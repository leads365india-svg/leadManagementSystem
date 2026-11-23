"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { apiClient } from "@/lib/api"
import {
  Bell,
  Clock,
  PhoneCall,
  AlertTriangle,
  AlertCircle,
  X,
  ExternalLink,
  ChevronRight,
  User,
  Phone,
  Sparkles,
} from "lucide-react"

const STORAGE_KEY = "leadflow_alerted_followups"

function getAlertHistory() {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (_) {
    return {}
  }
}

function saveAlertHistory(history) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch (_) {}
}

export default function FollowUpAlertManager() {
  const router = useRouter()
  const { user } = useAuth()
  const [activeAlerts, setActiveAlerts] = useState([])
  const [browserPermission, setBrowserPermission] = useState("default")
  const pollingTimerRef = useRef(null)

  // Track browser notification permission status
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermission(Notification.permission)
      if (Notification.permission === "default") {
        const handleUserGesture = () => {
          Notification.requestPermission().then((perm) => {
            setBrowserPermission(perm)
          })
          window.removeEventListener("click", handleUserGesture)
        }
        window.addEventListener("click", handleUserGesture, { once: true })
      }
    }
  }, [])

  // Fire Web Notification if allowed
  const triggerBrowserNotification = useCallback((task, alertType) => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (Notification.permission !== "granted") return

    try {
      const customerName = task.customerName || task.lead?.name || "Customer"
      const action = task.taskAction || (task.direction === "OUTBOUND" ? "Call customer" : "Follow up with customer")
      let title = `Callback Due: ${customerName}`
      if (alertType === "pre") {
        title = `Upcoming Callback in 5 mins: ${customerName}`
      } else if (alertType === "overdue") {
        title = `Overdue Follow-up: ${customerName}`
      }

      const body = `${action} • ${task.customerPhone || task.lead?.phone || "Phone not listed"}`
      const notification = new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag: `followup_${task.id || task._id}_${alertType}`,
      })

      notification.onclick = () => {
        window.focus()
        router.push("/communication/follow-ups")
        notification.close()
      }
    } catch (err) {
      console.warn("Could not display browser notification:", err)
    }
  }, [router])

  // Core evaluation of pending follow-ups
  const evaluateFollowUps = useCallback(async () => {
    if (!user) return
    // Super admin without tenant context cannot query tenant follow-ups
    if (user.role === "super_admin" && !user.tenantId && typeof window !== "undefined" && !localStorage.getItem("leadflow_active_tenant")) {
      return
    }

    try {
      const res = await apiClient.getFollowUps({
        status: "pending",
        limit: 20,
        sortBy: "scheduledAt",
        sortOrder: "asc",
      })

      if (!res.success || !res.data?.followUps) return

      const tasks = res.data.followUps
      const now = Date.now()
      const alertHistory = getAlertHistory()
      const newAlerts = []

      for (const task of tasks) {
        const taskId = String(task.id || task._id)
        const scheduledTime = task.scheduledAt ? new Date(task.scheduledAt).getTime() : 0
        if (!scheduledTime) continue

        const diffMs = scheduledTime - now // positive: future, negative: past
        const diffMinutes = Math.round(diffMs / 60000)

        const taskHistory = alertHistory[taskId] || {}

        // 1. Pre-reminder: due within 5 minutes in future (0 < diffMs <= 5 mins)
        if (diffMs > 0 && diffMs <= 5 * 60 * 1000 && !taskHistory.pre) {
          taskHistory.pre = Date.now()
          alertHistory[taskId] = taskHistory
          newAlerts.push({
            task,
            alertType: "pre",
            title: `Upcoming in ${Math.max(1, diffMinutes)}m`,
            subtitle: `Call scheduled soon with ${task.customerName || task.lead?.name || "Customer"}`,
            timestamp: Date.now(),
          })
          triggerBrowserNotification(task, "pre")
        }
        // 2. Due now: scheduled time arrived (-5 mins <= diffMs <= 0)
        else if (diffMs <= 0 && diffMs >= -5 * 60 * 1000 && !taskHistory.due) {
          taskHistory.due = Date.now()
          alertHistory[taskId] = taskHistory
          newAlerts.push({
            task,
            alertType: "due",
            title: "Follow-up Due Now",
            subtitle: `Scheduled touchpoint for ${task.customerName || task.lead?.name || "Customer"} is due`,
            timestamp: Date.now(),
          })
          triggerBrowserNotification(task, "due")
        }
        // 3. Overdue: incomplete past scheduled time (diffMs < -5 mins)
        // Also fires on next login if user was offline when it was due
        else if (diffMs < -5 * 60 * 1000 && !taskHistory.overdue) {
          taskHistory.overdue = Date.now()
          alertHistory[taskId] = taskHistory
          const overdueMins = Math.abs(diffMinutes)
          newAlerts.push({
            task,
            alertType: "overdue",
            title: `Overdue by ${overdueMins >= 60 ? `${Math.floor(overdueMins / 60)}h ${overdueMins % 60}m` : `${overdueMins}m`}`,
            subtitle: `Action required: ${task.customerName || task.lead?.name || "Customer"} follow-up overdue`,
            timestamp: Date.now(),
          })
          triggerBrowserNotification(task, "overdue")
        }
      }

      saveAlertHistory(alertHistory)

      if (newAlerts.length > 0) {
        setActiveAlerts((prev) => {
          const combined = [...prev]
          for (const alert of newAlerts) {
            const exists = combined.some(
              (a) => (a.task.id || a.task._id) === (alert.task.id || alert.task._id) && a.alertType === alert.alertType,
            )
            if (!exists) {
              combined.unshift(alert)
            }
          }
          return combined.slice(0, 4) // Show at most 4 simultaneous alerts
        })
      }
    } catch (_) {
      // Non-fatal
    }
  }, [user, triggerBrowserNotification])

  // Periodic polling every 30 seconds
  useEffect(() => {
    evaluateFollowUps()
    pollingTimerRef.current = setInterval(evaluateFollowUps, 30000)

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current)
      }
    }
  }, [evaluateFollowUps])

  const dismissAlert = (taskId, alertType) => {
    setActiveAlerts((prev) =>
      prev.filter((a) => !((a.task.id || a.task._id) === taskId && a.alertType === alertType)),
    )
  }

  const handleOpenFollowUp = (task) => {
    dismissAlert(task.id || task._id, task.alertType)
    router.push("/communication/follow-ups")
  }

  if (activeAlerts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-3 max-w-sm sm:max-w-md w-full pointer-events-none">
      {activeAlerts.map(({ task, alertType, title, subtitle }) => {
        const taskId = task.id || task._id
        const customerName = task.customerName || task.lead?.name || "Customer"
        const customerPhone = task.customerPhone || task.lead?.phone || ""
        const isOverdue = alertType === "overdue"
        const actionText = task.taskAction || (task.direction === "OUTBOUND" ? "Call customer" : "Follow up")

        return (
          <div
            key={`${taskId}-${alertType}`}
            className={`pointer-events-auto p-4 rounded-2xl shadow-xl border backdrop-blur-md transition-all duration-300 animate-in slide-in-from-bottom-5 ${
              isOverdue
                ? "bg-rose-50/95 border-rose-300 text-rose-950 shadow-rose-200/50"
                : alertType === "due"
                ? "bg-amber-50/95 border-amber-300 text-amber-950 shadow-amber-200/50"
                : "bg-indigo-50/95 border-indigo-300 text-indigo-950 shadow-indigo-200/50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start space-x-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isOverdue
                      ? "bg-rose-200 text-rose-700"
                      : alertType === "due"
                      ? "bg-amber-200 text-amber-700"
                      : "bg-indigo-200 text-indigo-700"
                  }`}
                >
                  {isOverdue ? (
                    <AlertTriangle className="w-5 h-5 animate-bounce" />
                  ) : alertType === "due" ? (
                    <Clock className="w-5 h-5 animate-pulse" />
                  ) : (
                    <Bell className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-1.5">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        isOverdue
                          ? "bg-rose-600 text-white"
                          : alertType === "due"
                          ? "bg-amber-600 text-white"
                          : "bg-indigo-600 text-white"
                      }`}
                    >
                      {title}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {task.scheduledAt ? new Date(task.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mt-1">{customerName}</h4>
                  <p className="text-xs text-slate-600 mt-0.5 font-medium">{actionText}</p>
                  {customerPhone && (
                    <a
                      href={`tel:${customerPhone}`}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-indigo-700 hover:underline mt-1"
                    >
                      <Phone className="w-3 h-3" />
                      <span>{customerPhone}</span>
                    </a>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissAlert(taskId, alertType)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end space-x-2 mt-3 pt-3 border-t border-slate-200/60">
              <button
                type="button"
                onClick={() => dismissAlert(taskId, alertType)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-200/40 cursor-pointer"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => handleOpenFollowUp(task)}
                className={`inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-lg text-white shadow-xs transition-colors cursor-pointer ${
                  isOverdue
                    ? "bg-rose-600 hover:bg-rose-700"
                    : alertType === "due"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                <span>Open Follow-up</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
