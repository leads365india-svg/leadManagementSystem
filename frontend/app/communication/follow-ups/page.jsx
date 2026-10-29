"use client"

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import Breadcrumb from "@/components/breadcrumb"
import LeadDetailDrawer from "@/components/lead-detail-drawer"
import {
  PhoneCall,
  Calendar,
  Clock,
  Mail,
  Users,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  Check,
  X,
  ExternalLink,
  Building2,
  Phone,
  Sparkles,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  User,
  SlidersHorizontal,
  Inbox,
  CalendarClock,
  CheckSquare,
  FileText,
  BadgeAlert,
} from "lucide-react"

// Configuration for Follow-up Types with distinct icons and colors
const TYPE_CONFIG = {
  call: {
    label: "Phone Call",
    icon: PhoneCall,
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
    iconBg: "bg-blue-100 text-blue-600",
  },
  email: {
    label: "Email",
    icon: Mail,
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
    iconBg: "bg-amber-100 text-amber-600",
  },
  meeting: {
    label: "Meeting",
    icon: Calendar,
    badgeClasses: "bg-purple-50 text-purple-700 border-purple-200/80",
    iconBg: "bg-purple-100 text-purple-600",
  },
  task: {
    label: "Task / Todo",
    icon: CheckSquare,
    badgeClasses: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
    iconBg: "bg-indigo-100 text-indigo-600",
  },
  other: {
    label: "Other Touchpoint",
    icon: Sparkles,
    badgeClasses: "bg-slate-100 text-slate-700 border-slate-200",
    iconBg: "bg-slate-100 text-slate-600",
  },
}

// Configuration for Priorities
const PRIORITY_CONFIG = {
  high: {
    label: "High Priority",
    badgeClasses: "bg-rose-50 text-rose-700 border-rose-200/80",
    dotColor: "bg-rose-500",
  },
  medium: {
    label: "Medium Priority",
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
    dotColor: "bg-amber-500",
  },
  low: {
    label: "Low Priority",
    badgeClasses: "bg-slate-100 text-slate-600 border-slate-200",
    dotColor: "bg-slate-400",
  },
}

// Configuration for Lead Pipeline Statuses
const LEAD_STATUS_CONFIG = {
  New: "bg-blue-50 text-blue-700 border-blue-200/80",
  Engaged: "bg-amber-50 text-amber-700 border-amber-200/80",
  "Proposal Sent": "bg-purple-50 text-purple-700 border-purple-200/80",
  "Closed-Won": "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  "Closed-Lost": "bg-rose-50 text-rose-700 border-rose-200/80",
}

function FollowUpsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL state synchronization
  const currentStatusTab = searchParams.get("status") || "all"
  const currentTypeFilter = searchParams.get("type") || "all"
  const currentPriorityFilter = searchParams.get("priority") || "all"
  const currentSearch = searchParams.get("search") || ""
  const currentPage = Number(searchParams.get("page")) || 1
  const currentLimit = Number(searchParams.get("limit")) || 10
  const currentSortBy = searchParams.get("sortBy") || "scheduledAt"
  const currentSortOrder = searchParams.get("sortOrder") || "asc"

  // Data & KPI state
  const [followUpsData, setFollowUpsData] = useState(null)
  const [stats, setStats] = useState({
    total: 0,
    upcoming: 0,
    overdue: 0,
    today: 0,
    completed: 0,
    completionRate: 0,
  })
  const [leadsList, setLeadsList] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  // Local search input state (debounced sync to URL)
  const [searchInput, setSearchInput] = useState(currentSearch)

  // Modals state
  const [activeDrawerLeadId, setActiveDrawerLeadId] = useState(null)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [scheduleForm, setScheduleForm] = useState({
    leadId: "",
    title: "",
    type: "call",
    scheduledDate: "",
    scheduledTime: "10:00",
    priority: "medium",
    notes: "",
    assignedTo: "Unassigned",
  })
  const [scheduleErrors, setScheduleErrors] = useState({})
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false)

  // Detail / View Modal
  const [activeDetails, setActiveDetails] = useState(null)

  // Edit Modal
  const [editingFollowUp, setEditingFollowUp] = useState(null)
  const [editErrors, setEditErrors] = useState({})
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)

  // Complete Outcome Modal
  const [completingFollowUp, setCompletingFollowUp] = useState(null)
  const [completionNotes, setCompletionNotes] = useState("")
  const [isSubmittingComplete, setIsSubmittingComplete] = useState(false)

  // Delete Modal
  const [deletingFollowUp, setDeletingFollowUp] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Fetch KPI statistics
  const fetchStats = useCallback(async () => {
    try {
      const res = await apiClient.getFollowUpStats()
      if (res.success && res.data) {
        setStats(res.data)
      }
    } catch (err) {
      console.error("Failed to fetch follow-up stats:", err)
    }
  }, [])

  // Fetch Leads for the schedule dropdown selector
  const fetchLeadsForSelection = useCallback(async () => {
    try {
      const res = await apiClient.getLeads({ limit: 100, sortBy: "createdAt", sortOrder: "desc" })
      if (res.success && res.data?.leads) {
        setLeadsList(res.data.leads)
      }
    } catch (err) {
      console.error("Failed to load leads list for selector:", err)
    }
  }, [])

  // Fetch paginated follow-ups
  const fetchFollowUps = useCallback(async () => {
    try {
      setRefreshing(true)
      setError(null)

      const response = await apiClient.getFollowUps({
        page: currentPage,
        limit: currentLimit,
        status: currentStatusTab !== "all" ? currentStatusTab : undefined,
        type: currentTypeFilter !== "all" ? currentTypeFilter : undefined,
        priority: currentPriorityFilter !== "all" ? currentPriorityFilter : undefined,
        search: currentSearch || undefined,
        sortBy: currentSortBy,
        sortOrder: currentSortOrder,
      })

      if (response.success && response.data) {
        setFollowUpsData(response.data)
      } else {
        setError(response.error || "Failed to load follow-ups records")
      }
    } catch (err) {
      console.error("Error fetching follow-ups:", err)
      setError("Unable to connect to follow-ups service. Please verify your connection.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [
    currentPage,
    currentLimit,
    currentStatusTab,
    currentTypeFilter,
    currentPriorityFilter,
    currentSearch,
    currentSortBy,
    currentSortOrder,
  ])

  useEffect(() => {
    fetchFollowUps()
  }, [fetchFollowUps])

  useEffect(() => {
    fetchStats()
    fetchLeadsForSelection()
  }, [fetchStats, fetchLeadsForSelection])

  // Sync search input with URL params
  useEffect(() => {
    setSearchInput(currentSearch)
  }, [currentSearch])

  // Helper to push query updates
  const updateUrlParams = (updates = {}) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "" || value === "all") {
        params.delete(key)
      } else {
        params.set(key, value.toString())
      }
    })
    params.set("page", "1")
    router.push(`/communication/follow-ups?${params.toString()}`)
  }

  // Handle Tab Click
  const handleTabChange = (tabKey) => {
    updateUrlParams({ status: tabKey })
  }

  // Handle Filter Form Submit
  const handleSearchSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault()
    updateUrlParams({ search: searchInput.trim() })
  }

  // Handle Clear Filters
  const handleClearFilters = () => {
    setSearchInput("")
    router.push("/communication/follow-ups")
  }

  // Handle Sort Toggle
  const handleSortToggle = (field) => {
    const nextOrder = currentSortBy === field && currentSortOrder === "asc" ? "desc" : "asc"
    updateUrlParams({ sortBy: field, sortOrder: nextOrder })
  }

  // Open Schedule Modal (with pre-filled tomorrow date)
  const handleOpenScheduleModal = async (prefillLeadId = "") => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yyyy = tomorrow.getFullYear()
    const mm = String(tomorrow.getMonth() + 1).padStart(2, "0")
    const dd = String(tomorrow.getDate()).padStart(2, "0")

    let selectedLeadId = prefillLeadId
    if (prefillLeadId) {
      const exists = leadsList.some((l) => (l._id || l.id) === prefillLeadId)
      if (!exists) {
        try {
          const singleRes = await apiClient.getLeadById(prefillLeadId)
          if (singleRes.success && singleRes.data) {
            setLeadsList((prev) => [singleRes.data, ...prev])
          }
        } catch (e) {
          console.warn("Could not fetch target lead details:", e)
        }
      }
    } else if (leadsList.length > 0) {
      selectedLeadId = leadsList[0]._id || leadsList[0].id || ""
    }

    setScheduleForm({
      leadId: selectedLeadId,
      title: "",
      type: "call",
      scheduledDate: `${yyyy}-${mm}-${dd}`,
      scheduledTime: "11:00",
      priority: "medium",
      notes: "",
      assignedTo: "Unassigned",
    })
    setScheduleErrors({})
    setIsScheduleModalOpen(true)
  }

  // Auto-open schedule modal if action=schedule or leadId param is present
  useEffect(() => {
    const action = searchParams.get("action")
    const targetLeadId = searchParams.get("leadId")
    if (action === "schedule" || targetLeadId) {
      handleOpenScheduleModal(targetLeadId || "")
    }
  }, [searchParams])

  // Submit Schedule Form
  const handleSaveSchedule = async (e) => {
    e.preventDefault()
    const errors = {}

    if (!scheduleForm.leadId) {
      errors.leadId = "Please select a target lead"
    }
    if (!scheduleForm.scheduledDate) {
      errors.scheduledDate = "Please choose a scheduled date"
    }
    if (!scheduleForm.scheduledTime) {
      errors.scheduledTime = "Please specify a time"
    }

    if (Object.keys(errors).length > 0) {
      setScheduleErrors(errors)
      toast.error("Please fill in the required fields")
      return
    }

    try {
      setIsSubmittingSchedule(true)
      const scheduledDateTime = new Date(`${scheduleForm.scheduledDate}T${scheduleForm.scheduledTime}:00`)

      if (isNaN(scheduledDateTime.getTime())) {
        setScheduleErrors({ scheduledDate: "Invalid date or time value" })
        return
      }

      const selectedLead = leadsList.find((l) => l._id === scheduleForm.leadId || l.id === scheduleForm.leadId)
      const titleFallback = `${scheduleForm.type.toUpperCase()} follow-up with ${selectedLead?.name || "Lead"}`

      const payload = {
        leadId: scheduleForm.leadId,
        title: scheduleForm.title.trim() || titleFallback,
        type: scheduleForm.type,
        scheduledAt: scheduledDateTime.toISOString(),
        priority: scheduleForm.priority,
        notes: scheduleForm.notes.trim(),
        assignedTo: scheduleForm.assignedTo || selectedLead?.assignedTo || "Unassigned",
      }

      const res = await apiClient.createFollowUp(payload)
      if (res.success) {
        toast.success("Follow-up touchpoint scheduled successfully")
        setIsScheduleModalOpen(false)
        fetchFollowUps()
        fetchStats()
      } else {
        toast.error(res.error || "Failed to schedule follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to schedule follow-up")
    } finally {
      setIsSubmittingSchedule(false)
    }
  }

  // Open Edit Modal
  const handleOpenEdit = (item) => {
    const dateObj = new Date(item.scheduledAt)
    const yyyy = dateObj.getFullYear()
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0")
    const dd = String(dateObj.getDate()).padStart(2, "0")
    const hh = String(dateObj.getHours()).padStart(2, "0")
    const min = String(dateObj.getMinutes()).padStart(2, "0")

    setEditingFollowUp({
      _id: item._id || item.id,
      title: item.title,
      type: item.type,
      scheduledDate: `${yyyy}-${mm}-${dd}`,
      scheduledTime: `${hh}:${min}`,
      priority: item.priority || "medium",
      status: item.status || "pending",
      notes: item.notes || "",
      assignedTo: item.assignedTo || "Unassigned",
      lead: item.lead,
    })
    setEditErrors({})
  }

  // Submit Edit Form
  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editingFollowUp) return

    const errors = {}
    if (!editingFollowUp.title.trim()) errors.title = "Follow-up title is required"
    if (!editingFollowUp.scheduledDate) errors.scheduledDate = "Date is required"
    if (!editingFollowUp.scheduledTime) errors.scheduledTime = "Time is required"

    if (Object.keys(errors).length > 0) {
      setEditErrors(errors)
      toast.error("Please resolve validation errors")
      return
    }

    try {
      setIsSubmittingEdit(true)
      const scheduledDateTime = new Date(`${editingFollowUp.scheduledDate}T${editingFollowUp.scheduledTime}:00`)

      const payload = {
        title: editingFollowUp.title.trim(),
        type: editingFollowUp.type,
        scheduledAt: scheduledDateTime.toISOString(),
        priority: editingFollowUp.priority,
        status: editingFollowUp.status,
        notes: editingFollowUp.notes.trim(),
        assignedTo: editingFollowUp.assignedTo.trim(),
      }

      const res = await apiClient.updateFollowUp(editingFollowUp._id, payload)
      if (res.success) {
        toast.success("Follow-up updated successfully")
        setEditingFollowUp(null)
        if (activeDetails && (activeDetails._id === editingFollowUp._id || activeDetails.id === editingFollowUp._id)) {
          setActiveDetails(res.data)
        }
        fetchFollowUps()
        fetchStats()
      } else {
        toast.error(res.error || "Failed to update follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update follow-up")
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  // Open Complete Modal
  const handleOpenComplete = (item) => {
    setCompletingFollowUp(item)
    setCompletionNotes("")
  }

  // Submit Complete Action
  const handleSaveComplete = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    if (!completingFollowUp) return

    try {
      setIsSubmittingComplete(true)
      const res = await apiClient.completeFollowUp(completingFollowUp._id || completingFollowUp.id, {
        completionNotes: completionNotes.trim(),
      })

      if (res.success) {
        toast.success("Follow-up marked as completed")
        setCompletingFollowUp(null)
        if (activeDetails && (activeDetails._id === completingFollowUp._id || activeDetails.id === completingFollowUp._id)) {
          setActiveDetails(res.data)
        }
        fetchFollowUps()
        fetchStats()
      } else {
        toast.error(res.error || "Failed to complete follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to complete follow-up")
    } finally {
      setIsSubmittingComplete(false)
    }
  }

  // Quick One-Click Complete from Table Row
  const handleQuickComplete = async (item) => {
    try {
      const res = await apiClient.completeFollowUp(item._id || item.id, {
        completionNotes: "Completed via quick table action",
      })
      if (res.success) {
        toast.success("Follow-up completed")
        fetchFollowUps()
        fetchStats()
      } else {
        toast.error(res.error || "Failed to complete follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to complete follow-up")
    }
  }

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    if (!deletingFollowUp) return
    try {
      setIsDeleting(true)
      const res = await apiClient.deleteFollowUp(deletingFollowUp._id || deletingFollowUp.id)
      if (res.success) {
        toast.success("Follow-up touchpoint deleted")
        setDeletingFollowUp(null)
        if (activeDetails && (activeDetails._id === deletingFollowUp._id || activeDetails.id === deletingFollowUp._id)) {
          setActiveDetails(null)
        }
        fetchFollowUps()
        fetchStats()
      } else {
        toast.error(res.error || "Failed to delete follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete follow-up")
    } finally {
      setIsDeleting(false)
    }
  }

  // Helper to format date with relative badge
  const formatScheduledDate = (dateString, isOverdue, isToday, status) => {
    if (!dateString) return "No date"
    const d = new Date(dateString)
    const formattedDate = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    const formattedTime = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })

    return (
      <div className="flex flex-col">
        <span className="font-semibold text-slate-800 text-xs">{formattedDate}</span>
        <span className="text-[11px] text-slate-500 flex items-center space-x-1">
          <Clock className="w-3 h-3 text-slate-400 inline" />
          <span>{formattedTime}</span>
        </span>
        {status === "pending" && (
          <div className="mt-1">
            {isOverdue && (
              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                <AlertCircle className="w-2.5 h-2.5" />
                <span>Overdue</span>
              </span>
            )}
            {isToday && (
              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                <CalendarClock className="w-2.5 h-2.5" />
                <span>Due Today</span>
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const followUpsList = followUpsData?.followUps || []
  const totalPages = followUpsData?.totalPages || 1
  const totalRecords = followUpsData?.total || 0

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Communication", href: "/communication/call-reports" },
          { label: "Follow Ups" },
        ]}
      />

      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/20 to-blue-50/30 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Page Top Header */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/60 text-indigo-700 text-xs font-semibold mb-2">
                <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Customer Touchpoints & Task Pipeline</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Follow-ups Management
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl">
                Schedule, track, and complete proactive sales callbacks, proposal reviews, and client check-ins linked directly to leads.
              </p>
            </div>

            <div className="flex items-center flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => {
                  fetchFollowUps()
                  fetchStats()
                }}
                disabled={refreshing}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-600" : "text-slate-500"}`} />
                <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenScheduleModal()}
                className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Schedule Follow-up</span>
              </button>
            </div>
          </div>

          {/* 5 KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {/* 1. Total */}
            <div
              onClick={() => handleTabChange("all")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                currentStatusTab === "all"
                  ? "bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-200 shadow-xs"
                  : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</span>
                <div className="w-7 h-7 rounded-lg bg-indigo-100/70 text-indigo-700 flex items-center justify-center">
                  <CalendarClock className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900">{stats.total}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">All scheduled records</p>
            </div>

            {/* 2. Upcoming */}
            <div
              onClick={() => handleTabChange("upcoming")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                currentStatusTab === "upcoming"
                  ? "bg-blue-50/70 border-blue-300 ring-2 ring-blue-200 shadow-xs"
                  : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Upcoming</span>
                <div className="w-7 h-7 rounded-lg bg-blue-100/80 text-blue-700 flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-black text-blue-600">{stats.upcoming}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">Future pending tasks</p>
            </div>

            {/* 3. Due Today */}
            <div
              onClick={() => handleTabChange("today")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                currentStatusTab === "today"
                  ? "bg-amber-50/70 border-amber-300 ring-2 ring-amber-200 shadow-xs"
                  : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Due Today</span>
                <div className="w-7 h-7 rounded-lg bg-amber-100/80 text-amber-700 flex items-center justify-center">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-black text-amber-600">{stats.today}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">Actionable today</p>
            </div>

            {/* 4. Overdue */}
            <div
              onClick={() => handleTabChange("overdue")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                currentStatusTab === "overdue"
                  ? "bg-rose-50/70 border-rose-300 ring-2 ring-rose-200 shadow-xs"
                  : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Overdue</span>
                <div className="w-7 h-7 rounded-lg bg-rose-100/80 text-rose-700 flex items-center justify-center">
                  <AlertCircle className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-black text-rose-600">{stats.overdue}</div>
              <p className="text-[10px] text-rose-500 font-medium mt-0.5">Urgent attention needed</p>
            </div>

            {/* 5. Completed */}
            <div
              onClick={() => handleTabChange("completed")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                currentStatusTab === "completed"
                  ? "bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-200 shadow-xs"
                  : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Completed</span>
                <div className="w-7 h-7 rounded-lg bg-emerald-100/80 text-emerald-700 flex items-center justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-black text-emerald-600">{stats.completed}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">{stats.completionRate}% win rate</p>
            </div>
          </div>

          {/* Filtering, Search & Status Tab Bar */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-4">
            
            {/* Top row: Status Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-1.5 overflow-x-auto">
                {[
                  { key: "all", label: "All Follow-ups", count: stats.total },
                  { key: "upcoming", label: "Upcoming", count: stats.upcoming },
                  { key: "today", label: "Due Today", count: stats.today },
                  { key: "overdue", label: "Overdue", count: stats.overdue, isAlert: stats.overdue > 0 },
                  { key: "completed", label: "Completed", count: stats.completed },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center space-x-1.5 cursor-pointer ${
                      currentStatusTab === tab.key
                        ? tab.isAlert
                          ? "bg-rose-600 text-white shadow-xs"
                          : "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        currentStatusTab === tab.key
                          ? "bg-white/20 text-white"
                          : tab.isAlert
                          ? "bg-rose-100 text-rose-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {(currentSearch || currentTypeFilter !== "all" || currentPriorityFilter !== "all" || currentStatusTab !== "all") && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-800 flex items-center space-x-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {/* Bottom row: Search and Select dropdowns */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              {/* Search Bar */}
              <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-96">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search lead name, company, email, notes..."
                  className="w-full text-xs pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("")
                      updateUrlParams({ search: "" })
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>

              {/* Type and Priority Filters */}
              <div className="flex items-center space-x-2.5 w-full sm:w-auto overflow-x-auto">
                {/* Type Filter */}
                <div className="flex items-center space-x-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden md:inline">
                    Type:
                  </span>
                  <select
                    value={currentTypeFilter}
                    onChange={(e) => updateUrlParams({ type: e.target.value })}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-700 cursor-pointer"
                  >
                    <option value="all">All Touchpoint Types</option>
                    <option value="call">Phone Call</option>
                    <option value="email">Email</option>
                    <option value="meeting">Meeting</option>
                    <option value="task">Task / Todo</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Priority Filter */}
                <div className="flex items-center space-x-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden md:inline">
                    Priority:
                  </span>
                  <select
                    value={currentPriorityFilter}
                    onChange={(e) => updateUrlParams({ priority: e.target.value })}
                    className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-700 cursor-pointer"
                  >
                    <option value="all">All Priorities</option>
                    <option value="high">High Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Follow-ups Table Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-6">Linked Lead Details</th>
                    <th className="py-3.5 px-4">Touchpoint Type & Title</th>
                    <th
                      onClick={() => handleSortToggle("scheduledAt")}
                      className="py-3.5 px-4 cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center space-x-1">
                        <span>Scheduled Date & Time</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th className="py-3.5 px-3">Priority</th>
                    <th className="py-3.5 px-3">Assigned Rep</th>
                    <th className="py-3.5 px-3">Status</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <div className="w-7 h-7 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-semibold text-slate-600">Loading scheduled follow-ups...</span>
                        </div>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-rose-600">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <AlertCircle className="w-8 h-8 text-rose-500" />
                          <p className="font-semibold text-sm">{error}</p>
                          <button
                            type="button"
                            onClick={fetchFollowUps}
                            className="mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : followUpsList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <Inbox className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 text-sm">No Follow-ups Found</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {currentSearch || currentStatusTab !== "all" || currentTypeFilter !== "all"
                                ? "No scheduled touchpoints match the active search criteria or filters."
                                : "No upcoming or pending touchpoints registered. Schedule your first follow-up to keep prospective deals moving."}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenScheduleModal()}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Schedule Follow-up</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    followUpsList.map((item) => {
                      const typeMeta = TYPE_CONFIG[item.type] || TYPE_CONFIG.other
                      const TypeIcon = typeMeta.icon
                      const priorityMeta = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium
                      const leadBadgeClass =
                        item.lead?.status && LEAD_STATUS_CONFIG[item.lead.status]
                          ? LEAD_STATUS_CONFIG[item.lead.status]
                          : "bg-slate-100 text-slate-700 border-slate-200"

                      return (
                        <tr
                          key={item._id}
                          className={`hover:bg-slate-50/70 transition-colors ${
                            item.isOverdue ? "bg-rose-50/30" : ""
                          }`}
                        >
                          {/* 1. Lead Details */}
                          <td className="py-3.5 px-6">
                            {item.lead ? (
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => setActiveDrawerLeadId(item.leadId || item.lead?._id || item.lead?.id)}
                                    className="font-bold text-slate-900 text-xs hover:text-indigo-600 transition-colors text-left cursor-pointer"
                                  >
                                    {item.lead.name}
                                  </button>
                                  <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold border ${leadBadgeClass}`}>
                                    {item.lead.status}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  {item.lead.company && (
                                    <span className="inline-flex items-center space-x-1 text-slate-600 font-medium">
                                      <Building2 className="w-3 h-3 text-slate-400" />
                                      <span>{item.lead.company}</span>
                                    </span>
                                  )}
                                  {item.lead.phone && (
                                    <span className="inline-flex items-center space-x-1 text-slate-500">
                                      <Phone className="w-3 h-3 text-slate-400" />
                                      <span>{item.lead.phone}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-xs">Unlinked Lead Record</span>
                            )}
                          </td>

                          {/* 2. Type & Title */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-start space-x-2.5">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${typeMeta.iconBg}`}>
                                <TypeIcon className="w-3.5 h-3.5" />
                              </div>
                              <div className="space-y-0.5 max-w-xs">
                                <p className="font-semibold text-slate-900 text-xs truncate">{item.title}</p>
                                <span className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold border ${typeMeta.badgeClasses}`}>
                                  {typeMeta.label}
                                </span>
                                {item.notes && (
                                  <p className="text-[11px] text-slate-500 line-clamp-1 italic">{item.notes}</p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* 3. Scheduled Date & Time */}
                          <td className="py-3.5 px-4">
                            {formatScheduledDate(item.scheduledAt, item.isOverdue, item.isToday, item.status)}
                          </td>

                          {/* 4. Priority */}
                          <td className="py-3.5 px-3">
                            <span className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityMeta.badgeClasses}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta.dotColor}`} />
                              <span>{priorityMeta.label}</span>
                            </span>
                          </td>

                          {/* 5. Assigned Rep */}
                          <td className="py-3.5 px-3">
                            <div className="flex items-center space-x-1.5 text-xs text-slate-700">
                              <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold uppercase">
                                {(item.assignedTo || "U")[0]}
                              </div>
                              <span className="truncate max-w-[100px]">{item.assignedTo}</span>
                            </div>
                          </td>

                          {/* 6. Status Badge */}
                          <td className="py-3.5 px-3">
                            {item.status === "completed" ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Completed</span>
                              </span>
                            ) : item.status === "cancelled" ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                <span>Cancelled</span>
                              </span>
                            ) : item.isOverdue ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                                <AlertTriangle className="w-3 h-3 text-rose-600" />
                                <span>Overdue</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Clock className="w-3 h-3 text-blue-600" />
                                <span>Pending</span>
                              </span>
                            )}
                          </td>

                          {/* 7. Action Buttons */}
                          <td className="py-3.5 px-6 text-right">
                            <div className="flex items-center justify-end space-x-1">
                              {/* Quick Complete Button */}
                              {item.status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenComplete(item)}
                                  title="Mark touchpoint as completed"
                                  className="w-7 h-7 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 flex items-center justify-center transition-colors cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* View Details */}
                              <button
                                type="button"
                                onClick={() => setActiveDetails(item)}
                                title="View follow-up & linked lead details"
                                className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {/* Edit Follow-up */}
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(item)}
                                title="Edit follow-up schedule and notes"
                                className="w-7 h-7 rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center transition-colors cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete Follow-up */}
                              <button
                                type="button"
                                onClick={() => setDeletingFollowUp(item)}
                                title="Delete follow-up record"
                                className="w-7 h-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                <span>
                  Showing page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({totalRecords} records)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => updateUrlParams({ page: Math.max(1, currentPage - 1) })}
                    disabled={currentPage <= 1}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-semibold text-slate-700 px-2">{currentPage}</span>
                  <button
                    type="button"
                    onClick={() => updateUrlParams({ page: Math.min(totalPages, currentPage + 1) })}
                    disabled={currentPage >= totalPages}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1. Schedule New Follow-up Modal                                */}
      {/* ============================================================== */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Schedule Lead Follow-up</h3>
                <p className="text-xs text-slate-500">Plan a future callback, meeting demo, or touchpoint</p>
              </div>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Linked Lead Selection */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Target Lead <span className="text-rose-500">*</span>
                </label>
                <select
                  value={scheduleForm.leadId}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, leadId: e.target.value })}
                  className={`w-full p-2.5 bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800 ${
                    scheduleErrors.leadId ? "border-rose-400" : "border-slate-200"
                  }`}
                >
                  <option value="">-- Choose an existing lead --</option>
                  {leadsList.map((lead) => (
                    <option key={lead._id || lead.id} value={lead._id || lead.id}>
                      {lead.name} {lead.company ? `(${lead.company})` : ""} &bull; {lead.status}
                    </option>
                  ))}
                </select>
                {scheduleErrors.leadId && <p className="text-[11px] text-rose-500 mt-1">{scheduleErrors.leadId}</p>}
              </div>

              {/* Title / Subject */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Touchpoint Title / Purpose
                </label>
                <input
                  type="text"
                  value={scheduleForm.title}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                  placeholder="e.g. Discuss revised quote, Product demo review"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800 placeholder-slate-400"
                />
              </div>

              {/* Type and Priority 2-Column */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Touchpoint Type <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={scheduleForm.type}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  >
                    <option value="call">Phone Call</option>
                    <option value="email">Email Touchpoint</option>
                    <option value="meeting">Meeting / Demo</option>
                    <option value="task">Task / Follow-up</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={scheduleForm.priority}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, priority: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  >
                    <option value="high">High Priority</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {/* Date & Time 2-Column */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Follow-up Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={scheduleForm.scheduledDate}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledDate: e.target.value })}
                    className={`w-full p-2.5 bg-slate-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800 ${
                      scheduleErrors.scheduledDate ? "border-rose-400" : "border-slate-200"
                    }`}
                  />
                  {scheduleErrors.scheduledDate && (
                    <p className="text-[11px] text-rose-500 mt-1">{scheduleErrors.scheduledDate}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Scheduled Time <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={scheduleForm.scheduledTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  />
                </div>
              </div>

              {/* Assigned Representative */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Representative</label>
                <input
                  type="text"
                  value={scheduleForm.assignedTo}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, assignedTo: e.target.value })}
                  placeholder="e.g. Sara Khan, Unassigned"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                />
              </div>

              {/* Notes / Agenda */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Preparation Notes / Objective</label>
                <textarea
                  rows={3}
                  value={scheduleForm.notes}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })}
                  placeholder="Outline key discussion points, questions, or contract terms to address..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800 placeholder-slate-400"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSchedule}
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-60"
                >
                  {isSubmittingSchedule ? "Scheduling..." : "Schedule Touchpoint"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. Follow-up Details & Linked Lead Modal                      */}
      {/* ============================================================== */}
      {activeDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <CalendarClock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Follow-up Touchpoint Details</h3>
                  <span className="text-[10px] text-slate-400">ID: {activeDetails._id || activeDetails.id}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDetails(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto flex-1 text-xs">
              {/* Linked Lead Details Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-slate-50 to-indigo-50/40 border border-slate-200/90 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                    <User className="w-3 h-3 text-indigo-600 inline" />
                    <span>Linked Lead Information</span>
                  </span>
                  {activeDetails.lead && (
                    <Link
                      href={`/leads?search=${encodeURIComponent(activeDetails.lead.email || activeDetails.lead.name)}`}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
                    >
                      <span>View in All Leads</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>

                {activeDetails.lead ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{activeDetails.lead.name}</p>
                      {activeDetails.lead.company && (
                        <p className="text-slate-600 font-medium">{activeDetails.lead.company}</p>
                      )}
                      <p className="text-slate-500">{activeDetails.lead.email || "No email"}</p>
                      <p className="text-slate-500">{activeDetails.lead.phone || "No phone"}</p>
                    </div>

                    <div className="sm:text-right space-y-1">
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Pipeline Stage</span>
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 mt-0.5">
                          {activeDetails.lead.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Lead Source: <strong>{activeDetails.lead.source || "Website"}</strong>
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400 italic">No linked lead associated with this follow-up record.</p>
                )}
              </div>

              {/* Follow-up Touchpoint Data */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Schedule & Execution</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Touchpoint Type</span>
                    <p className="font-bold text-slate-900 mt-1 capitalize">{activeDetails.type}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Priority</span>
                    <p className="font-bold text-slate-900 mt-1 capitalize">{activeDetails.priority}</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Status</span>
                    <p className="font-bold text-slate-900 mt-1 capitalize">{activeDetails.status}</p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Scheduled Time</span>
                  <p className="font-bold text-slate-900">
                    {new Date(activeDetails.scheduledAt).toLocaleString(undefined, {
                      dateStyle: "full",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    Assigned Representative: <strong>{activeDetails.assignedTo}</strong>
                  </p>
                </div>

                {activeDetails.notes && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Touchpoint Notes</span>
                    <p className="text-slate-700 whitespace-pre-wrap">{activeDetails.notes}</p>
                  </div>
                )}

                {activeDetails.status === "completed" && (
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
                    <div className="flex items-center space-x-1.5 text-emerald-800 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Completed by {activeDetails.completedBy || "User"}</span>
                    </div>
                    {activeDetails.completedAt && (
                      <p className="text-[10px] text-emerald-600">
                        {new Date(activeDetails.completedAt).toLocaleString()}
                      </p>
                    )}
                    {activeDetails.completionNotes && (
                      <p className="text-xs text-emerald-900 mt-1 italic">
                        &ldquo;{activeDetails.completionNotes}&rdquo;
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                {activeDetails.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => {
                      const item = activeDetails
                      setActiveDetails(null)
                      handleOpenComplete(item)
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Complete Touchpoint</span>
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const item = activeDetails
                    setActiveDetails(null)
                    handleOpenEdit(item)
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetails(null)}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. Edit Follow-up Modal                                        */}
      {/* ============================================================== */}
      {editingFollowUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Edit Follow-up Touchpoint</h3>
                <p className="text-xs text-slate-500">Update schedule date, status, or preparation notes</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingFollowUp(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Title */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Title / Subject <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingFollowUp.title}
                  onChange={(e) => setEditingFollowUp({ ...editingFollowUp, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                />
              </div>

              {/* Type and Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Touchpoint Type</label>
                  <select
                    value={editingFollowUp.type}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, type: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  >
                    <option value="call">Phone Call</option>
                    <option value="email">Email</option>
                    <option value="meeting">Meeting</option>
                    <option value="task">Task / Todo</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={editingFollowUp.priority}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, priority: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  >
                    <option value="high">High Priority</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Scheduled Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={editingFollowUp.scheduledDate}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, scheduledDate: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Scheduled Time <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={editingFollowUp.scheduledTime}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, scheduledTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  />
                </div>
              </div>

              {/* Status and Assigned Rep */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Execution Status</label>
                  <select
                    value={editingFollowUp.status}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, status: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  >
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned Rep</label>
                  <input
                    type="text"
                    value={editingFollowUp.assignedTo}
                    onChange={(e) => setEditingFollowUp({ ...editingFollowUp, assignedTo: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Preparation / Agenda Notes</label>
                <textarea
                  rows={3}
                  value={editingFollowUp.notes}
                  onChange={(e) => setEditingFollowUp({ ...editingFollowUp, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-800"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingFollowUp(null)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-60"
                >
                  {isSubmittingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 4. Complete Follow-up Modal                                    */}
      {/* ============================================================== */}
      {completingFollowUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Complete Follow-up</h3>
                  <p className="text-xs text-slate-500">Record touchpoint outcome and client feedback</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompletingFollowUp(null)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveComplete} className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                <p className="font-bold text-slate-800">{completingFollowUp.title}</p>
                <p className="text-slate-500 mt-0.5">
                  Lead: <strong>{completingFollowUp.lead?.name || "Client"}</strong>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Outcome & Discussion Notes (Optional)
                </label>
                <textarea
                  rows={4}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="e.g. Client agreed to pricing, schedule product demo for next Tuesday, sent revised contract..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 text-slate-800 placeholder-slate-400"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCompletingFollowUp(null)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingComplete}
                  className="px-5 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-all"
                >
                  {isSubmittingComplete ? "Completing..." : "Confirm Completed"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. Delete Confirmation Modal                                  */}
      {/* ============================================================== */}
      {deletingFollowUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center space-y-4 border border-slate-200">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Delete Follow-up?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to remove <strong>&ldquo;{deletingFollowUp.title}&rdquo;</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFollowUp(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 6. Lead Detail Drawer Integration (Phase 10) */}
      <LeadDetailDrawer
        isOpen={Boolean(activeDrawerLeadId)}
        leadId={activeDrawerLeadId}
        onClose={() => setActiveDrawerLeadId(null)}
        onLeadUpdated={() => {
          fetchFollowUps()
          fetchStats()
        }}
      />
    </>
  )
}

export default function FollowUpsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-slate-500">Loading Follow-ups Workspace...</p>
          </div>
        </div>
      }
    >
      <FollowUpsContent />
    </Suspense>
  )
}
