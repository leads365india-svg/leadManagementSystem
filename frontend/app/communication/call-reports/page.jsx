"use client"

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react"
import dynamic from "next/dynamic"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import Breadcrumb from "@/components/breadcrumb"

const LeadDetailDrawer = dynamic(() => import("@/components/lead-detail-drawer"), {
  ssr: false,
})
const InBrowserAudioPlayer = dynamic(() => import("@/components/in-browser-audio-player"), {
  ssr: false,
})
import {
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  Plus,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  Check,
  X,
  Building2,
  Phone,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Shield,
  ShieldAlert,
  Mic,
  Activity,
  BarChart3,
  SlidersHorizontal,
} from "lucide-react"

export default function CallReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      }
    >
      <CallReportsClient />
    </Suspense>
  )
}

function CallReportsClient() {
  // Navigation tabs: "logs" | "devices"
  const [activeTab, setActiveTab] = useState("logs")

  // Calls state
  const [calls, setCalls] = useState([])
  const [loadingCalls, setLoadingCalls] = useState(true)
  const [metrics, setMetrics] = useState({
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    totalDurationSeconds: 0,
    avgDurationSeconds: 0,
    completedCalls: 0,
    connectRate: 0,
    byDisposition: [],
    byStatus: [],
  })
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  // Filters
  const [searchTerm, setSearchTerm] = useState("")
  const [directionFilter, setDirectionFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dispositionFilter, setDispositionFilter] = useState("all")
  const [recordingFilter, setRecordingFilter] = useState("all") // "all" | "stored" | "missing" | "expired" | "skipped_dnr"
  const [activePlayingCall, setActivePlayingCall] = useState(null)
  const [dateRange, setDateRange] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Devices state
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(false)

  // Modals & Drawers
  const [selectedLeadId, setSelectedLeadId] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [showLogCallModal, setShowLogCallModal] = useState(false)
  const [submittingCall, setSubmittingCall] = useState(false)
  const [logCallForm, setLogCallForm] = useState({
    number: "",
    direction: "outbound",
    duration: 60,
    status: "completed",
    disposition: "Interested",
    notes: "",
  })

  // Edit call modal
  const [editingCall, setEditingCall] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Compute date range query params
  const dateQueryParams = useMemo(() => {
    const now = new Date()
    if (dateRange === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      return { startDate: startOfDay }
    } else if (dateRange === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      return { startDate: weekAgo }
    } else if (dateRange === "month") {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      return { startDate: monthAgo }
    }
    return {}
  }, [dateRange])

  // Fetch Calls
  const fetchCalls = useCallback(async () => {
    try {
      setLoadingCalls(true)
      const query = {
        page,
        limit: 15,
        ...dateQueryParams,
      }
      if (directionFilter !== "all") query.direction = directionFilter
      if (statusFilter !== "all") query.status = statusFilter
      if (dispositionFilter !== "all") query.disposition = dispositionFilter
      if (recordingFilter === "stored") query.hasRecording = "true"
      else if (recordingFilter === "missing") query.missingRecording = "true"
      else if (recordingFilter === "expired") query.recordingStatus = "expired"
      else if (recordingFilter === "skipped_dnr") query.recordingStatus = "skipped_dnr"

      const res = await apiClient.getCalls(query)
      if (res && res.success && res.data) {
        setCalls(res.data.calls || [])
        setTotalPages(res.data.pagination?.pages || 1)
        setTotalCount(res.data.pagination?.total || 0)
      } else {
        setCalls([])
      }
    } catch (err) {
      console.error("Failed to fetch calls:", err)
      toast.error(err.message || "Failed to load calls")
      setCalls([])
    } finally {
      setLoadingCalls(false)
    }
  }, [page, directionFilter, statusFilter, dispositionFilter, recordingFilter, dateQueryParams])

  // Fetch Metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoadingMetrics(true)
      const res = await apiClient.getCallMetrics(dateQueryParams)
      if (res && res.success && res.data) {
        setMetrics(res.data)
      }
    } catch (err) {
      console.error("Failed to load call metrics:", err)
    } finally {
      setLoadingMetrics(false)
    }
  }, [dateQueryParams])

  // Fetch Devices
  const fetchDevices = useCallback(async () => {
    try {
      setLoadingDevices(true)
      const res = await apiClient.getDevices()
      if (res && res.success && res.data) {
        setDevices(res.data.devices || [])
      }
    } catch (err) {
      console.error("Failed to load devices:", err)
      toast.error(err.message || "Failed to load devices")
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  useEffect(() => {
    fetchCalls()
    fetchMetrics()
  }, [fetchCalls, fetchMetrics])

  useEffect(() => {
    if (activeTab === "devices") {
      fetchDevices()
    }
  }, [activeTab, fetchDevices])

  // Handle Log Call submit
  const handleLogCallSubmit = async (e) => {
    e.preventDefault()
    if (!logCallForm.number.trim()) {
      toast.error("Please enter a phone number")
      return
    }

    try {
      setSubmittingCall(true)
      const payload = {
        number: logCallForm.number.trim(),
        direction: logCallForm.direction,
        duration: Number(logCallForm.duration) || 0,
        status: logCallForm.status,
        disposition: logCallForm.disposition,
        notes: logCallForm.notes,
        startedAt: new Date(Date.now() - (Number(logCallForm.duration) || 0) * 1000).toISOString(),
        endedAt: new Date().toISOString(),
      }

      const res = await apiClient.logCall(payload)
      if (res && res.success) {
        toast.success("Call logged successfully")
        setShowLogCallModal(false)
        setLogCallForm({
          number: "",
          direction: "outbound",
          duration: 60,
          status: "completed",
          disposition: "Interested",
          notes: "",
        })
        fetchCalls()
        fetchMetrics()
      } else {
        toast.error(res?.message || "Failed to log call")
      }
    } catch (err) {
      toast.error(err.message || "Failed to log call")
    } finally {
      setSubmittingCall(false)
    }
  }

  // Handle Edit Call submit
  const handleEditCallSubmit = async (e) => {
    e.preventDefault()
    if (!editingCall) return

    try {
      setSavingEdit(true)
      const res = await apiClient.updateCall(editingCall._id || editingCall.id, {
        disposition: editingCall.disposition,
        notes: editingCall.notes,
      })
      if (res && res.success) {
        toast.success("Call updated successfully")
        setEditingCall(null)
        fetchCalls()
      } else {
        toast.error(res?.message || "Failed to update call")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update call")
    } finally {
      setSavingEdit(false)
    }
  }

  // Handle Device Status toggle
  const handleToggleDeviceStatus = async (device) => {
    const newStatus = device.status === "active" ? "revoked" : "active"
    try {
      const res = await apiClient.updateDeviceStatus(device._id || device.id, newStatus)
      if (res && res.success) {
        toast.success(`Device marked as ${newStatus}`)
        fetchDevices()
      } else {
        toast.error(res?.message || "Failed to update device status")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update device status")
    }
  }

  // Format duration helper
  const formatDuration = (seconds = 0) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60)
      const remMins = mins % 60
      return `${hrs}h ${remMins}m`
    }
    return `${mins}m ${secs}s`
  }

  // Client-side search filter for calls
  const filteredCalls = useMemo(() => {
    if (!searchTerm.trim()) return calls
    const term = searchTerm.toLowerCase()
    return calls.filter(
      (c) =>
        (c.number && c.number.toLowerCase().includes(term)) ||
        (c.phoneNormalized && c.phoneNormalized.toLowerCase().includes(term)) ||
        (c.leadId?.name && c.leadId.name.toLowerCase().includes(term)) ||
        (c.notes && c.notes.toLowerCase().includes(term)) ||
        (c.disposition && c.disposition.toLowerCase().includes(term))
    )
  }, [calls, searchTerm])

  return (
    <div className="min-h-screen bg-slate-50/60 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Breadcrumb & Header */}
      <div className="space-y-3">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/portal/dashboard" },
            { label: "Communication", href: "/communication/follow-ups" },
            { label: "Call Reports", active: true },
          ]}
        />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2.5">
              <PhoneCall className="w-6 h-6 text-indigo-600" />
              <span>Call Reports & Telephony</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Analyze agent calling activity, track call duration metrics, monitor mobile hardware, and inspect logs.
            </p>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={() => {
                fetchCalls()
                fetchMetrics()
                if (activeTab === "devices") fetchDevices()
                toast.success("Call reports refreshed")
              }}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 shadow-2xs transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setShowLogCallModal(true)}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Call</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-8 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`pb-3 border-b-2 flex items-center space-x-2 transition cursor-pointer ${
            activeTab === "logs"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Call Logs & Metrics</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 font-bold">
            {totalCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("devices")}
          className={`pb-3 border-b-2 flex items-center space-x-2 transition cursor-pointer ${
            activeTab === "devices"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Smartphone className="w-4 h-4" />
          <span>Mobile Devices</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 font-bold">
            {devices.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CALL LOGS & METRICS */}
      {activeTab === "logs" && (
        <div className="space-y-6">
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Calls */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Total Calls</span>
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <PhoneCall className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {loadingMetrics ? "—" : metrics.totalCalls}
              </div>
              <div className="flex items-center space-x-3 text-xs text-slate-500 font-medium">
                <span className="text-emerald-600 font-semibold">{metrics.outboundCalls} Outbound</span>
                <span>•</span>
                <span className="text-blue-600 font-semibold">{metrics.inboundCalls} Inbound</span>
              </div>
            </div>

            {/* Total Duration */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Total Duration</span>
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {loadingMetrics ? "—" : formatDuration(metrics.totalDurationSeconds)}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                Avg: <span className="font-semibold text-slate-700">{formatDuration(metrics.avgDurationSeconds)}</span> per call
              </div>
            </div>

            {/* Connect Rate */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Connect Rate</span>
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Activity className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900">
                {loadingMetrics ? "—" : `${metrics.connectRate}%`}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                <span className="font-semibold text-slate-700">{metrics.completedCalls}</span> completed connections
              </div>
            </div>

            {/* Lead Telephony Health */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Top Disposition</span>
                <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900 truncate">
                {loadingMetrics
                  ? "—"
                  : metrics.byDisposition?.[0]?._id || "Interested"}
              </div>
              <div className="text-xs text-slate-500 font-medium truncate">
                {metrics.byDisposition?.[0]?.count ? `${metrics.byDisposition[0].count} interactions logged` : "No logs recorded"}
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by phone, lead name, notes, disposition..."
                  className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
                />
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Date Range */}
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                </select>

                {/* Direction */}
                <select
                  value={directionFilter}
                  onChange={(e) => setDirectionFilter(e.target.value)}
                  className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Directions</option>
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                </select>

                {/* Status */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="busy">Busy</option>
                  <option value="no-answer">No Answer</option>
                  <option value="failed">Failed</option>
                </select>

                {/* Disposition */}
                <select
                  value={dispositionFilter}
                  onChange={(e) => setDispositionFilter(e.target.value)}
                  className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Dispositions</option>
                  <option value="Interested">Interested</option>
                  <option value="Follow-up Required">Follow-up Required</option>
                  <option value="Not Interested">Not Interested</option>
                  <option value="Wrong Number">Wrong Number</option>
                  <option value="Left Voicemail">Left Voicemail</option>
                </select>

                {/* Recording Status Filter */}
                <select
                  value={recordingFilter}
                  onChange={(e) => setRecordingFilter(e.target.value)}
                  className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                >
                  <option value="all">All Audio</option>
                  <option value="stored">Has Stored Recording</option>
                  <option value="missing">Missing Recording</option>
                  <option value="skipped_dnr">Skipped (DNR)</option>
                  <option value="expired">Purged (30d)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Call Logs Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3.5">Direction</th>
                    <th className="px-5 py-3.5">Phone & Lead</th>
                    <th className="px-5 py-3.5">Agent</th>
                    <th className="px-5 py-3.5">Duration</th>
                    <th className="px-5 py-3.5">Status & Disposition</th>
                    <th className="px-5 py-3.5">Recording</th>
                    <th className="px-5 py-3.5">Started At</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingCalls ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
                        Loading call interactions...
                      </td>
                    </tr>
                  ) : filteredCalls.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-slate-500 space-y-2">
                        <PhoneCall className="w-8 h-8 text-slate-300 mx-auto" />
                        <p className="font-semibold text-slate-700">No call logs found</p>
                        <p className="text-xs text-slate-400">
                          Try adjusting your filter settings or click &quot;Log Call&quot; to create a new record.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredCalls.map((call) => {
                      const isOutbound = call.direction === "outbound"
                      return (
                        <tr key={call._id || call.id} className="hover:bg-slate-50/60 transition-colors">
                          {/* Direction */}
                          <td className="px-5 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                isOutbound
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                  : "bg-blue-50 text-blue-700 border border-blue-200/60"
                              }`}
                            >
                              {isOutbound ? <PhoneOutgoing className="w-3.5 h-3.5" /> : <PhoneIncoming className="w-3.5 h-3.5" />}
                              <span className="capitalize">{call.direction}</span>
                            </span>
                          </td>

                          {/* Phone & Lead */}
                          <td className="px-5 py-4">
                            <div className="font-mono font-semibold text-slate-900">
                              {call.phoneNormalized || call.number}
                            </div>
                            {call.leadId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedLeadId(call.leadId._id || call.leadId)
                                  setIsDrawerOpen(true)
                                }}
                                className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium text-[11px] flex items-center gap-1 mt-0.5"
                              >
                                <span>{call.leadId.name || "View Lead"}</span>
                                <Eye className="w-3 h-3" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400">Unlinked Lead</span>
                            )}
                          </td>

                          {/* Agent */}
                          <td className="px-5 py-4 whitespace-nowrap">
                            <div className="font-medium text-slate-800 flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span>{call.agentId?.name || "Agent"}</span>
                            </div>
                            {call.agentId?.email && (
                              <span className="text-[10px] text-slate-400 block">{call.agentId.email}</span>
                            )}
                          </td>

                          {/* Duration */}
                          <td className="px-5 py-4 whitespace-nowrap font-mono text-slate-700 font-semibold">
                            {formatDuration(call.duration)}
                          </td>

                          {/* Status & Disposition */}
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  call.status === "completed"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                                    : call.status === "busy"
                                    ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                                    : "bg-rose-50 text-rose-700 border border-rose-200/50"
                                }`}
                              >
                                {call.status}
                              </span>
                              {call.disposition && (
                                <span className="text-[10px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                                  {call.disposition}
                                </span>
                              )}
                            </div>
                            {call.notes && (
                              <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 max-w-xs">{call.notes}</p>
                            )}
                          </td>

                          {/* Recording */}
                          <td className="px-5 py-4 whitespace-nowrap">
                            {call.recording?.status === "stored" || call.recording?.status === "ready" ? (
                              <button
                                type="button"
                                onClick={() => setActivePlayingCall(activePlayingCall?._id === (call._id || call.id) ? null : call)}
                                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border transition shadow-2xs ${
                                  activePlayingCall?._id === (call._id || call.id)
                                    ? "bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-400/30"
                                    : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200"
                                }`}
                                title="Play audio recording in browser"
                              >
                                <Mic className="w-3.5 h-3.5" />
                                <span>{activePlayingCall?._id === (call._id || call.id) ? "Playing" : "Play"}</span>
                              </button>
                            ) : call.recording?.status === "skipped_dnr" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md" title="Excluded by Do-Not-Record compliance">
                                <Shield className="w-3 h-3 text-rose-500" /> Skipped (DNR)
                              </span>
                            ) : call.recording?.status === "expired" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md" title="Purged after 30-day retention">
                                <Clock className="w-3 h-3 text-amber-500" /> Purged (30d)
                              </span>
                            ) : call.recording?.status === "pending" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                                <RefreshCw className="w-3 h-3 animate-spin text-amber-600" /> Uploading
                              </span>
                            ) : call.status === "completed" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md" title="Call completed but no recording was uploaded">
                                <AlertCircle className="w-3 h-3 text-slate-400" /> Missing Audio
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">No Recording</span>
                            )}
                          </td>

                          {/* Started At */}
                          <td className="px-5 py-4 whitespace-nowrap text-slate-500 text-[11px]">
                            {call.startedAt ? new Date(call.startedAt).toLocaleString() : "—"}
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                type="button"
                                onClick={() => setEditingCall({ ...call })}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                                title="Edit notes & disposition"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Showing page <strong className="text-slate-800">{page}</strong> of{" "}
                  <strong className="text-slate-800">{totalPages}</strong>
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MOBILE DEVICES */}
      {activeTab === "devices" && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-indigo-600" />
              <span>Registered Field Hardware</span>
            </h2>
            <p className="text-xs text-slate-500">
              Mobile phones utilized by sales agents to conduct client calls. Call interactions and recording events sync automatically when devices are marked active.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Device Label & Model</th>
                  <th className="px-5 py-3.5">Assigned Staff</th>
                  <th className="px-5 py-3.5">OS & App Version</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Last Seen</th>
                  <th className="px-5 py-3.5 text-right">Access Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingDevices ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
                      Loading mobile devices...
                    </td>
                  </tr>
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-500 space-y-2">
                      <Smartphone className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="font-semibold text-slate-700">No field hardware registered</p>
                      <p className="text-xs text-slate-400">
                        Devices will appear here once agents login via the Leads-365 mobile app.
                      </p>
                    </td>
                  </tr>
                ) : (
                  devices.map((device) => {
                    const isActive = device.status === "active"
                    return (
                      <tr key={device._id || device.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-bold text-slate-900">{device.label || "Mobile Device"}</div>
                          <span className="text-[11px] text-slate-500 font-mono">{device.model || "Generic Smartphone"}</span>
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-800">{device.userId?.name || "Agent"}</div>
                          <span className="text-[10px] text-slate-400">{device.userId?.email || "—"}</span>
                        </td>

                        <td className="px-5 py-4 text-slate-600">
                          <div>{device.osVersion || "Android / iOS"}</div>
                          <span className="text-[10px] font-mono text-slate-400">App: {device.appVersion || "v1.0.0"}</span>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              isActive
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                : "bg-rose-50 text-rose-700 border border-rose-200/60"
                            }`}
                          >
                            {isActive ? <Shield className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                            <span className="capitalize">{device.status}</span>
                          </span>
                        </td>

                        <td className="px-5 py-4 text-slate-500 text-[11px]">
                          {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleDeviceStatus(device)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer ${
                              isActive
                                ? "text-rose-600 bg-rose-50 border-rose-200 hover:bg-rose-100"
                                : "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                            }`}
                          >
                            {isActive ? "Revoke Device" : "Reactivate"}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: LOG CALL */}
      {showLogCallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                <PhoneCall className="w-4 h-4 text-indigo-600" />
                <span>Log New Call Interaction</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowLogCallModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLogCallSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Phone Number *
                </label>
                <input
                  type="text"
                  required
                  value={logCallForm.number}
                  onChange={(e) => setLogCallForm({ ...logCallForm, number: e.target.value })}
                  placeholder="+91 9876543210"
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Direction</label>
                  <select
                    value={logCallForm.direction}
                    onChange={(e) => setLogCallForm({ ...logCallForm, direction: e.target.value })}
                    className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Duration (sec)</label>
                  <input
                    type="number"
                    min="0"
                    value={logCallForm.duration}
                    onChange={(e) => setLogCallForm({ ...logCallForm, duration: e.target.value })}
                    className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={logCallForm.status}
                    onChange={(e) => setLogCallForm({ ...logCallForm, status: e.target.value })}
                    className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="completed">Completed</option>
                    <option value="busy">Busy</option>
                    <option value="no-answer">No Answer</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Disposition</label>
                  <select
                    value={logCallForm.disposition}
                    onChange={(e) => setLogCallForm({ ...logCallForm, disposition: e.target.value })}
                    className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Interested">Interested</option>
                    <option value="Follow-up Required">Follow-up Required</option>
                    <option value="Not Interested">Not Interested</option>
                    <option value="Wrong Number">Wrong Number</option>
                    <option value="Left Voicemail">Left Voicemail</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={logCallForm.notes}
                  onChange={(e) => setLogCallForm({ ...logCallForm, notes: e.target.value })}
                  placeholder="Summary of conversation, objections, requirements..."
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLogCallModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCall}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                >
                  {submittingCall ? "Saving..." : "Save Call Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT CALL */}
      {editingCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                <span>Update Call Outcome</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingCall(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditCallSubmit} className="space-y-3.5 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 block">Phone</span>
                <span className="font-mono font-semibold text-slate-800">{editingCall.phoneNormalized || editingCall.number}</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Disposition</label>
                <select
                  value={editingCall.disposition || "Interested"}
                  onChange={(e) => setEditingCall({ ...editingCall, disposition: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Interested">Interested</option>
                  <option value="Follow-up Required">Follow-up Required</option>
                  <option value="Not Interested">Not Interested</option>
                  <option value="Wrong Number">Wrong Number</option>
                  <option value="Left Voicemail">Left Voicemail</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Call Notes</label>
                <textarea
                  rows={3}
                  value={editingCall.notes || ""}
                  onChange={(e) => setEditingCall({ ...editingCall, notes: e.target.value })}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingCall(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
                >
                  {savingEdit ? "Updating..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lead Detail Drawer Integration */}
      <LeadDetailDrawer
        isOpen={isDrawerOpen}
        leadId={selectedLeadId}
        onClose={() => {
          setIsDrawerOpen(false)
          setSelectedLeadId(null)
        }}
        onLeadUpdated={() => {
          fetchCalls()
          fetchMetrics()
        }}
      />

      {/* In-Browser Streaming Audio Player Dock */}
      {activePlayingCall && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-md animate-in slide-in-from-bottom-5 duration-200 shadow-2xl">
          <InBrowserAudioPlayer
            callId={activePlayingCall._id || activePlayingCall.id}
            recording={activePlayingCall.recording}
            agentName={activePlayingCall.agentId?.name || "Agent"}
            leadPhone={activePlayingCall.phoneNormalized || activePlayingCall.number}
            direction={activePlayingCall.direction}
            onClose={() => setActivePlayingCall(null)}
          />
        </div>
      )}
    </div>
  )
}
