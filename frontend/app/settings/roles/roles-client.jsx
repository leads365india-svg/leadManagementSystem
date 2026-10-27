"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Plus,
  Search,
  Users,
  Edit3,
  Trash2,
  Lock,
  Unlock,
  Check,
  X,
  AlertCircle,
  RefreshCw,
  Eye,
  Settings,
  ChevronRight,
  UserCheck,
  ArrowRight,
  Layers,
  Sparkles,
  Info,
} from "lucide-react"

export default function RolesClient() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [roles, setRoles] = useState([])
  const [ceiling, setCeiling] = useState([])
  const [availableModules, setAvailableModules] = useState([])
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all") // "all" | "system" | "custom"

  // Selected role for editing permissions
  const [activeRole, setActiveRole] = useState(null)
  const [isPermModalOpen, setIsPermModalOpen] = useState(false)
  const [editedPermissions, setEditedPermissions] = useState([])

  // Create role modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createFormData, setCreateFormData] = useState({
    name: "",
    slug: "",
    description: "",
    template: "agent",
    permissions: [],
  })

  // Delete confirmation
  const [roleToDelete, setRoleToDelete] = useState(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Check if current user can manage roles
  const canManageRoles = useMemo(() => {
    if (!user) return false
    if (user.role === "super_admin" || user.role === "account_admin") return true
    const perms = user.permissions || []
    return perms.includes("roles.manage")
  }, [user])

  // Fetch roles and available permissions
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [rolesRes, permsRes] = await Promise.all([
        apiClient.getRoles().catch((err) => ({ error: err.message })),
        apiClient.getAvailableRolePermissions().catch((err) => ({ error: err.message })),
      ])

      if (rolesRes?.success) {
        setRoles(rolesRes.data.roles || [])
        setCeiling(rolesRes.data.ceiling || [])
      } else if (rolesRes?.error) {
        toast.error(`Roles: ${rolesRes.error}`)
      }

      if (permsRes?.success) {
        setAvailableModules(permsRes.data.modules || [])
        if (!rolesRes?.data?.ceiling && permsRes.data.ceiling) {
          setCeiling(permsRes.data.ceiling)
        }
      }
    } catch (err) {
      console.error("Fetch roles error:", err)
      toast.error("Failed to load role definitions")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filtered roles
  const filteredRoles = useMemo(() => {
    return roles.filter((role) => {
      const matchesSearch =
        search.trim() === "" ||
        role.name.toLowerCase().includes(search.toLowerCase()) ||
        role.slug.toLowerCase().includes(search.toLowerCase()) ||
        (role.description && role.description.toLowerCase().includes(search.toLowerCase()))

      const matchesType =
        typeFilter === "all" ||
        (typeFilter === "system" && role.isSystem) ||
        (typeFilter === "custom" && !role.isSystem)

      return matchesSearch && matchesType
    })
  }, [roles, search, typeFilter])

  // Quick stats
  const stats = useMemo(() => {
    const total = roles.length
    const system = roles.filter((r) => r.isSystem).length
    const custom = roles.filter((r) => !r.isSystem).length
    const totalAssignedStaff = roles.reduce((acc, r) => acc + (r.assignedStaffCount || 0), 0)
    return { total, system, custom, totalAssignedStaff }
  }, [roles])

  // Open permission editing modal
  const handleOpenPermModal = (role) => {
    setActiveRole(role)
    setEditedPermissions([...(role.permissions || [])])
    setIsPermModalOpen(true)
  }

  // Toggle single permission key
  const handleTogglePermission = (key) => {
    setEditedPermissions((prev) => {
      if (prev.includes(key)) {
        return prev.filter((p) => p !== key)
      } else {
        return [...prev, key]
      }
    })
  }

  // Segmented scope change helper (e.g. leads.view: none | own | team | all)
  const handleScopeChange = (resource, action, newScope) => {
    const prefix = `${resource}.${action}`
    const scopeKeys = [`${prefix}.own`, `${prefix}.team`, `${prefix}.all`, prefix]

    setEditedPermissions((prev) => {
      // Remove all existing scope variants for this resource action
      const filtered = prev.filter((p) => !scopeKeys.includes(p))
      if (newScope === "none") {
        return filtered
      }
      return [...filtered, `${prefix}.${newScope}`]
    })
  }

  // Determine current active scope for a resource action
  const getSelectedScope = (resource, action, currentPerms) => {
    const prefix = `${resource}.${action}`
    if (currentPerms.includes(`${prefix}.all`) || currentPerms.includes(prefix)) return "all"
    if (currentPerms.includes(`${prefix}.team`)) return "team"
    if (currentPerms.includes(`${prefix}.own`)) return "own"
    return "none"
  }

  // Save updated permissions for the active role
  const handleSavePermissions = async () => {
    if (!activeRole) return
    try {
      setSaving(true)
      const res = await apiClient.updateRole(activeRole.id || activeRole._id, {
        permissions: editedPermissions,
      })

      if (res.success) {
        toast.success(`Updated permissions for "${activeRole.name}"`)
        setIsPermModalOpen(false)
        await fetchData()
      } else {
        toast.error(res.error || "Failed to update permissions")
      }
    } catch (err) {
      toast.error(err.message || "An error occurred while saving")
    } finally {
      setSaving(false)
    }
  }

  // Open Create Role Modal
  const handleOpenCreateModal = () => {
    // Default template permissions from Agent
    const agentRole = roles.find((r) => r.slug === "agent")
    setCreateFormData({
      name: "",
      slug: "",
      description: "",
      template: "agent",
      permissions: agentRole ? [...agentRole.permissions] : ["dashboard.view", "leads.view.own"],
    })
    setIsCreateModalOpen(true)
  }

  // Handle template change in create modal
  const handleTemplateChange = (templateSlug) => {
    let perms = []
    if (templateSlug === "blank") {
      perms = ["dashboard.view"]
    } else {
      const templateRole = roles.find((r) => r.slug === templateSlug)
      if (templateRole) {
        perms = [...templateRole.permissions]
      }
    }
    setCreateFormData((prev) => ({
      ...prev,
      template: templateSlug,
      permissions: perms,
    }))
  }

  // Auto-slugify role name
  const handleNameChange = (name) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    setCreateFormData((prev) => ({
      ...prev,
      name,
      slug: prev.slug === "" || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ? slug : prev.slug,
    }))
  }

  // Submit new role
  const handleCreateRole = async (e) => {
    e.preventDefault()
    if (!createFormData.name.trim() || !createFormData.slug.trim()) {
      toast.error("Role name and unique slug are required")
      return
    }

    try {
      setSaving(true)
      const res = await apiClient.createRole({
        name: createFormData.name.trim(),
        slug: createFormData.slug.trim(),
        description: createFormData.description.trim(),
        permissions: createFormData.permissions,
      })

      if (res.success) {
        toast.success(`Role "${createFormData.name}" created successfully`)
        setIsCreateModalOpen(false)
        await fetchData()
      } else {
        toast.error(res.error || "Failed to create role")
      }
    } catch (err) {
      toast.error(err.message || "Failed to create role")
    } finally {
      setSaving(false)
    }
  }

  // Handle delete role confirmation
  const handleDeleteRole = async () => {
    if (!roleToDelete) return
    try {
      setSaving(true)
      const res = await apiClient.deleteRole(roleToDelete.id || roleToDelete._id)
      if (res.success) {
        toast.success(`Role "${roleToDelete.name}" deleted successfully`)
        setIsDeleteModalOpen(false)
        setRoleToDelete(null)
        await fetchData()
      } else {
        toast.error(res.error || "Cannot delete role")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete role")
    } finally {
      setSaving(false)
    }
  }

  // Check ceiling coverage helper
  const isCoveredByCeiling = (permKey) => {
    if (!ceiling || ceiling.length === 0) return true
    if (ceiling.includes(permKey)) return true
    if (permKey.endsWith(".own") && (ceiling.includes(permKey.replace(".own", ".all")) || ceiling.includes(permKey.replace(".own", ".team")) || ceiling.includes(permKey.replace(".own", "")))) return true
    if (permKey.endsWith(".team") && (ceiling.includes(permKey.replace(".team", ".all")) || ceiling.includes(permKey.replace(".team", "")))) return true
    return false
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              Roles & Scoped Permissions
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure tenant security roles, granular resource actions, and own / team / all access boundaries.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            title="Refresh Role Definitions"
            className="p-2.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:shadow-sm transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          {canManageRoles && (
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow-indigo-500/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create Custom Role</span>
            </button>
          )}
        </div>
      </div>

      {/* Access Warning if user is not authorized */}
      {!canManageRoles && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong className="font-semibold">Read-Only View:</strong> You do not possess the{" "}
            <code className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-xs">roles.manage</code>{" "}
            permission. You can inspect roles and permissions, but modifications are restricted to Account Administrators.
          </div>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Defined Roles</div>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-cyan-50 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400 rounded-xl">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.system}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">System Roles</div>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-xl">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.custom}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Custom Roles</div>
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3.5">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalAssignedStaff}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Staff Members Assigned</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles by name, slug, or keywords..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Filter:</span>
          <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-900 rounded-xl text-xs font-medium">
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                typeFilter === "all"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              All Roles ({roles.length})
            </button>
            <button
              onClick={() => setTypeFilter("system")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                typeFilter === "system"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              System ({roles.filter((r) => r.isSystem).length})
            </button>
            <button
              onClick={() => setTypeFilter("custom")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                typeFilter === "custom"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              Custom ({roles.filter((r) => !r.isSystem).length})
            </button>
          </div>
        </div>
      </div>

      {/* Roles Grid / Table */}
      <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3.5 px-6 font-semibold">Role Name & Identifier</th>
                <th className="py-3.5 px-4 font-semibold">Classification</th>
                <th className="py-3.5 px-4 font-semibold">Assigned Staff</th>
                <th className="py-3.5 px-4 font-semibold">Permissions & Scopes</th>
                <th className="py-3.5 px-6 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading roles and permissions...
                  </td>
                </tr>
              ) : filteredRoles.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-slate-500">
                    <Shield className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                    <p className="font-medium text-slate-700 dark:text-slate-300">No roles match your filter.</p>
                    <p className="text-xs text-slate-400 mt-1">Try resetting search keywords or create a new custom role.</p>
                  </td>
                </tr>
              ) : (
                filteredRoles.map((role) => {
                  const permCount = role.permissions?.length || 0
                  const leadsScope = getSelectedScope("leads", "view", role.permissions || [])
                  const followupsScope = getSelectedScope("followups", "view", role.permissions || [])
                  const callsScope = getSelectedScope("calls", "view", role.permissions || [])

                  return (
                    <tr
                      key={role.id || role._id || role.slug}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-start gap-3">
                          <div
                            className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                              role.isSystem
                                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400"
                                : "bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400"
                            }`}
                          >
                            <Shield className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                              {role.name}
                              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {role.slug}
                              </code>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                              {role.description || "No description provided."}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        {role.isSystem ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            <Lock className="w-3 h-3" />
                            System Role
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            <Sparkles className="w-3 h-3" />
                            Custom Role
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4">
                        <Link
                          href={`/settings/staff?role=${role.slug}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 group"
                        >
                          <Users className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600" />
                          <span>
                            <strong>{role.assignedStaffCount || 0}</strong> staff
                          </span>
                          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                            {permCount} permissions
                          </span>

                          {leadsScope !== "none" && (
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                leadsScope === "all"
                                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                  : leadsScope === "team"
                                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                    : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              }`}
                            >
                              Leads: {leadsScope}
                            </span>
                          )}

                          {followupsScope !== "none" && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              Followups: {followupsScope}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenPermModal(role)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>{role.slug === "account_admin" ? "View Matrix" : "Configure"}</span>
                          </button>

                          {!role.isSystem && canManageRoles && (
                            <button
                              onClick={() => {
                                setRoleToDelete(role)
                                setIsDeleteModalOpen(true)
                              }}
                              disabled={role.assignedStaffCount > 0}
                              title={
                                role.assignedStaffCount > 0
                                  ? `Cannot delete role with ${role.assignedStaffCount} assigned staff members`
                                  : "Delete Role"
                              }
                              className={`p-1.5 rounded-lg transition-colors ${
                                role.assignedStaffCount > 0
                                  ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                  : "text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              }`}
                            >
                              <Trash2 className="w-4 h-4" />
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
      </div>

      {/* MODAL 1: Configure Permissions & Scopes Drawer */}
      {isPermModalOpen && activeRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheck className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Permissions Matrix: {activeRole.name}</span>
                    {activeRole.isSystem && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                        System
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeRole.slug === "account_admin"
                      ? "Account Admin holds full tenant administrator permissions dynamically synchronized with account tier capabilities."
                      : "Define granular actions and own / team / all visibility scopes for this role."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPermModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Scopes & Module Permissions */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Account Admin notice */}
              {activeRole.slug === "account_admin" && (
                <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 flex items-start gap-3">
                  <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <strong>Super Admin Ceiling Synchronized:</strong> As the root tenant role, Account Admin
                    inherits all permissions granted by the platform tier. To expand capabilities across your
                    organization, contact your platform administrator.
                  </div>
                </div>
              )}

              {/* Scoped Resources Section (Leads, Followups, Calls) */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5" />
                  Data Visibility & Ownership Scopes
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Leads View Scope */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Leads Visibility
                    </div>
                    <div className="text-[11px] text-slate-500 mb-2.5">
                      Determines which leads this role can search and inspect.
                    </div>
                    <div className="grid grid-cols-4 gap-1 p-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-center font-medium">
                      {["none", "own", "team", "all"].map((scope) => {
                        const isSelected = getSelectedScope("leads", "view", editedPermissions) === scope
                        return (
                          <button
                            key={scope}
                            disabled={!canManageRoles || activeRole.slug === "account_admin"}
                            onClick={() => handleScopeChange("leads", "view", scope)}
                            className={`py-1 rounded capitalize transition-all ${
                              isSelected
                                ? "bg-indigo-600 text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            }`}
                          >
                            {scope}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Followups View Scope */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Follow-ups Access
                    </div>
                    <div className="text-[11px] text-slate-500 mb-2.5">
                      Scope for reminders, callbacks, and tasks.
                    </div>
                    <div className="grid grid-cols-4 gap-1 p-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-center font-medium">
                      {["none", "own", "team", "all"].map((scope) => {
                        const isSelected = getSelectedScope("followups", "view", editedPermissions) === scope
                        return (
                          <button
                            key={scope}
                            disabled={!canManageRoles || activeRole.slug === "account_admin"}
                            onClick={() => {
                              handleScopeChange("followups", "view", scope)
                              if (scope !== "none") {
                                handleScopeChange("followups", "manage", scope)
                              }
                            }}
                            className={`py-1 rounded capitalize transition-all ${
                              isSelected
                                ? "bg-indigo-600 text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            }`}
                          >
                            {scope}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Calls View Scope */}
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Calls & Activity
                    </div>
                    <div className="text-[11px] text-slate-500 mb-2.5">
                      Scope for call logs and telephony timeline.
                    </div>
                    <div className="grid grid-cols-4 gap-1 p-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-center font-medium">
                      {["none", "own", "team", "all"].map((scope) => {
                        const isSelected = getSelectedScope("calls", "view", editedPermissions) === scope
                        return (
                          <button
                            key={scope}
                            disabled={!canManageRoles || activeRole.slug === "account_admin"}
                            onClick={() => handleScopeChange("calls", "view", scope)}
                            className={`py-1 rounded capitalize transition-all ${
                              isSelected
                                ? "bg-indigo-600 text-white font-semibold shadow-xs"
                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            }`}
                          >
                            {scope}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Module-by-Module Permission Checkboxes */}
              <div className="space-y-5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Granular Module Permissions
                </h4>

                {availableModules.map((grp) => {
                  return (
                    <div
                      key={grp.module}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                    >
                      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                          {grp.label || grp.module}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {grp.permissions.filter((p) => editedPermissions.includes(p.key)).length} /{" "}
                          {grp.permissions.length} granted
                        </span>
                      </div>

                      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {grp.permissions.map((perm) => {
                          const isChecked = editedPermissions.includes(perm.key)
                          const isAllowedByCeiling = isCoveredByCeiling(perm.key)

                          return (
                            <label
                              key={perm.key}
                              className={`flex items-start gap-2.5 p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                                isChecked
                                  ? "bg-indigo-50/70 dark:bg-indigo-950/40 text-slate-900 dark:text-white"
                                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                              } ${!isAllowedByCeiling ? "opacity-60" : ""}`}
                            >
                              <input
                                type="checkbox"
                                disabled={
                                  !canManageRoles ||
                                  activeRole.slug === "account_admin" ||
                                  !isAllowedByCeiling
                                }
                                checked={isChecked}
                                onChange={() => handleTogglePermission(perm.key)}
                                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <div className="flex-1">
                                <div className="font-semibold flex items-center gap-1.5">
                                  <span>{perm.label}</span>
                                  {perm.scope && (
                                    <span className="text-[10px] uppercase font-mono px-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                      {perm.scope}
                                    </span>
                                  )}
                                  {!isAllowedByCeiling && (
                                    <span className="text-[10px] font-medium text-rose-500">
                                      (Tier Locked)
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                                  {perm.description}
                                </p>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/30">
              <span className="text-xs text-slate-500">
                <strong>{editedPermissions.length}</strong> permissions active
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPermModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Close
                </button>

                {canManageRoles && activeRole.slug !== "account_admin" && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSavePermissions}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>Save Role Permissions</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Create Custom Role */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                  <Plus className="w-5 h-5" />
                </span>
                <h3 className="font-semibold text-slate-900 dark:text-white">Create Custom Role</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRole} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Role Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={createFormData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Senior Closer / Lead Qualifier"
                  className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Unique Slug Identifier <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={createFormData.slug}
                  onChange={(e) =>
                    setCreateFormData({
                      ...createFormData,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                    })
                  }
                  placeholder="senior-closer"
                  className="w-full text-sm font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Lowercase letters, digits, and hyphens only. Permanent identifier used in authorization.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows="2"
                  value={createFormData.description}
                  onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                  placeholder="Summarize the operational responsibilities and scope of this role..."
                  className="w-full text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Initial Permissions Template
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "agent", label: "Agent Baseline", desc: "Own-scoped leads & calls" },
                    { id: "manager", label: "Manager Baseline", desc: "Team-scoped leads & stats" },
                    { id: "viewer", label: "Viewer Baseline", desc: "Read-only team access" },
                    { id: "blank", label: "Blank (Minimal)", desc: "Dashboard overview only" },
                  ].map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleTemplateChange(tpl.id)}
                      className={`p-2.5 text-left rounded-xl border transition-all text-xs ${
                        createFormData.template === tpl.id
                          ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-slate-900 dark:text-white font-semibold"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <div className="font-semibold">{tpl.label}</div>
                      <div className="text-[11px] text-slate-400 font-normal">{tpl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
                >
                  {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Role</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Delete Role Confirmation */}
      {isDeleteModalOpen && roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-850 rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <span className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60">
                <Trash2 className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Delete Custom Role</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300">
              Are you sure you want to delete role <strong>"{roleToDelete.name}"</strong> (
              <code>{roleToDelete.slug}</code>)? Any staff members previously assigned to this role must have a
              different role assigned.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false)
                  setRoleToDelete(null)
                }}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleDeleteRole}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
              >
                {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
