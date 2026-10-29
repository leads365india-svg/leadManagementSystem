"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import Breadcrumb from "@/components/breadcrumb"
import InBrowserAudioPlayer from "@/components/in-browser-audio-player"

const LeadDetailDrawer = dynamic(() => import("@/components/lead-detail-drawer"), {
  ssr: false,
})
import {
  Users,
  User,
  UserPlus,
  Plus,
  Play,
  Search,
  Filter,
  RefreshCw,
  UploadCloud,
  Calendar,
  CalendarClock,
  Mail,
  Phone,
  Tag,
  SlidersHorizontal,
  Trash2,
  Edit2,
  Eye,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  X,
  ExternalLink,
  Shield,
  PhoneCall,
  Sparkles,
  Layers,
  Inbox,
  FileSpreadsheet,
  Save,
  Activity,
  XCircle,
  Building2,
  ChevronDown,
} from "lucide-react"

// Status configurations with accessible color tokens and navigation labels
const STATUS_CONFIG = {
  New: {
    label: "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
    navLabel: "New Leads",
  },
  Engaged: {
    label: "Engaged",
    dotColor: "bg-amber-500",
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
    navLabel: "Active Leads",
  },
  "Proposal Sent": {
    label: "Proposal Sent",
    dotColor: "bg-purple-500",
    badgeClasses: "bg-purple-50 text-purple-700 border-purple-200/80",
    navLabel: "Proposal Sent",
  },
  "Closed-Won": {
    label: "Closed-Won",
    dotColor: "bg-emerald-500",
    badgeClasses: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
    navLabel: "Order Placed",
  },
  "Closed-Lost": {
    label: "Closed-Lost",
    dotColor: "bg-rose-500",
    badgeClasses: "bg-rose-50 text-rose-700 border-rose-200/80",
    navLabel: "Lost Leads",
  },
}

const ALL_STATUSES = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]

const LEAD_SOURCES = [
  "Website",
  "Referral",
  "Cold Outreach",
  "Google Ads",
  "Meta Ads",
  "Inbound Call",
  "Manual Entry",
]

export default function LeadsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL parameters state
  const currentPage = Number(searchParams.get("page")) || 1
  const currentLimit = Number(searchParams.get("limit")) || 10
  const currentSearch = searchParams.get("search") || ""
  const currentStatus = searchParams.get("status") || "all"
  const currentSource = searchParams.get("source") || "all"
  const currentAssignedTo = searchParams.get("assignedTo") || "all"
  const currentLeadType = searchParams.get("leadType") || "all"
  const currentFromDate = searchParams.get("fromDate") || ""
  const currentToDate = searchParams.get("toDate") || ""
  const currentSortBy = searchParams.get("sortBy") || "createdAt"
  const currentSortOrder = searchParams.get("sortOrder") || "desc"

  // Local filter inputs state for controlled form fields
  const [filterInputs, setFilterInputs] = useState({
    name: searchParams.get("name") || currentSearch || "",
    phone: searchParams.get("phone") || "",
    email: searchParams.get("email") || "",
    status: currentStatus,
    source: currentSource,
    assignedTo: currentAssignedTo,
    leadType: currentLeadType,
    fromDate: currentFromDate,
    toDate: currentToDate,
    limit: currentLimit,
  })

  // Table & Data State
  const [leadsData, setLeadsData] = useState(null)
  const [leadStats, setLeadStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  // Modals state
  const [activeLeadDetails, setActiveLeadDetails] = useState(null)
  const [activePlayingCall, setActivePlayingCall] = useState(null)
  const [loadingRecordingId, setLoadingRecordingId] = useState(null)
  const [leadCalls, setLeadCalls] = useState([])
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [editingLead, setEditingLead] = useState(null)
  const [leadToDelete, setLeadToDelete] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [editFormErrors, setEditFormErrors] = useState({})
  const [updatingStatusId, setUpdatingStatusId] = useState(null)

  const activeLeadId = activeLeadDetails?._id || activeLeadDetails?.id

  useEffect(() => {
    if (!activeLeadId) {
      setLeadCalls([])
      return
    }

    let isMounted = true
    setLoadingCalls(true)
    apiClient
      .getLeadCalls(activeLeadId)
      .then((res) => {
        if (isMounted && res.success && Array.isArray(res.data)) {
          setLeadCalls(res.data)
        }
      })
      .catch((err) => {
        console.error("Failed to load calls for lead:", err)
        if (isMounted) setLeadCalls([])
      })
      .finally(() => {
        if (isMounted) setLoadingCalls(false)
      })

    return () => {
      isMounted = false
    }
  }, [activeLeadId])

  // Fetch lead statistics for live tab badges
  const fetchLeadStats = useCallback(async () => {
    try {
      const res = await apiClient.getLeadStats()
      if (res.success && res.data) {
        setLeadStats(res.data)
      }
    } catch (err) {
      console.error("Failed to load lead stats:", err)
    }
  }, [])

  // Fetch leads from backend API with complete filters
  const fetchLeads = useCallback(async () => {
    try {
      setRefreshing(true)
      setError(null)

      const response = await apiClient.getLeads({
        page: currentPage,
        limit: currentLimit,
        search: currentSearch || searchParams.get("name") || undefined,
        phone: searchParams.get("phone") || undefined,
        email: searchParams.get("email") || undefined,
        status: currentStatus !== "all" ? currentStatus : undefined,
        source: currentSource !== "all" ? currentSource : undefined,
        assignedTo: currentAssignedTo !== "all" ? currentAssignedTo : undefined,
        leadType: currentLeadType !== "all" ? currentLeadType : undefined,
        fromDate: currentFromDate || undefined,
        toDate: currentToDate || undefined,
        sortBy: currentSortBy,
        sortOrder: currentSortOrder,
      })

      if (response.success && response.data) {
        setLeadsData(response.data)
      } else {
        setError(response.error || "Failed to fetch leads records")
      }
    } catch (err) {
      console.error("Error fetching leads:", err)
      setError("Unable to connect to lead service. Please try again.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [
    currentPage,
    currentLimit,
    currentSearch,
    currentStatus,
    currentSource,
    currentAssignedTo,
    currentLeadType,
    currentFromDate,
    currentToDate,
    currentSortBy,
    currentSortOrder,
    searchParams,
  ])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  useEffect(() => {
    fetchLeadStats()
  }, [fetchLeadStats])

  // Sync local inputs when URL search params change
  useEffect(() => {
    setFilterInputs({
      name: searchParams.get("name") || searchParams.get("search") || "",
      phone: searchParams.get("phone") || "",
      email: searchParams.get("email") || "",
      status: searchParams.get("status") || "all",
      source: searchParams.get("source") || "all",
      assignedTo: searchParams.get("assignedTo") || "all",
      leadType: searchParams.get("leadType") || "all",
      fromDate: searchParams.get("fromDate") || "",
      toDate: searchParams.get("toDate") || "",
      limit: Number(searchParams.get("limit")) || 10,
    })
  }, [searchParams])

  // Apply filters to URL
  const handleApplyFilters = (e) => {
    if (e && e.preventDefault) e.preventDefault()

    const params = new URLSearchParams()

    if (filterInputs.name.trim()) {
      params.set("search", filterInputs.name.trim())
      params.set("name", filterInputs.name.trim())
    }
    if (filterInputs.phone.trim()) params.set("phone", filterInputs.phone.trim())
    if (filterInputs.email.trim()) params.set("email", filterInputs.email.trim())
    if (filterInputs.status && filterInputs.status !== "all") params.set("status", filterInputs.status)
    if (filterInputs.source && filterInputs.source !== "all") params.set("source", filterInputs.source)
    if (filterInputs.assignedTo && filterInputs.assignedTo !== "all") params.set("assignedTo", filterInputs.assignedTo)
    if (filterInputs.leadType && filterInputs.leadType !== "all") params.set("leadType", filterInputs.leadType)
    if (filterInputs.fromDate) params.set("fromDate", filterInputs.fromDate)
    if (filterInputs.toDate) params.set("toDate", filterInputs.toDate)
    if (filterInputs.limit && filterInputs.limit !== 10) params.set("limit", filterInputs.limit.toString())

    params.set("page", "1")
    router.push(`/leads?${params.toString()}`)
    toast.success("Filters applied")
  }

  // Quick switch status tab
  const handleStatusTabClick = (statusKey) => {
    const params = new URLSearchParams(searchParams.toString())
    if (statusKey === "all") {
      params.delete("status")
    } else {
      params.set("status", statusKey)
    }
    params.set("page", "1")
    router.push(`/leads?${params.toString()}`)
  }

  // Clear all filters
  const handleClearFilters = () => {
    setFilterInputs({
      name: "",
      phone: "",
      email: "",
      status: "all",
      source: "all",
      assignedTo: "all",
      leadType: "all",
      fromDate: "",
      toDate: "",
      limit: 10,
    })
    router.push("/leads")
    toast.success("Filters cleared")
  }

  // Handle single page navigation
  const handlePageChange = (newPage) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", newPage.toString())
    router.push(`/leads?${params.toString()}`)
  }

  // Handle items per page change
  const handleLimitChange = (newLimit) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("limit", newLimit.toString())
    params.set("page", "1")
    router.push(`/leads?${params.toString()}`)
  }

  // Handle column sorting toggle
  const handleSort = (field) => {
    const newOrder = currentSortBy === field && currentSortOrder === "asc" ? "desc" : "asc"
    const params = new URLSearchParams(searchParams.toString())
    params.set("sortBy", field)
    params.set("sortOrder", newOrder)
    router.push(`/leads?${params.toString()}`)
  }

  // Copy helper
  const handleCopy = (text, id) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success("Copied to clipboard")
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Handle lead deletion with confirmation modal
  const handleConfirmDelete = async () => {
    if (!leadToDelete) return
    const leadId = leadToDelete._id || leadToDelete.id
    const leadName = leadToDelete.name

    try {
      setIsDeleting(true)
      const res = await apiClient.deleteLead(leadId)
      if (res.success) {
        toast.success(`Lead "${leadName}" deleted successfully`)
        setLeadToDelete(null)
        if (activeLeadDetails && (activeLeadDetails._id === leadId || activeLeadDetails.id === leadId)) {
          setActiveLeadDetails(null)
        }
        fetchLeads()
        fetchLeadStats()
      } else {
        toast.error(res.error || "Failed to delete lead")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete lead")
    } finally {
      setIsDeleting(false)
    }
  }

  // Play latest call recording for lead directly from table action button
  const handlePlayRecording = async (lead) => {
    const leadId = lead?._id || lead?.id
    if (!leadId) return

    try {
      setLoadingRecordingId(leadId)
      const res = await apiClient.getLeadCalls(leadId)
      const calls = res?.success && Array.isArray(res.data) ? res.data : []

      if (calls.length === 0) {
        toast.error(`No calls recorded yet for ${lead.name || "this lead"}`)
        return
      }

      // Helper to compute call timestamp
      const getCallTime = (c) => {
        const t = c.createdAt || c.startedAt || c.recording?.createdAt || c.timestamp
        return t ? new Date(t).getTime() : 0
      }

      // Sort calls descending by creation / start timestamp
      const sortedCalls = [...calls].sort((a, b) => getCallTime(b) - getCallTime(a))
      const latestCall = sortedCalls[0]

      // Filter calls that have valid playable audio recording
      const validCallsWithRecording = sortedCalls.filter((c) => {
        const rec = c.recording
        if (rec?.status === "skipped_dnr" || rec?.status === "expired") {
          return false
        }
        return Boolean(
          c.hasRecording ||
          rec?.fileId ||
          rec?.status === "ready" ||
          rec?.status === "stored" ||
          c.metadata?.recordingUrl ||
          c.recordingUrl ||
          (rec?.sizeBytes && rec.sizeBytes > 0)
        )
      })

      if (validCallsWithRecording.length > 0) {
        const newestRecordingCall = validCallsWithRecording[0]
        setActivePlayingCall({
          ...newestRecordingCall,
          phone: lead.phone,
          number: newestRecordingCall.number || newestRecordingCall.phoneNumber || lead.phone,
          agentName: newestRecordingCall.agentName || newestRecordingCall.agentId?.name || "Agent",
        })
        const dateStr = newestRecordingCall.startedAt || newestRecordingCall.createdAt
          ? new Date(newestRecordingCall.startedAt || newestRecordingCall.createdAt).toLocaleDateString()
          : ""
        toast.success(`Playing latest recording for ${lead.name || "Lead"}${dateStr ? ` (${dateStr})` : ""}`)
      } else if (latestCall.recording?.status === "skipped_dnr") {
        toast.error(`Latest call for ${lead.name || "this lead"} was skipped (Do-Not-Record policy)`)
      } else if (latestCall.recording?.status === "expired") {
        toast.error(`Latest recording for ${lead.name || "this lead"} has expired (retention policy)`)
      } else {
        toast.error(`No valid audio recording found for ${lead.name || "this lead"}`)
      }
    } catch (err) {
      console.error("Failed to load recording:", err)
      toast.error(err?.message || "Failed to retrieve call recordings")
    } finally {
      setLoadingRecordingId(null)
    }
  }

  // Quick lead status change directly from table row or modal
  const handleQuickStatusChange = async (leadId, newStatus, currentStatus) => {
    if (newStatus === currentStatus) return
    try {
      setUpdatingStatusId(leadId)
      const res = await apiClient.updateLeadStatus(leadId, newStatus)
      if (res.success) {
        toast.success(`Lead moved to "${newStatus}"`)
        fetchLeads()
        fetchLeadStats()
        if (activeLeadDetails && (activeLeadDetails._id === leadId || activeLeadDetails.id === leadId)) {
          setActiveLeadDetails((prev) => ({ ...prev, status: newStatus }))
        }
      } else {
        toast.error(res.error || "Failed to update status")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update status")
    } finally {
      setUpdatingStatusId(null)
    }
  }

  // Open Edit modal
  const handleOpenEditModal = (lead) => {
    setEditingLead({
      _id: lead._id || lead.id,
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      company: lead.company || lead.metadata?.company || "",
      status: lead.status || "New",
      source: lead.source || "Website Form",
      assignedTo: lead.assignedTo || "Unassigned",
      message: lead.message || "",
    })
    setEditFormErrors({})
  }

  // Save Edit modal changes
  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editingLead) return

    const errors = {}
    if (!editingLead.name.trim()) errors.name = "Lead name is required"
    if (!editingLead.email.trim()) {
      errors.email = "Email address is required"
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(editingLead.email.trim())) {
        errors.email = "Enter a valid email address"
      }
    }

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors)
      toast.error("Please resolve the validation errors")
      return
    }

    try {
      setIsUpdating(true)
      const payload = {
        name: editingLead.name.trim(),
        email: editingLead.email.trim().toLowerCase(),
        phone: editingLead.phone.trim(),
        company: (editingLead.company || "").trim(),
        status: editingLead.status,
        source: editingLead.source.trim(),
        assignedTo: editingLead.assignedTo.trim(),
        message: editingLead.message.trim(),
      }

      const res = await apiClient.updateLead(editingLead._id, payload)
      if (res.success) {
        toast.success(`Lead "${editingLead.name}" updated successfully`)
        setEditingLead(null)
        fetchLeads()
        fetchLeadStats()
        if (activeLeadDetails && (activeLeadDetails._id === editingLead._id || activeLeadDetails.id === editingLead._id)) {
          setActiveLeadDetails((prev) => ({ ...prev, ...payload }))
        }
      } else {
        toast.error(res.error || "Failed to update lead")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update lead")
    } finally {
      setIsUpdating(false)
    }
  }

  // Leads data list
  const allLeadsList = leadsData?.leads || []

  // Filter count badge calculation
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (filterInputs.name.trim()) count++
    if (filterInputs.phone.trim()) count++
    if (filterInputs.email.trim()) count++
    if (filterInputs.status && filterInputs.status !== "all") count++
    if (filterInputs.source && filterInputs.source !== "all") count++
    if (filterInputs.assignedTo && filterInputs.assignedTo !== "all") count++
    if (filterInputs.leadType && filterInputs.leadType !== "all") count++
    if (filterInputs.fromDate) count++
    if (filterInputs.toDate) count++
    return count
  }, [filterInputs])

  // Real data metrics
  const totalLeads = leadsData?.total || 0
  const totalPages = leadsData?.totalPages || 1
  const startRecord = totalLeads === 0 ? 0 : (currentPage - 1) * currentLimit + 1
  const endRecord = Math.min(currentPage * currentLimit, totalLeads)

  // Quick navigation status tabs with real database counts
  const statusTabs = [
    { key: "all", label: "All Leads", count: leadStats?.total ?? totalLeads },
    { key: "New", label: "New Leads", count: leadStats?.statusCounts?.New ?? 0 },
    { key: "Engaged", label: "Active Leads", count: leadStats?.statusCounts?.Engaged ?? 0 },
    { key: "Proposal Sent", label: "Proposal Sent", count: leadStats?.statusCounts?.["Proposal Sent"] ?? 0 },
    { key: "Closed-Won", label: "Order Placed", count: leadStats?.statusCounts?.["Closed-Won"] ?? 0 },
    { key: "Closed-Lost", label: "Lost Leads", count: leadStats?.statusCounts?.["Closed-Lost"] ?? 0 },
  ]

  const displayTitle =
    currentStatus === "all"
      ? "All Leads"
      : STATUS_CONFIG[currentStatus]?.navLabel || `${currentStatus} Leads`

  return (
    <>
      <div className="w-full max-w-full min-w-0 overflow-x-hidden px-4 sm:px-6 lg:px-8 py-5 space-y-5 animate-in fade-in duration-200">
      {/* =========================================================================
          PAGE HEADER & PRIMARY ACTIONS
      ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Manage Leads</h1>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              fetchLeads()
              fetchLeadStats()
            }}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
            title="Refresh Leads Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-600" : "text-slate-500"}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <Link
            href="/tools/import-leads"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <UploadCloud className="w-4 h-4 text-slate-500" />
            <span>Import Leads</span>
          </Link>

          <Link
            href="/leads/new"
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Lead</span>
          </Link>
        </div>
      </div>

      {/* =========================================================================
          STATUS QUICK NAVIGATION TAB BAR (Clean White & Light-Blue Palette)
      ========================================================================= */}
      <div className="flex items-center space-x-1 overflow-x-auto pb-1 scrollbar-none border-b border-slate-200">
        {statusTabs.map((tab) => {
          const isActive = currentStatus === tab.key || (tab.key === "all" && currentStatus === "all")
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleStatusTabClick(tab.key)}
              className={`inline-flex items-center px-3.5 py-2 text-xs font-medium rounded-t-lg transition-colors cursor-pointer whitespace-nowrap border-b-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                isActive
                  ? "bg-blue-50/80 text-blue-700 border-blue-600 font-semibold"
                  : "bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 border-transparent"
              }`}
            >
              <span>{tab.label}</span>
              {tab.key === "New" && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-blue-100 text-blue-700 border border-blue-200/80 leading-none">
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* =========================================================================
          SEARCH & FILTER CONTROLS BAR
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Quick Search Input */}
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search leads by name, email, or phone number..."
              value={filterInputs.name}
              onChange={(e) => setFilterInputs({ ...filterInputs, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApplyFilters(e)
              }}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
            />
          </div>

          {/* Filter Bar Controls */}
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleApplyFilters}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              className={`inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
                isFilterOpen || activeFiltersCount > 0
                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-semibold"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-2.5 py-2 text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Expandable Advanced Filters Panel */}
        {isFilterOpen && (
          <form onSubmit={handleApplyFilters} className="pt-3 border-t border-slate-100 space-y-3.5 animate-in fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Phone Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={filterInputs.phone}
                    onChange={(e) => setFilterInputs({ ...filterInputs, phone: e.target.value })}
                    placeholder="Filter by phone..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono"
                  />
                </div>
              </div>

              {/* Email Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={filterInputs.email}
                    onChange={(e) => setFilterInputs({ ...filterInputs, email: e.target.value })}
                    placeholder="Filter by email..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Pipeline Status
                </label>
                <select
                  value={filterInputs.status}
                  onChange={(e) => setFilterInputs({ ...filterInputs, status: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Lead Source Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Lead Source
                </label>
                <select
                  value={filterInputs.source}
                  onChange={(e) => setFilterInputs({ ...filterInputs, source: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value="all">All Sources</option>
                  {LEAD_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
              </div>

              {/* From Date */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={filterInputs.fromDate}
                  onChange={(e) => setFilterInputs({ ...filterInputs, fromDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
              </div>

              {/* To Date */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  To Date
                </label>
                <input
                  type="date"
                  value={filterInputs.toDate}
                  onChange={(e) => setFilterInputs({ ...filterInputs, toDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
              </div>

              {/* Assigned Representative */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Assigned To
                </label>
                <input
                  type="text"
                  placeholder="e.g. Unassigned"
                  value={filterInputs.assignedTo === "all" ? "" : filterInputs.assignedTo}
                  onChange={(e) => setFilterInputs({ ...filterInputs, assignedTo: e.target.value || "all" })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
              </div>

              {/* Items per Page */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Page Limit
                </label>
                <select
                  value={filterInputs.limit}
                  onChange={(e) => setFilterInputs({ ...filterInputs, limit: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Clear Filters
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                Apply Advanced Filters
              </button>
            </div>
          </form>
        )}
      </div>

      {/* =========================================================================
          LEADS DATA TABLE
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden max-w-full">
        {/* Table Summary Bar */}
        <div className="px-4 py-3 bg-slate-50/60 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div className="text-slate-700 font-semibold text-xs">
            All Leads: <span className="font-bold text-slate-900">{totalLeads}</span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Sort by:</span>
            <button
              type="button"
              onClick={() => handleSort("createdAt")}
              className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                currentSortBy === "createdAt"
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>Date</span>
              <ArrowUpDown className="w-3 h-3 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => handleSort("name")}
              className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                currentSortBy === "name"
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>Name</span>
              <ArrowUpDown className="w-3 h-3 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs min-w-[760px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 cursor-pointer hover:text-slate-900" onClick={() => handleSort("name")}>
                  <div className="flex items-center space-x-1">
                    <span>Name</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4">Contact Details</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Pipeline Status</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-900" onClick={() => handleSort("createdAt")}>
                  <div className="flex items-center space-x-1">
                    <span>Created Date</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                /* Loading State Rows */
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs font-medium text-slate-600">Loading leads database from Atlas...</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                /* Error State Row */
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2 text-rose-600">
                      <AlertCircle className="w-8 h-8" />
                      <p className="font-semibold text-xs">{error}</p>
                      <button
                        type="button"
                        onClick={() => fetchLeads()}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs mt-2 transition-colors cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  </td>
                </tr>
              ) : allLeadsList.length === 0 ? (
                /* Empty State */
                <tr>
                  <td colSpan={7} className="py-16 sm:py-20 text-center">
                    <div className="max-w-md mx-auto px-4 flex flex-col items-center justify-center animate-in fade-in duration-200">
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4 shadow-2xs">
                        <Users className="w-8 h-8 stroke-[1.8]" />
                      </div>

                      <h3 className="text-base font-bold text-slate-900 mb-1">
                        No leads found
                      </h3>

                      <p className="text-xs text-slate-500 max-w-sm mb-6 leading-relaxed">
                        {activeFiltersCount > 0 || currentStatus !== "all"
                          ? "No leads match your current filter parameters. Try clearing or relaxing your search filters."
                          : "Your leads will appear here when you add them or capture them through your website lead feeds."}
                      </p>

                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {activeFiltersCount > 0 || currentStatus !== "all" ? (
                          <button
                            type="button"
                            onClick={handleClearFilters}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                          >
                            <Filter className="w-3.5 h-3.5 text-slate-400" />
                            <span>Reset Filters</span>
                          </button>
                        ) : null}

                        <Link
                          href="/leads/new"
                          className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add Your First Lead</span>
                        </Link>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                /* Leads Rows */
                allLeadsList.map((lead, idx) => {
                  const leadIdStr = lead._id || lead.id || `lead-${idx}`
                  const shortId = leadIdStr.slice(-6).toUpperCase()
                  const statusInfo = STATUS_CONFIG[lead.status] || {
                    label: lead.status || "New",
                    dotColor: "bg-slate-400",
                    badgeClasses: "bg-slate-50 text-slate-700 border-slate-200",
                  }

                  return (
                    <tr
                      key={leadIdStr}
                      className="hover:bg-slate-50/80 transition-colors"
                    >



                      {/* 3. Name & Company */}
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            {lead.name ? lead.name.charAt(0) : "L"}
                          </div>
                          <div>
                            <p
                              onClick={() => setActiveLeadDetails(lead)}
                              className="font-bold text-slate-900 truncate max-w-[180px] hover:text-indigo-600 transition-colors cursor-pointer"
                              title="Click to open Lead Drawer"
                            >
                              {lead.name}
                            </p>
                            {lead.company ? (
                              <p className="text-[11px] text-indigo-600 font-medium truncate max-w-[180px] flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-indigo-500 shrink-0" />
                                <span>{lead.company}</span>
                              </p>
                            ) : lead.message ? (
                              <p className="text-[11px] text-slate-400 font-normal truncate max-w-[180px]">
                                {lead.message}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {/* 4. Contact Details (Email & Phone) */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-600">
                        <div className="space-y-0.5">
                          {lead.email ? (
                            <div className="flex items-center space-x-1.5">
                              <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                              <a
                                href={`mailto:${lead.email}`}
                                className="truncate max-w-[190px] text-slate-700 hover:text-indigo-600"
                              >
                                {lead.email}
                              </a>
                            </div>
                          ) : null}
                          {lead.phone ? (
                            <div className="flex items-center space-x-1.5 text-slate-500">
                              <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                              <a href={`tel:${lead.phone}`} className="hover:text-indigo-600">
                                {lead.phone}
                              </a>
                            </div>
                          ) : null}
                          {!lead.email && !lead.phone && <span className="text-slate-400">—</span>}
                        </div>
                      </td>

                      {/* 5. Lead Source */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <Tag className="w-2.5 h-2.5 text-slate-400" />
                          <span>{lead.source || "Website Form"}</span>
                        </span>
                      </td>

                      {/* Pipeline Status (Compact Enterprise Pill) */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="relative inline-flex items-center w-[124px]">
                          <select
                            value={lead.status || "New"}
                            onChange={(e) => handleQuickStatusChange(leadIdStr, e.target.value, lead.status)}
                            disabled={updatingStatusId === leadIdStr}
                            aria-label={`Update pipeline status for ${lead.name}`}
                            className={`w-full text-[11px] font-semibold rounded-md pl-5 pr-5 py-1 border transition-colors cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 truncate shadow-2xs ${statusInfo.badgeClasses}`}
                            title="Click to change pipeline status"
                          >
                            {ALL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-white text-slate-800 font-medium py-1">
                                {s} {s === "Engaged" ? "(Active)" : s === "Closed-Won" ? "(Won)" : s === "Closed-Lost" ? "(Lost)" : ""}
                              </option>
                            ))}
                          </select>
                          <span className={`w-1.5 h-1.5 rounded-full absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none ${statusInfo.dotColor}`} />
                          <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </td>

                      {/* 7. Assigned To */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                        {lead.ownerId?.name || (lead.assignedTo && lead.assignedTo !== "Unassigned") ? (
                          <span className="font-medium text-slate-800">
                            {lead.ownerId?.name || lead.assignedTo}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>

                      {/* 8. Created Date */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                        {lead.createdAt ? (
                          new Date(lead.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* 9. Actions */}
                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setActiveLeadDetails(lead)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="Quick View Lead Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handlePlayRecording(lead)}
                            disabled={loadingRecordingId === leadIdStr}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Play Call Recording"
                            aria-label={`Play call recording for ${lead.name}`}
                          >
                            {loadingRecordingId === leadIdStr ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(lead)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="Edit Lead"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setLeadToDelete(lead)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Lead"
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

        {/* =========================================================================
            TABLE FOOTER: PAGINATION & PAGE-SIZE SELECTION
        ========================================================================= */}
        <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          {/* Summary Count */}
          <div className="text-slate-500 font-medium text-center sm:text-left">
            Showing <strong className="text-slate-900 font-bold">{totalLeads === 0 ? "0" : `${startRecord}–${endRecord}`}</strong> of{" "}
            <strong className="text-slate-900 font-bold">{totalLeads}</strong> leads
          </div>

          {/* Items Per Page Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 text-[11px] font-medium">Rows per page:</span>
            <select
              value={currentLimit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || totalLeads === 0}
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-semibold text-slate-700 text-xs">
              Page {totalLeads === 0 ? "1" : currentPage} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || totalLeads === 0}
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          LEAD DETAIL DRAWER & ACTIVITY TIMELINE (Phase 10)
      ========================================================================= */}
      <LeadDetailDrawer
        isOpen={Boolean(activeLeadDetails)}
        leadId={activeLeadDetails?._id || activeLeadDetails?.id}
        initialLead={activeLeadDetails}
        onClose={() => setActiveLeadDetails(null)}
        onLeadUpdated={(updatedLead) => {
          setActiveLeadDetails(updatedLead)
          setLeadsData((prev) => {
            if (!prev?.leads) return prev
            const targetId = updatedLead._id || updatedLead.id
            return {
              ...prev,
              leads: prev.leads.map((l) => {
                const currentId = l._id || l.id
                return currentId === targetId ? { ...l, ...updatedLead } : l
              }),
            }
          })
        }}
        onEditLead={(leadToEdit) => {
          handleOpenEditModal(leadToEdit)
          setActiveLeadDetails(null)
        }}
        onDeleteLead={(leadToDelete) => {
          setLeadToDelete(leadToDelete)
          setActiveLeadDetails(null)
        }}
      />

      {/* In-Browser Streaming Audio Player Dock */}
      {activePlayingCall && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-md animate-in slide-in-from-bottom-5 duration-200 shadow-2xl">
          <InBrowserAudioPlayer
            callId={activePlayingCall._id || activePlayingCall.id || activePlayingCall.clientCallId}
            recording={activePlayingCall.recording}
            agentName={activePlayingCall.agentName || activePlayingCall.agentId?.name || "Agent"}
            leadPhone={activePlayingCall.number || activePlayingCall.phoneNumber || activePlayingCall.phone}
            direction={activePlayingCall.direction}
            onClose={() => setActivePlayingCall(null)}
          />
        </div>
      )}

      {/* =========================================================================
          IN-PLACE EDIT LEAD MODAL
      ========================================================================= */}
      {editingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setEditingLead(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4 z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900">Edit Lead Record</h3>
                <p className="text-xs text-slate-500">Update information for #{editingLead._id.slice(-6).toUpperCase()}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingLead(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingLead.name}
                    onChange={(e) => setEditingLead({ ...editingLead, name: e.target.value })}
                    className={`w-full px-3 py-2 text-xs bg-slate-50 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white ${
                      editFormErrors.name ? "border-rose-400 ring-1 ring-rose-400" : "border-slate-300"
                    }`}
                  />
                  {editFormErrors.name && <p className="text-[11px] text-rose-600 mt-1">{editFormErrors.name}</p>}
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={editingLead.email}
                    onChange={(e) => setEditingLead({ ...editingLead, email: e.target.value })}
                    className={`w-full px-3 py-2 text-xs bg-slate-50 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono ${
                      editFormErrors.email ? "border-rose-400 ring-1 ring-rose-400" : "border-slate-300"
                    }`}
                  />
                  {editFormErrors.email && <p className="text-[11px] text-rose-600 mt-1">{editFormErrors.email}</p>}
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={editingLead.phone}
                    onChange={(e) => setEditingLead({ ...editingLead, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono"
                  />
                </div>

                {/* Company */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Company / Organization</label>
                  <input
                    type="text"
                    value={editingLead.company || ""}
                    onChange={(e) => setEditingLead({ ...editingLead, company: e.target.value })}
                    placeholder="e.g. Acme Health Corp"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pipeline Status</label>
                  <select
                    value={editingLead.status}
                    onChange={(e) => setEditingLead({ ...editingLead, status: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-medium cursor-pointer"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Source */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Lead Source</label>
                  <select
                    value={editingLead.source}
                    onChange={(e) => setEditingLead({ ...editingLead, source: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                  >
                    {LEAD_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assigned Representative */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Representative</label>
                  <input
                    type="text"
                    value={editingLead.assignedTo}
                    onChange={(e) => setEditingLead({ ...editingLead, assignedTo: e.target.value })}
                    placeholder="e.g. Sarah Jenkins or Unassigned"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                  />
                </div>

                {/* Message / Notes */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Inquiry Details</label>
                  <textarea
                    rows={3}
                    value={editingLead.message}
                    onChange={(e) => setEditingLead({ ...editingLead, message: e.target.value })}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingLead(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  {isUpdating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          DELETE CONFIRMATION MODAL DIALOG
      ========================================================================= */}
      {leadToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => !isDeleting && setLeadToDelete(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center border border-rose-100 shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Lead Record</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to permanently delete lead <strong className="text-slate-900 font-bold">{leadToDelete.name}</strong> (
              <span className="font-mono text-slate-700">#LD-{(leadToDelete._id || leadToDelete.id || "").slice(-6).toUpperCase()}</span>)?
              This lead record and its communication logs will be removed from your database.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setLeadToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
