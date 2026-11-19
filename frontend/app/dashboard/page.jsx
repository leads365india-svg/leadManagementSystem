"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

export default function DashboardPage() {
  const router = useRouter()
  const { user, status, loading, hasPermission } = useAuth()

  useEffect(() => {
    if (loading || status === "loading" || status === "idle") return

    if (status === "unauthenticated") {
      router.replace("/portal/login")
      return
    }

    if (user?.role === "super_admin") {
      router.replace("/super-admin")
      return
    }

    // Gated by dashboard.view permission
    if (typeof hasPermission === "function" && hasPermission("dashboard.view")) {
      router.replace("/portal")
      return
    }

    // If custom role does not possess dashboard.view, redirect to first permitted route
    if (typeof hasPermission === "function") {
      if (hasPermission("leads.view*")) {
        router.replace("/leads")
      } else if (hasPermission("calls.view*") || hasPermission("calls.log")) {
        router.replace("/communication/call-reports")
      } else if (hasPermission("followups.view*") || hasPermission("followups.manage*")) {
        router.replace("/communication/follow-ups")
      } else if (hasPermission("reports.view")) {
        router.replace("/reports/leads")
      } else if (hasPermission("settings.view") || hasPermission("settings.manage")) {
        router.replace("/settings/custom-fields")
      } else {
        router.replace("/leads")
      }
    } else {
      router.replace("/leads")
    }
  }, [router, user, status, loading, hasPermission])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
