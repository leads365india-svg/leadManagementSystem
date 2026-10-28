"use client"

import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
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
} from "lucide-react"

export default function ClientPortalDashboard() {
  const { user: authUser } = useAuth()
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
  const [recentLeads, setRecentLeads] = useState([])
  const [user, setUser] = useState(authUser || null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (authUser) {
      setUser(authUser)
    }
  }, [authUser])

  const loadData = useCallback(async () => {
    try {
      setRefreshing(true)
      const [statsRes, leadsRes] = await Promise.all([
        apiClient.getLeadStats(),
        apiClient.getLeads({ limit: 5, sortBy: "createdAt", sortOrder: "desc" }),
      ])

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data)
      }

      if (leadsRes.success && leadsRes.data?.leads) {
        setRecentLeads(leadsRes.data.leads)
      }
    } catch (error) {
      console.error("Failed to load portal data:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
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
  const companyName = effectiveUser?.account?.companyName || effectiveUser?.account?.displayName || "Your Organization"

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Welcome Bar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Welcome back, {effectiveUser?.name || "Administrator"}!
            </h1>
            {effectiveUser?.tenantId && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                Tenant: {effectiveUser.tenantId}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            CRM Dashboard for <strong>{companyName}</strong>. All data below is isolated strictly
            to your organization.
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

          <Link
            href="/portal/leads/new"
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Lead</span>
          </Link>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Card 1: Total Leads */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Leads
            </p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Active in pipeline</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: New Leads */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              New Leads
            </p>
            <h3 className="text-2xl font-bold text-blue-600 mt-1">
              {stats.statusCounts?.New || 0}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Awaiting contact</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Closed Won */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Closed Won
            </p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">
              {stats.statusCounts?.["Closed-Won"] || 0}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Converted deals</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4: Conversion Rate */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Conversion Rate
            </p>
            <h3 className="text-2xl font-bold text-purple-600 mt-1">{stats.conversionRate}%</h3>
            <p className="text-[11px] text-slate-400 mt-1">Win percentage</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Pipeline Status Breakdown */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Leads Pipeline Overview</h3>
            <p className="text-xs text-slate-500">Stage distribution of active tenant prospects</p>
          </div>
          <Link
            href="/portal/leads"
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
            <div
              key={stage.label}
              className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-left"
            >
              <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                <span className="text-xs font-medium text-slate-600 truncate">{stage.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-900 mt-2">{stage.count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Leads Table */}
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
                    <Link
                      href="/portal/leads/new"
                      className="inline-block mt-3 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                    >
                      + Create First Lead
                    </Link>
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
    </div>
  )
}
