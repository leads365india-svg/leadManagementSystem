"use client"

import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { useBranding } from "@/lib/branding-context"
import {
  Users,
  UserPlus,
  CheckCircle2,
  TrendingUp,
  Clock,
  ArrowRight,
  RefreshCw,
  Building2,
  Mail,
  ChevronRight,
  Filter,
  Sparkles,
  PhoneCall,
  Calendar,
  AlertCircle,
} from "lucide-react"
import MasterDashboard from "@/components/master-dashboard"

export default function ClientPortalDashboard() {
  const {
    user: authUser,
    hasPermission,
    isMultiWorkspaceEnabled,
    activeWorkspace,
    workspaces,
    setActiveWorkspace,
  } = useAuth()
  const { branding, isWhiteLabel } = useBranding()
  const router = useRouter()
  const [stats, setStats] = useState({
    total: 0,
    statusCounts: {
      New: 0,
      Engaged: 0,
      "Proposal Sent": 0,
      "Closed-Won": 0,
      "Closed-Lost": 0,
    },
    conversionRate: 0,
  })
  const [followUpStats, setFollowUpStats] = useState({
    today: 0,
    upcoming: 0,
    overdue: 0,
    completed: 0,
    pending: 0,
    total: 0,
  })
  const [fuError, setFuError] = useState(false)
  const [recentLeads, setRecentLeads] = useState([])
  const [user, setUser] = useState(authUser || null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Granular capability flags
  const canCreateLead = typeof hasPermission === "function" ? hasPermission("leads.create") : true
  const canViewLeads = typeof hasPermission === "function" ? hasPermission("leads.view*") : true
  const canViewReports = typeof hasPermission === "function" ? hasPermission("reports.view") : true
  const canViewCalls = typeof hasPermission === "function" ? (hasPermission("calls.view*") || hasPermission("recordings.listen")) : true

  // Automatic redirect if custom role lacks dashboard.view
  useEffect(() => {
    if (authUser && authUser.role !== "super_admin" && typeof hasPermission === "function") {
      if (!hasPermission("dashboard.view")) {
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
      }
    }
  }, [authUser, hasPermission, router])

  useEffect(() => {
    if (authUser) {
      setUser(authUser)
    }
  }, [authUser])

  const loadData = useCallback(async () => {
    try {
      setRefreshing(true)
      const [statsRes, leadsRes, fuStatsRes] = await Promise.all([
        apiClient.getLeadStats(),
        apiClient.getLeads({ limit: 5, sortBy: "createdAt", sortOrder: "desc" }),
        apiClient.getFollowUpStats().catch(() => ({ success: false })),
      ])

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data)
      }

      if (leadsRes.success && leadsRes.data?.leads) {
        setRecentLeads(leadsRes.data.leads)
      }

      if (fuStatsRes && fuStatsRes.success && fuStatsRes.data) {
        setFollowUpStats(fuStatsRes.data)
        setFuError(false)
      } else {
        setFuError(true)
      }
    } catch (error) {
      console.error("Failed to load portal data:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeWorkspace])

  useEffect(() => {
    const isAdmin = (user?.role || authUser?.role) === "account_admin" || (user?.role || authUser?.role) === "super_admin"
    if (isMultiWorkspaceEnabled && !activeWorkspace && !isAdmin && workspaces && workspaces.length > 0) return
    loadData()
  }, [loadData, isMultiWorkspaceEnabled, activeWorkspace, user, authUser, workspaces])

  useEffect(() => {
    const handleWorkspaceChange = () => {
      loadData()
    }
    if (typeof window !== "undefined") {
      window.addEventListener("leadflow_workspace_changed", handleWorkspaceChange)
      return () => window.removeEventListener("leadflow_workspace_changed", handleWorkspaceChange)
    }
  }, [loadData])

  const getStatusBadge = (status) => {
    switch (status) {
      case "New":
        return "bg-blue-50 text-blue-700 border-blue-200"
      case "Engaged":
        return "bg-amber-50 text-amber-700 border-amber-200"
      case "Proposal Sent":
        return "bg-purple-50 text-purple-700 border-purple-200"
      case "Closed-Won":
        return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case "Closed-Lost":
        return "bg-red-50 text-red-700 border-red-200"
      default:
        return "bg-slate-50 text-slate-700 border-slate-200"
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Loading CRM Pipeline...</p>
      </div>
    )
  }

  const effectiveUser = user || authUser
  const activeWorkspaceObj =
    activeWorkspace && activeWorkspace !== "all" && Array.isArray(workspaces)
      ? workspaces.find((w) => (w._id || w.id)?.toString() === activeWorkspace)
      : null
  const companyName =
    (isWhiteLabel && (branding?.displayName || branding?.companyName)) ||
    effectiveUser?.account?.displayName ||
    effectiveUser?.account?.companyName ||
    "Your Organization"

  // Master Dashboard view for Org Admins viewing All Projects
  if (
    isMultiWorkspaceEnabled &&
    activeWorkspace === "all" &&
    (effectiveUser?.role === "account_admin" || effectiveUser?.role === "super_admin")
  ) {
    return (
      <MasterDashboard
        workspaces={workspaces}
        setActiveWorkspace={setActiveWorkspace}
        user={effectiveUser}
      />
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Welcome Bar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Welcome back, {effectiveUser?.name || "Administrator"}!
            </h1>
            {activeWorkspaceObj && (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Workspace: {activeWorkspaceObj.name}
              </span>
            )}
            {effectiveUser?.tenantId && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                Tenant: {effectiveUser.tenantId}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {activeWorkspaceObj ? (
              <>
                Active workspace <strong>{activeWorkspaceObj.name}</strong> under organization <strong>{companyName}</strong>.
              </>
            ) : (
              <>
                CRM Dashboard for <strong>{companyName}</strong>. All data below is isolated strictly
                to your organization.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => loadData()}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          {canCreateLead && (
            <Link
              href="/portal/leads/new"
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Lead</span>
            </Link>
          )}
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Card 1: Total Leads */}
        <Link
          href="/leads"
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-indigo-600 transition-colors">
              Total Leads
            </p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Active in pipeline</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-6 h-6" />
          </div>
        </Link>

        {/* Card 2: New Leads */}
        <Link
          href="/leads?status=New"
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-blue-600 transition-colors">
              New Leads
            </p>
            <h3 className="text-2xl font-bold text-blue-600 mt-1">
              {stats.statusCounts?.New || 0}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Awaiting contact</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Clock className="w-6 h-6" />
          </div>
        </Link>

        {/* Card 3: Closed Won */}
        <Link
          href="/leads?status=Closed-Won"
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-emerald-600 transition-colors">
              Closed Won
            </p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">
              {stats.statusCounts?.["Closed-Won"] || 0}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Converted deals</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </Link>

        {/* Card 4: Conversion Rate */}
        <Link
          href="/reports/leads"
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between hover:border-purple-300 hover:shadow-md transition-all cursor-pointer group"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 group-hover:text-purple-600 transition-colors">
              Conversion Rate
            </p>
            <h3 className="text-2xl font-bold text-purple-600 mt-1">{stats.conversionRate}%</h3>
            <p className="text-[11px] text-slate-400 mt-1">Win percentage</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <TrendingUp className="w-6 h-6" />
          </div>
        </Link>
      </div>

      {/* Pipeline Status Breakdown */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Leads Pipeline Overview</h3>
            <p className="text-xs text-slate-500">Stage distribution of active tenant prospects</p>
          </div>
          <Link
            href="/leads"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
          >
            <span>View Full Pipeline</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
          {[
            { label: "New", count: stats.statusCounts?.New || 0, color: "bg-blue-500" },
            { label: "Engaged", count: stats.statusCounts?.Engaged || 0, color: "bg-amber-500" },
            {
              label: "Proposal Sent",
              count: stats.statusCounts?.["Proposal Sent"] || 0,
              color: "bg-purple-500",
            },
            {
              label: "Closed-Won",
              count: stats.statusCounts?.["Closed-Won"] || 0,
              color: "bg-emerald-500",
            },
            {
              label: "Closed-Lost",
              count: stats.statusCounts?.["Closed-Lost"] || 0,
              color: "bg-red-500",
            },
          ].map((stage) => (
            <Link
              key={stage.label}
              href={`/leads?status=${encodeURIComponent(stage.label)}`}
              className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-left hover:bg-slate-100 hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer block"
            >
              <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                <span className="text-xs font-medium text-slate-600 truncate">{stage.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-900 mt-2">{stage.count}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* AI Callback Tasks & Follow-up Reminders */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Scheduled Callbacks & Reminders</h3>
              <p className="text-xs text-slate-500">Live AI-scheduled callbacks, customer follow-up alarms & task metrics</p>
            </div>
          </div>
          <Link
            href="/communication/follow-ups"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
          >
            <span>Open All Callbacks</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {fuError ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Could not load follow-up metrics. Verify connection or retry.</span>
            </div>
            <button
              onClick={() => loadData()}
              className="text-xs font-semibold px-2.5 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
            <Link
              href="/communication/follow-ups?status=today"
              className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 text-left hover:bg-amber-50 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800">Today&apos;s Due</span>
                <Clock className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-amber-900 mt-2">{followUpStats.today || 0}</p>
              <p className="text-[10px] text-amber-700/80 mt-0.5">Need attention today</p>
            </Link>

            <Link
              href="/communication/follow-ups?status=upcoming"
              className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/80 text-left hover:bg-blue-50 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-800">Upcoming</span>
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-blue-900 mt-2">{followUpStats.upcoming || 0}</p>
              <p className="text-[10px] text-blue-700/80 mt-0.5">Scheduled future</p>
            </Link>

            <Link
              href="/communication/follow-ups?status=overdue"
              className="p-3.5 rounded-xl bg-red-50/60 border border-red-200/80 text-left hover:bg-red-50 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-800">Overdue</span>
                <AlertCircle className="w-3.5 h-3.5 text-red-600" />
              </div>
              <p className="text-2xl font-bold text-red-900 mt-2">{followUpStats.overdue || 0}</p>
              <p className="text-[10px] text-red-700/80 mt-0.5">Missed scheduled time</p>
            </Link>

            <Link
              href="/communication/follow-ups?status=completed"
              className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-left hover:bg-emerald-50 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800">Completed</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <p className="text-2xl font-bold text-emerald-900 mt-2">{followUpStats.completed || 0}</p>
              <p className="text-[10px] text-emerald-700/80 mt-0.5">Successfully called</p>
            </Link>

            <Link
              href="/communication/follow-ups?status=pending"
              className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200/80 text-left hover:bg-indigo-50 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-800">Total Pending</span>
                <Users className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <p className="text-2xl font-bold text-indigo-900 mt-2">
                {followUpStats.pending || ((followUpStats.today || 0) + (followUpStats.upcoming || 0) + (followUpStats.overdue || 0)) || 0}
              </p>
              <p className="text-[10px] text-indigo-700/80 mt-0.5">Active callback queue</p>
            </Link>
          </div>
        )}
      </div>

      {/* AI Call Intelligence & Voice Analytics Shortcut */}
      {canViewCalls && (
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-850 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 bg-indigo-500/20 rounded-lg border border-indigo-400/30 text-indigo-300">
                <Sparkles className="w-4 h-4" />
              </span>
              <h3 className="font-bold text-sm text-white">AI Call Intelligence & Voice Analytics</h3>
            </div>
            <p className="text-xs text-indigo-200/90 max-w-xl">
              Inspect automatic Gemini transcription, customer intent, scorecards, and actionable call outcomes.
            </p>
          </div>
          <Link
            href="/dashboard/ai-call-intelligence"
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-900 bg-white hover:bg-slate-100 shadow-sm transition-colors shrink-0"
          >
            <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
            <span>Open Call Intelligence</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </Link>
        </div>
      )}

      {/* Recent Leads Table */}
      {canViewLeads ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Recent Leads</h3>
              <p className="text-xs text-slate-500">Latest prospects registered in your workspace</p>
            </div>
            <Link
              href="/portal/leads"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
            >
              <span>All Leads →</span>
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-6">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Added On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {recentLeads.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-400">
                      <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-medium text-slate-700 text-xs">No leads recorded yet</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Get started by adding your first lead.
                      </p>
                      {canCreateLead && (
                        <Link
                          href="/portal/leads/new"
                          className="inline-block mt-3 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                        >
                          + Create First Lead
                        </Link>
                      )}
                    </td>
                  </tr>
                ) : (
                  recentLeads.map((lead) => (
                    <tr key={lead._id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6 font-semibold text-slate-900">{lead.name}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 text-[11px]">
                        {lead.email}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadge(
                            lead.status,
                          )}`}
                        >
                          {lead.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right text-slate-400 text-[11px]">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="font-semibold text-slate-700">Leads List Restricted</p>
          <p className="text-[11px] text-slate-400 mt-1">Your assigned role has restricted access to view individual lead records.</p>
        </div>
      )}
    </div>
  )
}
