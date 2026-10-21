"use client"

import React, { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import {
  Users,
  UserPlus,
  Search,
  Filter,
  RefreshCw,
  ArrowUpDown,
  Mail,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react"

function PortalLeadsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [status, setStatus] = useState(searchParams.get("status") || "all")
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalLeads, setTotalLeads] = useState(0)
  const [sortBy, setSortBy] = useState("createdAt")
  const [sortOrder, setSortOrder] = useState("desc")
  const [actionSuccess, setActionSuccess] = useState(null)

  const fetchLeads = useCallback(async () => {
    try {
      setRefreshing(true)
      const response = await apiClient.getLeads({
        page,
        limit: 10,
        search,
        status: status !== "all" ? status : undefined,
        sortBy,
        sortOrder,
      })

      if (response.success && response.data) {
        setLeads(response.data.leads || [])
        setTotalPages(response.data.totalPages || 1)
        setTotalLeads(response.data.total || 0)
      }
    } catch (err) {
      console.error("Error fetching leads:", err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, search, status, sortBy, sortOrder])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  const getStatusBadge = (s) => {
    switch (s) {
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

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("desc")
    }
    setPage(1)
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Leads Pipeline</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage, filter, and track all leads registered within your organization
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => fetchLeads()}
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
            <span>Add New Lead</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search by prospect name or email..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Pipeline Stage:</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">All Stages</option>
            <option value="New">New</option>
            <option value="Engaged">Engaged</option>
            <option value="Proposal Sent">Proposal Sent</option>
            <option value="Closed-Won">Closed-Won</option>
            <option value="Closed-Lost">Closed-Lost</option>
          </select>
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th
                  onClick={() => handleSort("name")}
                  className="py-3.5 px-6 cursor-pointer hover:text-slate-800"
                >
                  <div className="flex items-center space-x-1">
                    <span>Lead Name</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("email")}
                  className="py-3.5 px-4 cursor-pointer hover:text-slate-800"
                >
                  <div className="flex items-center space-x-1">
                    <span>Email Address</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3.5 px-4">Pipeline Status</th>
                <th
                  onClick={() => handleSort("createdAt")}
                  className="py-3.5 px-6 text-right cursor-pointer hover:text-slate-800"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Created Date</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span>Loading organization leads...</span>
                    </div>
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Users className="w-8 h-8 text-slate-300" />
                      <p className="font-medium text-slate-700">No Leads Found</p>
                      <p className="text-xs text-slate-400">
                        {search || status !== "all"
                          ? "Try adjusting your search query or stage filter."
                          : "Get started by adding your first prospect lead."}
                      </p>
                      <Link
                        href="/portal/leads/new"
                        className="inline-block mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                      >
                        + Add Lead
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
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
                    <td className="py-3.5 px-6 text-right text-slate-500 text-[11px]">
                      {new Date(lead.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {leads.length} of {totalLeads} leads
            </span>
            <div className="flex items-center space-x-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 border border-slate-200 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-2 font-medium text-slate-700">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 border border-slate-200 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PortalLeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PortalLeadsContent />
    </Suspense>
  )
}
