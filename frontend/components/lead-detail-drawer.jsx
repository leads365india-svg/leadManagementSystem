"use client"

import React, { useState, useEffect, useMemo, useCallback } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import InBrowserAudioPlayer from "@/components/in-browser-audio-player"
import { toast } from "react-hot-toast"
import {
  X,
  Copy,
  Check,
  Building2,
  Phone,
  Mail,
  Calendar,
  CalendarClock,
  Clock,
  User,
  Users,
  Shield,
  Tag,
  MessageSquare,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Trash2,
  Edit2,
  PhoneCall,
  Sparkles,
  History,
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Layers,
  MapPin,
  Globe,
  Share2,
  Plus,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
} from "lucide-react"

// Status styling configuration
const STATUS_CONFIG = {
  New: {
    label: "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
  },
  Engaged: {
    label: "Engaged (Active)",
    dotColor: "bg-amber-500",
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
  },
  "Proposal Sent": {
    label: "Proposal Sent",
    dotColor: "bg-purple-500",
    badgeClasses: "bg-purple-50 text-purple-700 border-purple-200/80",
  },
  "Closed-Won": {
    label: "Closed-Won (Order Placed)",
    dotColor: "bg-emerald-500",
    badgeClasses: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  },
  "Closed-Lost": {
    label: "Closed-Lost (Lost)",
    dotColor: "bg-rose-500",
    badgeClasses: "bg-rose-50 text-rose-700 border-rose-200/80",
  },
}

const ALL_STATUSES = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]

export default function LeadDetailDrawer({
  isOpen,
  leadId,
  initialLead,
  onClose,
  onLeadUpdated,
  onEditLead,
  onDeleteLead,
}) {
  const [activeTab, setActiveTab] = useState("timeline") // "timeline" | "notes" | "followups" | "calls" | "details"
  const [lead, setLead] = useState(initialLead || null)
  const [loading, setLoading] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [followUps, setFollowUps] = useState([])
  const [loadingFollowUps, setLoadingFollowUps] = useState(false)
  const [activities, setActivities] = useState([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [activitiesError, setActivitiesError] = useState(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [savingNote, setSavingNote] = useState("")
  const [timelineFilter, setTimelineFilter] = useState("all") // "all" | "status" | "assignment" | "followup" | "notes"
  const [playingCallId, setPlayingCallId] = useState(null)

  // Update lead when initialLead or leadId changes
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead)
    }
  }, [initialLead])

  // Fetch full lead details on drawer open
  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return
    try {
      setLoading(true)
      const res = await apiClient.getLeadById(leadId)
      if (res.success && res.data) {
        setLead(res.data)
        if (onLeadUpdated) onLeadUpdated(res.data)
      }
    } catch (err) {
      console.error("Failed to load lead details:", err)
      // If initialLead exists, we keep it as fallback
    } finally {
      setLoading(false)
    }
  }, [leadId, onLeadUpdated])

  const fetchLeadFollowUps = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingFollowUps(true)
      const res = await apiClient.getFollowUps({ leadId, limit: 50 })
      if (res.success && res.data?.followUps) {
        setFollowUps(res.data.followUps)
      } else if (Array.isArray(res.data)) {
        setFollowUps(res.data)
      }
    } catch (err) {
      console.error("Failed to fetch follow-ups for lead:", err)
    } finally {
      setLoadingFollowUps(false)
    }
  }, [leadId])

  // Phase 10: Fetch real chronological activity timeline from API
  const fetchLeadActivities = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingActivities(true)
      setActivitiesError(null)
      const res = await apiClient.getLeadActivities(leadId, { limit: 100 })
      if (res && res.success) {
        if (Array.isArray(res.data?.activities)) {
          setActivities(res.data.activities)
        } else if (Array.isArray(res.activities)) {
          setActivities(res.activities)
        } else if (Array.isArray(res.data)) {
          setActivities(res.data)
        } else {
          setActivities([])
        }
      } else {
        setActivitiesError(res?.error || "Failed to load timeline activities")
      }
    } catch (err) {
      console.error("Failed to fetch activities for lead:", err)
      setActivitiesError(err.message || "Failed to load timeline activities")
    } finally {
      setLoadingActivities(false)
    }
  }, [leadId])

  const [calls, setCalls] = useState([])
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [showLogCallForm, setShowLogCallForm] = useState(false)
  const [callFormData, setCallFormData] = useState({
    direction: "outbound",
    duration: 60,
    status: "completed",
    disposition: "Interested",
    notes: "",
  })
  const [submittingCall, setSubmittingCall] = useState(false)

  // Fetch calls for lead (Phase 14)
  const fetchLeadCalls = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingCalls(true)
      const res = await apiClient.getCalls({ leadId, limit: 50 })
      if (res && res.success && Array.isArray(res.data?.calls)) {
        setCalls(res.data.calls)
      } else if (Array.isArray(res?.data)) {
        setCalls(res.data)
      } else {
        setCalls([])
      }
    } catch (err) {
      console.error("Failed to fetch calls for lead:", err)
      setCalls([])
    } finally {
      setLoadingCalls(false)
    }
  }, [leadId])

  const handleLogCallSubmit = async (e) => {
    e.preventDefault()
    if (!lead) return
    try {
      setSubmittingCall(true)
      const payload = {
        leadId: lead._id || lead.id,
        number: lead.phoneNormalized || lead.phone || "unknown",
        direction: callFormData.direction,
        duration: Number(callFormData.duration) || 0,
        status: callFormData.status,
        disposition: callFormData.disposition,
        notes: callFormData.notes,
        startedAt: new Date(Date.now() - (Number(callFormData.duration) || 0) * 1000).toISOString(),
        endedAt: new Date().toISOString(),
      }
      const res = await apiClient.logCall(payload)
      if (res && res.success) {
        toast.success("Call logged successfully")
        setShowLogCallForm(false)
        setCallFormData({
          direction: "outbound",
          duration: 60,
          status: "completed",
          disposition: "Interested",
          notes: "",
        })
        fetchLeadCalls()
        fetchLeadActivities()
        fetchLeadDetails()
      } else {
        toast.error(res?.message || "Failed to log call")
      }
    } catch (err) {
      toast.error(err.message || "Failed to log call")
    } finally {
      setSubmittingCall(false)
    }
  }

  useEffect(() => {
    if (isOpen && leadId) {
      fetchLeadDetails()
      fetchLeadFollowUps()
      fetchLeadActivities()
      fetchLeadCalls()
    }
  }, [isOpen, leadId, fetchLeadDetails, fetchLeadFollowUps, fetchLeadActivities, fetchLeadCalls])

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // Quick Copy Helper
  const handleCopy = (text, fieldName) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    toast.success(`Copied to clipboard`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Quick Status Change Handler
  const handleStatusChange = async (newStatus) => {
    if (!lead || !lead._id || newStatus === lead.status || updatingStatus) return
    try {
      setUpdatingStatus(true)
      const res = await apiClient.updateLeadStatus(lead._id, newStatus)
      if (res.success && res.data) {
        const updated = {
          ...lead,
          status: newStatus,
          metadata: {
            ...lead.metadata,
            statusHistory: res.data.statusHistory || [
              ...(lead.metadata?.statusHistory || []),
              {
                status: newStatus,
                changedAt: new Date().toISOString(),
                changedBy: "Current User",
              },
            ],
          },
        }
        setLead(updated)
        if (onLeadUpdated) onLeadUpdated(updated)
        toast.success(`Pipeline status updated to ${newStatus}`)
        // Refresh activity timeline to display new status_changed event
        fetchLeadActivities()
      }
    } catch (err) {
      toast.error(err.message || "Failed to update status")
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Add Note Handler
  const handleAddNote = async (e) => {
    e.preventDefault()
    if (!newNote.trim() || !lead || !lead._id || savingNote) return
    try {
      setSavingNote(true)
      const dateStr = new Date().toLocaleString()
      const formattedNote = `[Note - ${dateStr}]: ${newNote.trim()}`
      const updatedMessage = lead.message ? `${lead.message}\n\n${formattedNote}` : formattedNote

      const res = await apiClient.updateLead(lead._id, {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        message: updatedMessage,
      })

      if (res.success && res.data) {
        const updated = { ...lead, message: updatedMessage }
        setLead(updated)
        if (onLeadUpdated) onLeadUpdated(updated)
        setNewNote("")
        toast.success("Note added successfully")
        // Refresh activity timeline to display new note_added event
        fetchLeadActivities()
      }
    } catch (err) {
      toast.error(err.message || "Failed to save note")
    } finally {
      setSavingNote(false)
    }
  }

  // Synthesize Activity Timeline Events
  const activityTimeline = useMemo(() => {
    if (!lead) return []

    const events = []

    // 1. If real activities exist from backend API, map them directly
    if (Array.isArray(activities) && activities.length > 0) {
      activities.forEach((act, idx) => {
        if (!act) return
        const actId = act._id || act.id || `act-${idx}`
        const actDate = act.createdAt ? new Date(act.createdAt) : new Date()
        const actorName = act.actor?.name || "System"
        const actType = act.type || ""

        if (actType === "lead.created" || actType === "created") {
          events.push({
            id: actId,
            type: "created",
            title: "Lead Created",
            description: act.payload?.source
              ? `Lead ingested from ${act.payload.source}${act.payload?.company ? ` (${act.payload.company})` : ""}`
              : "Lead record created",
            actor: actorName,
            timestamp: actDate,
            icon: Sparkles,
            iconBg: "bg-blue-100 text-blue-600 border-blue-200",
            category: "status",
          })
        } else if (actType === "lead.status_changed" || actType === "status_changed") {
          events.push({
            id: actId,
            type: "status_change",
            title: act.payload?.toStatus ? `Status Changed to ${act.payload.toStatus}` : "Status Changed",
            description: act.payload?.fromStatus && act.payload?.toStatus
              ? `Transitioned from ${act.payload.fromStatus} to ${act.payload.toStatus}`
              : act.payload?.note || "Stage updated in sales pipeline",
            actor: actorName,
            timestamp: actDate,
            icon: History,
            iconBg: "bg-purple-100 text-purple-600 border-purple-200",
            category: "status",
            badge: act.payload?.toStatus,
          })
        } else if (actType === "lead.owner_changed" || actType === "owner_changed") {
          events.push({
            id: actId,
            type: "assignment",
            title: `Assigned to ${act.payload?.toOwnerName || "Staff"}`,
            description: act.payload?.reason
              ? `Reason: ${act.payload.reason} (Previous: ${act.payload?.fromOwnerName || "Unassigned"})`
              : `Reassigned from ${act.payload?.fromOwnerName || "Unassigned"}`,
            actor: actorName,
            timestamp: actDate,
            icon: User,
            iconBg: "bg-emerald-100 text-emerald-600 border-emerald-200",
            category: "assignment",
          })
        } else if (actType === "lead.note_added" || actType === "note_added") {
          events.push({
            id: actId,
            type: "note",
            title: "Note Added",
            description: act.payload?.note || "Note added to lead record",
            actor: actorName,
            timestamp: actDate,
            icon: MessageSquare,
            iconBg: "bg-indigo-100 text-indigo-600 border-indigo-200",
            category: "notes",
          })
        } else if (actType.startsWith("lead.followup") || actType.startsWith("followup")) {
          const isCompleted = actType.includes("completed")
          events.push({
            id: actId,
            type: isCompleted ? "followup_completed" : "followup_scheduled",
            title: isCompleted ? "Follow-up Completed" : "Follow-up Scheduled",
            description: act.payload?.outcomeNotes || act.payload?.notes || act.payload?.title || "Follow-up touchpoint",
            actor: actorName,
            timestamp: actDate,
            icon: isCompleted ? CheckCircle2 : CalendarClock,
            iconBg: isCompleted ? "bg-teal-100 text-teal-600 border-teal-200" : "bg-amber-100 text-amber-600 border-amber-200",
            category: "followup",
          })
        } else {
          events.push({
            id: actId,
            type: actType,
            title: actType.replace("lead.", "").replace("_", " ").toUpperCase(),
            description: typeof act.payload === "object" ? JSON.stringify(act.payload) : String(act.payload || ""),
            actor: actorName,
            timestamp: actDate,
            icon: Clock,
            iconBg: "bg-slate-100 text-slate-600 border-slate-200",
            category: "status",
          })
        }
      })

      // Combine with active/scheduled follow-ups that aren't already represented
      if (Array.isArray(followUps)) {
        followUps.forEach((fu) => {
          if (!fu || !fu.createdAt) return
          const fuTime = new Date(fu.createdAt).getTime()
          const exists = events.some((e) => e.category === "followup" && Math.abs(e.timestamp.getTime() - fuTime) < 3000)
          if (!exists) {
            events.push({
              id: `fu-sched-${fu._id || fu.id}`,
              type: "followup_scheduled",
              title: `Follow-up Scheduled: ${fu.title || fu.type || "Call"}`,
              description: `Scheduled for ${new Date(fu.scheduledAt).toLocaleString()} with priority ${fu.priority || "medium"}`,
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.createdAt),
              icon: CalendarClock,
              iconBg: "bg-amber-100 text-amber-600 border-amber-200",
              category: "followup",
            })
          }
        })
      }
    } else {
      // Fallback: Synthesize from lead metadata, statusHistory, assignmentHistory
      // 1. Lead Creation Event
      if (lead.createdAt) {
        events.push({
          id: "event-created",
          type: "created",
          title: "Lead Created",
          description: `Lead ingested from ${lead.source || "Website Form"}${
            lead.attribution?.firstTouch?.landingPage ? ` on ${lead.attribution.firstTouch.landingPage}` : ""
          }`,
          actor: lead.metadata?.receivedVia ? "Webhook / API" : "System / User",
          timestamp: new Date(lead.createdAt),
          icon: Sparkles,
          iconBg: "bg-blue-100 text-blue-600 border-blue-200",
          category: "status",
        })
      }

      // 2. Status Transitions from metadata.statusHistory
      if (Array.isArray(lead.metadata?.statusHistory)) {
        lead.metadata.statusHistory.forEach((hist, idx) => {
          if (!hist) return
          const stName = hist.toStatus || hist.status
          const timeVal = hist.transitionedAt || hist.changedAt
          if (!stName) return
          events.push({
            id: `status-${idx}`,
            type: "status_change",
            title: `Status Changed to ${stName}`,
            description: hist.fromStatus
              ? `Transitioned from ${hist.fromStatus} to ${stName}`
              : hist.note || `Stage updated in sales pipeline`,
            actor: hist.transitionedBy || hist.changedBy || "System User",
            timestamp: timeVal ? new Date(timeVal) : new Date(),
            icon: History,
            iconBg: "bg-purple-100 text-purple-600 border-purple-200",
            category: "status",
            badge: stName,
          })
        })
      }

      // 3. Ownership / Assignment Transitions from assignmentHistory
      if (Array.isArray(lead.assignmentHistory)) {
        lead.assignmentHistory.forEach((assign, idx) => {
          if (!assign || !assign.assignedAt) return
          events.push({
            id: `assignment-${idx}`,
            type: "assignment",
            title: `Assigned to ${assign.toOwnerName || "Staff Member"}`,
            description: assign.reason
              ? `Reason: ${assign.reason} (Previous: ${assign.fromOwnerName || "Unassigned"})`
              : `Reassigned from ${assign.fromOwnerName || "Unassigned"}`,
            actor: assign.assignedByName || "System",
            timestamp: new Date(assign.assignedAt),
            icon: User,
            iconBg: "bg-emerald-100 text-emerald-600 border-emerald-200",
            category: "assignment",
          })
        })
      }

      // 4. Follow-up Activities
      if (Array.isArray(followUps)) {
        followUps.forEach((fu) => {
          if (!fu) return
          if (fu.createdAt) {
            events.push({
              id: `fu-created-${fu._id || fu.id}`,
              type: "followup_scheduled",
              title: `Follow-up Scheduled: ${fu.title || fu.type || "Call"}`,
              description: `Scheduled for ${new Date(fu.scheduledAt).toLocaleString()} with priority ${
                fu.priority || "medium"
              }`,
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.createdAt),
              icon: CalendarClock,
              iconBg: "bg-amber-100 text-amber-600 border-amber-200",
              category: "followup",
            })
          }
          if (fu.status === "completed" && (fu.completedAt || fu.updatedAt)) {
            events.push({
              id: `fu-completed-${fu._id || fu.id}`,
              type: "followup_completed",
              title: `Follow-up Completed: ${fu.title || fu.type}`,
              description: fu.outcomeNotes || fu.notes || "Marked as completed",
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.completedAt || fu.updatedAt),
              icon: CheckCircle2,
              iconBg: "bg-teal-100 text-teal-600 border-teal-200",
              category: "followup",
            })
          }
        })
      }

      // 5. Notes / Inquiries
      if (lead.message) {
        events.push({
          id: "event-note-primary",
          type: "note",
          title: "Inquiry / Note Added",
          description: lead.message,
          actor: lead.name || "Lead",
          timestamp: new Date(lead.createdAt || Date.now()),
          icon: MessageSquare,
          iconBg: "bg-indigo-100 text-indigo-600 border-indigo-200",
          category: "notes",
        })
      }
    }

    // Sort descending by timestamp
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return events
  }, [lead, activities, followUps])

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === "all") return activityTimeline
    return activityTimeline.filter((ev) => ev.category === timelineFilter)
  }, [activityTimeline, timelineFilter])

  if (!isOpen) return null

  const shortId = (lead?._id || lead?.id || "").slice(-6).toUpperCase()
  const statusInfo = STATUS_CONFIG[lead?.status] || {
    label: lead?.status || "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Slide-out Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10">
        <div className="w-screen max-w-2xl bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out animate-in slide-in-from-right">
          
          {/* =========================================================================
              DRAWER HEADER
          ========================================================================= */}
          <div className="p-6 bg-slate-50/70 border-b border-slate-200 shrink-0">
            <div className="flex items-start justify-between gap-4">
              {/* Lead identity & avatar */}
              <div className="flex items-start space-x-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg uppercase shadow-sm shrink-0">
                  {lead?.name ? lead.name.charAt(0) : "L"}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-bold text-slate-900 truncate">{lead?.name || "Lead Details"}</h2>
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700">
                      #LD-{shortId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(lead?._id || lead?.id, "lead-id")}
                      className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                      title="Copy full Lead ID"
                    >
                      {copiedField === "lead-id" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {lead?.company && (
                    <div className="flex items-center space-x-1.5 text-xs text-indigo-700 font-semibold mt-0.5">
                      <Building2 className="w-3.5 h-3.5" />
                      <span className="truncate">{lead.company}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {/* Status badge with interactive dropdown */}
                    <div className="relative inline-block">
                      <select
                        value={lead?.status || "New"}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        disabled={updatingStatus}
                        className={`text-xs font-bold rounded-full pl-6 pr-6 py-1 border transition-colors cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${statusInfo.badgeClasses}`}
                      >
                        {ALL_STATUSES.map((st) => (
                          <option key={st} value={st} className="bg-white text-slate-800 font-medium">
                            {st}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`w-1.5 h-1.5 rounded-full absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${statusInfo.dotColor}`}
                      />
                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Owner / Assignee pill */}
                    <div className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>{lead?.ownerId?.name || lead?.assignedTo || "Unassigned"}</span>
                    </div>

                    {/* Source pill */}
                    <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      <Globe className="w-3 h-3" />
                      <span>{lead?.source || "Website"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action buttons on header */}
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={fetchLeadDetails}
                  disabled={loading}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Refresh lead record"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Close Drawer (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Contact Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-200/80 text-xs text-slate-600 font-mono">
              <div className="flex items-center space-x-2 truncate">
                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {lead?.email ? (
                  <a href={`mailto:${lead.email}`} className="truncate hover:text-indigo-600 hover:underline">
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-slate-400 italic">No email address</span>
                )}
              </div>
              <div className="flex items-center space-x-2 truncate">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {lead?.phone ? (
                  <a href={`tel:${lead.phone}`} className="truncate hover:text-indigo-600 hover:underline">
                    {lead.phone}
                    {lead.phoneNormalized && lead.phoneNormalized !== lead.phone && (
                      <span className="text-[10px] text-slate-400 ml-1">({lead.phoneNormalized})</span>
                    )}
                  </a>
                ) : (
                  <span className="text-slate-400 italic">No phone number</span>
                )}
              </div>
            </div>
          </div>

          {/* =========================================================================
              TABS NAVIGATION
          ========================================================================= */}
          <div className="flex items-center px-6 bg-white border-b border-slate-200 shrink-0 overflow-x-auto text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === "timeline"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Timeline</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
                {activityTimeline.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("notes")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === "notes"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Notes</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("followups")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === "followups"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Follow-ups</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
                {followUps.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("calls")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === "calls"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Calls & Recordings</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
                {calls.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === "details"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Details & Attribution</span>
            </button>
          </div>

          {/* =========================================================================
              TAB CONTENT BODY
          ========================================================================= */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* TAB 1: ACTIVITY TIMELINE */}
            {activeTab === "timeline" && (
              <div className="space-y-4">
                {/* Timeline Filter Pills */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-400 mr-1 text-[11px]">Filter:</span>
                    {["all", "status", "assignment", "followup", "notes"].map((filterKey) => (
                      <button
                        key={filterKey}
                        type="button"
                        onClick={() => setTimelineFilter(filterKey)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                          timelineFilter === filterKey
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}
                      </button>
                    ))}
                  </div>

                  <span className="text-[11px] text-slate-400 font-mono">
                    {filteredTimeline.length} events
                  </span>
                </div>

                {loadingActivities && activities.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 space-y-2">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-medium">Loading timeline activities...</p>
                  </div>
                ) : activitiesError ? (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                    <span>{activitiesError}</span>
                    <button
                      type="button"
                      onClick={fetchLeadActivities}
                      className="px-2.5 py-1 bg-white border border-rose-300 rounded font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                ) : filteredTimeline.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 space-y-2">
                    <History className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="text-xs font-medium">No activity events found for this filter</p>
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {filteredTimeline.map((item) => {
                      const IconComponent = item.icon || Clock
                      return (
                        <div key={item.id} className="relative group">
                          {/* Circle Icon Badge on Timeline Bar */}
                          <div
                            className={`absolute -left-6 top-0 w-6 h-6 rounded-full flex items-center justify-center border text-xs shadow-2xs ${item.iconBg}`}
                          >
                            <IconComponent className="w-3 h-3" />
                          </div>

                          <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/80 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-bold text-xs text-slate-900">{item.title}</h4>
                                <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{item.description}</p>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap shrink-0">
                                {item.timestamp ? item.timestamp.toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }) : "—"}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2 border-t border-slate-200/50">
                              <span className="flex items-center gap-1 font-medium">
                                <User className="w-3 h-3 text-slate-400" />
                                <span>{item.actor}</span>
                              </span>
                              {item.badge && (
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-200 text-slate-700">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: NOTES */}
            {activeTab === "notes" && (
              <div className="space-y-5">
                {/* Add Note Form */}
                <form onSubmit={handleAddNote} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Add New Note</span>
                    </label>
                    <span className="text-[10px] text-slate-400">Appends to lead communication notes</span>
                  </div>
                  <textarea
                    rows={3}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Enter discussion notes, call takeaways, or follow-up instructions..."
                    className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!newNote.trim() || savingNote}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      {savingNote ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Saving Note...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Save Note</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Display Current Notes */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-900">Communication Notes</h4>
                  {lead?.message ? (
                    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans">
                      {lead.message}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      No notes recorded for this lead yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: FOLLOW-UPS */}
            {activeTab === "followups" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900">Scheduled Follow-ups</h4>
                  <Link
                    href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>+ Schedule Follow-up</span>
                  </Link>
                </div>

                {loadingFollowUps ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Loading follow-ups...
                  </div>
                ) : followUps.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-100 p-6 space-y-2">
                    <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-medium">No follow-ups scheduled for this lead</p>
                    <Link
                      href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                      className="inline-block text-xs text-indigo-600 hover:underline font-semibold mt-1"
                    >
                      Schedule first follow-up call or task
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {followUps.map((fu) => {
                      const isCompleted = fu.status === "completed"
                      const isOverdue =
                        fu.status === "pending" && new Date(fu.scheduledAt) < new Date()
                      return (
                        <div
                          key={fu._id || fu.id}
                          className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900">{fu.title || fu.type}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isCompleted
                                    ? "bg-emerald-100 text-emerald-800"
                                    : isOverdue
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {isCompleted ? "Completed" : isOverdue ? "Overdue" : "Pending"}
                              </span>
                            </div>
                            <p className="text-slate-500 font-mono text-[11px]">
                              {new Date(fu.scheduledAt).toLocaleString()}
                            </p>
                            {fu.notes && <p className="text-slate-600 mt-1">{fu.notes}</p>}
                          </div>

                          <span className="px-2 py-1 rounded bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
                            {fu.priority || "Medium"}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CALLS & RECORDINGS (Phase 14) */}
            {activeTab === "calls" && (
              <div className="space-y-4">
                {/* Header bar with count and Log Call toggle button */}
                <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <PhoneCall className="w-4 h-4 text-indigo-600" />
                      <span>Telephony & Call Logs</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Target: <span className="font-mono font-semibold">{lead?.phoneNormalized || lead?.phone || "No phone"}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLogCallForm(!showLogCallForm)}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition cursor-pointer shadow-xs"
                  >
                    {showLogCallForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{showLogCallForm ? "Cancel" : "Log Call"}</span>
                  </button>
                </div>

                {/* Collapsible Log Call Form */}
                {showLogCallForm && (
                  <form
                    onSubmit={handleLogCallSubmit}
                    className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100 space-y-3 animate-in fade-in duration-200"
                  >
                    <div className="flex items-center justify-between border-b border-indigo-100/60 pb-2">
                      <span className="text-xs font-bold text-indigo-900">Record a Call Interaction</span>
                      <span className="text-[10px] text-slate-400">Updates lead timeline & last contact</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Direction</label>
                        <select
                          value={callFormData.direction}
                          onChange={(e) => setCallFormData({ ...callFormData, direction: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="outbound">Outbound (Agent initiated)</option>
                          <option value="inbound">Inbound (Client received)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Duration (seconds)</label>
                        <input
                          type="number"
                          min="0"
                          value={callFormData.duration}
                          onChange={(e) => setCallFormData({ ...callFormData, duration: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="60"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                        <select
                          value={callFormData.status}
                          onChange={(e) => setCallFormData({ ...callFormData, status: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="completed">Completed (Connected)</option>
                          <option value="busy">Busy</option>
                          <option value="no-answer">No Answer</option>
                          <option value="failed">Failed / Dropped</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Disposition</label>
                        <select
                          value={callFormData.disposition}
                          onChange={(e) => setCallFormData({ ...callFormData, disposition: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="Interested">Interested / Qualified</option>
                          <option value="Follow-up Required">Follow-up Required</option>
                          <option value="Not Interested">Not Interested</option>
                          <option value="Wrong Number">Wrong Number</option>
                          <option value="Left Voicemail">Left Voicemail</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Discussion Notes</label>
                      <textarea
                        rows={2}
                        value={callFormData.notes}
                        onChange={(e) => setCallFormData({ ...callFormData, notes: e.target.value })}
                        placeholder="Add call outcome notes, customer feedback, next steps..."
                        className="w-full text-xs rounded-lg border border-slate-300 bg-white p-2.5 font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowLogCallForm(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingCall}
                        className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:opacity-50"
                      >
                        {submittingCall ? "Saving..." : "Save Call Log"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Loading State */}
                {loadingCalls && (
                  <div className="py-8 text-center text-xs text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-500 mb-2" />
                    Loading call interactions...
                  </div>
                )}

                {/* Empty State */}
                {!loadingCalls && calls.length === 0 && (
                  <div className="py-10 text-center space-y-3 max-w-sm mx-auto">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-100">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <h5 className="font-bold text-xs text-slate-800">No calls recorded yet</h5>
                    <p className="text-[11px] text-slate-500">
                      Log calls manually using the button above, or allow agent mobile devices to sync call logs automatically.
                    </p>
                  </div>
                )}

                {/* Call Logs List */}
                {!loadingCalls && calls.length > 0 && (
                  <div className="space-y-2.5">
                    {calls.map((c) => {
                      const isOutbound = c.direction === "outbound"
                      const durationMinutes = Math.floor((c.duration || 0) / 60)
                      const durationSeconds = (c.duration || 0) % 60
                      const durationStr = durationMinutes > 0 ? `${durationMinutes}m ${durationSeconds}s` : `${durationSeconds}s`

                      return (
                        <div
                          key={c._id || c.id}
                          className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isOutbound ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}
                              >
                                {isOutbound ? <PhoneOutgoing className="w-3 h-3" /> : <PhoneIncoming className="w-3 h-3" />}
                                <span className="capitalize">{c.direction}</span>
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  c.status === "completed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : c.status === "busy"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {c.status}
                              </span>
                              {c.disposition && (
                                <span className="text-[10px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                                  {c.disposition}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-500">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{durationStr}</span>
                            </div>
                          </div>

                          {c.notes && (
                            <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100 font-sans leading-relaxed">
                              {c.notes}
                            </p>
                          )}

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                            <div className="flex items-center space-x-1.5">
                              <User className="w-3 h-3 text-slate-400" />
                              <span>{c.agentId?.name || "Agent"}</span>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              {c.recording?.status === "stored" || c.recording?.status === "ready" ? (
                                <button
                                  type="button"
                                  onClick={() => setPlayingCallId(playingCallId === c._id ? null : c._id)}
                                  className="inline-flex items-center text-indigo-600 hover:text-indigo-800 font-bold gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 transition"
                                >
                                  <Mic className="w-3 h-3" />
                                  <span>{playingCallId === c._id ? "Hide Player" : "Play Recording"}</span>
                                </button>
                              ) : c.recording?.status === "skipped_dnr" ? (
                                <span className="inline-flex items-center text-rose-600 text-[10px] font-semibold gap-1">
                                  <Shield className="w-3 h-3" /> Skipped (DNR)
                                </span>
                              ) : c.recording?.status === "expired" ? (
                                <span className="inline-flex items-center text-amber-600 text-[10px] font-semibold gap-1">
                                  <Clock className="w-3 h-3" /> Purged (30d)
                                </span>
                              ) : (
                                <span className="text-slate-400">No recording</span>
                              )}
                              <span>•</span>
                              <span>{c.startedAt ? new Date(c.startedAt).toLocaleString() : "—"}</span>
                            </div>
                          </div>

                          {/* Embedded In-Browser Audio Player */}
                          {playingCallId === c._id && (
                            <div className="pt-2">
                              <InBrowserAudioPlayer
                                callId={c._id}
                                recording={c.recording}
                                agentName={c.agentId?.name || "Agent"}
                                leadPhone={c.number || lead?.phone}
                                direction={c.direction}
                                compact={true}
                                onClose={() => setPlayingCallId(null)}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: DETAILS & ATTRIBUTION */}
            {activeTab === "details" && (
              <div className="space-y-6 text-xs">
                {/* 1. Contact Info Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Contact Information</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Primary Phone</span>
                      <span className="font-semibold text-slate-800">{lead?.phone || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Normalized (E.164)</span>
                      <span className="font-semibold text-slate-800">{lead?.phoneNormalized || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Alternate Phone</span>
                      <span className="font-semibold text-slate-800">{lead?.alternatePhone || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">City / Location</span>
                      <span className="font-semibold text-slate-800">{lead?.city || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Marketing Attribution (Multi-touch) */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Multi-touch Marketing Attribution</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">First-touch write once</span>
                  </div>

                  <div className="space-y-3">
                    {/* First Touch */}
                    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                      <span className="text-[11px] font-bold text-indigo-700 block">First Touch Attribution</span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Source</span>
                          <span className="font-semibold text-slate-800">{lead?.attribution?.firstTouch?.source || lead?.source || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Medium</span>
                          <span className="text-slate-800">{lead?.attribution?.firstTouch?.medium || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Campaign</span>
                          <span className="text-slate-800">{lead?.attribution?.firstTouch?.campaign || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">GCLID</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.gclid || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">FBCLID</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.fbclid || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Landing Page</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.landingPage || lead?.landingPage || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Last Touch if different */}
                    {lead?.attribution?.lastTouch?.source && (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                        <span className="text-[11px] font-bold text-slate-700 block">Last Touch Attribution</span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Source</span>
                            <span className="font-semibold text-slate-800">{lead.attribution.lastTouch.source}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Medium</span>
                            <span className="text-slate-800">{lead.attribution.lastTouch.medium || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Campaign</span>
                            <span className="text-slate-800">{lead.attribution.lastTouch.campaign || "—"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. System Metadata & Partitioning */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-600" />
                    <span>System Record & Partition</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tenant ID:</span>
                      <span className="font-bold text-indigo-700">{lead?.tenantId || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email Verified:</span>
                      <span className={lead?.isEmailVerified ? "text-emerald-600 font-bold" : "text-slate-500"}>
                        {lead?.verificationStatus || (lead?.isEmailVerified ? "Verified" : "Unverified")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Created At:</span>
                      <span>{lead?.createdAt ? new Date(lead.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Contacted:</span>
                      <span>{lead?.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : "Never"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* =========================================================================
              DRAWER FOOTER ACTIONS
          ========================================================================= */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 shrink-0 flex items-center justify-between gap-3 text-xs">
            <button
              type="button"
              onClick={() => {
                if (onDeleteLead) onDeleteLead(lead)
              }}
              className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Lead</span>
            </button>

            <div className="flex items-center space-x-2">
              <Link
                href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Schedule Follow-up</span>
              </Link>

              <button
                type="button"
                onClick={() => {
                  if (onEditLead) onEditLead(lead)
                }}
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Lead</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
