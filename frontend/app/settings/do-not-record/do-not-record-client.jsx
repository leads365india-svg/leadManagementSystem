"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Phone,
  Tag,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  Lock,
  Smartphone,
  ExternalLink,
} from "lucide-react"

export default function DoNotRecordClient() {
  const { user } = useAuth()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedType, setSelectedType] = useState("all") // "all" | "number" | "tag"

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({
    type: "number",
    value: "",
    reason: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getDnrRules()
      if (res && res.success) {
        setRules(res.data?.rules || [])
      } else {
        toast.error(res?.message || "Failed to load Do-Not-Record rules")
      }
    } catch (err) {
      toast.error(err.message || "Failed to connect to privacy service")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const handleCreateRule = async (e) => {
    e.preventDefault()
    if (!formData.value.trim()) {
      toast.error("Please enter a phone number or tag")
      return
    }

    try {
      setSubmitting(true)
      const res = await apiClient.addDnrRule({
        type: formData.type,
        value: formData.value.trim(),
        reason: formData.reason.trim(),
      })

      if (res && res.success) {
        toast.success("Do-Not-Record exclusion rule registered")
        setIsModalOpen(false)
        setFormData({ type: "number", value: "", reason: "" })
        fetchRules()
      } else {
        toast.error(res?.message || "Failed to create rule")
      }
    } catch (err) {
      toast.error(err.message || "Rule creation failed")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteRule = async (ruleId) => {
    if (!confirm("Are you sure you want to remove this Do-Not-Record rule?")) return

    try {
      setDeletingId(ruleId)
      const res = await apiClient.removeDnrRule(ruleId)
      if (res && res.success) {
        toast.success("Rule removed. Recording eligibility restored.")
        setRules((prev) => prev.filter((r) => r._id !== ruleId))
      } else {
        toast.error(res?.message || "Failed to remove rule")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete rule")
    } finally {
      setDeletingId(null)
    }
  }

  const filteredRules = rules.filter((rule) => {
    const matchesSearch =
      rule.value?.toLowerCase().includes(search.toLowerCase()) ||
      rule.reason?.toLowerCase().includes(search.toLowerCase()) ||
      rule.valueNormalized?.toLowerCase().includes(search.toLowerCase())
    const matchesType = selectedType === "all" || rule.type === selectedType
    return matchesSearch && matchesType
  })

  const numberRulesCount = rules.filter((r) => r.type === "number").length
  const tagRulesCount = rules.filter((r) => r.type === "tag").length

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-xl">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Do-Not-Record & Privacy Controls
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Phase 18 Server-Authoritative Compliance, Exclusion Rules & Erasure
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchRules}
            disabled={loading}
            className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            title="Refresh rules"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add Exclusion Rule
          </button>
        </div>
      </div>

      {/* Compliance Notice Banner */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3.5 text-amber-900 dark:text-amber-200">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm leading-relaxed">
          <span className="font-semibold">Legal & Regulatory Compliance Notice: </span>
          Call recording laws vary significantly across jurisdictions (e.g., GDPR two-party consent, TCPA, Indian Telegraph Act).
          Leads-365 provides server-enforced Do-Not-Record blocks and pre-flight ticket gates to keep prohibited recordings out.
          Agencies remain solely responsible for fulfilling their statutory disclosure and consent duties.
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Rules</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{rules.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">Enforced across web & Android</div>
          </div>
          <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300">
            <Lock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-rose-500">Excluded Numbers</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{numberRulesCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">Normalized E.164 matches</div>
          </div>
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl text-rose-600 dark:text-rose-400">
            <Phone className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-500">Excluded Tags</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{tagRulesCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">Leads with tag auto-blocked</div>
          </div>
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Tag className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Rules Table & Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        {/* Filters bar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search number, tag, or reason..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-slate-800 dark:text-slate-100 placeholder-slate-400"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Type:
            </span>
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium">
              <button
                onClick={() => setSelectedType("all")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  selectedType === "all"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setSelectedType("number")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  selectedType === "number"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                Numbers
              </button>
              <button
                onClick={() => setSelectedType("tag")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  selectedType === "tag"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                Tags
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50/75 dark:bg-slate-800/40 text-xs uppercase font-semibold text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3.5 px-5">Type</th>
                <th className="py-3.5 px-5">Value / Pattern</th>
                <th className="py-3.5 px-5">Normalized Target</th>
                <th className="py-3.5 px-5">Reason</th>
                <th className="py-3.5 px-5">Created</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && rules.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-rose-500" />
                    Loading Do-Not-Record rules...
                  </td>
                </tr>
              ) : filteredRules.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-400">
                    <ShieldCheck className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    No Do-Not-Record exclusion rules found.
                  </td>
                </tr>
              ) : (
                filteredRules.map((rule) => (
                  <tr key={rule._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                    <td className="py-3.5 px-5">
                      {rule.type === "number" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/50 dark:border-rose-900/30">
                          <Phone className="w-3 h-3" /> Number
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900/30">
                          <Tag className="w-3 h-3" /> Tag
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 font-semibold text-slate-900 dark:text-white">
                      {rule.value}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {rule.valueNormalized || rule.value}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-400">
                      {rule.reason || <span className="text-slate-300 dark:text-slate-600 italic">None specified</span>}
                    </td>
                    <td className="py-3.5 px-5 text-xs text-slate-400">
                      {rule.createdAt ? new Date(rule.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        onClick={() => handleDeleteRule(rule._id)}
                        disabled={deletingId === rule._id}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                        title="Delete rule"
                      >
                        {deletingId === rule._id ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Android Sync & Privacy Architecture Guide */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-white font-semibold text-sm">
            <Smartphone className="w-4 h-4 text-rose-500" />
            Android Mobile Pre-Flight Synchronization
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Mobile agents automatically receive active DNR numbers and tags during periodic delta sync via{" "}
            <code className="text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
              /api/privacy/mobile/rules
            </code>
            . When an agent calls a DNR contact, the app stops immediately, never reading the phone recording or requesting an upload ticket.
          </p>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-white font-semibold text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            Right to Erasure & Immediate Audio Purge
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Per Phase 18 specifications, whenever a lead is deleted or anonymized by an admin or agent, the backend immediately purges all associated audio chunks from MongoDB GridFS and updates call recording state to{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-300">expired</span>.
          </p>
        </div>
      </div>

      {/* Add Rule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-500/10 text-rose-600 rounded-xl">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white">Add Exclusion Rule</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Exclusion Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, type: "number" }))}
                    className={`py-2 px-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition ${
                      formData.type === "number"
                        ? "border-rose-500 bg-rose-50/50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Phone className="w-4 h-4" /> Phone Number
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, type: "tag" }))}
                    className={`py-2 px-3 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition ${
                      formData.type === "tag"
                        ? "border-indigo-500 bg-indigo-50/50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Tag className="w-4 h-4" /> Lead Tag
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  {formData.type === "number" ? "Phone Number (e.g. +91 9876543210)" : "Lead Tag Name (e.g. VIP or DNR)"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={formData.type === "number" ? "+91 98765 43210" : "DNR"}
                  value={formData.value}
                  onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Compliance Reason (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Explicit customer opt-out / GDPR request"
                  value={formData.reason}
                  onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl shadow-sm transition flex items-center gap-2"
                >
                  {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
