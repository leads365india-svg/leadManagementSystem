"use client"

import React, { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { toast } from "react-hot-toast"
import {
  Building2,
  Users,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Shield,
  Layers,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  UserPlus,
  UserMinus,
  Check,
  X,
  Lock,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Globe,
  Copy,
  ExternalLink,
} from "lucide-react"

export default function WorkspacesClient() {
  const router = useRouter()
  const { user, isMultiWorkspaceEnabled, reloadWorkspaces } = useAuth()

  // State
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [workspaces, setWorkspaces] = useState([])
  const [isModeEnabled, setIsModeEnabled] = useState(false)
  const [staffList, setStaffList] = useState([])

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState(null)
  const [managingMembersWs, setManagingMembersWs] = useState(null)
  const [membersList, setMembersList] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  // Custom Domain modal states
  const [managingDomainWs, setManagingDomainWs] = useState(null)
  const [domainData, setDomainData] = useState(null)
  const [domainInput, setDomainInput] = useState("")
  const [loadingDomain, setLoadingDomain] = useState(false)
  const [savingDomain, setSavingDomain] = useState(false)
  const [verifyingDomain, setVerifyingDomain] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    primaryColor: "#4f46e5",
    isDefault: false,
    status: "active",
  })
  const [memberForm, setMemberForm] = useState({
    userId: "",
    role: "agent",
  })
  const [submitting, setSubmitting] = useState(false)
  const [togglingMode, setTogglingMode] = useState(false)

  const isOrgAdmin = user?.role === "account_admin" || user?.role === "super_admin"
  const currentTenantId = user?.effectiveTenantId || user?.tenantId || null

  // Fetch workspaces & staff scoped to the currently authenticated tenant
  const loadData = useCallback(async () => {
    try {
      setRefreshing(true)
      const [wsRes, staffRes] = await Promise.all([
        apiClient.getWorkspaces().catch((err) => ({ success: false, error: err.message })),
        apiClient.getStaff().catch(() => ({ success: false })),
      ])

      if (wsRes?.success) {
        const rawList = Array.isArray(wsRes.data) ? wsRes.data : []
        const scopedList = (currentTenantId
          ? rawList.filter((w) => !w.tenantId || String(w.tenantId) === String(currentTenantId))
          : rawList
        ).filter((w) => !w.isSystemManaged)
        setWorkspaces(scopedList)
        setIsModeEnabled(Boolean(wsRes.workspaceModeEnabled))
      } else {
        setWorkspaces([])
      }
      if (staffRes?.success && staffRes.data) {
        const staff = Array.isArray(staffRes.data) ? staffRes.data : staffRes.data.staff || []
        setStaffList(staff)
      }
    } catch (err) {
      console.error("Error loading workspaces data:", err)
      toast.error("Failed to load workspace configuration")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [currentTenantId])

  useEffect(() => {
    setWorkspaces([])
    loadData()
  }, [loadData])

  // Toggle multi-workspace mode
  const handleToggleMode = async (enable) => {
    try {
      setTogglingMode(true)
      const res = await apiClient.toggleWorkspaceMode(enable)
      if (res.success) {
        toast.success(res.message || `Multi-workspace mode ${enable ? "enabled" : "disabled"}`)
        setIsModeEnabled(res.workspaceModeEnabled)
        await reloadWorkspaces()
        await loadData()
      } else {
        toast.error(res.error || "Failed to toggle workspace mode")
      }
    } catch (err) {
      toast.error(err.message || "Failed to toggle mode")
    } finally {
      setTogglingMode(false)
    }
  }

  // Open create modal
  const openCreateModal = () => {
    setFormData({
      name: "",
      slug: "",
      description: "",
      primaryColor: "#4f46e5",
      isDefault: false,
      status: "active",
    })
    setShowCreateModal(true)
  }

  // Open edit modal
  const openEditModal = (ws) => {
    setEditingWorkspace(ws)
    setFormData({
      name: ws.name || "",
      slug: ws.slug || "",
      description: ws.description || "",
      primaryColor: ws.branding?.primaryColor || "#4f46e5",
      isDefault: Boolean(ws.isDefault),
      status: ws.status || "active",
    })
  }

  // Handle create / update submit
  const handleSaveWorkspace = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      toast.error("Workspace name is required")
      return
    }

    try {
      setSubmitting(true)
      const payload = {
        name: formData.name.trim(),
        slug: formData.slug.trim(),
        description: formData.description.trim(),
        branding: {
          primaryColor: formData.primaryColor,
        },
        isDefault: formData.isDefault,
        status: formData.status,
      }

      let res
      if (editingWorkspace) {
        res = await apiClient.updateWorkspace(editingWorkspace._id, payload)
      } else {
        res = await apiClient.createWorkspace(payload)
      }

      if (res.success) {
        if (!editingWorkspace && currentTenantId && res.data?.tenantId && String(res.data.tenantId) !== String(currentTenantId)) {
          toast.error("Security warning: Created workspace tenant mismatch detected. Reloading session.")
          await loadData()
          return
        }
        toast.success(editingWorkspace ? "Workspace updated" : "Workspace created")
        setShowCreateModal(false)
        setEditingWorkspace(null)
        await reloadWorkspaces()
        await loadData()
      } else {
        toast.error(res.error || "Failed to save workspace")
      }
    } catch (err) {
      toast.error(err.message || "Operation failed")
    } finally {
      setSubmitting(false)
    }
  }

  // Handle archive
  const handleArchiveWorkspace = async (ws) => {
    if (workspaces.filter((w) => w.status === "active").length <= 1) {
      toast.error("Cannot archive the only active workspace in the organization.")
      return
    }

    if (!window.confirm(`Are you sure you want to archive workspace "${ws.name}"?`)) {
      return
    }

    try {
      const res = await apiClient.archiveWorkspace(ws._id)
      if (res.success) {
        toast.success("Workspace archived successfully")
        await reloadWorkspaces()
        await loadData()
      } else {
        toast.error(res.error || "Failed to archive workspace")
      }
    } catch (err) {
      toast.error(err.message || "Archive failed")
    }
  }

  // Open manage members drawer
  const openMembersDrawer = async (ws) => {
    setManagingMembersWs(ws)
    setLoadingMembers(true)
    setMemberForm({ userId: "", role: "agent" })
    try {
      const res = await apiClient.getWorkspaceMembers(ws._id)
      if (res.success) {
        setMembersList(res.data || [])
      }
    } catch (err) {
      toast.error("Failed to load workspace members")
    } finally {
      setLoadingMembers(false)
    }
  }

  // Add member to workspace
  const handleAddMember = async (e) => {
    e.preventDefault()
    if (!memberForm.userId) {
      toast.error("Please select a team member")
      return
    }

    try {
      setSubmitting(true)
      const res = await apiClient.addWorkspaceMember(managingMembersWs._id, {
        userId: memberForm.userId,
        role: memberForm.role,
      })

      if (res.success) {
        toast.success("Member added to workspace")
        setMemberForm({ userId: "", role: "agent" })
        const membersRes = await apiClient.getWorkspaceMembers(managingMembersWs._id)
        if (membersRes.success) setMembersList(membersRes.data || [])
        loadData()
      } else {
        toast.error(res.error || "Failed to add member")
      }
    } catch (err) {
      toast.error(err.message || "Failed to add member")
    } finally {
      setSubmitting(false)
    }
  }

  // Remove member from workspace
  const handleRemoveMember = async (memberUserId) => {
    if (!window.confirm("Revoke this member's access to this workspace immediately?")) {
      return
    }

    try {
      const res = await apiClient.removeWorkspaceMember(managingMembersWs._id, memberUserId)
      if (res.success) {
        toast.success("Member access revoked immediately")
        setMembersList((prev) => prev.filter((m) => m.userId !== memberUserId && m.id !== memberUserId))
        loadData()
      } else {
        toast.error(res.error || "Failed to remove member")
      }
    } catch (err) {
      toast.error(err.message || "Failed to remove member")
    }
  }

  // --- Domain Management Handlers ---
  const openDomainModal = async (ws) => {
    setManagingDomainWs(ws)
    setDomainData(null)
    setDomainInput("")
    setLoadingDomain(true)
    setCopiedToken(false)
    try {
      const res = await apiClient.getWorkspaceDomain(ws._id)
      if (res?.success && res.data) {
        setDomainData(res.data)
        setDomainInput(res.data.domain || "")
      }
    } catch (err) {
      // If none configured, domainData remains null
    } finally {
      setLoadingDomain(false)
    }
  }

  const handleSaveDomain = async (e) => {
    e.preventDefault()
    if (!domainInput.trim()) {
      toast.error("Please enter a custom domain hostname")
      return
    }

    try {
      setSavingDomain(true)
      const res = await apiClient.setWorkspaceDomain(managingDomainWs._id, {
        domain: domainInput.trim(),
      })
      if (res?.success) {
        toast.success(res.message || "Domain configured. Please configure DNS TXT verification.")
        setDomainData(res.data)
        await loadData()
      } else {
        toast.error(res?.error || "Failed to configure custom domain")
      }
    } catch (err) {
      toast.error(err.message || "Failed to configure custom domain")
    } finally {
      setSavingDomain(false)
    }
  }

  const handleVerifyDomain = async () => {
    try {
      setVerifyingDomain(true)
      const res = await apiClient.verifyWorkspaceDomain(managingDomainWs._id)
      if (res?.success) {
        toast.success(res.message || "Custom domain verified and activated!")
        setDomainData((prev) => ({ ...prev, status: "verified", verifiedAt: new Date().toISOString() }))
        await loadData()
      } else {
        toast.error(res?.error || "DNS verification failed. Check DNS TXT records.")
      }
    } catch (err) {
      toast.error(err.message || "Verification request failed")
    } finally {
      setVerifyingDomain(false)
    }
  }

  const handleRemoveDomain = async () => {
    if (!window.confirm(`Are you sure you want to remove the custom domain from workspace "${managingDomainWs.name}"?`)) {
      return
    }

    try {
      const res = await apiClient.removeWorkspaceDomain(managingDomainWs._id)
      if (res?.success) {
        toast.success("Custom domain removed successfully")
        setDomainData(null)
        setDomainInput("")
        await loadData()
      } else {
        toast.error(res?.error || "Failed to remove domain")
      }
    } catch (err) {
      toast.error(err.message || "Failed to remove domain")
    }
  }

  const handleCopyToken = (text) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedToken(true)
    toast.success("Verification token copied to clipboard")
    setTimeout(() => setCopiedToken(false), 2000)
  }

  if (!isOrgAdmin) {
    return (
      <div className="py-20 text-center space-y-3">
        <Lock className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-slate-800">Access Restricted</h2>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          Workspace administration is restricted to Organization Administrators.
        </p>
        <Link
          href="/portal"
          className="inline-flex items-center space-x-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          <span>Return to Dashboard</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Loading workspace configuration...</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-300 pb-16">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Building2 className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Workspace Administration
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Configure autonomous operating workspaces, staff assignments, and project routing.
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

          {isModeEnabled && (
            <button
              onClick={openCreateModal}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Workspace</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-Workspace SaaS Mode Status Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-slate-900">Multi-Workspace Architecture</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isModeEnabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {isModeEnabled ? "Mode B: Multi-Workspace Enabled" : "Mode A: Standalone Account"}
              </span>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl">
              {isModeEnabled
                ? "Your organization is operating in Multi-Workspace mode. Staff are scoped to assigned projects, and Organization Admins have consolidated master visibility."
                : "Your account is currently running in Standalone mode. All leads, calls, and configurations operate under one unified account with no workspace switcher required."}
            </p>
          </div>

          <button
            onClick={() => handleToggleMode(!isModeEnabled)}
            disabled={togglingMode}
            className={`inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer shrink-0 ${
              isModeEnabled
                ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                : "bg-indigo-600 text-white border-transparent hover:bg-indigo-700 shadow-sm"
            }`}
          >
            {isModeEnabled ? (
              <>
                <ToggleRight className="w-4 h-4 text-emerald-600" />
                <span>Disable Multi-Workspace</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-4 h-4" />
                <span>Enable Multi-Workspace</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Workspace Cards List */}
      {isModeEnabled && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Configured Workspaces ({workspaces.length})
            </h2>
          </div>

          {workspaces.length === 0 && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-800">No manually created projects yet</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                All existing organization leads and calls remain available in <strong>All Projects</strong>. Create a workspace only when you want a dedicated project partition.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {workspaces.map((ws) => (
              <div
                key={ws._id}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 flex flex-col justify-between hover:border-slate-300 transition-all space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: ws.branding?.primaryColor || "#4f46e5" }}
                      />
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <h3 className="font-bold text-slate-900 text-base">{ws.name}</h3>
                          {ws.isDefault && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-slate-400">/{ws.slug}</p>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        ws.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {ws.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2">
                    {ws.description || "No description configured."}
                  </p>

                  {/* Auto-Generated Platform Workspace Access URL */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {ws.customDomain && ws.domainStatus === "verified" ? "White-Label URL" : "Platform Access URL"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const url = ws.accessUrl || `https://crm.leads365.in/portal/login?organization=${user?.account?.slug || user?.tenantId}&workspace=${ws.slug}`
                          navigator.clipboard.writeText(url)
                          toast.success("Access URL copied to clipboard!")
                        }}
                        className="inline-flex items-center space-x-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        title="Copy Access URL"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy URL</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-700 truncate select-all" title={ws.accessUrl}>
                        {ws.accessUrl || `https://crm.leads365.in/portal/login?organization=${user?.account?.slug || user?.tenantId}&workspace=${ws.slug}`}
                      </span>
                      <a
                        href={ws.accessUrl || `https://crm.leads365.in/portal/login?organization=${user?.account?.slug || user?.tenantId}&workspace=${ws.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-indigo-600 ml-1.5 shrink-0"
                        title="Open Access URL"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => openMembersDrawer(ws)}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 hover:text-indigo-600 cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Members</span>
                    </button>

                    <button
                      onClick={() => openDomainModal(ws)}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 hover:text-indigo-600 cursor-pointer"
                      title="Manage Workspace Custom Domain"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Domain</span>
                      {ws.customDomain && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                            ws.domainStatus === "verified"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {ws.domainStatus === "verified" ? "Active" : "Pending"}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => openEditModal(ws)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                      title="Edit Workspace"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleArchiveWorkspace(ws)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      title="Archive Workspace"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create / Edit Workspace Modal */}
      {(showCreateModal || editingWorkspace) && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">
                {editingWorkspace ? `Edit Workspace: ${editingWorkspace.name}` : "Create New Workspace"}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setEditingWorkspace(null)
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWorkspace} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Workspace Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => {
                    const name = e.target.value
                    setFormData((prev) => ({
                      ...prev,
                      name,
                      slug: editingWorkspace
                        ? prev.slug
                        : name
                            .toLowerCase()
                            .replace(/[^\w\s-]/g, "")
                            .replace(/[\s_-]+/g, "-"),
                    }))
                  }}
                  placeholder="e.g. Commercial Real Estate"
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">URL Identifier / Slug *</label>
                <input
                  type="text"
                  required
                  value={formData.slug}
                  onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                  placeholder="commercial-real-estate"
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Operational scope, team focus or market domain..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Brand Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={formData.primaryColor}
                      onChange={(e) => setFormData((prev) => ({ ...prev, primaryColor: e.target.value }))}
                      className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-600">{formData.primaryColor}</span>
                  </div>
                </div>

                {editingWorkspace && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                      className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="isDefaultWs"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <label htmlFor="isDefaultWs" className="text-xs text-slate-700 font-medium">
                  Set as Organization Default Workspace
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setEditingWorkspace(null)
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm cursor-pointer"
                >
                  {submitting ? "Saving..." : editingWorkspace ? "Update Workspace" : "Create Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Member Management Drawer */}
      {managingMembersWs && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-end">
          <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div>
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Workspace Members</h3>
                  <p className="text-xs text-slate-500 font-medium">{managingMembersWs.name}</p>
                </div>
                <button
                  onClick={() => setManagingMembersWs(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Add Member Form */}
              <div className="p-5 bg-slate-50/80 border-b border-slate-100">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                  Assign Staff Member
                </h4>
                <form onSubmit={handleAddMember} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Organization Employee
                    </label>
                    <select
                      value={memberForm.userId}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, userId: e.target.value }))}
                      required
                      className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="">Select Employee...</option>
                      {staffList.map((st) => (
                        <option key={st._id || st.id} value={st._id || st.id}>
                          {st.name} ({st.email}) — {st.roleTitle || st.role}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Workspace Role
                    </label>
                    <select
                      value={memberForm.role}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, role: e.target.value }))}
                      className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      <option value="workspace_admin">Workspace Admin (Full Project Scope)</option>
                      <option value="manager">Manager (Team Management)</option>
                      <option value="agent">Agent (Lead & Call Handling)</option>
                      <option value="viewer">Viewer (Read-only)</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !memberForm.userId}
                    className="w-full py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
                  >
                    {submitting ? "Assigning..." : "Assign to Workspace"}
                  </button>
                </form>
              </div>

              {/* Members List */}
              <div className="p-5 space-y-3 overflow-y-auto max-h-[calc(100vh-360px)]">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Active Members ({membersList.length})
                </h4>

                {loadingMembers ? (
                  <div className="py-8 text-center text-xs text-slate-400">Loading members...</div>
                ) : membersList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4">No staff members currently assigned.</p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                    {membersList.map((m) => (
                      <div key={m.id || m.userId} className="p-3 flex items-center justify-between hover:bg-slate-50">
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{m.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                          <div className="flex items-center space-x-1 mt-1">
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                              {m.workspaceRole}
                            </span>
                            <span className="text-[9px] text-slate-400">Account: {m.accountRole}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer shrink-0"
                          title="Revoke Workspace Access"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={() => setManagingMembersWs(null)}
                className="w-full py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Custom Domain Modal */}
      {managingDomainWs && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Workspace Custom Domain
                  </h3>
                  <p className="text-xs text-slate-500">{managingDomainWs.name}</p>
                </div>
              </div>
              <button
                onClick={() => setManagingDomainWs(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {loadingDomain ? (
                <div className="py-10 text-center space-y-2">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500">Checking domain records...</p>
                </div>
              ) : (
                <>
                  {domainData ? (
                    <div className="space-y-4">
                      {/* Domain Status Card */}
                      <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {domainData.domain}
                            </span>
                            {domainData.status === "verified" && (
                              <a
                                href={`https://${domainData.domain}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-600 hover:text-indigo-700"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {domainData.status === "verified"
                              ? "Active & routing traffic to this workspace"
                              : "Verification pending — add TXT record in DNS"}
                          </p>
                        </div>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            domainData.status === "verified"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {domainData.status === "verified" ? "Verified & Active" : "Pending Verification"}
                        </span>
                      </div>

                      {/* DNS Instructions */}
                      <div className="space-y-2.5">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          DNS Verification Configuration
                        </h4>
                        <div className="bg-slate-900 text-slate-200 rounded-xl p-3.5 font-mono text-xs space-y-2">
                          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase border-b border-slate-800 pb-1">
                            <span>Record Type</span>
                            <span>Host / Name</span>
                            <span>Value</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-amber-400 font-bold">TXT</span>
                            <span className="text-slate-300">
                              {domainData.dnsInstructions?.host || `_leads365-challenge.${domainData.domain}`}
                            </span>
                            <div className="flex items-center space-x-1.5">
                              <span className="text-slate-400 max-w-[140px] truncate" title={domainData.verificationToken}>
                                {domainData.verificationToken}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyToken(domainData.verificationToken)}
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                                title="Copy Verification Token"
                              >
                                {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* CNAME note */}
                        <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl text-[11px] text-indigo-900 space-y-1">
                          <p className="font-semibold">Routing Setup (CNAME):</p>
                          <p className="text-indigo-700">
                            Point a <code className="font-mono font-bold bg-indigo-100 px-1 py-0.5 rounded">CNAME</code> record for{" "}
                            <span className="font-mono font-bold">{domainData.domain}</span> to{" "}
                            <code className="font-mono font-bold bg-indigo-100 px-1 py-0.5 rounded">
                              {domainData.dnsInstructions?.cnameTarget || "cname.vercel-dns.com"}
                            </code>
                          </p>
                        </div>
                      </div>

                      {/* Modal Actions */}
                      <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                        <button
                          type="button"
                          onClick={handleRemoveDomain}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          Remove Domain
                        </button>

                        <div className="flex items-center space-x-2">
                          {domainData.status !== "verified" && (
                            <button
                              type="button"
                              onClick={handleVerifyDomain}
                              disabled={verifyingDomain}
                              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-1.5"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${verifyingDomain ? "animate-spin" : ""}`} />
                              <span>{verifyingDomain ? "Checking DNS..." : "Verify DNS TXT"}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setManagingDomainWs(null)}
                            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Setup New Domain Form */
                    <form onSubmit={handleSaveDomain} className="space-y-4">
                      <p className="text-xs text-slate-500">
                        Map a dedicated domain or subdomain to this workspace. Once verified, this workspace will use its own branding and lock session contexts to this project.
                      </p>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Workspace Domain Hostname *
                        </label>
                        <input
                          type="text"
                          required
                          value={domainInput}
                          onChange={(e) => setDomainInput(e.target.value)}
                          placeholder="e.g. realty.yourcompany.com"
                          className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Enter a fully qualified hostname without https:// or trailing slashes.
                        </p>
                      </div>

                      <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-800 flex items-start space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-[11px]">
                          <strong>Domain Uniqueness:</strong> Each domain is globally unique across the platform. You must be able to add DNS TXT records to prove domain ownership.
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setManagingDomainWs(null)}
                          className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingDomain || !domainInput.trim()}
                          className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm cursor-pointer"
                        >
                          {savingDomain ? "Generating Token..." : "Configure Domain"}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
