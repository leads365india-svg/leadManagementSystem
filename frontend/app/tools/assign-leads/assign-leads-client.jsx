"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  Users,
  UserCheck,
  UserPlus,
  ArrowRightLeft,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  Settings,
  ChevronRight,
  ArrowUpDown,
  MoveUp,
  MoveDown,
  Trash2,
  Edit2,
  Layers,
  Inbox,
  UserX,
  FileText,
  Building,
  Check,
  X,
  Eye,
  Sliders,
} from "lucide-react"

export default function AssignLeadsClient() {
  const { user } = useAuth()

  // RBAC Permission Check
  const canAssign = useMemo(() => {
    if (!user) return false
    if (user.role === "super_admin" || user.role === "account_admin") return true
    if (Array.isArray(user.permissions) && user.permissions.includes("leads.assign")) return true
    return false
  }, [user])

  // Active Tab: "pool" | "all" | "rules"
  const [activeTab, setActiveTab] = useState("pool")

  // Data states
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [poolStats, setPoolStats] = useState({ unassignedCount: 0, totalOpenLeadsCount: 0 })
  const [leads, setLeads] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 15, totalPages: 1, total: 0 })
  const [rules, setRules] = useState([])
  const [staffList, setStaffList] = useState([])
  const [teamList, setTeamList] = useState([])

  // Filters
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [ownerFilter, setOwnerFilter] = useState("all")

  // Lead Selection for Bulk Assignment
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set())

  // Bulk Action Drawer/Modal State
  const [bulkTargetType, setBulkTargetType] = useState("agent") // "agent" | "team" | "rule"
  const [bulkTargetOwnerId, setBulkTargetOwnerId] = useState("")
  const [bulkTargetTeamId, setBulkTargetTeamId] = useState("")
  const [bulkTargetRuleId, setBulkTargetRuleId] = useState("")
  const [bulkReason, setBulkReason] = useState("")
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false)

  // Single Lead Assign Modal State
  const [singleAssignLead, setSingleAssignLead] = useState(null)
  const [singleTargetOwnerId, setSingleTargetOwnerId] = useState("")
  const [singleTargetTeamId, setSingleTargetTeamId] = useState("")
  const [singleReason, setSingleReason] = useState("")
  const [isSubmittingSingle, setIsSubmittingSingle] = useState(false)

  // Lead Assignment History Modal State
  const [historyLead, setHistoryLead] = useState(null)

  // Rules Editor Modal State
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [ruleFormData, setRuleFormData] = useState({
    name: "",
    priority: 1,
    isActive: true,
    routingType: "round_robin",
    sources: "",
    tags: "",
    city: "",
    teamId: "",
    targetUserId: "",
    targetUserIds: [],
  })
  const [isSubmittingRule, setIsSubmittingRule] = useState(false)

  // Deactivated Staff Migration Wizard Modal State
  const [isMigrationWizardOpen, setIsMigrationWizardOpen] = useState(false)
  const [selectedStaffForMigration, setSelectedStaffForMigration] = useState("")
  const [migrationOpenLeadsCount, setMigrationOpenLeadsCount] = useState(null)
  const [migrationDestination, setMigrationDestination] = useState("pool") // "pool" | "agent"
  const [migrationTargetOwnerId, setMigrationTargetOwnerId] = useState("")
  const [isSubmittingMigration, setIsSubmittingMigration] = useState(false)

  // Load supporting options (Staff & Teams)
  const loadStaffAndTeams = useCallback(async () => {
    try {
      const [staffRes, teamRes] = await Promise.all([
        apiClient.getStaff({ status: "all", limit: 100 }).catch(() => ({ success: false, data: [] })),
        apiClient.getTeams().catch(() => ({ success: false, data: [] })),
      ])

      if (staffRes.success && Array.isArray(staffRes.data)) {
        setStaffList(staffRes.data)
      } else if (staffRes.success && staffRes.data?.staff) {
        setStaffList(staffRes.data.staff)
      }

      if (teamRes.success && Array.isArray(teamRes.data)) {
        setTeamList(teamRes.data)
      } else if (teamRes.success && teamRes.data?.teams) {
        setTeamList(teamRes.data.teams)
      }
    } catch (err) {
      console.error("Failed to load staff/teams for assignment UI:", err)
    }
  }, [])

  // Load pool stats
  const loadPoolStats = useCallback(async () => {
    try {
      const res = await apiClient.getUnassignedPoolStats()
      if (res.success && res.data) {
        setPoolStats(res.data)
      }
    } catch (err) {
      console.error("Failed to load pool stats:", err)
    }
  }, [])

  // Load rules
  const loadRules = useCallback(async () => {
    try {
      const res = await apiClient.getAssignmentRules()
      if (res.success && Array.isArray(res.data)) {
        setRules(res.data)
      }
    } catch (err) {
      console.error("Failed to load assignment rules:", err)
    }
  }, [])

  // Load leads table data based on active tab and filters
  const loadLeads = useCallback(async () => {
    try {
      setLoading(true)
      const query = {
        page: pagination.page,
        limit: pagination.limit,
        search: searchQuery.trim() || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
      }

      if (activeTab === "pool") {
        query.assignedTo = "unassigned"
      } else if (ownerFilter !== "all") {
        query.assignedTo = ownerFilter
      }

      const res = await apiClient.getLeads(query)
      if (res.success) {
        const leadDocs = res.data?.leads || (Array.isArray(res.data) ? res.data : [])
        setLeads(leadDocs)
        if (res.data?.pagination) {
          setPagination((prev) => ({
            ...prev,
            totalPages: res.data.pagination.totalPages || 1,
            total: res.data.pagination.total || leadDocs.length,
          }))
        } else {
          setPagination((prev) => ({ ...prev, total: leadDocs.length, totalPages: 1 }))
        }
      }
    } catch (err) {
      console.error("Failed to load leads:", err)
      toast.error("Failed to load leads")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeTab, pagination.page, pagination.limit, searchQuery, statusFilter, ownerFilter])

  // Initial load
  useEffect(() => {
    loadStaffAndTeams()
    loadPoolStats()
    loadRules()
  }, [loadStaffAndTeams, loadPoolStats, loadRules])

  // Refresh leads when tab or filters change
  useEffect(() => {
    setSelectedLeadIds(new Set())
    if (activeTab !== "rules") {
      loadLeads()
    }
  }, [activeTab, loadLeads])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([loadPoolStats(), loadRules(), loadLeads()])
    setRefreshing(false)
  }

  // Handle select all toggle
  const handleToggleSelectAll = () => {
    if (selectedLeadIds.size === leads.length && leads.length > 0) {
      setSelectedLeadIds(new Set())
    } else {
      setSelectedLeadIds(new Set(leads.map((l) => l.id || l._id)))
    }
  }

  // Handle single item select toggle
  const handleToggleSelectLead = (id) => {
    const updated = new Set(selectedLeadIds)
    if (updated.has(id)) {
      updated.delete(id)
    } else {
      updated.add(id)
    }
    setSelectedLeadIds(updated)
  }

  // Handle single lead assignment submission
  const handleAssignSingleLeadSubmit = async (e) => {
    e.preventDefault()
    if (!singleAssignLead) return
    setIsSubmittingSingle(true)

    try {
      const payload = {
        targetOwnerId: singleTargetOwnerId || null,
        teamId: singleTargetTeamId || null,
        reason: singleReason || "Manual assignment from dashboard",
      }

      const res = await apiClient.assignLead(singleAssignLead.id || singleAssignLead._id, payload)
      if (res.success) {
        toast.success(res.message || "Lead assigned successfully")
        setSingleAssignLead(null)
        setSingleTargetOwnerId("")
        setSingleTargetTeamId("")
        setSingleReason("")
        await Promise.all([loadLeads(), loadPoolStats()])
      } else {
        toast.error(res.error || "Assignment failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to assign lead")
    } finally {
      setIsSubmittingSingle(false)
    }
  }

  // Handle bulk assignment submission
  const handleBulkAssignSubmit = async (e) => {
    e.preventDefault()
    if (selectedLeadIds.size === 0) {
      toast.error("Please select at least one lead")
      return
    }

    setIsSubmittingBulk(true)
    try {
      const payload = {
        leadIds: Array.from(selectedLeadIds),
        reason: bulkReason || `Bulk assignment of ${selectedLeadIds.size} leads`,
      }

      if (bulkTargetType === "agent") {
        if (!bulkTargetOwnerId) {
          toast.error("Please select a target staff member")
          setIsSubmittingBulk(false)
          return
        }
        payload.targetOwnerId = bulkTargetOwnerId
        if (bulkTargetTeamId) payload.teamId = bulkTargetTeamId
      } else if (bulkTargetType === "team") {
        if (!bulkTargetTeamId) {
          toast.error("Please select a target team")
          setIsSubmittingBulk(false)
          return
        }
        payload.teamId = bulkTargetTeamId
      } else if (bulkTargetType === "rule") {
        if (!bulkTargetRuleId) {
          toast.error("Please select an assignment rule")
          setIsSubmittingBulk(false)
          return
        }
        payload.ruleId = bulkTargetRuleId
      }

      const res = await apiClient.bulkAssignLeads(payload)
      if (res.success) {
        toast.success(
          `Successfully processed assignment. ${res.data?.successCount || selectedLeadIds.size} leads assigned.`
        )
        setSelectedLeadIds(new Set())
        setBulkReason("")
        await Promise.all([loadLeads(), loadPoolStats()])
      } else {
        toast.error(res.error || "Bulk assignment failed")
      }
    } catch (err) {
      toast.error(err.message || "Bulk assignment failed")
    } finally {
      setIsSubmittingBulk(false)
    }
  }

  // Handle rule create / edit submit
  const handleSaveRuleSubmit = async (e) => {
    e.preventDefault()
    setIsSubmittingRule(true)

    try {
      const payload = {
        name: ruleFormData.name,
        priority: Number(ruleFormData.priority) || 1,
        isActive: Boolean(ruleFormData.isActive),
        routingType: ruleFormData.routingType,
        conditions: {
          sources: ruleFormData.sources
            ? ruleFormData.sources.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          tags: ruleFormData.tags
            ? ruleFormData.tags.split(",").map((t) => t.trim()).filter(Boolean)
            : [],
          city: ruleFormData.city.trim() || undefined,
        },
        teamId: ruleFormData.teamId || null,
        targetUserId: ruleFormData.targetUserId || null,
        targetUserIds: Array.isArray(ruleFormData.targetUserIds) ? ruleFormData.targetUserIds : [],
      }

      let res
      if (editingRule) {
        res = await apiClient.updateAssignmentRule(editingRule._id || editingRule.id, payload)
      } else {
        res = await apiClient.createAssignmentRule(payload)
      }

      if (res.success) {
        toast.success(res.message || "Assignment rule saved")
        setIsRuleModalOpen(false)
        setEditingRule(null)
        await loadRules()
      } else {
        toast.error(res.error || "Failed to save rule")
      }
    } catch (err) {
      toast.error(err.message || "Error saving assignment rule")
    } finally {
      setIsSubmittingRule(false)
    }
  }

  // Handle rule delete
  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm("Are you sure you want to delete this assignment rule?")) return
    try {
      const res = await apiClient.deleteAssignmentRule(ruleId)
      if (res.success) {
        toast.success("Rule deleted successfully")
        await loadRules()
      } else {
        toast.error(res.error || "Failed to delete rule")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete rule")
    }
  }

  // Handle rule toggle active status
  const handleToggleRuleActive = async (rule) => {
    try {
      const res = await apiClient.updateAssignmentRule(rule._id || rule.id, {
        isActive: !rule.isActive,
      })
      if (res.success) {
        toast.success(`Rule "${rule.name}" is now ${!rule.isActive ? "active" : "inactive"}`)
        await loadRules()
      }
    } catch (err) {
      toast.error("Failed to toggle rule status")
    }
  }

  // Handle rule priority reordering (move up or down)
  const handleMoveRule = async (index, direction) => {
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= rules.length) return

    const newRules = [...rules]
    const temp = newRules[index]
    newRules[index] = newRules[targetIndex]
    newRules[targetIndex] = temp

    const ruleIds = newRules.map((r) => r._id || r.id)
    try {
      const res = await apiClient.reorderAssignmentRules(ruleIds)
      if (res.success) {
        setRules(newRules)
        toast.success("Rule priority reordered")
      }
    } catch (err) {
      toast.error("Failed to reorder rules")
    }
  }

  // Open rule edit form
  const handleOpenEditRule = (rule) => {
    setEditingRule(rule)
    setRuleFormData({
      name: rule.name || "",
      priority: rule.priority || 1,
      isActive: rule.isActive ?? true,
      routingType: rule.routingType || "round_robin",
      sources: Array.isArray(rule.conditions?.sources) ? rule.conditions.sources.join(", ") : "",
      tags: Array.isArray(rule.conditions?.tags) ? rule.conditions.tags.join(", ") : "",
      city: rule.conditions?.city || "",
      teamId: rule.teamId?._id || rule.teamId || "",
      targetUserId: rule.targetUserId?._id || rule.targetUserId || "",
      targetUserIds: Array.isArray(rule.targetUserIds)
        ? rule.targetUserIds.map((u) => u._id || u)
        : [],
    })
    setIsRuleModalOpen(true)
  }

  // Fetch open leads for a staff member selected in the migration wizard
  const handleSelectStaffForMigration = async (staffId) => {
    setSelectedStaffForMigration(staffId)
    setMigrationOpenLeadsCount(null)
    if (!staffId) return

    try {
      const res = await apiClient.getStaffOpenLeads(staffId)
      if (res.success && res.data) {
        setMigrationOpenLeadsCount(res.data.openLeadsCount || 0)
      }
    } catch (err) {
      toast.error("Failed to check open leads count for selected staff")
    }
  }

  // Handle staff lead migration submission
  const handleMigrationSubmit = async (e) => {
    e.preventDefault()
    if (!selectedStaffForMigration) return

    setIsSubmittingMigration(true)
    try {
      const payload = {
        action: "deactivate",
        sendToPool: migrationDestination === "pool",
        targetOwnerId: migrationDestination === "agent" ? migrationTargetOwnerId : null,
      }

      const res = await apiClient.request(`/staff/${selectedStaffForMigration}/deactivate`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })

      if (res.success) {
        toast.success(res.message || "Staff open leads successfully migrated")
        setIsMigrationWizardOpen(false)
        setSelectedStaffForMigration("")
        setMigrationOpenLeadsCount(null)
        await Promise.all([loadPoolStats(), loadLeads()])
      } else {
        toast.error(res.error || "Migration failed")
      }
    } catch (err) {
      toast.error(err.message || "Staff lead migration failed")
    } finally {
      setIsSubmittingMigration(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <span>Tools</span>
            <ChevronRight className="w-3 h-3 text-slate-400" />
            <span>Lead Allocation & Routing</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">
            Lead Ownership & Assignment
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage single source of truth lead ownership, distribute unassigned pool leads, and automate routing with priority rules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-indigo-600" : ""}`} />
            <span>Refresh</span>
          </button>

          {canAssign && (
            <>
              <button
                onClick={() => {
                  setSelectedStaffForMigration("")
                  setMigrationOpenLeadsCount(null)
                  setIsMigrationWizardOpen(true)
                }}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/60 rounded-xl transition"
              >
                <ArrowRightLeft className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>Reassignment Wizard</span>
              </button>

              <button
                onClick={() => {
                  setEditingRule(null)
                  setRuleFormData({
                    name: "",
                    priority: rules.length + 1,
                    isActive: true,
                    routingType: "round_robin",
                    sources: "",
                    tags: "",
                    city: "",
                    teamId: "",
                    targetUserId: "",
                    targetUserIds: [],
                  })
                  setIsRuleModalOpen(true)
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/20 rounded-xl transition"
              >
                <Plus className="w-4 h-4" />
                <span>New Routing Rule</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* RBAC Notice if user lacks leads.assign permission */}
      {!canAssign && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-xl flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">View-Only Scope:</span> Your current role does not have the{" "}
            <code className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/60 rounded text-xs font-mono font-bold">
              leads.assign
            </code>{" "}
            permission. You can monitor lead ownership and review assignment rules, but you cannot modify owners.
          </div>
        </div>
      )}

      {/* Key Metrics Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Unassigned Pool
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {poolStats.unassignedCount}
            </div>
            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1">
              Awaiting agent distribution
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <Inbox className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Open Leads
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {poolStats.totalOpenLeadsCount}
            </div>
            <div className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-1">
              Across pipeline stages
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Routing Rules
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {rules.filter((r) => r.isActive).length} / {rules.length}
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
              Automated routing active
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Sliders className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Eligible Staff
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {staffList.filter((s) => s.isActive !== false).length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">
              {teamList.length} teams configured
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center text-sky-600 dark:text-sky-400">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Tab Controls */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-8">
        <button
          onClick={() => setActiveTab("pool")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeTab === "pool"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Inbox className="w-4 h-4" />
          <span>Unassigned Pool</span>
          {poolStats.unassignedCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
              {poolStats.unassignedCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("all")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeTab === "all"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>All Leads Explorer</span>
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
            activeTab === "rules"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Automated Assignment Rules</span>
          <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {rules.length}
          </span>
        </button>
      </div>

      {/* Bulk Assignment Floating Action Bar */}
      {selectedLeadIds.size > 0 && canAssign && activeTab !== "rules" && (
        <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-4 rounded-2xl shadow-xl border border-indigo-700/50 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 rounded-full bg-indigo-500/30 border border-indigo-400/40 items-center justify-center font-bold text-sm">
              {selectedLeadIds.size}
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight">Leads Selected for Assignment</div>
              <div className="text-xs text-indigo-200">
                Choose target allocation method and reason to record in assignment history.
              </div>
            </div>
          </div>

          <form onSubmit={handleBulkAssignSubmit} className="flex flex-wrap items-center gap-3">
            {/* Mode selection */}
            <select
              value={bulkTargetType}
              onChange={(e) => setBulkTargetType(e.target.value)}
              className="bg-slate-800/80 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-400"
            >
              <option value="agent">Assign to Agent</option>
              <option value="team">Assign to Team</option>
              <option value="rule">Execute Assignment Rule</option>
            </select>

            {/* Target Select */}
            {bulkTargetType === "agent" && (
              <select
                value={bulkTargetOwnerId}
                onChange={(e) => setBulkTargetOwnerId(e.target.value)}
                required
                className="bg-slate-800/80 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Select Target Staff...</option>
                {staffList
                  .filter((s) => s.isActive !== false)
                  .map((staff) => (
                    <option key={staff.id || staff._id} value={staff.id || staff._id}>
                      {staff.name} ({staff.role || "Agent"})
                    </option>
                  ))}
              </select>
            )}

            {bulkTargetType === "team" && (
              <select
                value={bulkTargetTeamId}
                onChange={(e) => setBulkTargetTeamId(e.target.value)}
                required
                className="bg-slate-800/80 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Select Target Team...</option>
                {teamList.map((team) => (
                  <option key={team._id || team.id} value={team._id || team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            )}

            {bulkTargetType === "rule" && (
              <select
                value={bulkTargetRuleId}
                onChange={(e) => setBulkTargetRuleId(e.target.value)}
                required
                className="bg-slate-800/80 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Select Rule...</option>
                {rules
                  .filter((r) => r.isActive)
                  .map((rule) => (
                    <option key={rule._id || rule.id} value={rule._id || rule.id}>
                      #{rule.priority} - {rule.name} ({rule.routingType})
                    </option>
                  ))}
              </select>
            )}

            {/* Reason input */}
            <input
              type="text"
              placeholder="Reason / Note (optional)"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              className="bg-slate-800/80 border border-slate-700 text-xs text-white placeholder-slate-400 rounded-xl px-3 py-2 focus:ring-2 focus:ring-indigo-400 w-48"
            />

            <button
              type="submit"
              disabled={isSubmittingBulk}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold rounded-xl shadow-md transition disabled:opacity-50"
            >
              {isSubmittingBulk ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Assigning...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Execute Assignment</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSelectedLeadIds(new Set())}
              className="px-2.5 py-2 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Clear
            </button>
          </form>
        </div>
      )}

      {/* TAB CONTENT: Unassigned Pool OR All Leads */}
      {(activeTab === "pool" || activeTab === "all") && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search leads by name, email, phone, city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadLeads()}
                className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="all">All Pipeline Stages</option>
              <option value="New">New</option>
              <option value="Contacted">Contacted</option>
              <option value="Qualified">Qualified</option>
              <option value="Follow-up Scheduled">Follow-up Scheduled</option>
              <option value="Lost">Lost</option>
              <option value="Converted">Converted</option>
            </select>

            {activeTab === "all" && (
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
              >
                <option value="all">All Owners</option>
                <option value="unassigned">Unassigned Only</option>
                {staffList.map((s) => (
                  <option key={s.id || s._id} value={s.id || s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={loadLeads}
              className="px-4 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-sm font-semibold rounded-xl transition"
            >
              Filter
            </button>
          </div>

          {/* Leads Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                <div className="text-sm font-medium text-slate-500">Loading leads for assignment...</div>
              </div>
            ) : leads.length === 0 ? (
              <div className="py-20 text-center px-4">
                <Inbox className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {activeTab === "pool" ? "Unassigned Pool is Empty" : "No Leads Found"}
                </h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
                  {activeTab === "pool"
                    ? "Great job! All incoming leads have been routed to accountable owners."
                    : "No leads matched your search and filter criteria."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="py-3.5 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.size === leads.length && leads.length > 0}
                          onChange={handleToggleSelectAll}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="py-3.5 px-4">Lead Contact</th>
                      <th className="py-3.5 px-4">Stage / Status</th>
                      <th className="py-3.5 px-4">Source</th>
                      <th className="py-3.5 px-4">Accountable Owner</th>
                      <th className="py-3.5 px-4">Team</th>
                      <th className="py-3.5 px-4">History</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {leads.map((lead) => {
                      const id = lead.id || lead._id
                      const isSelected = selectedLeadIds.has(id)
                      const isUnassigned = !lead.ownerId && !lead.assignedStaffId && !lead.assignedTo

                      return (
                        <tr
                          key={id}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition ${
                            isSelected ? "bg-indigo-50/50 dark:bg-indigo-950/20" : ""
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectLead(id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {lead.name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {lead.phone} {lead.email ? `• ${lead.email}` : ""}
                            </div>
                            {lead.city && (
                              <div className="text-[11px] text-slate-400">{lead.city}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {lead.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-medium text-slate-600 dark:text-slate-400">
                            {lead.source || "Website"}
                          </td>
                          <td className="py-3.5 px-4">
                            {isUnassigned ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40">
                                <UserX className="w-3.5 h-3.5" />
                                <span>Unassigned</span>
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold">
                                  {lead.ownerId?.name?.[0] || lead.assignedTo?.[0] || "A"}
                                </div>
                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                  {lead.ownerId?.name || lead.assignedTo || "Assigned"}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                            {lead.teamId?.name || lead.teamName || "—"}
                          </td>
                          <td className="py-3.5 px-4">
                            {Array.isArray(lead.assignmentHistory) &&
                            lead.assignmentHistory.length > 0 ? (
                              <button
                                onClick={() => setHistoryLead(lead)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>{lead.assignmentHistory.length} events</span>
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">No events</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {canAssign && (
                              <button
                                onClick={() => {
                                  setSingleAssignLead(lead)
                                  setSingleTargetOwnerId(lead.ownerId?._id || lead.ownerId || "")
                                  setSingleTargetTeamId(lead.teamId?._id || lead.teamId || "")
                                  setSingleReason("")
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Assign</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: Automated Assignment Rules */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Rule Evaluation Hierarchy
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rules are evaluated sequentially from lowest priority number (#1) to highest. The first matching rule dictates lead routing. Leads matching no rules drop into the Unassigned Pool.
              </p>
            </div>
            {canAssign && (
              <button
                onClick={() => {
                  setEditingRule(null)
                  setRuleFormData({
                    name: "",
                    priority: rules.length + 1,
                    isActive: true,
                    routingType: "round_robin",
                    sources: "",
                    tags: "",
                    city: "",
                    teamId: "",
                    targetUserId: "",
                    targetUserIds: [],
                  })
                  setIsRuleModalOpen(true)
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Rule</span>
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            {rules.length === 0 ? (
              <div className="py-20 text-center px-4">
                <Sliders className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  No Assignment Rules Configured
                </h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
                  Add automated assignment rules to route leads by source, city, round-robin rotation, or fewest open leads workload balance.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="py-3.5 px-4 w-16">Priority</th>
                      <th className="py-3.5 px-4">Rule Name</th>
                      <th className="py-3.5 px-4">Routing Strategy</th>
                      <th className="py-3.5 px-4">Matching Conditions</th>
                      <th className="py-3.5 px-4">Target Assignees</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {rules.map((rule, index) => {
                      const ruleId = rule._id || rule.id
                      return (
                        <tr
                          key={ruleId}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                        >
                          <td className="py-3.5 px-4">
                            <span className="font-mono font-bold text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-700 dark:text-slate-300">
                              #{rule.priority}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {rule.name}
                            </div>
                            <div className="text-[11px] text-slate-400">ID: {ruleId}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              {rule.routingType === "direct" && "Direct User"}
                              {rule.routingType === "round_robin" && "Round-Robin"}
                              {rule.routingType === "fewest_open_leads" && "Fewest Open Leads"}
                              {rule.routingType === "pool" && "Unassigned Pool"}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs space-y-1">
                            {rule.conditions?.sources?.length > 0 && (
                              <div>
                                <span className="text-slate-400">Sources: </span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {rule.conditions.sources.join(", ")}
                                </span>
                              </div>
                            )}
                            {rule.conditions?.city && (
                              <div>
                                <span className="text-slate-400">City: </span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {rule.conditions.city}
                                </span>
                              </div>
                            )}
                            {rule.conditions?.tags?.length > 0 && (
                              <div>
                                <span className="text-slate-400">Tags: </span>
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {rule.conditions.tags.join(", ")}
                                </span>
                              </div>
                            )}
                            {!rule.conditions?.sources?.length &&
                              !rule.conditions?.city &&
                              !rule.conditions?.tags?.length && (
                                <span className="text-slate-400 italic">Matches all leads</span>
                              )}
                          </td>
                          <td className="py-3.5 px-4 text-xs">
                            {rule.routingType === "direct" && (
                              <span>
                                {rule.targetUserId?.name || "Single Agent"}
                              </span>
                            )}
                            {(rule.routingType === "round_robin" ||
                              rule.routingType === "fewest_open_leads") && (
                              <span>
                                {rule.targetUserIds?.length
                                  ? `${rule.targetUserIds.length} agents in rotation`
                                  : rule.teamId?.name
                                  ? `Team: ${rule.teamId.name}`
                                  : "All active agents"}
                              </span>
                            )}
                            {rule.routingType === "pool" && (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">
                                Pool Fallback
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {canAssign ? (
                              <button
                                onClick={() => handleToggleRuleActive(rule)}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold transition ${
                                  rule.isActive
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                {rule.isActive ? "Active" : "Inactive"}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500">
                                {rule.isActive ? "Active" : "Inactive"}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {canAssign && (
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleMoveRule(index, "up")}
                                  disabled={index === 0}
                                  title="Move Up"
                                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                                >
                                  <MoveUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleMoveRule(index, "down")}
                                  disabled={index === rules.length - 1}
                                  title="Move Down"
                                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                                >
                                  <MoveDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleOpenEditRule(rule)}
                                  title="Edit Rule"
                                  className="p-1 text-slate-400 hover:text-indigo-600"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteRule(ruleId)}
                                  title="Delete Rule"
                                  className="p-1 text-slate-400 hover:text-rose-600"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SINGLE LEAD ASSIGN MODAL */}
      {singleAssignLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Reassign Lead Ownership
              </h3>
              <button
                onClick={() => setSingleAssignLead(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl space-y-1 text-sm">
              <div className="font-semibold text-slate-900 dark:text-white">
                {singleAssignLead.name}
              </div>
              <div className="text-xs text-slate-500">
                Phone: {singleAssignLead.phone} | Status: {singleAssignLead.status}
              </div>
              <div className="text-xs text-slate-500">
                Current Owner:{" "}
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {singleAssignLead.ownerId?.name || singleAssignLead.assignedTo || "Unassigned"}
                </span>
              </div>
            </div>

            <form onSubmit={handleAssignSingleLeadSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Accountable Staff Owner
                </label>
                <select
                  value={singleTargetOwnerId}
                  onChange={(e) => setSingleTargetOwnerId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="">Leave Unassigned (Send to Pool)</option>
                  {staffList
                    .filter((s) => s.isActive !== false)
                    .map((staff) => (
                      <option key={staff.id || staff._id} value={staff.id || staff._id}>
                        {staff.name} — {staff.role || "Agent"} ({staff.email})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Assigned Team (Optional)
                </label>
                <select
                  value={singleTargetTeamId}
                  onChange={(e) => setSingleTargetTeamId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="">No Team Assigned</option>
                  {teamList.map((team) => (
                    <option key={team._id || team.id} value={team._id || team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Reason for Ownership Change
                </label>
                <input
                  type="text"
                  placeholder="e.g., Lead reassignment per territory realignment"
                  value={singleReason}
                  onChange={(e) => setSingleReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSingleAssignLead(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSingle}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingSingle ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Confirm Assignment</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LEAD ASSIGNMENT HISTORY MODAL */}
      {historyLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Lead Assignment Audit Trail
                </h3>
                <p className="text-xs text-slate-500">
                  {historyLead.name} ({historyLead.phone})
                </p>
              </div>
              <button
                onClick={() => setHistoryLead(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
              {!historyLead.assignmentHistory?.length ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  No historical ownership events recorded for this lead.
                </div>
              ) : (
                historyLead.assignmentHistory.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-500">From:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {item.fromOwnerId?.name || "Unassigned"}
                        </span>
                        <ChevronRight className="w-3 h-3 text-slate-400" />
                        <span className="font-semibold text-slate-500">To:</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                          {item.toOwnerId?.name || "Unassigned"}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-semibold">Reason:</span> {item.reason || "Manual update"}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Triggered by: {item.assignedBy?.name || "System Rule"}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 text-right whitespace-nowrap">
                      {new Date(item.assignedAt || item.timestamp || Date.now()).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setHistoryLead(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT ASSIGNMENT RULE MODAL */}
      {isRuleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingRule ? "Edit Assignment Rule" : "Create New Assignment Rule"}
              </h3>
              <button
                onClick={() => setIsRuleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRuleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    Rule Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Website Facebook Inquiries"
                    value={ruleFormData.name}
                    onChange={(e) => setRuleFormData({ ...ruleFormData, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    Evaluation Priority
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ruleFormData.priority}
                    onChange={(e) => setRuleFormData({ ...ruleFormData, priority: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                  Routing Strategy
                </label>
                <select
                  value={ruleFormData.routingType}
                  onChange={(e) => setRuleFormData({ ...ruleFormData, routingType: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="round_robin">Round-Robin Rotation (Equal Distribution)</option>
                  <option value="fewest_open_leads">Fewest Open Leads (Workload Balancing)</option>
                  <option value="direct">Direct Specific Staff Agent</option>
                  <option value="pool">Unassigned Pool Fallback</option>
                </select>
              </div>

              {ruleFormData.routingType === "direct" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    Target Staff Agent
                  </label>
                  <select
                    value={ruleFormData.targetUserId}
                    onChange={(e) => setRuleFormData({ ...ruleFormData, targetUserId: e.target.value })}
                    required
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  >
                    <option value="">Select Staff...</option>
                    {staffList
                      .filter((s) => s.isActive !== false)
                      .map((staff) => (
                        <option key={staff.id || staff._id} value={staff.id || staff._id}>
                          {staff.name} ({staff.role || "Agent"})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                  Target Team Filter (Optional)
                </label>
                <select
                  value={ruleFormData.teamId}
                  onChange={(e) => setRuleFormData({ ...ruleFormData, teamId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="">All Teams (Entire Tenant Staff)</option>
                  {teamList.map((team) => (
                    <option key={team._id || team.id} value={team._id || team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Matching Criteria
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                      Lead Sources (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., website, google_ads, meta"
                      value={ruleFormData.sources}
                      onChange={(e) => setRuleFormData({ ...ruleFormData, sources: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                      City Match (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Mumbai, Delhi"
                      value={ruleFormData.city}
                      onChange={(e) => setRuleFormData({ ...ruleFormData, city: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="ruleActiveCheck"
                  checked={ruleFormData.isActive}
                  onChange={(e) => setRuleFormData({ ...ruleFormData, isActive: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="ruleActiveCheck" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Rule is active and enabled for live lead ingestion
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRuleModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRule}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingRule ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Rule</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STAFF DEACTIVATION REASSIGNMENT WIZARD MODAL */}
      {isMigrationWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-600" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Staff Offboarding & Reassignment Wizard
                </h3>
              </div>
              <button
                onClick={() => setIsMigrationWizardOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              When an agent or sales rep departs or is deactivated, their active open leads can be systematically transferred to prevent abandoned inquiries.
            </p>

            <form onSubmit={handleMigrationSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Select Staff Member to Offboard / Deactivate
                </label>
                <select
                  value={selectedStaffForMigration}
                  onChange={(e) => handleSelectStaffForMigration(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                >
                  <option value="">Select Staff Member...</option>
                  {staffList.map((staff) => (
                    <option key={staff.id || staff._id} value={staff.id || staff._id}>
                      {staff.name} ({staff.email}) — Status: {staff.isActive === false ? "Inactive" : "Active"}
                    </option>
                  ))}
                </select>
              </div>

              {selectedStaffForMigration && (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800/60 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Open Leads Requiring Reassignment
                    </div>
                    <div className="text-2xl font-bold text-amber-900 dark:text-amber-200 mt-0.5">
                      {migrationOpenLeadsCount !== null ? migrationOpenLeadsCount : "Checking..."}
                    </div>
                  </div>
                  <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                </div>
              )}

              {selectedStaffForMigration && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Lead Reassignment Destination
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                        migrationDestination === "pool"
                          ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30"
                          : "border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="migrationDest"
                        value="pool"
                        checked={migrationDestination === "pool"}
                        onChange={() => setMigrationDestination("pool")}
                        className="sr-only"
                      />
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        Send to Unassigned Pool
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Leads land in general pool for manual or rule reallocation.
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                        migrationDestination === "agent"
                          ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/30"
                          : "border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="migrationDest"
                        value="agent"
                        checked={migrationDestination === "agent"}
                        onChange={() => setMigrationDestination("agent")}
                        className="sr-only"
                      />
                      <div className="text-xs font-bold text-slate-900 dark:text-white">
                        Transfer to Specific Agent
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Directly assign all open leads to another active agent.
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {migrationDestination === "agent" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                    Select Target Replacement Agent
                  </label>
                  <select
                    value={migrationTargetOwnerId}
                    onChange={(e) => setMigrationTargetOwnerId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  >
                    <option value="">Select Replacement Staff...</option>
                    {staffList
                      .filter((s) => (s.id || s._id) !== selectedStaffForMigration && s.isActive !== false)
                      .map((staff) => (
                        <option key={staff.id || staff._id} value={staff.id || staff._id}>
                          {staff.name} ({staff.role || "Agent"})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsMigrationWizardOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMigration || !selectedStaffForMigration}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingMigration ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing Migration...</span>
                    </>
                  ) : (
                    <span>Execute Reassignment & Deactivate</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
