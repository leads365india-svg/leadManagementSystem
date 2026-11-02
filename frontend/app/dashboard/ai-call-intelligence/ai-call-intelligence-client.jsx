"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "react-hot-toast"
import { apiClient, API_BASE_URL } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  Sparkles,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Search,
  Filter,
  RefreshCw,
  Eye,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  SlidersHorizontal,
  FileText,
  Volume2,
  Play,
  Pause,
  Tag,
  BarChart2,
  Shield,
  Layers,
  Check,
  X,
  ExternalLink,
  Target,
  MessageSquare,
  HelpCircle,
  Zap,
  Activity,
  Award,
  ChevronDown,
} from "lucide-react"

// Formatting helper for duration seconds
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "0:00"
  const totalSecs = Math.round(seconds)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hrs}h ${remMins}m ${secs}s`
  }
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

function formatMinutes(seconds) {
  if (!seconds || isNaN(seconds)) return "0m"
  const mins = Math.round(seconds / 60)
  if (mins >= 60) {
    const hrs = (seconds / 3600).toFixed(1)
    return `${hrs} hrs`
  }
  return `${mins} mins`
}

export default function AICallIntelligenceClient() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const urlCallId = searchParams.get("callId")

  const isAdmin = user?.role === "admin" || user?.role === "superadmin" || user?.isSuperAdmin

  // --- Dashboard & Listing State ---
  const [metrics, setMetrics] = useState({
    eligibleRecordedCalls: 0,
    analyzedCalls: 0,
    processingCalls: 0,
    failedCalls: 0,
    pendingCalls: 0,
    totalAudioSeconds: 0,
    analysisRate: 0,
    outcomeDistribution: {},
    sentimentDistribution: {},
    topTopics: [],
  })
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  const [calls, setCalls] = useState([])
  const [loadingCalls, setLoadingCalls] = useState(true)
  const [page, setPage] = useState(1)
  const [limit] = useState(15)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)

  // Filters
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [outcomeFilter, setOutcomeFilter] = useState("all")
  const [topicFilter, setTopicFilter] = useState("all")
  const [dateRange, setDateRange] = useState("all")

  // Selected Call Intelligence Drawer State
  const [selectedCallId, setSelectedCallId] = useState(urlCallId || null)
  const [drawerOpen, setDrawerOpen] = useState(Boolean(urlCallId))
  const [drawerTab, setDrawerTab] = useState("summary") // "summary" | "transcript" | "topics" | "usage"
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailData, setDetailData] = useState({
    call: null,
    status: null,
    transcript: null,
    analysis: null,
  })

  // Audio Player State in Drawer
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [reprocessing, setReprocessing] = useState(false)

  // Transcript Search
  const [transcriptSearch, setTranscriptSearch] = useState("")

  // 1. Fetch KPI Dashboard Metrics
  const fetchDashboardMetrics = useCallback(async () => {
    try {
      setLoadingMetrics(true)
      const res = await apiClient.getAICallDashboard()
      if (res && res.success && res.data) {
        setMetrics(res.data)
      }
    } catch (err) {
      console.warn("Failed to load AI Call Dashboard metrics:", err.message)
    } finally {
      setLoadingMetrics(false)
    }
  }, [])

  // 2. Fetch Call List
  const fetchCallsList = useCallback(async () => {
    try {
      setLoadingCalls(true)
      const query = {
        page,
        limit,
        search: search.trim() || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        callOutcome: outcomeFilter !== "all" ? outcomeFilter : undefined,
        topic: topicFilter !== "all" ? topicFilter : undefined,
        dateRange: dateRange !== "all" ? dateRange : undefined,
      }
      const res = await apiClient.listAICalls(query)
      if (res && res.success && res.data) {
        setCalls(res.data.calls || [])
        setTotalPages(res.data.pagination?.totalPages || 1)
        setTotalRecords(res.data.pagination?.total || 0)
      }
    } catch (err) {
      toast.error(err.message || "Failed to load analyzed calls")
    } finally {
      setLoadingCalls(false)
    }
  }, [page, limit, search, statusFilter, outcomeFilter, topicFilter, dateRange])

  // 3. Fetch Detail for a specific Call
  const fetchCallDetail = useCallback(async (callId) => {
    if (!callId) return
    try {
      setLoadingDetail(true)
      const [statusRes, transcriptRes, analysisRes] = await Promise.allSettled([
        apiClient.getAICallStatus(callId),
        apiClient.getAICallTranscript(callId),
        apiClient.getAICallAnalysis(callId),
      ])

      const status = statusRes.status === "fulfilled" && statusRes.value?.success ? statusRes.value.data : null
      const transcript = transcriptRes.status === "fulfilled" && transcriptRes.value?.success ? transcriptRes.value.data?.transcript : null
      const analysis = analysisRes.status === "fulfilled" && analysisRes.value?.success ? analysisRes.value.data?.analysis : null

      setDetailData({
        call: status?.call || null,
        status,
        transcript,
        analysis,
      })
    } catch (err) {
      toast.error("Failed to load intelligence report: " + err.message)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchDashboardMetrics()
  }, [fetchDashboardMetrics])

  useEffect(() => {
    fetchCallsList()
  }, [fetchCallsList])

  // Handle URL callId parameter
  useEffect(() => {
    if (urlCallId) {
      setSelectedCallId(urlCallId)
      setDrawerOpen(true)
      fetchCallDetail(urlCallId)
    }
  }, [urlCallId, fetchCallDetail])

  // Open Call Report Drawer
  const handleOpenReport = (callId) => {
    setSelectedCallId(callId)
    setDrawerOpen(true)
    fetchCallDetail(callId)
  }

  // Close Drawer
  const handleCloseDrawer = () => {
    setDrawerOpen(false)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    setIsPlaying(false)
  }

  // Audio seek handler
  const handleSeek = (seconds) => {
    if (audioRef.current && !isNaN(seconds)) {
      audioRef.current.currentTime = seconds
      audioRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  // Reprocess Call
  const handleReprocess = async (callId) => {
    if (!isAdmin) {
      toast.error("Administrator authorization required to reprocess call intelligence.")
      return
    }
    try {
      setReprocessing(true)
      const res = await apiClient.reprocessAICall(callId, { force: true })
      if (res && res.success) {
        toast.success(res.message || "Call re-enqueued for AI processing.")
        // Reload detail and list
        setTimeout(() => {
          fetchCallDetail(callId)
          fetchCallsList()
          fetchDashboardMetrics()
        }, 1500)
      } else {
        toast.error(res?.error || "Reprocess failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to trigger reprocess")
    } finally {
      setReprocessing(false)
    }
  }

  // Trigger initial analysis
  const handleTriggerAnalysis = async (callId) => {
    try {
      const res = await apiClient.triggerAICallAnalysis(callId)
      if (res && res.success) {
        toast.success(res.message || "Analysis job enqueued!")
        fetchCallsList()
        fetchDashboardMetrics()
      } else {
        toast.error(res?.error || "Analysis trigger failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to trigger analysis")
    }
  }

  // Sentiment Color Helper
  const getSentimentBadge = (sentiment, score) => {
    const s = (sentiment || "NEUTRAL").toUpperCase()
    const scoreText = score ? ` (${Math.round(score * 100)}%)` : ""
    switch (s) {
      case "POSITIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Positive{scoreText}
          </span>
        )
      case "NEGATIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Negative{scoreText}
          </span>
        )
      case "MIXED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            Mixed{scoreText}
          </span>
        )
      case "NEUTRAL":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            Neutral{scoreText}
          </span>
        )
    }
  }

  // Outcome Badge Helper
  const getOutcomeBadge = (outcome) => {
    const oc = (outcome || "UNRESOLVED").toUpperCase()
    switch (oc) {
      case "INTERESTED":
      case "DEAL_CLOSED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100/70 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            {oc.replace("_", " ")}
          </span>
        )
      case "FOLLOW_UP_REQUIRED":
      case "CALL_BACK_LATER":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Clock className="w-3 h-3 text-indigo-500" />
            {oc.replace(/_/g, " ")}
          </span>
        )
      case "NOT_INTERESTED":
      case "WRONG_NUMBER":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <XCircle className="w-3 h-3 text-slate-400" />
            {oc.replace(/_/g, " ")}
          </span>
        )
      case "ESCALATED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-500" />
            Escalated
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200">
            {oc}
          </span>
        )
    }
  }

  // Status Badge Helper
  const getStatusBadge = (status) => {
    const st = (status || "PENDING").toUpperCase()
    switch (st) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Analyzed
          </span>
        )
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" />
            Processing
          </span>
        )
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-600" />
            Failed
          </span>
        )
      case "PENDING":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <Clock className="w-3 h-3 text-slate-400" />
            Pending
          </span>
        )
    }
  }

  // Filtered transcript segments
  const filteredSegments = (detailData.transcript?.segments || []).filter((seg) => {
    if (!transcriptSearch.trim()) return true
    const q = transcriptSearch.toLowerCase()
    return (
      (seg.text || "").toLowerCase().includes(q) ||
      (seg.speaker || "").toLowerCase().includes(q)
    )
  })

  // Token retrieval for streaming audio tag
  let authToken = null
  if (typeof window !== "undefined") {
    try {
      authToken = localStorage.getItem("leadflow_token")
    } catch (_) {}
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      {/* 1. Header Bar with Breadcrumbs & Actions */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-6 shadow-2xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1.5">
              <Link href="/portal" className="hover:text-slate-800 transition">Home</Link>
              <ChevronRight className="w-3 h-3" />
              <Link href="/communication/call-reports" className="hover:text-slate-800 transition">Communication</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-indigo-600 font-semibold">AI Call Intelligence</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 text-white shadow-sm">
                <Sparkles className="w-5 h-5" />
              </span>
              AI Call Intelligence & Conversation Analytics
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Phase 3: Automated Hindi/English speech-to-text, executive call summaries, sentiment classification & approved topic tracking.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto">
            <button
              type="button"
              onClick={() => {
                fetchDashboardMetrics()
                fetchCallsList()
                toast.success("Intelligence dashboard refreshed")
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              Refresh Data
            </button>
            <Link
              href="/settings/ai-knowledge"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 shadow-2xs transition"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Manage Approved Topics
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {/* 2. Top Metric KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Card 1: Eligible Recorded Calls */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Recorded Calls</span>
              <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <PhoneCall className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {loadingMetrics ? "..." : metrics.eligibleRecordedCalls}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Eligible</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Calls with stored audio</p>
          </div>

          {/* Card 2: Analyzed Calls */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Analyzed Calls</span>
              <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {loadingMetrics ? "..." : metrics.analyzedCalls}
              </span>
              <span className="text-[11px] font-semibold text-emerald-600">
                {loadingMetrics ? "" : `${metrics.analysisRate}%`}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Completed end-to-end</p>
          </div>

          {/* Card 3: In-Progress */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Processing</span>
              <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                <RefreshCw className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {loadingMetrics ? "..." : metrics.processingCalls}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Active</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">In worker queue</p>
          </div>

          {/* Card 4: Failed */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Failed</span>
              <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                <XCircle className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {loadingMetrics ? "..." : metrics.failedCalls}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Retryable</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Provider or audio errors</p>
          </div>

          {/* Card 5: Audio Duration */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs col-span-2 md:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Audio Processed</span>
              <span className="p-1.5 rounded-lg bg-violet-50 text-violet-600">
                <Clock className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {loadingMetrics ? "..." : formatMinutes(metrics.totalAudioSeconds)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{formatDuration(metrics.totalAudioSeconds)} total</p>
          </div>
        </div>

        {/* 3. Analytics Distribution Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Outcome Distribution */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-600" />
                Call Outcomes
              </h2>
              <span className="text-xs text-slate-400">Classified</span>
            </div>
            {Object.keys(metrics.outcomeDistribution || {}).length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No outcome data available yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(metrics.outcomeDistribution).map(([outcome, count]) => {
                  const total = metrics.analyzedCalls || 1
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={outcome}>
                      <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>{outcome.replace(/_/g, " ")}</span>
                        <span className="text-slate-500 font-semibold">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${
                            outcome === "INTERESTED" || outcome === "DEAL_CLOSED"
                              ? "bg-emerald-500"
                              : outcome === "FOLLOW_UP_REQUIRED" || outcome === "CALL_BACK_LATER"
                              ? "bg-indigo-500"
                              : "bg-slate-400"
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sentiment Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Conversation Sentiment
              </h2>
              <span className="text-xs text-slate-400">Tone Analysis</span>
            </div>
            {Object.keys(metrics.sentimentDistribution || {}).length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No sentiment data available yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(metrics.sentimentDistribution).map(([sentiment, count]) => {
                  const total = metrics.analyzedCalls || 1
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={sentiment}>
                      <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span className="capitalize">{sentiment.toLowerCase()}</span>
                        <span className="text-slate-500 font-semibold">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${
                            sentiment === "POSITIVE"
                              ? "bg-emerald-500"
                              : sentiment === "NEGATIVE"
                              ? "bg-rose-500"
                              : sentiment === "MIXED"
                              ? "bg-amber-500"
                              : "bg-slate-400"
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Top Matched Approved Topics */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Tag className="w-4 h-4 text-violet-600" />
                Top Approved Topics
              </h2>
              <span className="text-xs text-slate-400">Phase 2 Topics</span>
            </div>
            {metrics.topTopics?.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-slate-400">No approved topic matches detected yet.</p>
                <Link
                  href="/settings/ai-knowledge"
                  className="inline-block mt-2 text-xs text-indigo-600 hover:underline font-semibold"
                >
                  Generate & Approve Topics &rarr;
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {metrics.topTopics.map((topic, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200/70 shadow-2xs"
                  >
                    <Tag className="w-3 h-3 text-violet-500" />
                    <span>{topic.name}</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-violet-200/80 text-[10px] text-violet-900 font-bold">
                      {topic.count}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 4. Analyzed Calls Table & Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          {/* Filter Bar */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex-1 relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search phone, agent, intent or summary..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Date Filter */}
              <select
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value)
                  setPage(1)
                }}
                className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  setPage(1)
                }}
                className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="PROCESSING">Processing</option>
                <option value="FAILED">Failed</option>
                <option value="PENDING">Pending</option>
              </select>

              {/* Outcome Filter */}
              <select
                value={outcomeFilter}
                onChange={(e) => {
                  setOutcomeFilter(e.target.value)
                  setPage(1)
                }}
                className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Outcomes</option>
                <option value="INTERESTED">Interested</option>
                <option value="FOLLOW_UP_REQUIRED">Follow-up Required</option>
                <option value="CALL_BACK_LATER">Call Back Later</option>
                <option value="DEAL_CLOSED">Deal Closed</option>
                <option value="NOT_INTERESTED">Not Interested</option>
                <option value="ESCALATED">Escalated</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Call Date</th>
                  <th className="px-5 py-3.5">Customer & Lead</th>
                  <th className="px-5 py-3.5">Agent</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">AI Status</th>
                  <th className="px-5 py-3.5">Matched Topics</th>
                  <th className="px-5 py-3.5">Outcome & Tone</th>
                  <th className="px-5 py-3.5 text-right">Intelligence Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingCalls ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
                      Loading call interactions & AI intelligence...
                    </td>
                  </tr>
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-500 space-y-2">
                      <PhoneCall className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="font-semibold text-slate-700">No recorded calls found</p>
                      <p className="text-xs text-slate-400">
                        {search || statusFilter !== "all" || outcomeFilter !== "all"
                          ? "Try clearing your filters to see more results."
                          : "Calls with stored audio will automatically be enqueued for AI transcription and intelligence."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => {
                    const isOutbound = call.direction === "outbound"
                    const analysis = call.aiAnalysis
                    const hasAnalysis = Boolean(analysis)
                    return (
                      <tr key={call._id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Call Date */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={`p-1.5 rounded-lg ${
                                isOutbound ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                              }`}
                              title={isOutbound ? "Outbound Call" : "Inbound Call"}
                            >
                              {isOutbound ? <PhoneOutgoing className="w-3.5 h-3.5" /> : <PhoneIncoming className="w-3.5 h-3.5" />}
                            </span>
                            <div>
                              <p className="font-semibold text-slate-800">
                                {call.startedAt ? new Date(call.startedAt).toLocaleDateString() : "—"}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {call.startedAt ? new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Customer & Lead */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="font-semibold text-slate-900">{call.customerNumber || "Unknown"}</p>
                          {call.leadId ? (
                            <Link
                              href={`/leads?id=${call.leadId._id || call.leadId}`}
                              className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                            >
                              <span>{call.leadId.name || "View Lead"}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                          ) : (
                            <span className="text-[10px] text-slate-400">Direct Contact</span>
                          )}
                        </td>

                        {/* Agent */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <User className="w-3 h-3 text-slate-400" />
                            <span className="font-medium">{call.agentId?.name || "Agent"}</span>
                          </div>
                        </td>

                        {/* Duration */}
                        <td className="px-5 py-4 whitespace-nowrap text-slate-600 font-medium">
                          {formatDuration(call.recording?.duration || call.duration || 0)}
                        </td>

                        {/* AI Status */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          {getStatusBadge(call.intelligenceStatus || (hasAnalysis ? "COMPLETED" : "PENDING"))}
                        </td>

                        {/* Matched Topics */}
                        <td className="px-5 py-4">
                          {analysis?.topicMatches && analysis.topicMatches.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {analysis.topicMatches.slice(0, 2).map((tm, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200"
                                >
                                  {tm.topicName}
                                </span>
                              ))}
                              {analysis.topicMatches.length > 2 && (
                                <span className="text-[10px] font-medium text-slate-400 self-center">
                                  +{analysis.topicMatches.length - 2} more
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">None matched</span>
                          )}
                        </td>

                        {/* Outcome & Tone */}
                        <td className="px-5 py-4 whitespace-nowrap">
                          {analysis ? (
                            <div className="space-y-1">
                              <div>{getOutcomeBadge(analysis.callOutcome)}</div>
                              <div className="text-[10px] text-slate-500">
                                {analysis.sentiment} tone
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="px-5 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {hasAnalysis || call.hasRecording ? (
                              <button
                                type="button"
                                onClick={() => handleOpenReport(call._id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-2xs transition"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Report</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleTriggerAnalysis(call._id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <span>Analyze</span>
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleReprocess(call._id)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                                title="Reprocess call intelligence"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                              </button>
                            )}
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
                <strong className="text-slate-800">{totalPages}</strong> ({totalRecords} records)
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

      {/* 5. Slide-Over Call Intelligence Report Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end transition-opacity">
          <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>Call Intelligence Report</span>
                    {detailData.status?.overallStatus && getStatusBadge(detailData.status.overallStatus)}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {detailData.call?.customerNumber || "Customer"} &bull; {detailData.call?.agentId?.name || "Agent"} &bull;{" "}
                    {detailData.call?.startedAt ? new Date(detailData.call.startedAt).toLocaleString() : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isAdmin && selectedCallId && (
                  <button
                    type="button"
                    disabled={reprocessing}
                    onClick={() => handleReprocess(selectedCallId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs transition disabled:opacity-50"
                    title="Re-enqueue transcription and analysis"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${reprocessing ? "animate-spin" : ""}`} />
                    <span>{reprocessing ? "Processing..." : "Reprocess"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Audio Streaming Bar */}
            {selectedCallId && (
              <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between gap-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!audioRef.current) return
                      if (isPlaying) {
                        audioRef.current.pause()
                        setIsPlaying(false)
                      } else {
                        audioRef.current.play().catch(() => {})
                        setIsPlaying(true)
                      }
                    }}
                    className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <div className="text-xs">
                    <p className="font-semibold">Call Recording Playback</p>
                    <p className="text-[10px] text-slate-400">
                      {formatDuration(audioCurrentTime)} / {formatDuration(audioDuration || detailData.call?.recording?.duration || 0)}
                    </p>
                  </div>
                </div>

                <div className="flex-1 max-w-xs mx-4">
                  <input
                    type="range"
                    min="0"
                    max={audioDuration || detailData.call?.recording?.duration || 100}
                    value={audioCurrentTime}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <audio
                  ref={audioRef}
                  src={`${API_BASE_URL}/calls/${selectedCallId}/recording?format=mp3${authToken ? `&token=${encodeURIComponent(authToken)}` : ""}`}
                  onTimeUpdate={(e) => setAudioCurrentTime(e.target.currentTime)}
                  onLoadedMetadata={(e) => setAudioDuration(e.target.duration)}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                />
              </div>
            )}

            {/* Drawer Tabs */}
            <div className="flex border-b border-slate-200 bg-white px-6">
              <button
                type="button"
                onClick={() => setDrawerTab("summary")}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition ${
                  drawerTab === "summary"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Executive Intelligence
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab("transcript")}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                  drawerTab === "transcript"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <span>Full Transcript</span>
                {detailData.transcript?.segments?.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600">
                    {detailData.transcript.segments.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab("topics")}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                  drawerTab === "topics"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <span>Matched Approved Topics</span>
                {detailData.analysis?.topicMatches?.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-violet-100 text-violet-700 font-bold">
                    {detailData.analysis.topicMatches.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab("usage")}
                className={`py-3 px-4 text-xs font-semibold border-b-2 transition ${
                  drawerTab === "usage"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Audit & Metadata
              </button>
            </div>

            {/* Drawer Body Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loadingDetail ? (
                <div className="py-20 text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
                  <p className="text-xs font-medium">Loading comprehensive intelligence...</p>
                </div>
              ) : !detailData.analysis && !detailData.transcript ? (
                <div className="py-20 text-center text-slate-500 space-y-3">
                  <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-800">Intelligence Report Not Ready</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {detailData.status?.transcript?.safeErrorMessage ||
                      "This call has not finished AI transcription and analysis yet."}
                  </p>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleReprocess(selectedCallId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Trigger AI Processing Now
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* TAB 1: EXECUTIVE INTELLIGENCE */}
                  {drawerTab === "summary" && detailData.analysis && (
                    <div className="space-y-6">
                      {/* Summary Banner */}
                      <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                            Executive Call Summary
                          </h3>
                          <div className="flex items-center gap-2">
                            {getOutcomeBadge(detailData.analysis.callOutcome)}
                            {getSentimentBadge(detailData.analysis.sentiment, detailData.analysis.sentimentScore)}
                          </div>
                        </div>
                        <p className="text-xs text-indigo-950 leading-relaxed font-normal">
                          {detailData.analysis.summary}
                        </p>
                      </div>

                      {/* Customer Intent & Requirements Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                            <Target className="w-3.5 h-3.5 text-blue-600" />
                            Customer Intent & Inquiries
                          </h4>
                          <p className="text-xs text-slate-700 font-medium">{detailData.analysis.customerIntent}</p>
                          {detailData.analysis.customerNeeds?.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-slate-600 list-disc list-inside">
                              {detailData.analysis.customerNeeds.map((need, idx) => (
                                <li key={idx}>{need}</li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                            Objections & Concerns
                          </h4>
                          {detailData.analysis.objections?.length > 0 ? (
                            <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                              {detailData.analysis.objections.map((obj, idx) => (
                                <li key={idx}>{obj}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No significant objections raised.</p>
                          )}
                        </div>
                      </div>

                      {/* Key Moments with Audio Seeking */}
                      {detailData.analysis.keyMoments?.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-indigo-600" />
                            Key Conversation Moments
                          </h4>
                          <div className="space-y-2">
                            {detailData.analysis.keyMoments.map((km, idx) => (
                              <div
                                key={idx}
                                className="p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition flex items-start justify-between gap-3"
                              >
                                <div>
                                  <p className="text-xs font-medium text-slate-800">{km.description}</p>
                                  {km.quote && (
                                    <p className="text-[11px] text-slate-500 italic mt-1 border-l-2 border-indigo-400 pl-2">
                                      &quot;{km.quote}&quot;
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSeek(km.timestamp)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 transition shrink-0"
                                >
                                  <Play className="w-2.5 h-2.5" />
                                  <span>{formatDuration(km.timestamp)}</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Next Steps & Recommendations */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Agreed Next Steps
                          </h4>
                          {detailData.analysis.nextSteps?.length > 0 ? (
                            <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                              {detailData.analysis.nextSteps.map((step, idx) => (
                                <li key={idx}>{step}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No explicit next steps recorded.</p>
                          )}
                        </div>

                        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
                          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
                            <Award className="w-3.5 h-3.5 text-violet-600" />
                            Follow-Up Recommendations
                          </h4>
                          {detailData.analysis.followUpRecommendations?.length > 0 ? (
                            <ul className="space-y-1 text-xs text-slate-600 list-disc list-inside">
                              {detailData.analysis.followUpRecommendations.map((rec, idx) => (
                                <li key={idx}>{rec}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No follow-up recommendations.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: FULL TRANSCRIPT */}
                  {drawerTab === "transcript" && (
                    <div className="space-y-4">
                      {/* Search Bar & Language Tag */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Filter spoken transcript text..."
                            value={transcriptSearch}
                            onChange={(e) => setTranscriptSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          Language: {detailData.transcript?.language || "auto"}
                        </span>
                      </div>

                      {/* Segments Display */}
                      <div className="space-y-3">
                        {filteredSegments.length === 0 ? (
                          <p className="text-xs text-slate-400 text-center py-10">No transcript lines found.</p>
                        ) : (
                          filteredSegments.map((seg, idx) => {
                            const isAgent = (seg.speaker || "").toLowerCase().includes("agent")
                            return (
                              <div
                                key={idx}
                                className={`p-3 rounded-xl border transition ${
                                  isAgent
                                    ? "bg-blue-50/40 border-blue-200/60"
                                    : "bg-emerald-50/40 border-emerald-200/60"
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                      isAgent ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"
                                    }`}
                                  >
                                    {seg.speaker || "Unknown"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSeek(seg.startTime)}
                                    className="text-[10px] font-mono text-slate-500 hover:text-indigo-600 transition flex items-center gap-1"
                                    title="Click to seek recording to this timestamp"
                                  >
                                    <Clock className="w-2.5 h-2.5" />
                                    <span>
                                      {formatDuration(seg.startTime)} &ndash; {formatDuration(seg.endTime)}
                                    </span>
                                  </button>
                                </div>
                                <p className="text-xs text-slate-800 leading-relaxed font-normal">{seg.text}</p>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: MATCHED APPROVED TOPICS */}
                  {drawerTab === "topics" && (
                    <div className="space-y-4">
                      <div className="p-3 bg-violet-50/70 rounded-xl border border-violet-100 text-xs text-violet-900">
                        <p className="font-semibold">Semantic Approved Topic Matching (Phase 2 &amp; 3 Contract)</p>
                        <p className="text-[11px] text-violet-700 mt-0.5">
                          Only topics explicitly marked as <strong>APPROVED</strong> by the Account Admin are evaluated against conversation transcripts.
                        </p>
                      </div>

                      {detailData.analysis?.topicMatches?.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 space-y-2">
                          <Tag className="w-8 h-8 text-slate-300 mx-auto" />
                          <p className="text-xs">No approved topics were matched in this conversation.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {detailData.analysis.topicMatches.map((tm, idx) => (
                            <div
                              key={idx}
                              className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                                  <Tag className="w-3.5 h-3.5 text-violet-600" />
                                  {tm.topicName}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                                  {Math.round((tm.confidenceScore || 0.8) * 100)}% match
                                </span>
                              </div>
                              {tm.evidence && (
                                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 italic">
                                  &quot;{tm.evidence}&quot;
                                </div>
                              )}
                              {typeof tm.timestamp === "number" && (
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => handleSeek(tm.timestamp)}
                                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                  >
                                    <Play className="w-2.5 h-2.5" />
                                    <span>Seek to {formatDuration(tm.timestamp)}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 4: AUDIT & METADATA */}
                  {drawerTab === "usage" && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-indigo-600" />
                          Processing &amp; Usage Ledger
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-slate-400">Speech-to-Text Provider:</span>
                            <p className="font-semibold text-slate-800 capitalize">
                              {detailData.transcript?.provider || "gemini"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Analysis Provider / Model:</span>
                            <p className="font-semibold text-slate-800">
                              {detailData.analysis?.provider || "gemini"} ({detailData.analysis?.model || "gemini-3.8-flash"})
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Audio Duration:</span>
                            <p className="font-semibold text-slate-800">
                              {formatDuration(detailData.transcript?.duration || 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Versions:</span>
                            <p className="font-semibold text-slate-800">
                              Transcript v{detailData.transcript?.version || 1} / Analysis v{detailData.analysis?.analysisVersion || 1}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Input Tokens:</span>
                            <p className="font-semibold text-slate-800">
                              {detailData.analysis?.usage?.inputTokens !== null && detailData.analysis?.usage?.inputTokens !== undefined
                                ? detailData.analysis.usage.inputTokens
                                : "N/A (Enterprise Privacy)"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Output Tokens:</span>
                            <p className="font-semibold text-slate-800">
                              {detailData.analysis?.usage?.outputTokens !== null && detailData.analysis?.usage?.outputTokens !== undefined
                                ? detailData.analysis.usage.outputTokens
                                : "N/A (Enterprise Privacy)"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
