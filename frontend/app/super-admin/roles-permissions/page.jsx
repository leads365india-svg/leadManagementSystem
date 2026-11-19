"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Shield,
  Check,
  CheckSquare,
  Square,
  Save,
  RefreshCw,
  AlertCircle,
  Lock,
  Layers,
  ArrowLeft,
  Info,
  Users,
  UserPlus,
  Plus,
  Search,
  Edit2,
  Trash2,
  Key,
  Copy,
  Briefcase,
  UserCheck,
  Building,
  CheckCircle2,
  XCircle,
  X,
  ExternalLink,
} from "lucide-react"

export default function RolesPermissionsPage() {
  // Top-level View Tab: "ceiling" | "tenants"
  const [activeTab, setActiveTab] = useState("ceiling")

  // --- CEILING / ACCOUNT ADMIN PERMISSIONS STATE ---
  const [modules, setModules] = useState([])
  const [allowedPermissions, setAllowedPermissions] = useState([])
  const [selectedPermissions, setSelectedPermissions] = useState(new Set())
  const [initialPermissions, setInitialPermissions] = useState(new Set())
  const [updatedAt, setUpdatedAt] = useState(null)
  const [updatedBy, setUpdatedBy] = useState(null)

  const [loadingCeiling, setLoadingCeiling] = useState(true)
  const [savingCeiling, setSavingCeiling] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // --- TENANT CUSTOM ROLES & STAFF STATE ---
  const [accounts, setAccounts] = useState([])
  const [selectedTenantId, setSelectedTenantId] = useState("")
  const [selectedTenantAccount, setSelectedTenantAccount] = useState(null)
  const [tenantSubTab, setTenantSubTab] = useState("roles") // "roles" | "staff"
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [accountsError, setAccountsError] = useState(null)

  // Roles state for selected tenant
  const [tenantRoles, setTenantRoles] = useState([])
  const [loadingTenantRoles, setLoadingTenantRoles] = useState(false)
  const [tenantRolesError, setTenantRolesError] = useState(null)
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [roleFormData, setRoleFormData] = useState({
    name: "",
    slug: "",
    description: "",
    permissions: [],
  })
  const [savingRole, setSavingRole] = useState(false)

  // Staff state for selected tenant
  const [tenantStaff, setTenantStaff] = useState([])
  const [loadingTenantStaff, setLoadingTenantStaff] = useState(false)
  const [tenantStaffError, setTenantStaffError] = useState(null)
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false)
  const [staffFormData, setStaffFormData] = useState({
    name: "",
    email: "",
    phone: "",
    role: "agent",
    maxOpenLeads: 50,
    temporaryPassword: "",
  })
  const [savingStaff, setSavingStaff] = useState(false)
  const [resetModalData, setResetModalData] = useState(null) // { staff, resetUrl }
  const [copiedLink, setCopiedLink] = useState(false)

  // -------------------------------------------------------------
  // 1. CEILING / PERMISSIONS HANDLERS
  // -------------------------------------------------------------
  const loadPermissions = useCallback(async () => {
    try {
      setLoadingCeiling(true)
      setLoadError(null)
      const res = await apiClient.getPermissions()

      if (res.success && res.data) {
        setModules(res.data.modules || [])
        setAllowedPermissions(res.data.allowedPermissions || [])
        const active = new Set(res.data.activePermissions || [])
        setSelectedPermissions(active)
        setInitialPermissions(new Set(active))
        setUpdatedAt(res.data.updatedAt)
        setUpdatedBy(res.data.updatedBy)
      } else {
        throw new Error(res.error || "Failed to load permissions configuration")
      }
    } catch (err) {
      console.error("Error loading permissions:", err)
      setLoadError(err.message || "Failed to load roles and permissions configuration")
    } finally {
      setLoadingCeiling(false)
    }
  }, [])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  const togglePermission = useCallback((key) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleModulePermissions = useCallback((modulePermissions) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      const allActive = modulePermissions.every((p) => next.has(p.key))
      if (allActive) {
        modulePermissions.forEach((p) => next.delete(p.key))
      } else {
        modulePermissions.forEach((p) => next.add(p.key))
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPermissions(new Set(allowedPermissions))
  }, [allowedPermissions])

  const deselectAll = useCallback(() => {
    setSelectedPermissions(new Set())
  }, [])

  const resetToSaved = useCallback(() => {
    setSelectedPermissions(new Set(initialPermissions))
    toast("Reset changes to last saved state", { icon: "↩️" })
  }, [initialPermissions])

  const hasChanges = useMemo(() => {
    if (selectedPermissions.size !== initialPermissions.size) return true
    for (const key of selectedPermissions) {
      if (!initialPermissions.has(key)) return true
    }
    return false
  }, [selectedPermissions, initialPermissions])

  const handleSaveCeiling = async () => {
    try {
      setSavingCeiling(true)
      const permArray = Array.from(selectedPermissions)
      const res = await apiClient.updatePermissions(permArray)

      if (res.success && res.data) {
        const active = new Set(res.data.activePermissions || permArray)
        setSelectedPermissions(active)
        setInitialPermissions(new Set(active))
        setUpdatedAt(res.data.updatedAt || new Date().toISOString())
        setUpdatedBy(res.data.updatedBy || "super_admin")
        toast.success("Roles & Permissions configuration saved successfully!")
      } else {
        throw new Error(res.error || "Failed to save permissions")
      }
    } catch (err) {
      console.error("Save error:", err)
      toast.error(err.message || "Failed to save permissions")
    } finally {
      setSavingCeiling(false)
    }
  }

  // -------------------------------------------------------------
  // 2. TENANT ACCOUNTS & SELECTOR HANDLERS
  // -------------------------------------------------------------
  const loadAccounts = useCallback(async () => {
    try {
      setLoadingAccounts(true)
      setAccountsError(null)
      const accountsRes = await apiClient.getSuperAdminAccounts({ limit: 100, status: "all" })
      const rawAccounts = accountsRes?.data?.accounts || accountsRes?.accounts || (Array.isArray(accountsRes) ? accountsRes : [])
      const accountsList = Array.isArray(rawAccounts) ? rawAccounts : []
      setAccounts(accountsList)

      if (accountsList.length > 0) {
        setSelectedTenantId((prevId) => {
          const matched = accountsList.find((a) => (a.tenantId || a.accountId) === prevId)
          if (prevId && matched) {
            setSelectedTenantAccount(matched)
            return prevId
          }
          const first = accountsList[0]
          const firstId = first.tenantId || first.accountId || first.id || ""
          setSelectedTenantAccount(first)
          return firstId
        })
      } else {
        setSelectedTenantId("")
        setSelectedTenantAccount(null)
      }
    } catch (err) {
      console.error("Error loading accounts for tenant management:", err)
      const errMsg = err.message || "Failed to load tenant accounts"
      setAccountsError(errMsg)
      toast.error(errMsg)
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === "tenants") {
      loadAccounts()
    }
  }, [activeTab, loadAccounts])

  const handleSelectTenant = (tenantOrAccountId) => {
    setSelectedTenantId(tenantOrAccountId)
    const acc = accounts.find((a) => (a.tenantId || a.accountId) === tenantOrAccountId) || null
    setSelectedTenantAccount(acc)
  }

  // Load roles & staff when selectedTenantId changes
  const loadTenantRoles = useCallback(async (tId) => {
    if (!tId) {
      setTenantRoles([])
      return
    }
    try {
      setLoadingTenantRoles(true)
      setTenantRolesError(null)
      const res = await apiClient.getRoles({ tenantId: tId })
      if (res && res.success !== false) {
        const rawRoles = res?.data?.roles || res?.roles || (Array.isArray(res) ? res : [])
        const rolesList = Array.isArray(rawRoles) ? rawRoles : []
        setTenantRoles(rolesList)
      } else {
        const errMsg = res?.error || res?.message || "Failed to load roles for selected tenant"
        setTenantRolesError(errMsg)
        setTenantRoles([])
        toast.error(errMsg)
      }
    } catch (err) {
      console.error("Failed to load tenant roles:", err)
      const errMsg = err.message || "Failed to load roles for selected tenant"
      setTenantRolesError(errMsg)
      setTenantRoles([])
      toast.error(errMsg)
    } finally {
      setLoadingTenantRoles(false)
    }
  }, [])

  const loadTenantStaff = useCallback(async (tId) => {
    if (!tId) {
      setTenantStaff([])
      return
    }
    try {
      setLoadingTenantStaff(true)
      setTenantStaffError(null)
      const res = await apiClient.getStaff({ tenantId: tId, limit: 100 })
      if (res && res.success !== false) {
        const rawStaff = res?.data?.staff || res?.staff || (Array.isArray(res) ? res : [])
        const staffList = Array.isArray(rawStaff) ? rawStaff : []
        setTenantStaff(staffList)
      } else {
        const errMsg = res?.error || res?.message || "Failed to load staff for selected tenant"
        setTenantStaffError(errMsg)
        setTenantStaff([])
        toast.error(errMsg)
      }
    } catch (err) {
      console.error("Failed to load tenant staff:", err)
      const errMsg = err.message || "Failed to load staff for selected tenant"
      setTenantStaffError(errMsg)
      setTenantStaff([])
      toast.error(errMsg)
    } finally {
      setLoadingTenantStaff(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === "tenants" && selectedTenantId) {
      loadTenantRoles(selectedTenantId)
      loadTenantStaff(selectedTenantId)
    }
  }, [activeTab, selectedTenantId, loadTenantRoles, loadTenantStaff])

  // -------------------------------------------------------------
  // 3. ROLE CREATION & MANAGEMENT (SUPER ADMIN ON BEHALF OF TENANT)
  // -------------------------------------------------------------
  const openCreateRoleModal = () => {
    setEditingRole(null)
    setRoleFormData({
      name: "",
      slug: "",
      description: "",
      permissions: ["leads.view.own", "leads.create", "calls.log"],
    })
    setIsRoleModalOpen(true)
  }

  const openEditRoleModal = (role) => {
    setEditingRole(role)
    setRoleFormData({
      name: role.name || "",
      slug: role.slug || "",
      description: role.description || "",
      permissions: role.permissions || [],
    })
    setIsRoleModalOpen(true)
  }

  const handleSaveRole = async (e) => {
    e.preventDefault()
    if (!roleFormData.name.trim()) {
      toast.error("Role name is required")
      return
    }
    if (!selectedTenantId) {
      toast.error("Please select a tenant account first")
      return
    }

    try {
      setSavingRole(true)
      if (editingRole) {
        // Update existing role
        const res = await apiClient.updateRole(editingRole.id || editingRole._id, {
          name: roleFormData.name.trim(),
          description: roleFormData.description.trim(),
          permissions: roleFormData.permissions,
        })
        if (res.success) {
          toast.success(`Role "${roleFormData.name}" updated successfully!`)
          setIsRoleModalOpen(false)
          loadTenantRoles(selectedTenantId)
        } else {
          toast.error(res.error || "Failed to update role")
        }
      } else {
        // Create new role
        const payload = {
          name: roleFormData.name.trim(),
          slug: roleFormData.slug.trim() || undefined,
          description: roleFormData.description.trim(),
          permissions: roleFormData.permissions,
          tenantId: selectedTenantId,
        }
        const res = await apiClient.createRole(payload)
        if (res.success) {
          toast.success(`Custom role "${roleFormData.name}" created successfully!`)
          setIsRoleModalOpen(false)
          loadTenantRoles(selectedTenantId)
        } else {
          toast.error(res.error || "Failed to create role")
        }
      }
    } catch (err) {
      toast.error(err.message || "Failed to save role")
    } finally {
      setSavingRole(false)
    }
  }

  const handleDeleteRole = async (role) => {
    if (role.isSystem) {
      toast.error("System roles cannot be deleted")
      return
    }
    if (role.assignedStaffCount > 0) {
      toast.error(`Cannot delete role: ${role.assignedStaffCount} staff members are assigned to it. Reassign them first.`)
      return
    }
    if (!confirm(`Are you sure you want to permanently delete custom role "${role.name}"?`)) {
      return
    }

    try {
      const res = await apiClient.deleteRole(role.id || role._id)
      if (res.success) {
        toast.success(`Role "${role.name}" deleted successfully`)
        loadTenantRoles(selectedTenantId)
      } else {
        toast.error(res.error || "Failed to delete role")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete role")
    }
  }

  const toggleRolePermission = (permKey) => {
    setRoleFormData((prev) => {
      const exists = prev.permissions.includes(permKey)
      const nextPerms = exists
        ? prev.permissions.filter((p) => p !== permKey)
        : [...prev.permissions, permKey]
      return { ...prev, permissions: nextPerms }
    })
  }

  // -------------------------------------------------------------
  // 4. STAFF CREATION & MANAGEMENT (SUPER ADMIN ON BEHALF OF TENANT)
  // -------------------------------------------------------------
  const openAddStaffModal = () => {
    setStaffFormData({
      name: "",
      email: "",
      phone: "",
      role: tenantRoles.length > 0 ? tenantRoles[0].slug : "agent",
      maxOpenLeads: 50,
      temporaryPassword: "",
    })
    setIsStaffModalOpen(true)
  }

  const handleSaveStaff = async (e) => {
    e.preventDefault()
    if (!staffFormData.name.trim()) {
      toast.error("Staff member name is required")
      return
    }
    if (!staffFormData.email.trim() || !staffFormData.email.includes("@")) {
      toast.error("Valid email address is required")
      return
    }
    if (!selectedTenantId) {
      toast.error("Please select a tenant account first")
      return
    }

    try {
      setSavingStaff(true)
      const payload = {
        name: staffFormData.name.trim(),
        email: staffFormData.email.trim().toLowerCase(),
        phone: staffFormData.phone.trim(),
        role: staffFormData.role,
        maxOpenLeads: Number(staffFormData.maxOpenLeads) || 50,
        temporaryPassword: staffFormData.temporaryPassword.trim() || undefined,
        tenantId: selectedTenantId,
      }
      const res = await apiClient.createStaff(payload)
      if (res.success) {
        toast.success(`Staff user "${staffFormData.name}" added successfully!`)
        setIsStaffModalOpen(false)
        loadTenantStaff(selectedTenantId)
        loadTenantRoles(selectedTenantId) // Update staff counts
      } else {
        toast.error(res.error || "Failed to add staff member")
      }
    } catch (err) {
      toast.error(err.message || "Failed to add staff member")
    } finally {
      setSavingStaff(false)
    }
  }

  const handleToggleStaffStatus = async (staffUser) => {
    const action = staffUser.isActive ? "deactivate" : "activate"
    if (!confirm(`Are you sure you want to ${action} ${staffUser.name}?`)) {
      return
    }
    try {
      const res = await apiClient.toggleStaffStatus(staffUser.id || staffUser._id)
      if (res.success) {
        toast.success(`Staff member ${staffUser.name} ${action}d successfully`)
        loadTenantStaff(selectedTenantId)
      } else {
        toast.error(res.error || `Failed to ${action} staff member`)
      }
    } catch (err) {
      toast.error(err.message || `Failed to ${action} staff member`)
    }
  }

  const handleResetPassword = async (staffUser) => {
    try {
      const res = await apiClient.resetStaffPassword(staffUser.id || staffUser._id)
      if (res.success && res.data) {
        setResetModalData({
          staff: staffUser,
          resetUrl: res.data.resetUrl || null,
          temporaryPassword: res.data.temporaryPassword || null,
        })
      } else {
        toast.error(res.error || "Failed to generate password reset")
      }
    } catch (err) {
      toast.error(err.message || "Failed to reset password")
    }
  }

  const handleCopy = (text) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
    toast.success("Copied to clipboard!")
  }

  return (
    <div className="flex-1 bg-slate-50 min-h-screen pb-16">
      {/* Top Banner / Breadcrumb */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs font-semibold text-slate-500 mb-1">
                <Link
                  href="/super-admin"
                  className="hover:text-indigo-600 transition-colors flex items-center space-x-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Super Admin Console</span>
                </Link>
                <span>/</span>
                <span className="text-slate-800">Roles & Permissions</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center space-x-2.5">
                <Shield className="w-6 h-6 text-indigo-600" />
                <span>
                  {activeTab === "ceiling"
                    ? "Account Admin Default Permissions"
                    : "Tenant Custom Roles & Staff Management"}
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
                {activeTab === "ceiling"
                  ? "Define the baseline permission policy granted to Leads Account Admins across tenant accounts. Changes take effect immediately without forcing user re-login."
                  : "Inspect, create custom roles, and add staff members directly to any tenant account."}
              </p>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center space-x-2.5 shrink-0">
              {activeTab === "ceiling" ? (
                <>
                  <button
                    type="button"
                    onClick={loadPermissions}
                    disabled={loadingCeiling || savingCeiling}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer disabled:opacity-50"
                    title="Reload from database"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingCeiling ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>

                  {hasChanges && (
                    <button
                      type="button"
                      onClick={resetToSaved}
                      disabled={loadingCeiling || savingCeiling}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      Discard Changes
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveCeiling}
                    disabled={loadingCeiling || savingCeiling || !hasChanges}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingCeiling ? "Saving..." : "Save Configuration"}</span>
                  </button>
                </>
              ) : (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedTenantId) {
                        loadTenantRoles(selectedTenantId)
                        loadTenantStaff(selectedTenantId)
                      }
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh Tenant</span>
                  </button>
                  {tenantSubTab === "roles" ? (
                    <button
                      type="button"
                      onClick={openCreateRoleModal}
                      disabled={!selectedTenantId}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Custom Role</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={openAddStaffModal}
                      disabled={!selectedTenantId}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Staff User</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Primary View Navigation Tabs */}
          <div className="flex items-center space-x-2 mt-5 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab("ceiling")}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "ceiling"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Account Admin Default Permissions</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("tenants")}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === "tenants"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Tenant Custom Roles & Staff</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* =========================================================================
            TAB 1: ACCOUNT ADMIN DEFAULT PERMISSIONS (GLOBAL CEILING)
        ========================================================================= */}
        {activeTab === "ceiling" && (
          <>
            {loadingCeiling && (
              <div className="min-h-[40vh] flex flex-col items-center justify-center space-y-3 bg-white rounded-xl border border-slate-200 p-12">
                <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Loading permission modules...
                </p>
              </div>
            )}

            {!loadingCeiling && loadError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center">
                <div className="flex flex-col items-center space-y-3">
                  <AlertCircle className="w-10 h-10 text-rose-500" />
                  <h3 className="font-bold text-slate-900 text-base">Failed to Load Permissions</h3>
                  <p className="text-xs text-rose-700 max-w-md">{loadError}</p>
                  <button
                    type="button"
                    onClick={loadPermissions}
                    className="mt-2 inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Loading</span>
                  </button>
                </div>
              </div>
            )}

            {!loadingCeiling && !loadError && (
              <div className="space-y-6">
                {/* Summary Metrics & Quick Actions */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="border-r border-slate-100 pr-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Target Role
                        </p>
                        <p className="text-base font-bold text-slate-900 mt-0.5 flex items-center space-x-1.5">
                          <span>Account Admin</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-50 text-indigo-700 rounded font-semibold">
                            account_admin
                          </span>
                        </p>
                      </div>

                      <div className="border-r border-slate-100 pr-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Active Permissions
                        </p>
                        <p className="text-base font-bold text-indigo-600 mt-0.5">
                          {selectedPermissions.size}
                          <span className="text-xs text-slate-400 font-normal ml-1">
                            / {allowedPermissions.length} total
                          </span>
                        </p>
                      </div>

                      <div className="border-r border-slate-100 pr-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Total Modules
                        </p>
                        <p className="text-base font-bold text-slate-800 mt-0.5">
                          {modules.length} Modules
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Last Updated
                        </p>
                        <p className="text-xs font-medium text-slate-600 mt-1">
                          {updatedAt ? new Date(updatedAt).toLocaleDateString() : "Default"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                      <button
                        type="button"
                        onClick={selectAll}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Select All</span>
                      </button>
                      <button
                        type="button"
                        onClick={deselectAll}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                        <span>Deselect All</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Module Cards Grid */}
                <div className="space-y-4">
                  {modules.map((mod) => {
                    const modPermissions = mod.permissions || []
                    const activeCount = modPermissions.filter((p) =>
                      selectedPermissions.has(p.key)
                    ).length
                    const allActive =
                      modPermissions.length > 0 && activeCount === modPermissions.length
                    const someActive = activeCount > 0 && !allActive

                    return (
                      <div
                        key={mod.module}
                        className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden transition-shadow hover:shadow-sm"
                      >
                        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/70 border-b border-slate-200">
                          <div className="flex items-center space-x-3">
                            <button
                              type="button"
                              onClick={() => toggleModulePermissions(modPermissions)}
                              className="p-1 text-slate-500 hover:text-indigo-600 cursor-pointer transition-colors"
                              title={allActive ? "Deselect all" : "Select all"}
                            >
                              {allActive ? (
                                <CheckSquare className="w-4 h-4 text-indigo-600" />
                              ) : someActive ? (
                                <div className="w-4 h-4 border-2 border-indigo-600 bg-indigo-100 rounded flex items-center justify-center">
                                  <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                                </div>
                              ) : (
                                <Square className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                            <div>
                              <h2 className="text-sm font-bold text-slate-900">{mod.label || mod.module}</h2>
                              <p className="text-[11px] text-slate-500">
                                Module identifier: <span className="font-mono text-slate-600">{mod.module}</span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                                allActive
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : someActive
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {activeCount} / {modPermissions.length} Active
                            </span>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100 p-2 sm:p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
                            {modPermissions.map((perm) => {
                              const isEnabled = selectedPermissions.has(perm.key)

                              return (
                                <div
                                  key={perm.key}
                                  onClick={() => togglePermission(perm.key)}
                                  className={`flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer select-none ${
                                    isEnabled
                                      ? "bg-indigo-50/40 border-indigo-200 shadow-2xs"
                                      : "bg-white border-slate-150 hover:bg-slate-50"
                                  }`}
                                >
                                  <div className="pt-0.5">
                                    <input
                                      type="checkbox"
                                      checked={isEnabled}
                                      onChange={() => {}}
                                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-1.5">
                                      <span className="text-xs font-bold text-slate-900 truncate">
                                        {perm.label || perm.key}
                                      </span>
                                      {perm.scope && (
                                        <span className="px-1.5 py-0.2 text-[10px] font-mono bg-slate-100 text-slate-600 rounded">
                                          scope: {perm.scope}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                                      {perm.description || "Grant capability to perform operations on this resource."}
                                    </p>
                                    <p className="text-[10px] font-mono text-slate-400 mt-1">
                                      {perm.key}
                                    </p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* =========================================================================
            TAB 2: TENANT CUSTOM ROLES & STAFF MANAGEMENT
        ========================================================================= */}
        {activeTab === "tenants" && (
          <div className="space-y-6">
            {/* Tenant Selector Header */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex-1 max-w-md">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Select CRM Tenant Account
                  </label>
                  <select
                    value={selectedTenantId}
                    onChange={(e) => handleSelectTenant(e.target.value)}
                    disabled={loadingAccounts}
                    className="w-full text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white disabled:opacity-60"
                  >
                    {loadingAccounts ? (
                      <option value="">Loading accounts...</option>
                    ) : accounts.length === 0 ? (
                      <option value="">No accounts found</option>
                    ) : (
                      accounts.map((acc) => {
                        const tId = acc.tenantId || acc.accountId || acc.id
                        return (
                          <option key={tId} value={tId}>
                            {acc.companyName || acc.displayName || tId} ({tId}) — {acc.status || "active"}
                          </option>
                        )
                      })
                    )}
                  </select>
                  {accountsError && (
                    <div className="mt-2 flex items-center justify-between text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2">
                      <div className="flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{accountsError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={loadAccounts}
                        className="underline font-bold hover:text-rose-800 cursor-pointer text-[11px]"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                {selectedTenantAccount && (
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200/80 rounded-lg p-3 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Account</p>
                      <p className="font-bold text-slate-800">{selectedTenantAccount.companyName}</p>
                    </div>
                    <div className="border-l border-slate-200 pl-3">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Tenant ID</p>
                      <p className="font-mono text-indigo-600 font-bold">{selectedTenantAccount.accountId}</p>
                    </div>
                    {selectedTenantAccount.customDomain && (
                      <div className="border-l border-slate-200 pl-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">White-Label Domain</p>
                        <p className="font-mono text-emerald-700 font-bold">{selectedTenantAccount.customDomain}</p>
                      </div>
                    )}
                    <div className="border-l border-slate-200 pl-3">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Status</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {selectedTenantAccount.status}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Sub-Tabs: Custom Roles vs Staff Members */}
              <div className="flex items-center space-x-2 mt-4 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTenantSubTab("roles")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    tenantSubTab === "roles"
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Custom Roles ({tenantRoles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTenantSubTab("staff")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    tenantSubTab === "staff"
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Staff Users ({tenantStaff.length})
                </button>
              </div>
            </div>

            {/* Sub-Tab 1: Roles List */}
            {tenantSubTab === "roles" && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Tenant Roles & Access Scopes</h3>
                    <p className="text-xs text-slate-500">Roles available for staff assignment in this account</p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateRoleModal}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Role</span>
                  </button>
                </div>

                {loadingTenantRoles ? (
                  <div className="p-8 text-center text-xs text-slate-500">Loading roles...</div>
                ) : tenantRolesError ? (
                  <div className="p-6 text-center">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{tenantRolesError}</span>
                      <button
                        type="button"
                        onClick={() => loadTenantRoles(selectedTenantId)}
                        className="ml-2 underline font-bold hover:text-rose-800 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : tenantRoles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">No roles found for this tenant.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {tenantRoles.map((role) => (
                      <div key={role.id || role._id} className="p-4 sm:p-5 flex items-start justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                        <div className="space-y-1.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-slate-900 text-sm">{role.name}</span>
                            <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {role.slug}
                            </span>
                            {role.isSystem ? (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-600">
                                System Role
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                                Custom Role
                              </span>
                            )}
                          </div>
                          {role.description && (
                            <p className="text-xs text-slate-500 max-w-xl">{role.description}</p>
                          )}
                          <div className="flex items-center space-x-4 text-xs text-slate-500 pt-1">
                            <span>
                              <strong>{role.assignedStaffCount || 0}</strong> staff assigned
                            </span>
                            <span>•</span>
                            <span>
                              <strong>{Array.isArray(role.permissions) ? role.permissions.length : 0}</strong> permissions granted
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditRoleModal(role)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-indigo-600" />
                            <span>{role.isSystem ? "View Perms" : "Edit"}</span>
                          </button>
                          {!role.isSystem && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRole(role)}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Role"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sub-Tab 2: Staff List */}
            {tenantSubTab === "staff" && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Tenant Staff Members</h3>
                    <p className="text-xs text-slate-500">Sales agents and managers assigned to this account</p>
                  </div>
                  <button
                    type="button"
                    onClick={openAddStaffModal}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-2xs cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Staff User</span>
                  </button>
                </div>

                {loadingTenantStaff ? (
                  <div className="p-8 text-center text-xs text-slate-500">Loading staff users...</div>
                ) : tenantStaffError ? (
                  <div className="p-6 text-center">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{tenantStaffError}</span>
                      <button
                        type="button"
                        onClick={() => loadTenantStaff(selectedTenantId)}
                        className="ml-2 underline font-bold hover:text-rose-800 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : tenantStaff.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">No staff members found for this tenant.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Staff Member</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Capacity</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tenantStaff.map((st) => (
                          <tr key={st.id || st._id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{st.name}</div>
                              <div className="text-[11px] text-slate-500 font-mono">{st.email}</div>
                              {st.phone && <div className="text-[10px] text-slate-400">{st.phone}</div>}
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                {st.role}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              {st.isActive ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  Suspended
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono">
                              {st.maxOpenLeads || 50} leads
                            </td>
                            <td className="py-3 px-4 text-right space-x-2">
                              <button
                                type="button"
                                onClick={() => handleResetPassword(st)}
                                className="px-2 py-1 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Reset Password"
                              >
                                Reset Pass
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStaffStatus(st)}
                                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                  st.isActive
                                    ? "text-rose-600 hover:bg-rose-50"
                                    : "text-emerald-600 hover:bg-emerald-50"
                                }`}
                              >
                                {st.isActive ? "Deactivate" : "Activate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL: CREATE / EDIT CUSTOM ROLE
      ========================================================================= */}
      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingRole ? `Edit Role: ${editingRole.name}` : "Create Custom Role"}
                </h3>
                <p className="text-xs text-slate-500">
                  Define custom permissions for this tenant role within the Super Admin ceiling.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRoleModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="flex-1 overflow-y-auto py-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Role Name *</label>
                <input
                  type="text"
                  required
                  value={roleFormData.name}
                  onChange={(e) => setRoleFormData({ ...roleFormData, name: e.target.value })}
                  placeholder="e.g. Senior Closer or Telemarketing Specialist"
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {!editingRole && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role Slug (Optional)</label>
                  <input
                    type="text"
                    value={roleFormData.slug}
                    onChange={(e) => setRoleFormData({ ...roleFormData, slug: e.target.value })}
                    placeholder="e.g. senior_closer (auto-generated if empty)"
                    className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={roleFormData.description}
                  onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
                  placeholder="Scope of responsibilities and permissions"
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Permission Checkboxes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Role Permissions ({roleFormData.permissions.length} selected)
                </label>
                <div className="space-y-3 max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50">
                  {modules.map((mod) => (
                    <div key={mod.module} className="bg-white rounded-lg p-3 border border-slate-200">
                      <p className="text-xs font-bold text-slate-800 mb-2">{mod.label || mod.module}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(mod.permissions || []).map((perm) => {
                          const isChecked = roleFormData.permissions.includes(perm.key)
                          return (
                            <label
                              key={perm.key}
                              className={`flex items-start space-x-2 p-2 rounded border text-xs cursor-pointer select-none ${
                                isChecked
                                  ? "bg-indigo-50/70 border-indigo-200 text-indigo-900 font-semibold"
                                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleRolePermission(perm.key)}
                                className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 mt-0.5 cursor-pointer"
                              />
                              <span className="truncate">{perm.label || perm.key}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  {savingRole ? "Saving..." : editingRole ? "Update Role" : "Create Role"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: ADD STAFF MEMBER
      ========================================================================= */}
      {isStaffModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">Add Staff Member</h3>
                <p className="text-xs text-slate-500">
                  Assign a sales agent or manager to tenant account <span className="font-mono text-indigo-600">{selectedTenantId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsStaffModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaff} className="py-4 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={staffFormData.name}
                  onChange={(e) => setStaffFormData({ ...staffFormData, name: e.target.value })}
                  placeholder="e.g. Alex Johnson"
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={staffFormData.email}
                  onChange={(e) => setStaffFormData({ ...staffFormData, email: e.target.value })}
                  placeholder="alex@company.com"
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={staffFormData.phone}
                    onChange={(e) => setStaffFormData({ ...staffFormData, phone: e.target.value })}
                    placeholder="+91 9876543210"
                    className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Role *</label>
                  <select
                    value={staffFormData.role}
                    onChange={(e) => setStaffFormData({ ...staffFormData, role: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    {tenantRoles.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name} {r.isSystem ? `(${r.slug})` : "(Custom)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Max Open Leads</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={staffFormData.maxOpenLeads}
                    onChange={(e) => setStaffFormData({ ...staffFormData, maxOpenLeads: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Temporary Password</label>
                  <input
                    type="text"
                    value={staffFormData.temporaryPassword}
                    onChange={(e) => setStaffFormData({ ...staffFormData, temporaryPassword: e.target.value })}
                    placeholder="Auto-generated if empty"
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsStaffModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                >
                  {savingStaff ? "Adding..." : "Add Staff Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: PASSWORD RESET SUCCESS
      ========================================================================= */}
      {resetModalData && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Password Reset Generated</h3>
            <p className="text-xs text-slate-500 mt-1">
              Share the credentials or reset link with {resetModalData.staff.name}.
            </p>

            {resetModalData.temporaryPassword && (
              <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] font-semibold text-slate-500">Temporary Password</p>
                <p className="font-mono text-sm font-bold text-slate-900 mt-0.5">{resetModalData.temporaryPassword}</p>
              </div>
            )}

            {resetModalData.resetUrl && (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-[11px] font-semibold text-slate-500">Password Reset Link</p>
                <div className="flex items-center space-x-2 mt-1">
                  <input
                    type="text"
                    readOnly
                    value={resetModalData.resetUrl}
                    className="text-xs font-mono bg-white border border-slate-200 rounded px-2 py-1 flex-1 text-slate-700 truncate"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(resetModalData.resetUrl)}
                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                    title="Copy Link"
                  >
                    {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setResetModalData(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
