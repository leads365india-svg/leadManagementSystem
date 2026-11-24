"use client"

import React, { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Building2,
  Users,
  CheckCircle2,
  TrendingUp,
  Clock,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  PhoneCall,
  Layers,
  Shield,
  ExternalLink,
  ChevronRight,
  Plus,
  Sparkles,
  Filter,
  ArrowUpRight,
  Calendar,
  X,
  Check,
} from "lucide-react"

export default function MasterDashboard({ workspaces = [], setActiveWorkspace, user }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState(null)
  const [reviewQueue, setReviewQueue] = useState({ unassignedLeads: [], conflictCalls: [] })
  const [showReviewQueue, setShowReviewQueue] = useState(false)
  const [assigningId, setAssigningId] = useState(null)
  const [selectedTargetWs, setSelectedTargetWs] = useState({})

  const loadMasterData = useCallback(async () => {
    try {
      setRefreshing(true)
      const [masterRes, queueRes] = await Promise.all([
        apiClient.getMasterDashboard().catch((err) => ({ success: false, error: err.message })),
        apiClient.getUnassignedQueue().catch((err) => ({ success: false, error: err.message })),
      ])

      if (masterRes?.success && masterRes.data) {
        setData(masterRes.data)
      }
      if (queueRes?.success && queueRes.data) {
        setReviewQueue(queueRes.data)
      }
    } catch (err) {
      console.error("Failed to load master dashboard:", err)
      toast.error("Failed to load Master Dashboard data")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadMasterData()
  }, [loadMasterData])

  const handleAssignItem = async (itemType, itemId) => {
    const targetWsId = selectedTargetWs[itemId]
    if (!targetWsId) {
      toast.error("Please select a target workspace")
      return
    }

    try {
      setAssigningId(itemId)
      const res = await apiClient.assignUnassignedItem({
        itemType,
        itemId,
        targetWorkspaceId: targetWsId,
      })

      if (res.success) {
        toast.success(res.message || "Assigned successfully")
        // Remove item from local queue state
        if (itemType === "lead") {
          setReviewQueue((prev) => ({
            ...prev,
            unassignedLeads: prev.unassignedLeads.filter((l) => l._id !== itemId),
          }))
        } else {
          setReviewQueue((prev) => ({
            ...prev,
            conflictCalls: prev.conflictCalls.filter((c) => c._id !== itemId),
          }))
        }
        // Refresh master counts
        loadMasterData()
      } else {
        toast.error(res.error || "Assignment failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to assign item")
    } finally {
      setAssigningId(null)
    }
  }

  const handleOpenWorkspace = (wsId) => {
    if (typeof setActiveWorkspace === "function") {
      setActiveWorkspace(wsId)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("leadflow_workspace_changed", { detail: { workspaceId: wsId } }))
      }
      router.refresh()
    }
  }

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Aggregating Master Organization Data...</p>
      </div>
    )
  }

  const kpis = data?.kpis || {}
  const projects = data?.projects || []
  const pipeline = data?.pipeline || []
  const queueTotal = (reviewQueue?.unassignedLeads?.length || 0) + (reviewQueue?.conflictCalls?.length || 0)

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Welcome & Navigation Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Layers className="w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Master Dashboard — All Projects
            </h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Consolidated Organization View
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time multi-workspace performance across {kpis.totalWorkspaces || projects.length} configured workspaces.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => loadMasterData()}
            disabled={refreshing}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <Link
            href="/settings/workspaces"
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 transition-colors"
          >
            <Building2 className="w-4 h-4" />
            <span>Workspace Administration</span>
          </Link>
        </div>
      </div>

      {/* Review Queue Alert Banner */}
      {queueTotal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-2xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-900">
                  Review Queue: {queueTotal} Item{queueTotal > 1 ? "s" : ""} Awaiting Workspace Attribution
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  {reviewQueue.unassignedLeads?.length || 0} unassigned lead(s) and {reviewQueue.conflictCalls?.length || 0} conflicting call(s) require project attribution.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowReviewQueue((prev) => !prev)}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <span>{showReviewQueue ? "Hide Queue" : "Review & Assign"}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showReviewQueue ? "rotate-90" : ""}`} />
            </button>
          </div>

          {/* Collapsible Review Queue Table */}
          {showReviewQueue && (
            <div className="mt-4 pt-4 border-t border-amber-200/80 space-y-4">
              {/* Unassigned Leads */}
              {reviewQueue.unassignedLeads?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">Unassigned Leads</h4>
                  <div className="overflow-x-auto bg-white rounded-xl border border-amber-200">
                    <table className="w-full text-xs text-left text-slate-700">
                      <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Contact Name</th>
                          <th className="px-3 py-2">Phone / Email</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Created</th>
                          <th className="px-3 py-2 text-right">Assign to Workspace</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reviewQueue.unassignedLeads.map((lead) => (
                          <tr key={lead._id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 font-medium text-slate-900">{lead.name || "Anonymous Lead"}</td>
                            <td className="px-3 py-2.5 text-slate-500 font-mono text-[11px]">{lead.phone || lead.email || "—"}</td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                                {lead.source || "Website"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-400 text-[11px]">
                              {new Date(lead.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="inline-flex items-center space-x-2">
                                <select
                                  value={selectedTargetWs[lead._id] || ""}
                                  onChange={(e) =>
                                    setSelectedTargetWs((prev) => ({ ...prev, [lead._id]: e.target.value }))
                                  }
                                  className="text-xs py-1 px-2 border border-slate-200 rounded-lg bg-white text-slate-800"
                                >
                                  <option value="">Select Workspace...</option>
                                  {projects.map((p) => (
                                    <option key={p._id} value={p._id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleAssignItem("lead", lead._id)}
                                  disabled={assigningId === lead._id || !selectedTargetWs[lead._id]}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg cursor-pointer"
                                >
                                  {assigningId === lead._id ? "Assigning..." : "Assign"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Conflict Calls */}
              {reviewQueue.conflictCalls?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">Ambiguous / Conflict Calls</h4>
                  <div className="overflow-x-auto bg-white rounded-xl border border-amber-200">
                    <table className="w-full text-xs text-left text-slate-700">
                      <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Caller / Agent</th>
                          <th className="px-3 py-2">Duration</th>
                          <th className="px-3 py-2">Conflict Reason</th>
                          <th className="px-3 py-2 text-right">Assign to Workspace</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reviewQueue.conflictCalls.map((call) => (
                          <tr key={call._id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-800">
                              {call.callerNumber || "Unknown"} → {call.agentNumber || "Agent"}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500">{call.duration || 0}s</td>
                            <td className="px-3 py-2.5 text-amber-700 text-[11px]">
                              {call.metadata?.conflictReason || "Multiple workspace service match"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="inline-flex items-center space-x-2">
                                <select
                                  value={selectedTargetWs[call._id] || ""}
                                  onChange={(e) =>
                                    setSelectedTargetWs((prev) => ({ ...prev, [call._id]: e.target.value }))
                                  }
                                  className="text-xs py-1 px-2 border border-slate-200 rounded-lg bg-white text-slate-800"
                                >
                                  <option value="">Select Workspace...</option>
                                  {projects.map((p) => (
                                    <option key={p._id} value={p._id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => handleAssignItem("call", call._id)}
                                  disabled={assigningId === call._id || !selectedTargetWs[call._id]}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg cursor-pointer"
                                >
                                  {assigningId === call._id ? "Assigning..." : "Assign"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4 Consolidated Master KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Leads */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Leads</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {kpis.totalLeads?.toLocaleString() || 0}
            </div>
            {kpis.leadsToday > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                +{kpis.leadsToday} today
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Across all projects</p>
        </div>

        {/* Active Follow-ups */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Follow-ups</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {kpis.activeFollowUps?.toLocaleString() || 0}
            </div>
            <span className="text-[11px] font-medium text-slate-400">Scheduled / Pending</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Touchpoints requiring action</p>
        </div>

        {/* Total Calls */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Calls Logged</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PhoneCall className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {kpis.totalCalls?.toLocaleString() || 0}
            </div>
            <span className="text-[11px] font-medium text-indigo-600">Mobile & PBX</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Attributed phone conversations</p>
        </div>

        {/* Closed Won & Conversion */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Deals Won</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {kpis.wonLeads?.toLocaleString() || 0}
            </div>
            <span className="text-xs font-bold text-emerald-600">
              {kpis.conversionRate || 0}% Conv.
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Overall organization win rate</p>
        </div>
      </div>

      {/* Project-wise Performance Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Project-wise Performance</h2>
            <p className="text-xs text-slate-500">Comparative metrics across individual operating workspaces</p>
          </div>
          <span className="text-xs font-medium text-slate-400">
            {projects.length} Workspace{projects.length > 1 ? "s" : ""} Active
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/80 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200/80">
              <tr>
                <th className="px-5 py-3">Project / Workspace</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Total Leads</th>
                <th className="px-4 py-3">Follow-ups</th>
                <th className="px-4 py-3">Calls</th>
                <th className="px-4 py-3">Won</th>
                <th className="px-4 py-3">Conversion</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-400">
                    No active workspaces found. Create your first workspace in Workspace Administration.
                  </td>
                </tr>
              ) : (
                projects.map((proj) => (
                  <tr key={proj._id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center space-x-2.5">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: proj.branding?.primaryColor || "#4f46e5" }}
                        />
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-slate-900 text-sm">{proj.name}</span>
                            {proj.isDefault && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                Default
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">{proj.slug}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          proj.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {proj.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <span className="font-semibold text-slate-900">{proj.memberCount || 0}</span> members
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-slate-900">{proj.totalLeads?.toLocaleString() || 0}</span>
                      {proj.leadsToday > 0 && (
                        <span className="text-[10px] text-emerald-600 font-semibold ml-1">
                          (+{proj.leadsToday})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 font-medium">{proj.activeFollowUps || 0}</td>
                    <td className="px-4 py-3.5 text-slate-600 font-medium">{proj.totalCalls || 0}</td>
                    <td className="px-4 py-3.5 font-bold text-emerald-700">{proj.wonLeads || 0}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-800">{proj.conversionRate || 0}%</span>
                        <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full"
                            style={{ width: `${Math.min(proj.conversionRate || 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenWorkspace(proj._id)}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <span>Open Project</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
