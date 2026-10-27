"use client"

import React, { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import {
  Users,
  UserPlus,
  Shield,
  Phone,
  Mail,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  MoreVertical,
  Edit2,
  Key,
  Copy,
  Check,
  UserCheck,
  UserX,
  Layers,
  ArrowRight,
  X,
  ExternalLink,
  Sliders,
  Briefcase,
} from "lucide-react"

export default function StaffClient() {
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState([])
  const [teams, setTeams] = useState([])
  const [availableRoles, setAvailableRoles] = useState([])
  const [stats, setStats] = useState({
    totalStaff: 0,
    activeCount: 0,
    agentsCount: 0,
    managersCount: 0,
  })

  // Filters
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [teamFilter, setTeamFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false)
  const [isTeamsModalOpen, setIsTeamsModalOpen] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [generatedInvite, setGeneratedInvite] = useState(null)
  const [generatedResetUrl, setGeneratedResetUrl] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "agent",
    teamId: "",
    maxOpenLeads: 50,
  })

  const [teamFormData, setTeamFormData] = useState({
    name: "",
    description: "",
    managerId: "",
  })

  // Fetch staff and teams
  const fetchStaffData = useCallback(async () => {
    try {
      setLoading(true)
      const [staffRes, teamsRes, rolesRes] = await Promise.all([
        apiClient.getStaff({
          search,
          role: roleFilter,
          teamId: teamFilter,
          status: statusFilter,
        }),
        apiClient.getTeams().catch(() => ({ data: [] })),
        apiClient.getRoles().catch(() => ({ data: { roles: [] } })),
      ])

      if (staffRes.success) {
        setStaff(staffRes.data.staff || [])
        setStats(
          staffRes.data.stats || {
            totalStaff: staffRes.data.staff?.length || 0,
            activeCount: staffRes.data.staff?.filter((s) => s.isActive).length || 0,
            agentsCount: staffRes.data.staff?.filter((s) => s.role === "agent").length || 0,
            managersCount: staffRes.data.staff?.filter((s) => s.role === "manager").length || 0,
          }
        )
      }

      if (teamsRes.success) {
        setTeams(teamsRes.data || [])
      }

      if (rolesRes.success && rolesRes.data?.roles) {
        setAvailableRoles(rolesRes.data.roles)
      }
    } catch (err) {
      console.error("Failed to load staff:", err)
      toast.error(err.message || "Failed to load staff list")
    } finally {
      setLoading(false)
    }
  }, [search, roleFilter, teamFilter, statusFilter])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStaffData()
    }, 250)
    return () => clearTimeout(timer)
  }, [fetchStaffData])

  // Handle Create Staff
  const handleCreateStaff = async (e) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.email.trim()) {
      toast.error("Name and Email are required")
      return
    }

    try {
      setSubmitting(true)
      const res = await apiClient.createStaff({
        ...formData,
        teamId: formData.teamId || null,
      })

      if (res.success) {
        toast.success(`Staff member '${res.data.staff.name}' created!`)
        setGeneratedInvite(res.data)
        fetchStaffData()
      }
    } catch (err) {
      toast.error(err.message || "Failed to create staff member")
    } finally {
      setSubmitting(false)
    }
  }

  // Handle Edit Staff
  const handleUpdateStaff = async (e) => {
    e.preventDefault()
    if (!selectedStaff) return

    try {
      setSubmitting(true)
      const res = await apiClient.updateStaff(selectedStaff.id, {
        name: formData.name,
        phone: formData.phone,
        role: formData.role,
        teamId: formData.teamId || null,
        maxOpenLeads: formData.maxOpenLeads,
      })

      if (res.success) {
        toast.success("Staff member updated successfully")
        setIsEditModalOpen(false)
        setSelectedStaff(null)
        fetchStaffData()
      }
    } catch (err) {
      toast.error(err.message || "Failed to update staff member")
    } finally {
      setSubmitting(false)
    }
  }

  // Toggle Deactivate / Reactivate
  const handleToggleStatus = async (member) => {
    const actionName = member.isActive ? "deactivate" : "reactivate"
    if (!confirm(`Are you sure you want to ${actionName} ${member.name}?`)) return

    try {
      const res = await apiClient.toggleStaffStatus(member.id)
      if (res.success) {
        toast.success(res.message)
        fetchStaffData()
      }
    } catch (err) {
      toast.error(err.message || `Failed to ${actionName} staff member`)
    }
  }

  // Reset Password Trigger
  const handleResetPassword = async (member) => {
    try {
      setSubmitting(true)
      const res = await apiClient.resetStaffPassword(member.id)
      if (res.success) {
        setGeneratedResetUrl(res.data.resetUrl)
        setSelectedStaff(member)
        setIsResetModalOpen(true)
      }
    } catch (err) {
      toast.error(err.message || "Failed to generate password reset")
    } finally {
      setSubmitting(false)
    }
  }

  // Create Team
  const handleCreateTeam = async (e) => {
    e.preventDefault()
    if (!teamFormData.name.trim()) {
      toast.error("Team name is required")
      return
    }

    try {
      setSubmitting(true)
      const res = await apiClient.createTeam({
        name: teamFormData.name.trim(),
        description: teamFormData.description.trim(),
        managerId: teamFormData.managerId || null,
      })

      if (res.success) {
        toast.success(`Team '${res.data.name}' created successfully`)
        setTeamFormData({ name: "", description: "", managerId: "" })
        fetchStaffData()
      }
    } catch (err) {
      toast.error(err.message || "Failed to create team")
    } finally {
      setSubmitting(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    setCopiedLink(true)
    toast.success("Link copied to clipboard!")
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const openEditModal = (member) => {
    setSelectedStaff(member)
    setFormData({
      name: member.name,
      email: member.email,
      phone: member.phone || "",
      role: member.role,
      teamId: member.teamId || "",
      maxOpenLeads: member.maxOpenLeads || 50,
    })
    setIsEditModalOpen(true)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Staff & Agent Management</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold border border-indigo-200 dark:border-indigo-800">
              Phase 4 Core
            </span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage sales reps, team leads, department structures, and lead assignment capacity.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/settings/roles"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shadow-sm"
          >
            <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            Roles & Permissions
          </Link>

          <button
            onClick={() => setIsTeamsModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors shadow-sm"
          >
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Manage Teams ({teams.length})
          </button>

          <button
            onClick={() => {
              setGeneratedInvite(null)
              setFormData({
                name: "",
                email: "",
                phone: "",
                role: "agent",
                teamId: "",
                maxOpenLeads: 50,
              })
              setIsAddModalOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Staff Member
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Staff</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{stats.totalStaff || staff.length}</div>
          <div className="text-xs text-slate-500 mt-1">Configured CRM users</div>
        </div>

        <div className="bg-white dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Active Staff</span>
            <UserCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.activeCount}</div>
          <div className="text-xs text-emerald-600/80 mt-1">Ready to receive leads</div>
        </div>

        <div className="bg-white dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Agents</span>
            <Briefcase className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{stats.agentsCount}</div>
          <div className="text-xs text-slate-500 mt-1">Dialer & lead handlers</div>
        </div>

        <div className="bg-white dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Managers</span>
            <Shield className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{stats.managersCount}</div>
          <div className="text-xs text-slate-500 mt-1">Team supervisors</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone number..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Roles</option>
            {availableRoles.length > 0 ? (
              availableRoles.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))
            ) : (
              <>
                <option value="account_admin">Account Admin</option>
                <option value="manager">Manager</option>
                <option value="agent">Agent</option>
                <option value="viewer">Viewer</option>
              </>
            )}
          </select>

          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Teams</option>
            <option value="unassigned">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Deactivated Only</option>
          </select>

          <button
            onClick={fetchStaffData}
            title="Refresh List"
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Max Capacity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Last Active</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && staff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading staff members...
                  </td>
                </tr>
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Users className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                    No staff members match the selected criteria.
                  </td>
                </tr>
              ) : (
                staff.map((member) => {
                  const roleBadgeStyles = {
                    account_admin: "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
                    manager: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
                    agent: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
                  }

                  const roleLabels = {
                    account_admin: "Account Admin",
                    manager: "Manager",
                    agent: "Agent",
                  }

                  const initials = member.name
                    ? member.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()
                    : "??"

                  return (
                    <tr
                      key={member.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold text-xs flex items-center justify-center border border-indigo-200 dark:border-indigo-800">
                            {initials}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900 dark:text-white">{member.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{member.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs font-mono">
                        {member.phone || <span className="text-slate-400">—</span>}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${
                            roleBadgeStyles[member.role] || "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {member.role === "account_admin" && <Shield className="w-3 h-3" />}
                          {member.role === "manager" && <Briefcase className="w-3 h-3" />}
                          {member.role === "agent" && <UserCheck className="w-3 h-3" />}
                          {roleLabels[member.role] || member.role}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-xs">
                        {member.teamName && member.teamName !== "Unassigned" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <Layers className="w-3 h-3 text-indigo-500" />
                            {member.teamName}
                          </span>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs font-medium">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {member.maxOpenLeads} leads
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {member.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-medium border border-rose-200 dark:border-rose-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            Deactivated
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-500">
                        {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleDateString() : "Never"}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(member)}
                            title="Edit Staff Member"
                            className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleResetPassword(member)}
                            title="Reset Password"
                            className="p-1.5 text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleToggleStatus(member)}
                            title={member.isActive ? "Deactivate Account" : "Reactivate Account"}
                            className={`p-1.5 rounded-md transition-colors ${
                              member.isActive
                                ? "text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                : "text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            }`}
                          >
                            {member.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
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
      </div>

      {/* MODAL 1: Add Staff Member */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Add Staff Member</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {generatedInvite ? (
              <div className="p-6 space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    Staff Member Created Successfully!
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                    An activation link has been generated. Share this one-time link with{" "}
                    <strong>{generatedInvite.staff.name}</strong> so they can set their password and start handling leads.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    One-Time Set Password Link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={generatedInvite.inviteUrl}
                      className="flex-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-mono text-slate-700 dark:text-slate-300 select-all"
                    />
                    <button
                      onClick={() => copyToClipboard(generatedInvite.inviteUrl)}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
                    >
                      {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedLink ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setIsAddModalOpen(false)
                      setGeneratedInvite(null)
                    }}
                    className="px-4 py-2 text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateStaff} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Alex Morgan"
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="alex@agency.com"
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Phone Number (for dialer & call match)
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+1 555-0199"
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Role <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {availableRoles.length > 0 ? (
                        availableRoles.map((r) => (
                          <option key={r.slug} value={r.slug}>
                            {r.name} {r.isSystem ? `(${r.slug === "account_admin" ? "Admin" : r.slug})` : "(Custom)"}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="agent">Agent (Sales Rep)</option>
                          <option value="manager">Manager (Team Lead)</option>
                          <option value="viewer">Viewer (Read Only)</option>
                          <option value="account_admin">Account Admin</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Department / Team
                    </label>
                    <select
                      value={formData.teamId}
                      onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
                      className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Unassigned</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Open Leads Capacity
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={formData.maxOpenLeads}
                    onChange={(e) => setFormData({ ...formData, maxOpenLeads: Number(e.target.value) || 0 })}
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
                    Used by automatic assignment rules to balance team workload.
                  </span>
                </div>

                <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {submitting ? "Creating..." : "Create & Generate Invite"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: Edit Staff Member */}
      {isEditModalOpen && selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Edit Staff Details</h3>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStaff} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Address (Read-only)
                </label>
                <input
                  type="email"
                  disabled
                  value={formData.email}
                  className="w-full text-sm bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 text-slate-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {availableRoles.length > 0 ? (
                      availableRoles.map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.name} {r.isSystem ? `(${r.slug === "account_admin" ? "Admin" : r.slug})` : "(Custom)"}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="agent">Agent</option>
                        <option value="manager">Manager</option>
                        <option value="viewer">Viewer</option>
                        <option value="account_admin">Account Admin</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Team / Department
                  </label>
                  <select
                    value={formData.teamId}
                    onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
                    className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Max Open Leads Capacity
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={formData.maxOpenLeads}
                  onChange={(e) => setFormData({ ...formData, maxOpenLeads: Number(e.target.value) || 0 })}
                  className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Reset Password Link */}
      {isResetModalOpen && selectedStaff && generatedResetUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
              <Key className="w-5 h-5 text-amber-500" />
              Password Reset Link Generated
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              A secure one-time password reset link has been created for <strong>{selectedStaff.name}</strong>. Share this link directly with them:
            </p>

            <div className="flex items-center gap-2">
              <input
                readOnly
                value={generatedResetUrl}
                className="flex-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-mono text-slate-700 dark:text-slate-300 select-all"
              />
              <button
                onClick={() => copyToClipboard(generatedResetUrl)}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedLink ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Teams Management */}
      {isTeamsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Teams & Departments</h3>
              </div>
              <button
                onClick={() => setIsTeamsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Create Team Form */}
              <form onSubmit={handleCreateTeam} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Create New Team
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Team Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={teamFormData.name}
                      onChange={(e) => setTeamFormData({ ...teamFormData, name: e.target.value })}
                      placeholder="e.g. Outbound Inquiries"
                      className="w-full text-xs bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Assign Team Lead / Manager
                    </label>
                    <select
                      value={teamFormData.managerId}
                      onChange={(e) => setTeamFormData({ ...teamFormData, managerId: e.target.value })}
                      className="w-full text-xs bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white"
                    >
                      <option value="">No Manager</option>
                      {staff
                        .filter((s) => s.role === "manager" || s.role === "account_admin")
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={teamFormData.description}
                    onChange={(e) => setTeamFormData({ ...teamFormData, description: e.target.value })}
                    placeholder="Brief description of department scope..."
                    className="w-full text-xs bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Add Team
                  </button>
                </div>
              </form>

              {/* Existing Teams List */}
              <div className="space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Active Teams ({teams.length})
                </div>
                {teams.length === 0 ? (
                  <div className="text-center py-6 text-sm text-slate-400">
                    No teams created yet. Use the form above to add your first sales squad.
                  </div>
                ) : (
                  teams.map((t) => (
                    <div
                      key={t.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                          {t.name}
                          <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {t.memberCount || 0} members
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Manager: {t.managerName || "None"} {t.description ? `• ${t.description}` : ""}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
