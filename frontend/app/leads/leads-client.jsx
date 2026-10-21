"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Users,
  User,
  UserPlus,
  Plus,
  Search,
  Filter,
  RefreshCw,
  UploadCloud,
  Calendar,
  Mail,
  Phone,
  Tag,
  SlidersHorizontal,
  Trash2,
  Edit2,
  Eye,
  CheckCircle2,
  AlertCircle,
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
} from "lucide-react"

// Status configurations with accessible color tokens
const STATUS_CONFIG = {
  New: {
    label: "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
  },
  Engaged: {
    label: "Engaged",
    dotColor: "bg-amber-500",
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
  },
  "Proposal Sent": {
    label: "Proposal Sent",
    dotColor: "bg-purple-500",
    badgeClasses: "bg-purple-50 text-purple-700 border-purple-200/80",
  },
  "Closed-Won": {
    label: "Closed-Won",
    dotColor: "bg-emerald-500",
    badgeClasses: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  },
  "Closed-Lost": {
    label: "Closed-Lost",
    dotColor: "bg-rose-500",
    badgeClasses: "bg-rose-50 text-rose-700 border-rose-200/80",
  },
}

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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [copiedId, setCopiedId] = useState(null)
  const [activeLeadDetails, setActiveLeadDetails] = useState(null)
  const [isDeletingId, setIsDeletingId] = useState(null)
  const [isFilterOpen, setIsFilterOpen] = useState(true)

  // Fetch leads from backend API
  const fetchLeads = useCallback(async () => {
    try {
      setRefreshing(true)
      setError(null)

      const response = await apiClient.getLeads({
        page: currentPage,
        limit: currentLimit,
        search: currentSearch || searchParams.get("name") || undefined,
        status: currentStatus !== "all" ? currentStatus : undefined,
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
    currentSortBy,
    currentSortOrder,
    searchParams,
  ])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

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
    setSelectedIds(new Set())
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

  // Single Lead Deletion
  const handleDeleteLead = async (leadId, leadName) => {
    if (!window.confirm(`Are you sure you want to delete lead "${leadName}"?`)) {
      return
    }

    try {
      setIsDeletingId(leadId)
      const res = await apiClient.deleteLead(leadId)
      if (res.success) {
        toast.success(`Lead "${leadName}" deleted successfully`)
        fetchLeads()
      } else {
        toast.error(res.error || "Failed to delete lead")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete lead")
    } finally {
      setIsDeletingId(null)
    }
  }

  // Checkbox Selection
  const allLeadsList = leadsData?.leads || []
  const allSelected = allLeadsList.length > 0 && selectedIds.size === allLeadsList.length

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allLeadsList.map((l) => l._id || l.id)))
    }
  }

  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

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

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5 space-y-5 animate-in fade-in duration-200">
      {/* =========================================================================
          PAGE HEADER & PRIMARY ACTIONS
      ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">All Leads</h1>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              {totalLeads} {totalLeads === 1 ? "Lead" : "Leads"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage, organize, and track all your leads in one place.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            type="button"
            onClick={() => fetchLeads()}
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
            <span>+ Add Lead</span>
          </Link>
        </div>
      </div>

      {/* =========================================================================
          COMPACT LEAD FILTERS PANEL
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden transition-all">
        {/* Filter Card Header */}
        <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Filter className="w-3.5 h-3.5 text-indigo-600" />
            <span className="text-xs font-bold text-slate-800">Filter Leads</span>
            {activeFiltersCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-600 text-white">
                {activeFiltersCount} Active
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center space-x-1 cursor-pointer"
          >
            <span>{isFilterOpen ? "Hide Filters" : "Show Filters"}</span>
          </button>
        </div>

        {/* Filter Inputs Form */}
        {isFilterOpen && (
          <form onSubmit={handleApplyFilters} className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {/* 1. Lead Name */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Lead Name
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={filterInputs.name}
                    onChange={(e) => setFilterInputs({ ...filterInputs, name: e.target.value })}
                    placeholder="Search name..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                  />
                </div>
              </div>

              {/* 2. Phone Number */}
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
                    placeholder="Search phone..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                  />
                </div>
              </div>

              {/* 3. Email Address */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={filterInputs.email}
                    onChange={(e) => setFilterInputs({ ...filterInputs, email: e.target.value })}
                    placeholder="Search email..."
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                  />
                </div>
              </div>

              {/* 4. Lead Status */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Lead Status
                </label>
                <select
                  value={filterInputs.status}
                  onChange={(e) => setFilterInputs({ ...filterInputs, status: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="New">New</option>
                  <option value="Engaged">Engaged</option>
                  <option value="Proposal Sent">Proposal Sent</option>
                  <option value="Closed-Won">Closed-Won</option>
                  <option value="Closed-Lost">Closed-Lost</option>
                </select>
              </div>

              {/* 5. Lead Source */}
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
                  <option value="Website">Website Form</option>
                  <option value="Referral">Client Referral</option>
                  <option value="Cold Outreach">Cold Outreach</option>
                  <option value="Google Ads">Google Ads</option>
                  <option value="Meta Ads">Meta Ads</option>
                  <option value="Inbound Call">Inbound Call</option>
                </select>
              </div>

              {/* 6. Assigned To */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Assigned To
                </label>
                <select
                  value={filterInputs.assignedTo}
                  onChange={(e) => setFilterInputs({ ...filterInputs, assignedTo: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value="all">All Team Members</option>
                  <option value="Unassigned">Unassigned</option>
                  <option value="Me">Assigned to Me</option>
                </select>
              </div>

              {/* 7. Fresh / Existing Lead */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Lead Type
                </label>
                <select
                  value={filterInputs.leadType}
                  onChange={(e) => setFilterInputs({ ...filterInputs, leadType: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                >
                  <option value="all">All Leads</option>
                  <option value="Fresh">Fresh Leads (New)</option>
                  <option value="Existing">Existing Pipeline Leads</option>
                </select>
              </div>

              {/* 8. From Date */}
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

              {/* 9. To Date */}
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

              {/* 10. Items Per Page */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Items Per Page
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

            {/* Filter Buttons */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Clear All
              </button>

              <button
                type="submit"
                className="inline-flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Apply Filters</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* =========================================================================
          BATCH ACTIONS BAR (Displays when items are checked)
      ========================================================================= */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs text-indigo-900 shadow-2xs animate-in fade-in">
          <div className="flex items-center space-x-2">
            <span className="font-bold">{selectedIds.size}</span>
            <span>{selectedIds.size === 1 ? "lead" : "leads"} selected</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100/70 rounded transition-colors"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          LEADS DATA TABLE & ZERO-LEADS EMPTY STATE
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {/* Table Summary Bar */}
        <div className="px-4 py-3 bg-slate-50/60 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
          <div className="text-slate-600 font-medium">
            Showing <strong className="text-slate-900 font-bold">{totalLeads === 0 ? "0" : `${startRecord}–${endRecord}`}</strong> of{" "}
            <strong className="text-slate-900 font-bold">{totalLeads}</strong> leads
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
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    disabled={allLeadsList.length === 0}
                    aria-label="Select all leads on current page"
                    className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
                  />
                </th>
                <th className="py-3 px-4">Lead ID</th>
                <th className="py-3 px-4 cursor-pointer hover:text-slate-900" onClick={() => handleSort("name")}>
                  <div className="flex items-center space-x-1">
                    <span>Name</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Lead Source</th>
                <th className="py-3 px-4">Status</th>
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
                  <td colSpan={10} className="py-16 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs font-medium text-slate-600">Loading leads database...</p>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                /* Error State Row */
                <tr>
                  <td colSpan={10} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2 text-rose-600">
                      <AlertCircle className="w-8 h-8" />
                      <p className="font-semibold text-xs">{error}</p>
                      <button
                        type="button"
                        onClick={() => fetchLeads()}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs mt-2 transition-colors cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  </td>
                </tr>
              ) : allLeadsList.length === 0 ? (
                /* =========================================================================
                   ZERO-LEADS EMPTY STATE (INSIDE TABLE AREA, NEVER A BLANK SCREEN)
                ========================================================================= */
                <tr>
                  <td colSpan={10} className="py-16 sm:py-20 text-center">
                    <div className="max-w-md mx-auto px-4 flex flex-col items-center justify-center animate-in fade-in duration-200">
                      {/* Premium lead-related icon */}
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4 shadow-2xs">
                        <Users className="w-8 h-8 stroke-[1.8]" />
                      </div>

                      {/* Heading */}
                      <h3 className="text-base font-bold text-slate-900 mb-1">
                        No leads yet
                      </h3>

                      {/* Description */}
                      <p className="text-xs text-slate-500 max-w-sm mb-6 leading-relaxed">
                        {activeFiltersCount > 0
                          ? "No leads match your current filter parameters. Try clearing or relaxing your search filters."
                          : "Your leads will appear here when you add them or connect a lead source."}
                      </p>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {activeFiltersCount > 0 ? (
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
                          <span>+ Add Your First Lead</span>
                        </Link>

                        <Link
                          href="/tools/import-leads"
                          className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                        >
                          <UploadCloud className="w-4 h-4 text-slate-500" />
                          <span>Import Leads</span>
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
                  const isChecked = selectedIds.has(leadIdStr)

                  return (
                    <tr
                      key={leadIdStr}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isChecked ? "bg-indigo-50/30" : ""
                      }`}
                    >
                      {/* 1. Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(leadIdStr)}
                          className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          aria-label={`Select lead ${lead.name}`}
                        />
                      </td>

                      {/* 2. Lead ID */}
                      <td className="py-3 px-4 font-mono font-medium text-slate-600 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-bold text-slate-700">
                            #LD-{shortId}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(leadIdStr, leadIdStr)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                            title="Copy full Lead ID"
                          >
                            {copiedId === leadIdStr ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* 3. Name */}
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            {lead.name ? lead.name.charAt(0) : "L"}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 truncate max-w-[180px]">{lead.name}</p>
                            {lead.company && (
                              <p className="text-[11px] text-slate-500 font-normal truncate max-w-[180px]">
                                {lead.company}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 4. Phone */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-600">
                        {lead.phone ? (
                          <div className="flex items-center space-x-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{lead.phone}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 5. Email */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-slate-600">
                        {lead.email ? (
                          <div className="flex items-center space-x-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[200px]">{lead.email}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* 6. Lead Source */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <Tag className="w-2.5 h-2.5 text-slate-400" />
                          <span>{lead.source || "Website Form"}</span>
                        </span>
                      </td>

                      {/* 7. Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusInfo.badgeClasses}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotColor}`} />
                          <span>{statusInfo.label}</span>
                        </span>
                      </td>

                      {/* 8. Assigned To */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600">
                        {lead.assignedTo ? (
                          <span className="font-medium text-slate-800">{lead.assignedTo}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>

                      {/* 9. Created Date */}
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

                      {/* 10. Actions */}
                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setActiveLeadDetails(lead)}
                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Quick View Lead"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <Link
                            href={`/leads/new?id=${leadIdStr}`}
                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            title="Edit Lead"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Link>

                          <button
                            type="button"
                            onClick={() => handleDeleteLead(leadIdStr, lead.name)}
                            disabled={isDeletingId === leadIdStr}
                            className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
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
            <span className="text-slate-500 text-[11px] font-medium">Rows:</span>
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
          QUICK VIEW MODAL FOR LEAD DETAILS
      ========================================================================= */}
      {activeLeadDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setActiveLeadDetails(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  {activeLeadDetails.name ? activeLeadDetails.name.charAt(0).toUpperCase() : "L"}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">{activeLeadDetails.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">
                    #LD-{(activeLeadDetails._id || activeLeadDetails.id || "").slice(-6).toUpperCase()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveLeadDetails(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-500 block font-medium mb-1">Status</span>
                <span className="font-bold text-slate-800">{activeLeadDetails.status}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-500 block font-medium mb-1">Lead Source</span>
                <span className="font-bold text-slate-800">{activeLeadDetails.source || "Website Form"}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-500 block font-medium mb-1">Email Address</span>
                <span className="font-mono text-slate-800 break-all">{activeLeadDetails.email || "—"}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-slate-500 block font-medium mb-1">Phone Number</span>
                <span className="font-mono text-slate-800">{activeLeadDetails.phone || "—"}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 col-span-2">
                <span className="text-slate-500 block font-medium mb-1">Created At</span>
                <span className="text-slate-800 font-mono">
                  {activeLeadDetails.createdAt ? new Date(activeLeadDetails.createdAt).toLocaleString() : "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveLeadDetails(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              <Link
                href={`/leads/new?id=${activeLeadDetails._id || activeLeadDetails.id}`}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Edit Lead
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
