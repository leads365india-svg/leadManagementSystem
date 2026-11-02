"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  Sparkles,
  TrendingUp,
  Award,
  Users,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  PhoneCall,
  Search,
  Filter,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  ChevronRight,
  Shield,
  HelpCircle,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  Plus,
  BookOpen,
  MessageSquare,
  FileCheck,
  Zap,
  BarChart3,
  Calendar,
  AlertCircle,
  X,
  ExternalLink,
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

export default function AISalesIntelligenceClient({ initialTab } = {}) {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const urlTab = searchParams.get("tab")

  const isManagerOrAdmin = useMemo(() => {
    const r = (user?.role || "").toLowerCase()
    return (
      r === "account_admin" ||
      r === "admin" ||
      r === "manager" ||
      r === "super_admin" ||
      r === "superadmin" ||
      user?.isSuperAdmin
    )
  }, [user])

  // --- Main View Tabs ---
  const [activeTab, setActiveTab] = useState(initialTab || urlTab || "overview")

  // --- Date Filters ---
  const [dateFilter, setDateFilter] = useState("all") // all, 7d, 30d, 90d

  // --- States for Sub-views ---
  const [dashboardData, setDashboardData] = useState(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)

  const [topicIntel, setTopicIntel] = useState(null)
  const [loadingTopicIntel, setLoadingTopicIntel] = useState(false)

  const [scorecards, setScorecards] = useState([])
  const [loadingScorecards, setLoadingScorecards] = useState(false)
  const [recomputingAgentId, setRecomputingAgentId] = useState(null)

  const [leadPriorities, setLeadPriorities] = useState([])
  const [loadingPriorities, setLoadingPriorities] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState("ALL")

  const [recommendations, setRecommendations] = useState([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [recStatusFilter, setRecStatusFilter] = useState("ALL")
  const [recPriorityFilter, setRecPriorityFilter] = useState("ALL")

  const [coachingReviews, setCoachingReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)

  // Modals & Drawers
  const [coachingModalCallId, setCoachingModalCallId] = useState(null)
  const [coachingReport, setCoachingReport] = useState(null)
  const [loadingCoachingReport, setLoadingCoachingReport] = useState(false)

  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [selectedAgentForReview, setSelectedAgentForReview] = useState(null)
  const [reviewForm, setReviewForm] = useState({
    managerNotes: "",
    actionItemsText: "",
    strengthsText: "",
    improvementText: "",
  })
  const [submittingReview, setSubmittingReview] = useState(false)

  const [acceptModalItem, setAcceptModalItem] = useState(null)
  const [acceptNotes, setAcceptNotes] = useState("")
  const [submittingAction, setSubmittingAction] = useState(false)

  // Compute dateFrom based on filter
  const getDateRangeQuery = useCallback(() => {
    if (dateFilter === "7d") {
      const d = new Date(Date.now() - 7 * 86400000)
      return { dateFrom: d.toISOString() }
    } else if (dateFilter === "30d") {
      const d = new Date(Date.now() - 30 * 86400000)
      return { dateFrom: d.toISOString() }
    } else if (dateFilter === "90d") {
      const d = new Date(Date.now() - 90 * 86400000)
      return { dateFrom: d.toISOString() }
    }
    return {}
  }, [dateFilter])

  // --- Fetchers ---
  const fetchDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true)
      const q = getDateRangeQuery()
      const res = await apiClient.getSalesIntelligenceDashboard(q)
      if (res && res.success) {
        setDashboardData(res.data)
      } else {
        toast.error(res?.error || "Failed to load dashboard metrics")
      }
    } catch (err) {
      toast.error(err.message || "Network error loading dashboard")
    } finally {
      setLoadingDashboard(false)
    }
  }, [getDateRangeQuery])

  const fetchTopicIntelligence = useCallback(async () => {
    try {
      setLoadingTopicIntel(true)
      const res = await apiClient.getTopicIntelligence()
      if (res && res.success) {
        setTopicIntel(res.data)
      }
    } catch (err) {
      console.error("Error loading topic intelligence", err)
    } finally {
      setLoadingTopicIntel(false)
    }
  }, [])

  const fetchScorecards = useCallback(async () => {
    try {
      setLoadingScorecards(true)
      const res = await apiClient.listAgentScorecards()
      if (res && res.success) {
        setScorecards(res.data || [])
      }
    } catch (err) {
      console.error("Error loading scorecards", err)
    } finally {
      setLoadingScorecards(false)
    }
  }, [])

  const fetchLeadPriorities = useCallback(async () => {
    try {
      setLoadingPriorities(true)
      const q = {}
      if (priorityFilter !== "ALL") q.priority = priorityFilter
      const res = await apiClient.listLeadPriorities(q)
      if (res && res.success) {
        setLeadPriorities(res.data || [])
      }
    } catch (err) {
      console.error("Error loading lead priorities", err)
    } finally {
      setLoadingPriorities(false)
    }
  }, [priorityFilter])

  const fetchRecommendations = useCallback(async () => {
    try {
      setLoadingRecs(true)
      const q = {}
      if (recStatusFilter !== "ALL") q.status = recStatusFilter
      if (recPriorityFilter !== "ALL") q.priority = recPriorityFilter
      const res = await apiClient.listManagerRecommendations(q)
      if (res && res.success) {
        setRecommendations(res.data || [])
      }
    } catch (err) {
      console.error("Error loading manager recommendations", err)
    } finally {
      setLoadingRecs(false)
    }
  }, [recStatusFilter, recPriorityFilter])

  const fetchCoachingReviews = useCallback(async () => {
    try {
      setLoadingReviews(true)
      const res = await apiClient.listCoachingReviews()
      if (res && res.success) {
        setCoachingReviews(res.data || [])
      }
    } catch (err) {
      console.error("Error loading coaching reviews", err)
    } finally {
      setLoadingReviews(false)
    }
  }, [])

  // Initial and reactive load
  useEffect(() => {
    fetchDashboard()
    fetchTopicIntelligence()
  }, [fetchDashboard, fetchTopicIntelligence])

  useEffect(() => {
    if (activeTab === "scorecards") fetchScorecards()
    if (activeTab === "lead-priorities") fetchLeadPriorities()
    if (activeTab === "recommendations") fetchRecommendations()
    if (activeTab === "coaching-reviews") fetchCoachingReviews()
  }, [activeTab, fetchScorecards, fetchLeadPriorities, fetchRecommendations, fetchCoachingReviews])

  // Open Call Coaching Modal
  const handleOpenCoachingModal = async (callId) => {
    if (!callId) return
    setCoachingModalCallId(callId)
    setCoachingReport(null)
    setLoadingCoachingReport(true)
    try {
      const res = await apiClient.getCallCoaching(callId)
      if (res && res.success) {
        setCoachingReport(res.data)
      } else {
        toast.error(res?.error || "Coaching report unavailable for this call")
      }
    } catch (err) {
      toast.error(err.message || "Failed to load call coaching")
    } finally {
      setLoadingCoachingReport(false)
    }
  }

  // Recompute Scorecard for Agent
  const handleRecomputeScorecard = async (agentId) => {
    try {
      setRecomputingAgentId(agentId)
      const res = await apiClient.recomputeAgentScorecard(agentId)
      if (res && res.success) {
        toast.success("Agent scorecard recomputed successfully")
        fetchScorecards()
      } else {
        toast.error(res?.error || "Recompute failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to recompute scorecard")
    } finally {
      setRecomputingAgentId(null)
    }
  }

  // Lead Priority Accept / Dismiss
  const handleAcceptPriority = async (leadId) => {
    try {
      setSubmittingAction(true)
      const res = await apiClient.acceptLeadPriority(leadId, { actionNotes: acceptNotes })
      if (res && res.success) {
        toast.success("Lead priority recommendation accepted")
        setAcceptModalItem(null)
        setAcceptNotes("")
        fetchLeadPriorities()
      } else {
        toast.error(res?.error || "Accept action failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to accept priority")
    } finally {
      setSubmittingAction(false)
    }
  }

  const handleDismissPriority = async (leadId) => {
    try {
      const res = await apiClient.dismissLeadPriority(leadId, { reason: "Dismissed by user" })
      if (res && res.success) {
        toast.success("Recommendation dismissed")
        fetchLeadPriorities()
      } else {
        toast.error(res?.error || "Dismiss failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to dismiss priority")
    }
  }

  // Recommendation Status Update
  const handleUpdateRecommendation = async (recId, nextStatus, notes = "") => {
    try {
      const res = await apiClient.updateRecommendationStatus(recId, {
        status: nextStatus,
        managerNotes: notes,
      })
      if (res && res.success) {
        toast.success(`Recommendation marked as ${nextStatus.toLowerCase()}`)
        fetchRecommendations()
      } else {
        toast.error(res?.error || "Status update failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update recommendation")
    }
  }

  // Complete Coaching Review
  const handleCompleteReview = async (reviewId) => {
    try {
      const res = await apiClient.completeCoachingReview(reviewId)
      if (res && res.success) {
        toast.success("Action plan marked as completed!")
        fetchCoachingReviews()
      } else {
        toast.error(res?.error || "Complete action failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to complete review")
    }
  }

  // Create Coaching Review
  const handleCreateReview = async (e) => {
    e.preventDefault()
    if (!selectedAgentForReview) {
      toast.error("Please select an agent for the review")
      return
    }
    try {
      setSubmittingReview(true)
      const actionItems = reviewForm.actionItemsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => ({ item, completed: false }))

      const strengths = reviewForm.strengthsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)

      const areasForImprovement = reviewForm.improvementText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)

      const payload = {
        agentId: selectedAgentForReview._id || selectedAgentForReview.id,
        managerNotes: reviewForm.managerNotes,
        actionItems,
        strengths,
        areasForImprovement,
        status: "DISCUSSED",
      }

      const res = await apiClient.createCoachingReview(payload)
      if (res && res.success) {
        toast.success("Coaching review recorded successfully")
        setReviewModalOpen(false)
        setReviewForm({
          managerNotes: "",
          actionItemsText: "",
          strengthsText: "",
          improvementText: "",
        })
        setSelectedAgentForReview(null)
        fetchCoachingReviews()
      } else {
        toast.error(res?.error || "Failed to create coaching review")
      }
    } catch (err) {
      toast.error(err.message || "Failed to record coaching review")
    } finally {
      setSubmittingReview(false)
    }
  }

  // UI Helper: Priority Badge
  const getPriorityBadge = (p) => {
    switch (p) {
      case "HIGH_INTENT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <Zap className="w-3 h-3 text-emerald-600" />
            High Intent
          </span>
        )
      case "AT_RISK":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            At Risk
          </span>
        )
      case "NEEDS_FOLLOWUP":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Needs Follow-up
          </span>
        )
      case "MEDIUM_INTENT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
            <Target className="w-3 h-3 text-blue-600" />
            Medium Intent
          </span>
        )
      case "LOW_INTENT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            Low Intent
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200">
            Insufficient Data
          </span>
        )
    }
  }

  // UI Helper: Recommendation Type Badge
  const getRecTypeBadge = (t) => {
    switch (t) {
      case "HIGH_INTENT_FOLLOWUP":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Zap className="w-3 h-3 text-emerald-600" /> High Intent Follow-up
          </span>
        )
      case "CALLBACK_REQUESTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <PhoneCall className="w-3 h-3 text-indigo-600" /> Callback Requested
          </span>
        )
      case "REPEATED_OBJECTION":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" /> Repeated Objection
          </span>
        )
      case "AT_RISK_OVERDUE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" /> Overdue Follow-up
          </span>
        )
      case "TOPIC_COVERAGE_GAP":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <BookOpen className="w-3 h-3 text-purple-600" /> Topic Coverage Gap
          </span>
        )
      case "AGENT_COACHING_REVIEW":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Award className="w-3 h-3 text-blue-600" /> Coaching Review
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {t}
          </span>
        )
    }
  }

  // Count active recommendations
  const activeRecsCount = useMemo(() => {
    return recommendations.filter((r) => r.status === "NEW" || r.status === "VIEWED").length
  }, [recommendations])

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* 1. Header Banner */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 tracking-wider uppercase mb-1">
                <Sparkles className="w-4 h-4" />
                <span>AI Sales Intelligence & Coaching (Phase 4)</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Sales Performance, Scorecards & Prioritization
              </h1>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Evidence-backed sales coaching, agent scorecards, customer objection analytics, and explainable lead prioritization.
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Quick Refresh */}
              <button
                type="button"
                onClick={() => {
                  fetchDashboard()
                  fetchTopicIntelligence()
                  if (activeTab === "scorecards") fetchScorecards()
                  if (activeTab === "lead-priorities") fetchLeadPriorities()
                  if (activeTab === "recommendations") fetchRecommendations()
                  if (activeTab === "coaching-reviews") fetchCoachingReviews()
                  toast.success("Intelligence data refreshed")
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs transition"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                Refresh
              </button>

              <Link
                href="/dashboard/ai-call-intelligence"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Call Transcripts
              </Link>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 border-t border-slate-100 pt-3 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === "overview"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Executive Dashboard
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("scorecards")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === "scorecards"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              Agent Scorecards
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("lead-priorities")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === "lead-priorities"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              Lead Prioritization
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("recommendations")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === "recommendations"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Manager Alerts
              {activeRecsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                  {activeRecsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("coaching-reviews")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === "coaching-reviews"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <FileCheck className="w-3.5 h-3.5" />
              1-on-1 Coaching Reviews
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* ======================================================== */}
        {/* TAB 1: EXECUTIVE SALES PERFORMANCE DASHBOARD */}
        {/* ======================================================== */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>Time Period:</span>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  {["all", "7d", "30d", "90d"].map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setDateFilter(period)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                        dateFilter === period
                          ? "bg-white text-indigo-700 shadow-2xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {period === "all" ? "All Time" : `Last ${period.toUpperCase()}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-[11px] text-slate-500 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Real CRM Closed-Won conversion tracking enabled</span>
              </div>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Analyzed Sales Calls */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Analyzed Calls</span>
                  <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <PhoneCall className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.totalAnalyzedCalls || 0}
                  </span>
                  <span className="text-[11px] font-semibold text-indigo-600">
                    {loadingDashboard
                      ? ""
                      : `${dashboardData?.kpis?.analysisCompletionRate || 100}% rate`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Deduplicated call analyses</p>
              </div>

              {/* Qualified / Interested Calls */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Interested Calls</span>
                  <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                    <ThumbsUp className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.totalQualifiedCalls || 0}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    {loadingDashboard
                      ? ""
                      : `${dashboardData?.kpis?.qualificationRate || 0}% of analyzed`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Commercial interest detected</p>
              </div>

              {/* Converted Leads (Strictly CRM Closed-Won) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Converted Leads</span>
                  <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-700">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.totalConvertedLeads || 0}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-600">
                    {loadingDashboard
                      ? ""
                      : `${dashboardData?.kpis?.leadConversionRate || 0}% closed-won`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Strict CRM Closed-Won status</p>
              </div>

              {/* Lost Opportunities */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Lost Opportunities</span>
                  <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                    <XCircle className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.totalLostOpportunities || 0}
                  </span>
                  <span className="text-[11px] font-medium text-rose-600">Closed-Lost</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Confirmed CRM lost leads</p>
              </div>

              {/* Follow-ups Required */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Follow-ups Required</span>
                  <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                    <Clock className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.totalFollowupsRequired || 0}
                  </span>
                  <span className="text-[11px] font-medium text-amber-600">Action pending</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Callbacks & touchpoints needed</p>
              </div>

              {/* High-Intent Leads */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">High-Intent Leads</span>
                  <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
                    <Zap className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard ? "..." : dashboardData?.kpis?.highIntentLeadsCount || 0}
                  </span>
                  <span className="text-[11px] font-medium text-purple-600">Top Priority</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">High purchase propensity</p>
              </div>

              {/* Avg Call Duration */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Avg Call Duration</span>
                  <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                    <Clock className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard
                      ? "..."
                      : formatDuration(dashboardData?.kpis?.averageCallDurationSeconds)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">minutes</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Effective conversation length</p>
              </div>

              {/* Follow-up Completion Rate */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Follow-up Completion</span>
                  <span className="p-1.5 rounded-lg bg-teal-50 text-teal-600">
                    <CheckCircle2 className="w-4 h-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {loadingDashboard
                      ? "..."
                      : `${dashboardData?.kpis?.followupCompletionRate || 0}%`}
                  </span>
                  <span className="text-[11px] font-medium text-teal-600">on schedule</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Completed CRM follow-ups</p>
              </div>
            </div>

            {/* Conversion Funnel & Visual Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Funnel Card */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Sales Conversion Funnel</h2>
                    <p className="text-xs text-slate-500">
                      Stepwise progression from analyzed calls to verified Closed-Won deals
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Strict CRM Grounding
                  </span>
                </div>

                <div className="space-y-3 mt-4">
                  {dashboardData?.funnel?.stages?.map((stage, idx) => {
                    const maxCount = Math.max(
                      ...(dashboardData?.funnel?.stages?.map((s) => s.count) || [1])
                    )
                    const pctWidth = Math.max(8, Math.round((stage.count / (maxCount || 1)) * 100))
                    const colors = [
                      "bg-indigo-600",
                      "bg-blue-600",
                      "bg-amber-500",
                      "bg-emerald-600",
                    ]
                    return (
                      <div key={stage.stage} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">{stage.label}</span>
                          <span className="font-bold text-slate-900">
                            {stage.count}{" "}
                            <span className="text-[11px] font-normal text-slate-400">
                              ({stage.dropoffPct}% of total)
                            </span>
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              colors[idx % colors.length]
                            }`}
                            style={{ width: `${pctWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <p>
                    <strong>Accuracy Guarantee:</strong> Interested calls reflect AI conversation classification, whereas Won Deals count strictly verified CRM leads reaching the <code className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-800">Closed-Won</code> stage.
                  </p>
                </div>
              </div>

              {/* Call Outcomes Distribution */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                <h2 className="text-sm font-bold text-slate-900 mb-1">Call Outcomes</h2>
                <p className="text-xs text-slate-500 mb-4">Disposition of analyzed customer calls</p>

                <div className="space-y-2.5">
                  {dashboardData?.charts?.callOutcomes?.map((item) => (
                    <div key={item.outcome} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600">
                        {item.outcome.replace(/_/g, " ")}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{item.count}</span>
                        <span className="text-[11px] text-slate-400">({item.percentage}%)</span>
                      </div>
                    </div>
                  ))}
                  {(!dashboardData?.charts?.callOutcomes ||
                    dashboardData.charts.callOutcomes.length === 0) && (
                    <p className="text-xs text-slate-400 py-4 text-center">No outcome data yet</p>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                  <h3 className="text-xs font-bold text-slate-800 mb-2">Customer Sentiment</h3>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200">
                      <div className="text-xs font-semibold text-emerald-800">Positive</div>
                      <div className="text-sm font-bold text-emerald-900">
                        {dashboardData?.charts?.sentimentDistribution?.positive?.percentage || 0}%
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs font-semibold text-slate-700">Neutral</div>
                      <div className="text-sm font-bold text-slate-900">
                        {dashboardData?.charts?.sentimentDistribution?.neutral?.percentage || 0}%
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-rose-50 border border-rose-200">
                      <div className="text-xs font-semibold text-rose-800">Negative</div>
                      <div className="text-sm font-bold text-rose-900">
                        {dashboardData?.charts?.sentimentDistribution?.negative?.percentage || 0}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Objections & Product/Topic Intelligence */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Customer Objections Breakdown */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Customer Objections</h2>
                    <p className="text-xs text-slate-500">Recurring pushbacks and buyer hesitations</p>
                  </div>
                  <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                    <AlertCircle className="w-4 h-4" />
                  </span>
                </div>

                <div className="space-y-3">
                  {dashboardData?.charts?.customerObjections?.map((obj, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{obj.objection}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Category: <span className="capitalize">{obj.category}</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                        {obj.count} {obj.count === 1 ? "call" : "calls"}
                      </span>
                    </div>
                  ))}
                  {(!dashboardData?.charts?.customerObjections ||
                    dashboardData.charts.customerObjections.length === 0) && (
                    <p className="text-xs text-slate-400 py-6 text-center">
                      No customer objections recorded in this period
                    </p>
                  )}
                </div>
              </div>

              {/* Product Interest & Approved Topics */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Product & Topic Intelligence</h2>
                    <p className="text-xs text-slate-500">Catalog interest and approved knowledge coverage</p>
                  </div>
                  <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <BookOpen className="w-4 h-4" />
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                      Top Products Discussed
                    </h3>
                    <div className="space-y-2">
                      {dashboardData?.charts?.productInterest?.map((prod, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{prod.product}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{prod.count} mentions</span>
                            <span className="text-[11px] text-emerald-600 font-semibold">
                              ({prod.positiveIntentCount} high-intent)
                            </span>
                          </div>
                        </div>
                      ))}
                      {(!dashboardData?.charts?.productInterest ||
                        dashboardData.charts.productInterest.length === 0) && (
                        <p className="text-xs text-slate-400 py-2">No product mentions detected</p>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Approved Topics Discussion Frequency</span>
                      <span className="text-[10px] text-indigo-600 font-semibold">
                        {topicIntel?.totalApprovedTopics || 0} Total Approved
                      </span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {topicIntel?.frequentlyDiscussed?.map((t) => (
                        <span
                          key={t.topicId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
                        >
                          <CheckCircle2 className="w-3 h-3 text-indigo-500" />
                          {t.name}
                          <span className="font-bold ml-1">{t.discussionCount}</span>
                        </span>
                      ))}
                      {topicIntel?.rarelyDiscussed?.map((t) => (
                        <span
                          key={t.topicId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200"
                          title="Rarely mentioned during calls"
                        >
                          <Clock className="w-3 h-3 text-slate-400" />
                          {t.name}
                          <span className="text-[10px] ml-1">(0-1 calls)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: AGENT PERFORMANCE SCORECARDS */}
        {/* ======================================================== */}
        {activeTab === "scorecards" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Agent Performance Scorecards</h2>
                <p className="text-xs text-slate-500">
                  Transparent, evidence-based evaluation across 7 sales dimensions (Minimum 3 calls required)
                </p>
              </div>

              <button
                type="button"
                onClick={fetchScorecards}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Scorecards
              </button>
            </div>

            {loadingScorecards ? (
              <div className="p-12 text-center text-slate-400">Loading agent scorecards...</div>
            ) : scorecards.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-800">No Agent Scorecards Yet</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Scorecards are computed automatically once agents complete calls with AI Call Intelligence analysis.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {scorecards.map((card) => {
                  const agent = card.agentId || {}
                  const isSufficient = card.sampleCoverage === "SUFFICIENT"
                  const dims = card.dimensionScores || {}

                  return (
                    <div
                      key={card._id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs hover:border-slate-300 transition"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm">
                            {(agent.name || agent.email || "A").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                              <span>{agent.name || agent.email || "Sales Agent"}</span>
                              <span className="text-[11px] font-normal text-slate-400">
                                ({agent.role || "agent"})
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                              <span>{card.sampleSize} completed calls</span>
                              <span>•</span>
                              {isSufficient ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  Sufficient Sample (Reliable)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-semibold text-[11px]">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  Insufficient Sample (&lt; 3 calls)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Overall Score Badge */}
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                              Overall Score
                            </div>
                            <div className="text-2xl font-black text-slate-900">
                              {isSufficient && card.overallScore !== null ? (
                                `${card.overallScore}/100`
                              ) : (
                                <span className="text-xs font-semibold text-amber-600">
                                  N/A (Sample &lt; 3)
                                </span>
                              )}
                            </div>
                          </div>

                          {isManagerOrAdmin && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={recomputingAgentId === agent._id}
                                onClick={() => handleRecomputeScorecard(agent._id)}
                                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                              >
                                {recomputingAgentId === agent._id ? "Recomputing..." : "Recompute"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAgentForReview(agent)
                                  setReviewModalOpen(true)
                                }}
                                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition"
                              >
                                1-on-1 Review
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 7 Dimensions Breakdown */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 mt-4 text-center">
                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Discovery
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.requirementDiscovery?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Knowledge
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.productKnowledge?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Objections
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.objectionHandling?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Clarity
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.communicationClarity?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Next Steps
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.nextStepDiscipline?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Engagement
                          </div>
                          <div className="text-sm font-bold text-slate-800 mt-1">
                            {dims.customerEngagement?.score ?? "N/A"}/100
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                          <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider">
                            Won Deals
                          </div>
                          <div className="text-sm font-bold text-emerald-900 mt-1">
                            {card.conversionRate || 0}%
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: LEAD PRIORITIZATION HUB */}
        {/* ======================================================== */}
        {activeTab === "lead-priorities" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Explainable Lead Prioritization</h2>
                <p className="text-xs text-slate-500">
                  AI-evaluated commercial intent and follow-up discipline (Human approval required before mutation)
                </p>
              </div>

              {/* Priority Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Filter:</span>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="text-xs font-semibold rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-2xs"
                >
                  <option value="ALL">All Categories</option>
                  <option value="HIGH_INTENT">High Intent</option>
                  <option value="NEEDS_FOLLOWUP">Needs Follow-up</option>
                  <option value="AT_RISK">At Risk</option>
                  <option value="MEDIUM_INTENT">Medium Intent</option>
                  <option value="LOW_INTENT">Low Intent</option>
                </select>
              </div>
            </div>

            {loadingPriorities ? (
              <div className="p-12 text-center text-slate-400">Loading lead priorities...</div>
            ) : leadPriorities.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <Target className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-800">No Priority Signals Evaluated</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Lead priority signals are generated when calls are analyzed or overdue follow-ups are detected.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {leadPriorities.map((item) => {
                  const lead = item.leadId || {}
                  const isAccepted = item.userAction?.status === "ACCEPTED"
                  const isDismissed = item.userAction?.status === "DISMISSED"

                  return (
                    <div
                      key={item._id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs hover:border-slate-300 transition"
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm">
                              {lead.name || lead.phone || "CRM Lead"}
                            </span>
                            {getPriorityBadge(item.priority)}
                            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                              Stage: {lead.status || "Unknown"}
                            </span>
                            {isAccepted && (
                              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                Accepted
                              </span>
                            )}
                            {isDismissed && (
                              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                Dismissed
                              </span>
                            )}
                          </div>

                          <p className="text-xs font-medium text-slate-700 mt-2">
                            <strong>Reason:</strong> {item.reason}
                          </p>

                          {/* Grounded Factors / Quotes */}
                          {item.factors && item.factors.length > 0 && (
                            <div className="mt-2.5 space-y-1">
                              {item.factors.map((f, fi) => (
                                <div
                                  key={fi}
                                  className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 border border-slate-100"
                                >
                                  <span className="font-semibold text-slate-800">{f.factor}:</span>{" "}
                                  <span>{f.detail}</span>
                                  {f.quote && (
                                    <div className="italic text-slate-500 mt-0.5">
                                      &ldquo;{f.quote}&rdquo;
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {item.recommendedAction && (
                            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-indigo-700 bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-100">
                              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span>Recommended Next Step: {item.recommendedAction}</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                          <Link
                            href={`/leads?search=${lead._id || ""}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View Lead
                          </Link>

                          {!isAccepted && !isDismissed && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setAcceptModalItem(item)
                                  setAcceptNotes("")
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDismissPriority(item.leadId?._id || item.leadId)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                              >
                                Dismiss
                              </button>
                            </>
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

        {/* ======================================================== */}
        {/* TAB 4: MANAGER RECOMMENDATIONS & ALERT CENTER */}
        {/* ======================================================== */}
        {activeTab === "recommendations" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Manager Alert & Action Center</h2>
                <p className="text-xs text-slate-500">
                  Critical call alerts, high-intent follow-up requests, and recurring objection signals
                </p>
              </div>

              {/* Status and Priority Filters */}
              <div className="flex items-center gap-2">
                <select
                  value={recStatusFilter}
                  onChange={(e) => setRecStatusFilter(e.target.value)}
                  className="text-xs font-semibold rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-2xs"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="NEW">New</option>
                  <option value="VIEWED">Viewed</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="DISMISSED">Dismissed</option>
                  <option value="RESOLVED">Resolved</option>
                </select>

                <select
                  value={recPriorityFilter}
                  onChange={(e) => setRecPriorityFilter(e.target.value)}
                  className="text-xs font-semibold rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-2xs"
                >
                  <option value="ALL">All Priorities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                </select>
              </div>
            </div>

            {loadingRecs ? (
              <div className="p-12 text-center text-slate-400">Loading manager alerts...</div>
            ) : recommendations.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-800">All Alerts Resolved</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  No pending manager action items at this moment. You are up to date!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {recommendations.map((rec) => {
                  const isNew = rec.status === "NEW"
                  const isViewed = rec.status === "VIEWED"

                  return (
                    <div
                      key={rec._id}
                      className={`bg-white rounded-2xl border p-5 shadow-2xs transition ${
                        isNew ? "border-indigo-300 ring-2 ring-indigo-50" : "border-slate-200"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {getRecTypeBadge(rec.type)}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                rec.priority === "CRITICAL"
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : rec.priority === "HIGH"
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : "bg-blue-100 text-blue-800 border border-blue-200"
                              }`}
                            >
                              {rec.priority}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              Status: <strong>{rec.status}</strong>
                            </span>
                          </div>

                          <h3 className="font-bold text-slate-900 text-sm mt-2">{rec.title}</h3>
                          <p className="text-xs text-slate-600 mt-1">{rec.description}</p>

                          {/* Evidence Block */}
                          {rec.evidence && (
                            <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                              <span className="font-semibold text-slate-800">Transcript Evidence:</span>
                              {rec.evidence.quotes && rec.evidence.quotes.length > 0 && (
                                <ul className="list-disc list-inside mt-1 text-slate-600 italic">
                                  {rec.evidence.quotes.map((q, qi) => (
                                    <li key={qi}>&ldquo;{q}&rdquo;</li>
                                  ))}
                                </ul>
                              )}
                              {rec.evidence.objection && (
                                <p className="text-slate-700 mt-1">
                                  <strong>Objection:</strong> {rec.evidence.objection}
                                </p>
                              )}
                            </div>
                          )}

                          {rec.suggestedAction && (
                            <div className="mt-3 text-xs font-semibold text-indigo-700 flex items-center gap-2">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Suggested Action: {rec.suggestedAction}</span>
                            </div>
                          )}
                        </div>

                        {/* Status Actions */}
                        {isManagerOrAdmin && (
                          <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                            {isNew && (
                              <button
                                type="button"
                                onClick={() => handleUpdateRecommendation(rec._id, "VIEWED")}
                                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                              >
                                Mark Viewed
                              </button>
                            )}

                            {(isNew || isViewed) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateRecommendation(
                                      rec._id,
                                      "ACCEPTED",
                                      "Accepted by manager"
                                    )
                                  }
                                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition"
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateRecommendation(
                                      rec._id,
                                      "RESOLVED",
                                      "Resolved by manager"
                                    )
                                  }
                                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition"
                                >
                                  Resolve
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateRecommendation(
                                      rec._id,
                                      "DISMISSED",
                                      "Dismissed by manager"
                                    )
                                  }
                                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: 1-ON-1 COACHING REVIEWS & ACTION PLANS */}
        {/* ======================================================== */}
        {activeTab === "coaching-reviews" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">1-on-1 Coaching Reviews</h2>
                <p className="text-xs text-slate-500">
                  Manager coaching sessions, structured feedback, and tracked action items
                </p>
              </div>

              {isManagerOrAdmin && (
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-2xs transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Coaching Review
                </button>
              )}
            </div>

            {loadingReviews ? (
              <div className="p-12 text-center text-slate-400">Loading coaching reviews...</div>
            ) : coachingReviews.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <FileCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-800">No Coaching Reviews Recorded</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Managers can conduct 1-on-1 coaching sessions and record action items directly here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {coachingReviews.map((rev) => {
                  const agent = rev.agentId || {}
                  const manager = rev.managerId || {}
                  const isCompleted = rev.status === "ACTION_COMPLETED"

                  return (
                    <div
                      key={rev._id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs"
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm">
                              Agent: {agent.name || agent.email || "Agent"}
                            </span>
                            <span className="text-xs text-slate-500">
                              (Reviewed by: {manager.name || manager.email || "Manager"})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isCompleted
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                              }`}
                            >
                              {rev.status}
                            </span>
                          </div>

                          {rev.managerNotes && (
                            <div className="mt-3 text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <span className="font-semibold text-slate-900">Manager Notes:</span>
                              <p className="mt-1 whitespace-pre-line">{rev.managerNotes}</p>
                            </div>
                          )}

                          {/* Action Items */}
                          {rev.actionItems && rev.actionItems.length > 0 && (
                            <div className="mt-3">
                              <span className="text-xs font-bold text-slate-800">
                                Agreed Action Items:
                              </span>
                              <div className="mt-1.5 space-y-1">
                                {rev.actionItems.map((act, ai) => (
                                  <div
                                    key={ai}
                                    className="flex items-center gap-2 text-xs text-slate-700"
                                  >
                                    <CheckCircle2
                                      className={`w-3.5 h-3.5 ${
                                        act.completed || isCompleted
                                          ? "text-emerald-600"
                                          : "text-slate-300"
                                      }`}
                                    />
                                    <span>{act.item}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isCompleted && isManagerOrAdmin && (
                          <button
                            type="button"
                            onClick={() => handleCompleteReview(rev._id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Mark Action Completed
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL: NEW COACHING REVIEW */}
      {/* ======================================================== */}
      {reviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Record 1-on-1 Coaching Session</h3>
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateReview} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Select Agent *</label>
                <select
                  required
                  value={selectedAgentForReview?._id || ""}
                  onChange={(e) => {
                    const ag = scorecards.find((c) => (c.agentId?._id || c.agentId) === e.target.value)
                    setSelectedAgentForReview(ag?.agentId || { _id: e.target.value })
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 bg-white"
                >
                  <option value="">Select an agent</option>
                  {scorecards.map((c) => (
                    <option key={c._id} value={c.agentId?._id || c.agentId}>
                      {c.agentId?.name || c.agentId?.email || "Agent"} ({c.sampleSize} calls)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Manager Notes *</label>
                <textarea
                  required
                  rows={3}
                  value={reviewForm.managerNotes}
                  onChange={(e) => setReviewForm({ ...reviewForm, managerNotes: e.target.value })}
                  placeholder="Key discussion points, observations, and positive feedback..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Agreed Action Items (One per line)
                </label>
                <textarea
                  rows={2}
                  value={reviewForm.actionItemsText}
                  onChange={(e) => setReviewForm({ ...reviewForm, actionItemsText: e.target.value })}
                  placeholder="Review pricing objections playbook&#10;Follow up with high-intent leads within 2 hours"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="px-4 py-2 rounded-xl bg-indigo-600 font-semibold text-white hover:bg-indigo-700 shadow-2xs"
                >
                  {submittingReview ? "Recording..." : "Save Coaching Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ACCEPT LEAD PRIORITY ACTION */}
      {/* ======================================================== */}
      {acceptModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base">Accept Recommendation</h3>
              <button
                type="button"
                onClick={() => setAcceptModalItem(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Confirm acceptance of this recommendation. Please note this does not auto-mutate lead pipeline status without explicit confirmation.
            </p>

            <div className="text-xs">
              <label className="font-semibold text-slate-700 block mb-1">
                Action Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={acceptNotes}
                onChange={(e) => setAcceptNotes(e.target.value)}
                placeholder="Next step scheduled with agent..."
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAcceptModalItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-semibold text-xs text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingAction}
                onClick={() =>
                  handleAcceptPriority(acceptModalItem.leadId?._id || acceptModalItem.leadId)
                }
                className="px-4 py-2 rounded-xl bg-emerald-600 font-semibold text-xs text-white hover:bg-emerald-700 shadow-2xs"
              >
                {submittingAction ? "Accepting..." : "Confirm Acceptance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* DRAWER / MODAL: CALL COACHING REPORT */}
      {/* ======================================================== */}
      {coachingModalCallId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">Call Coaching Insights</h3>
              </div>
              <button
                type="button"
                onClick={() => setCoachingModalCallId(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingCoachingReport ? (
              <div className="p-8 text-center text-slate-400 text-xs">Loading coaching report...</div>
            ) : !coachingReport ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No coaching report available for this call
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Strengths */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5 text-emerald-800">
                    <ThumbsUp className="w-4 h-4 text-emerald-600" /> Strengths
                  </h4>
                  <div className="space-y-1.5">
                    {coachingReport.strengths?.map((str, i) => (
                      <div
                        key={i}
                        className="bg-emerald-50/70 border border-emerald-100 p-2.5 rounded-xl text-emerald-950"
                      >
                        <p className="font-semibold">{str.point}</p>
                        {str.quote && (
                          <p className="text-[11px] italic text-emerald-800 mt-1">
                            &ldquo;{str.quote}&rdquo; {str.timestamp && `(${str.timestamp})`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Improvement Areas */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5 text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Improvement Areas
                  </h4>
                  <div className="space-y-1.5">
                    {coachingReport.areasForImprovement?.map((imp, i) => (
                      <div
                        key={i}
                        className="bg-amber-50/70 border border-amber-100 p-2.5 rounded-xl text-amber-950"
                      >
                        <p className="font-semibold">{imp.point}</p>
                        {imp.quote && (
                          <p className="text-[11px] italic text-amber-800 mt-1">
                            &ldquo;{imp.quote}&rdquo; {imp.timestamp && `(${imp.timestamp})`}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Suggested Responses */}
                {coachingReport.suggestedResponses &&
                  coachingReport.suggestedResponses.length > 0 && (
                    <div>
                      <h4 className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5 text-indigo-800">
                        <MessageSquare className="w-4 h-4 text-indigo-600" /> Suggested Objection
                        Responses
                      </h4>
                      <div className="space-y-1.5">
                        {coachingReport.suggestedResponses.map((sr, i) => (
                          <div
                            key={i}
                            className="bg-indigo-50/70 border border-indigo-100 p-2.5 rounded-xl"
                          >
                            <p className="font-semibold text-slate-900">
                              Objection: &ldquo;{sr.objection}&rdquo;
                            </p>
                            <p className="text-indigo-900 mt-1">
                              <strong>Recommended:</strong> &ldquo;{sr.suggestedResponse}&rdquo;
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Training Topics */}
                {coachingReport.recommendedTrainingTopics &&
                  coachingReport.recommendedTrainingTopics.length > 0 && (
                    <div>
                      <h4 className="font-bold text-slate-900 mb-1.5 flex items-center gap-1.5 text-purple-800">
                        <BookOpen className="w-4 h-4 text-purple-600" /> Recommended Training Topics
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {coachingReport.recommendedTrainingTopics.map((top, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 font-semibold border border-purple-200"
                          >
                            {top}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
