"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import Breadcrumb from "@/components/breadcrumb"
import {
  Users,
  UserPlus,
  CheckCircle2,
  TrendingUp,
  PhoneCall,
  Calendar,
  Database,
  BarChart3,
  Sliders,
  Shield,
  ArrowRight,
  Sparkles,
  Building2,
  Activity,
  XCircle,
} from "lucide-react"

export default function HomePage() {
  const router = useRouter()
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

  useEffect(() => {
    if (authUser) {
      if (authUser.role === "super_admin") {
        router.replace("/super-admin")
        return
      }
      setUser(authUser)
    }
  }, [authUser, router])

  useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      try {
        const [statsRes, leadsRes] = await Promise.allSettled([
          apiClient.getLeadStats(),
          apiClient.getLeads({ limit: 5, sortBy: "createdAt", sortOrder: "desc" }),
        ])

        if (isMounted) {
          if (statsRes.status === "fulfilled" && statsRes.value?.success && statsRes.value.data) {
            setStats(statsRes.value.data)
          }

          if (leadsRes.status === "fulfilled" && leadsRes.value?.success && leadsRes.value.data?.leads) {
            setRecentLeads(leadsRes.value.data.leads)
          }
        }
      } catch (err) {
        console.error("Error loading home page CRM data:", err)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [])

  const effectiveUser = user || authUser
  const clientName = effectiveUser?.name || effectiveUser?.username || null
  const companyName = effectiveUser?.account?.companyName || effectiveUser?.account?.displayName || (effectiveUser?.tenantId ? `Account ${effectiveUser.tenantId}` : null)

  return (
    <>
      <Breadcrumb />
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-blue-50/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          
          {/* Welcome Header */}
          <div className="text-center mb-10 sm:mb-12">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200/60 text-indigo-700 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Client CRM Workspace</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
              {clientName ? `Welcome back, ${clientName}` : "Welcome to LeadFlow CRM"}
            </h1>

            <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto mb-6">
              {companyName ? (
                <span className="flex items-center justify-center space-x-2">
                  <Building2 className="w-4 h-4 text-indigo-600 inline" />
                  <span>{companyName} &bull; Real-time pipeline tracking and sales intelligence</span>
                </span>
              ) : (
                "Your centralized platform for sales lead management, team communication and conversion analytics"
              )}
            </p>

            {/* Quick Action Navigation Links (Strictly Client CRM actions) */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/portal"
                className="inline-flex items-center space-x-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-200 transition-all active:scale-95"
              >
                <span>Client Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                href="/leads"
                className="inline-flex items-center space-x-2 px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 shadow-2xs transition-all"
              >
                <Users className="w-4 h-4 text-slate-500" />
                <span>View All Leads</span>
              </Link>

              <Link
                href="/leads/new"
                className="inline-flex items-center space-x-2 px-5 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-200 shadow-2xs transition-all"
              >
                <UserPlus className="w-4 h-4 text-indigo-600" />
                <span>+ Add New Lead</span>
              </Link>
            </div>
          </div>

          {/* Lead Statistics Pipeline Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-10">
            {/* 1. Total Leads */}
            <Link
              href="/leads"
              className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md hover:border-blue-200 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-blue-600">Total Leads</h3>
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{stats.total}</div>
              <p className="text-[10px] text-slate-400 mt-1">All database leads</p>
            </Link>

            {/* 2. New Leads */}
            <Link
              href="/leads?status=New"
              className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md hover:border-emerald-200 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-emerald-600">New Leads</h3>
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-emerald-600">{stats.statusCounts.New || 0}</div>
              <p className="text-[10px] text-slate-400 mt-1">Awaiting outreach</p>
            </Link>

            {/* 3. Active Leads */}
            <Link
              href="/leads?status=Engaged"
              className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md hover:border-amber-200 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-amber-600">Active Leads</h3>
                <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-amber-600">{stats.statusCounts.Engaged || 0}</div>
              <p className="text-[10px] text-slate-400 mt-1">Engaged in discussion</p>
            </Link>

            {/* 4. Order Placed */}
            <Link
              href="/leads?status=Closed-Won"
              className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md hover:border-purple-200 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-purple-600">Order Placed</h3>
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-purple-600">{stats.statusCounts["Closed-Won"] || 0}</div>
              <p className="text-[10px] text-slate-400 mt-1">Converted deals</p>
            </Link>

            {/* 5. Lost Leads */}
            <Link
              href="/leads?status=Closed-Lost"
              className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md hover:border-rose-200 transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-rose-600">Lost Leads</h3>
                <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <XCircle className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-rose-600">{stats.statusCounts["Closed-Lost"] || 0}</div>
              <p className="text-[10px] text-slate-400 mt-1">Disqualified records</p>
            </Link>

            {/* 6. Conversion Rate */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200/80 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Win Rate</h3>
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-indigo-600">{stats.conversionRate || 0}%</div>
              <p className="text-[10px] text-slate-400 mt-1">Lead to win ratio</p>
            </div>
          </div>

          {/* Action Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 text-white rounded-2xl p-6 sm:p-8 shadow-lg shadow-indigo-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Add New Lead</h2>
                </div>
                <p className="text-indigo-100 text-sm mb-6">
                  Capture inbound leads, prospect inquiries and client contact details directly into your sales pipeline.
                </p>
              </div>
              <Link
                href="/leads/new"
                className="w-full inline-flex items-center justify-center space-x-2 py-3 px-6 bg-white text-indigo-700 hover:bg-indigo-50 font-semibold text-sm rounded-xl transition-colors shadow-xs"
              >
                <span>Create New Lead Record</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-6 sm:p-8 shadow-lg shadow-slate-200 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xs flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">View All Leads</h2>
                </div>
                <p className="text-slate-300 text-sm mb-6">
                  Access filters, status stages, search records and track your sales team progress across all accounts.
                </p>
              </div>
              <Link
                href="/leads"
                className="w-full inline-flex items-center justify-center space-x-2 py-3 px-6 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-sm rounded-xl transition-colors shadow-xs"
              >
                <span>Explore Full Lead Database</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* CRM Feature Quick Navigation Section */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs mb-10">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">CRM Feature Navigation</h2>
                <p className="text-xs text-slate-500">Quick shortcuts to your Client CRM modules</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Link
                href="/communication/call-reports"
                className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600">Communication</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Call logs & meetings</p>
              </Link>

              <Link
                href="/tools/import-leads"
                className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <Database className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600">Tools</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Import & data routing</p>
              </Link>

              <Link
                href="/reports/leads"
                className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600">Reports</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Performance analytics</p>
              </Link>

              <Link
                href="/settings/custom-fields"
                className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all group"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <Sliders className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600">Settings</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Fields & lead feeds</p>
              </Link>
            </div>
          </div>

          {/* Recent Activity Section */}
          <div className="bg-white shadow-xs rounded-2xl border border-slate-200/80 p-6">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Recent Lead Activity</h2>
                <p className="text-xs text-slate-500">Latest pipeline updates from your account</p>
              </div>
              <Link
                href="/leads"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                View all &rarr;
              </Link>
            </div>

            {loading ? (
              <div className="py-8 text-center">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading recent records...</p>
              </div>
            ) : recentLeads.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-slate-400">No leads recorded yet.</p>
                <Link
                  href="/leads/new"
                  className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Create your first lead record
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentLeads.map((lead) => (
                  <div
                    key={lead._id}
                    className="flex items-center justify-between py-3 hover:bg-slate-50/60 rounded-xl px-2 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-xl flex items-center justify-center">
                        {lead.name ? lead.name.charAt(0).toUpperCase() : "L"}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">{lead.name}</p>
                        <p className="text-[11px] text-slate-400">{lead.email || "No email"}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          lead.status === "Closed-Won"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : lead.status === "Closed-Lost"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : lead.status === "New"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}
                      >
                        {lead.status}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
