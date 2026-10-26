"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import { toast } from "react-hot-toast"
import {
  History,
  Shield,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  User,
  Clock,
  Globe,
  Key,
  Users,
  Layers,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Copy,
  Check,
  Download,
  AlertTriangle,
  Info,
  Calendar,
} from "lucide-react"

export default function AuditLogClient() {
  const { user, status } = useAuth()

  // Data state
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterOptions, setFilterOptions] = useState({ actions: [], entities: [] })
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1, limit: 25 })

  // Filter state
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedEntity, setSelectedEntity] = useState("all")
  const [selectedAction, setSelectedAction] = useState("all")
  const [dateRange, setDateRange] = useState("all") // "all" | "today" | "7d" | "30d"

  // Drawer / Detail modal state
  const [selectedLog, setSelectedLog] = useState(null)
  const [copiedId, setCopiedId] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPagination((prev) => ({ ...prev, page: 1 }))
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Compute date range timestamps
  const dateParams = useMemo(() => {
    const now = new Date()
    if (dateRange === "today") {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return { startDate: today.toISOString() }
    }
    if (dateRange === "7d") {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { startDate: past7.toISOString() }
    }
    if (dateRange === "30d") {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { startDate: past30.toISOString() }
    }
    return {}
  }, [dateRange])

  // Fetch filter options once
  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/audit-logs/filters", { credentials: "include" })
      const json = await res.json()
      if (json.success && json.data) {
        setFilterOptions(json.data)
      }
    } catch (_) {}
  }, [])

  // Fetch audit logs
  const fetchLogs = useCallback(
    async (pageToLoad = pagination.page) => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          page: String(pageToLoad),
          limit: String(pagination.limit),
        })

        if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim())
        if (selectedEntity !== "all") params.append("entity", selectedEntity)
        if (selectedAction !== "all") params.append("action", selectedAction)
        if (dateParams.startDate) params.append("startDate", dateParams.startDate)

        const res = await fetch(`/api/audit-logs?${params.toString()}`, { credentials: "include" })
        const json = await res.json()

        if (json.success) {
          setLogs(json.data || [])
          if (json.pagination) {
            setPagination((prev) => ({
              ...prev,
              total: json.pagination.total || 0,
              page: json.pagination.page || 1,
              totalPages: json.pagination.totalPages || 1,
            }))
          }
        } else {
          toast.error(json.error || "Failed to load audit logs")
        }
      } catch (err) {
        console.error("Error fetching audit logs:", err)
        toast.error("Failed to fetch audit logs")
      } finally {
        setLoading(false)
      }
    },
    [pagination.limit, pagination.page, debouncedSearch, selectedEntity, selectedAction, dateParams],
  )

  useEffect(() => {
    fetchFilterOptions()
  }, [fetchFilterOptions])

  useEffect(() => {
    fetchLogs(pagination.page)
  }, [debouncedSearch, selectedEntity, selectedAction, dateRange, pagination.page, fetchLogs])

  // Permission authorization check
  const hasAuditPermission = useMemo(() => {
    if (!user) return false
    if (user.role === "account_admin" || user.role === "super_admin") return true
    return Array.isArray(user.permissions) && user.permissions.includes("audit.view")
  }, [user])

  // Copy helpers
  const handleCopy = (text, type = "id") => {
    if (!text) return
    navigator.clipboard.writeText(typeof text === "object" ? JSON.stringify(text, null, 2) : String(text))
    if (type === "id") {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    } else {
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    }
    toast.success("Copied to clipboard")
  }

  // Export visible logs as JSON
  const handleExportJson = () => {
    if (logs.length === 0) {
      toast.error("No audit logs to export")
      return
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2))
    const downloadAnchor = document.createElement("a")
    downloadAnchor.setAttribute("href", dataStr)
    downloadAnchor.setAttribute("download", `audit-logs-${new Date().toISOString().slice(0, 10)}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
    toast.success("Audit log export started")
  }

  // Action badge formatting
  const getActionBadge = (action = "") => {
    if (action.includes("delete") || action.includes("deactivate")) {
      return "bg-rose-50 text-rose-700 border-rose-200"
    }
    if (action.includes("login") || action.includes("logout") || action.includes("auth")) {
      return "bg-indigo-50 text-indigo-700 border-indigo-200"
    }
    if (action.includes("create") || action.includes("reactivate")) {
      return "bg-emerald-50 text-emerald-700 border-emerald-200"
    }
    if (action.includes("assign") || action.includes("update") || action.includes("rotate")) {
      return "bg-amber-50 text-amber-700 border-amber-200"
    }
    return "bg-slate-100 text-slate-700 border-slate-200"
  }

  // Entity badge icon
  const getEntityIcon = (entity = "") => {
    switch (entity.toLowerCase()) {
      case "auth":
        return <Shield className="w-3.5 h-3.5 text-indigo-600" />
      case "staff":
        return <User className="w-3.5 h-3.5 text-purple-600" />
      case "team":
        return <Users className="w-3.5 h-3.5 text-blue-600" />
      case "role":
        return <Layers className="w-3.5 h-3.5 text-sky-600" />
      case "lead":
        return <History className="w-3.5 h-3.5 text-amber-600" />
      case "integration":
        return <Key className="w-3.5 h-3.5 text-emerald-600" />
      default:
        return <History className="w-3.5 h-3.5 text-slate-500" />
    }
  }

  // Metrics computation
  const metrics = useMemo(() => {
    let authEvents = 0
    let staffEvents = 0
    let leadEvents = 0

    logs.forEach((log) => {
      if (log.entity === "auth") authEvents++
      else if (log.entity === "staff" || log.entity === "team" || log.entity === "role") staffEvents++
      else if (log.entity === "lead") leadEvents++
    })

    return {
      total: pagination.total,
      authEvents,
      staffEvents,
      leadEvents,
    }
  }, [logs, pagination.total])

  if (status === "loading") {
    return (
      <div className="min-h-[500px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasAuditPermission) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4">
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs">
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-4">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto mb-6">
            You do not have permission to view the tenant audit log. Contact your Leads Account Administrator to grant the <code className="bg-slate-100 text-rose-600 px-1.5 py-0.5 rounded font-mono text-xs">audit.view</code> permission.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Audit Log & Security Trail</h1>
                <p className="text-xs text-slate-500 font-medium">
                  Append-only, immutable record of logins, staff changes, assignments, and API events.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={() => fetchLogs(pagination.page)}
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Metrics Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6 pt-5 border-t border-slate-100">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Recorded Events</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{pagination.total.toLocaleString()}</p>
          </div>
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5">
            <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">Auth & Security</p>
            <p className="text-2xl font-bold text-indigo-900 mt-1">{metrics.authEvents} <span className="text-xs font-normal text-indigo-500">visible</span></p>
          </div>
          <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-3.5">
            <p className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Staff & Roles</p>
            <p className="text-2xl font-bold text-purple-900 mt-1">{metrics.staffEvents} <span className="text-xs font-normal text-purple-500">visible</span></p>
          </div>
          <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3.5">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Leads & Reassignments</p>
            <p className="text-2xl font-bold text-amber-900 mt-1">{metrics.leadEvents} <span className="text-xs font-normal text-amber-500">visible</span></p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search Input */}
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by actor, email, summary, or IP..."
              className="w-full pl-9 pr-3.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-slate-50/50"
            />
          </div>

          {/* Entity Filter */}
          <div className="md:col-span-2.5">
            <select
              value={selectedEntity}
              onChange={(e) => {
                setSelectedEntity(e.target.value)
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-medium text-slate-700"
            >
              <option value="all">All Entities</option>
              <option value="auth">Auth & Sessions</option>
              <option value="staff">Staff Members</option>
              <option value="team">Teams</option>
              <option value="role">Roles & Permissions</option>
              <option value="lead">Leads & Assignments</option>
              <option value="integration">Lead Feeds & API Keys</option>
            </select>
          </div>

          {/* Action Filter */}
          <div className="md:col-span-2.5">
            <select
              value={selectedAction}
              onChange={(e) => {
                setSelectedAction(e.target.value)
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-medium text-slate-700"
            >
              <option value="all">All Actions</option>
              {filterOptions.actions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Selector */}
          <div className="md:col-span-2 flex items-center space-x-1 bg-slate-100 p-1 rounded-lg">
            {["all", "today", "7d", "30d"].map((rangeKey) => (
              <button
                key={rangeKey}
                type="button"
                onClick={() => {
                  setDateRange(rangeKey)
                  setPagination((prev) => ({ ...prev, page: 1 }))
                }}
                className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  dateRange === rangeKey
                    ? "bg-white text-indigo-700 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {rangeKey === "all" ? "All" : rangeKey === "today" ? "Today" : rangeKey.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Summary</th>
                <th className="py-3 px-4">Client IP</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-400">
                    <div className="inline-flex items-center space-x-2 text-indigo-600 font-medium">
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span>Loading audit entries...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-500">
                    <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">No audit records found</p>
                    <p className="text-[11px] text-slate-400 mt-1">Try adjusting your filters or date range.</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const logDate = new Date(log.timestamp)
                  return (
                    <tr key={log._id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Timestamp */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">
                            {logDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {logDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </div>
                      </td>

                      {/* Actor */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center shrink-0">
                            {log.actor?.name ? log.actor.name.charAt(0).toUpperCase() : "S"}
                          </div>
                          <div className="truncate max-w-[140px]">
                            <p className="font-bold text-slate-900 truncate">{log.actor?.name || "System"}</p>
                            <p className="text-[10px] text-slate-400 font-mono truncate">{log.actor?.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getActionBadge(
                            log.action,
                          )}`}
                        >
                          {log.action}
                        </span>
                      </td>

                      {/* Entity */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center space-x-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {getEntityIcon(log.entity)}
                          <span className="capitalize">{log.entity}</span>
                        </div>
                      </td>

                      {/* Summary */}
                      <td className="py-3.5 px-4 max-w-[320px]">
                        <p className="text-slate-800 font-medium truncate" title={log.summary}>
                          {log.summary}
                        </p>
                      </td>

                      {/* Client IP */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {log.ip || "unknown"}
                      </td>

                      {/* Detail CTA */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs">
          <p className="text-slate-500 font-medium">
            Showing <span className="font-bold text-slate-900">{logs.length}</span> of{" "}
            <span className="font-bold text-slate-900">{pagination.total.toLocaleString()}</span> entries
          </p>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors cursor-pointer"
              aria-label="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-700 font-semibold px-2">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors cursor-pointer"
              aria-label="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Audit Detail Modal / Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center space-x-2.5">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getActionBadge(selectedLog.action)}`}>
                  {selectedLog.action}
                </span>
                <span className="text-xs text-slate-500 font-mono">ID: {selectedLog._id}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedLog._id, "id")}
                  className="text-slate-400 hover:text-slate-600"
                  title="Copy log ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-7 h-7 rounded-lg hover:bg-slate-200/60 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              {/* Summary Statement */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5">
                <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider mb-1">Event Summary</p>
                <p className="text-sm font-semibold text-slate-900">{selectedLog.summary}</p>
              </div>

              {/* 2-Column Metadata Grid */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actor Identity</p>
                  <p className="font-bold text-slate-900">{selectedLog.actor?.name || "System"}</p>
                  <p className="text-slate-500 font-mono text-[11px]">{selectedLog.actor?.email}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-semibold">
                    Role: {selectedLog.actor?.role || "system"}
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Context & Environment</p>
                  <p className="font-mono text-slate-800">IP: {selectedLog.ip || "unknown"}</p>
                  <p className="text-slate-500 truncate" title={selectedLog.userAgent}>
                    Agent: {selectedLog.userAgent || "unknown"}
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    Timestamp: {new Date(selectedLog.timestamp).toISOString()}
                  </p>
                </div>
              </div>

              {/* Target Entity Information */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Entity</span>
                  <p className="font-bold text-slate-900 capitalize mt-0.5">{selectedLog.entity}</p>
                </div>
                {selectedLog.entityId && (
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Entity ID</span>
                    <p className="font-mono text-slate-700 mt-0.5">{String(selectedLog.entityId)}</p>
                  </div>
                )}
              </div>

              {/* Sanitized Details / Diff Inspector */}
              {selectedLog.details && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Event Payload & Changes (Sanitized)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedLog.details, "json")}
                      className="inline-flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                    >
                      {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copy Details JSON</span>
                    </button>
                  </div>

                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 leading-relaxed">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
