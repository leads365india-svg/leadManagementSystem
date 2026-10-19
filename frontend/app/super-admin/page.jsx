"use client"

import React, { useEffect, useState, useCallback } from "react"
import { apiClient } from "@/lib/api"
import {
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Lock,
  X,
  Info,
} from "lucide-react"

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState({
    totalAccounts: 0,
    activeAccounts: 0,
    suspendedAccounts: 0,
    totalAdmins: 0,
  })
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalAccountsCount, setTotalAccountsCount] = useState(0)

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [isConfirmSuspendOpen, setIsConfirmSuspendOpen] = useState(false)
  const [accountToToggle, setAccountToToggle] = useState(null)

  // Success Notification State
  const [successMessage, setSuccessMessage] = useState(null)

  // Add Account Form Data with manual password fields
  const [formData, setFormData] = useState({
    companyName: "",
    displayName: "",
    adminName: "",
    adminEmail: "",
    contactNumber: "",
    password: "",
    confirmPassword: "",
    status: "active",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)

  // Fetch Stats and Accounts List
  const loadData = useCallback(async () => {
    try {
      setRefreshing(true)
      const [statsRes, accountsRes] = await Promise.all([
        apiClient.getSuperAdminStats(),
        apiClient.getSuperAdminAccounts({
          page,
          limit: 10,
          search,
          status: statusFilter !== "all" ? statusFilter : undefined,
        }),
      ])

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data)
      }

      if (accountsRes.success && accountsRes.data) {
        setAccounts(accountsRes.data.accounts)
        setTotalPages(accountsRes.data.totalPages || 1)
        setTotalAccountsCount(accountsRes.data.total || 0)
      }
    } catch (error) {
      console.error("Failed to load dashboard data:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, search, statusFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Copy helper
  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Validate form fields
  const validateForm = () => {
    const errors = {}
    if (!formData.companyName.trim()) {
      errors.companyName = "Leads Account / Company name is required"
    }
    if (!formData.displayName.trim()) {
      errors.displayName = "Display name is required"
    }
    if (!formData.adminName.trim()) {
      errors.adminName = "Account Admin full name is required"
    }
    if (!formData.adminEmail.trim()) {
      errors.adminEmail = "Admin email address is required"
    } else {
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/
      if (!emailRegex.test(formData.adminEmail.trim())) {
        errors.adminEmail = "Please enter a valid email address"
      }
    }
    if (!formData.password) {
      errors.password = "Password is required"
    } else if (formData.password.length < 8) {
      errors.password = "Password must be at least 8 characters long"
    }
    if (!formData.confirmPassword) {
      errors.confirmPassword = "Confirm password is required"
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = "Password and Confirm Password do not match"
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Handle Add Account Form Submission
  const handleCreateAccount = async (e) => {
    e.preventDefault()
    setActionError(null)

    if (!validateForm()) return

    try {
      setIsSubmitting(true)
      const { confirmPassword, ...payload } = formData
      const response = await apiClient.createSuperAdminAccount(payload)

      if (response.success && response.data) {
        // Show success notification without exposing password
        setSuccessMessage({
          accountId: response.data.account.accountId,
          companyName: response.data.account.companyName,
          adminEmail: response.data.account.adminEmail,
        })

        // Reset form
        setFormData({
          companyName: "",
          displayName: "",
          adminName: "",
          adminEmail: "",
          contactNumber: "",
          password: "",
          confirmPassword: "",
          status: "active",
        })
        setShowPassword(false)
        setShowConfirmPassword(false)
        setIsAddModalOpen(false)

        // Seamlessly refresh data without a full page reload
        loadData()
      } else {
        setActionError(response.error || "Failed to create Leads Account")
      }
    } catch (err) {
      setActionError(err.message || "Failed to create Leads Account")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Account Status Toggle (Activate/Suspend)
  const handleToggleStatus = async () => {
    if (!accountToToggle) return

    const newStatus = accountToToggle.status === "active" ? "suspended" : "active"

    try {
      const response = await apiClient.updateAccountStatus(accountToToggle.id, newStatus)
      if (response.success) {
        setIsConfirmSuspendOpen(false)
        setAccountToToggle(null)
        // Refresh without full reload
        loadData()
      } else {
        alert(response.error || "Failed to update status")
      }
    } catch (err) {
      alert(err.message || "Failed to update status")
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Leads Accounts & Multi-Tenancy
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Overview of all customer accounts, assigned tenant administrators, and system status
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

          <button
            onClick={() => {
              setFormData({
                companyName: "",
                displayName: "",
                adminName: "",
                adminEmail: "",
                contactNumber: "",
                status: "active",
              })
              setFormErrors({})
              setActionError(null)
              setIsAddModalOpen(true)
            }}
            className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Leads Account</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner when Account is created */}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200/90 shadow-xs flex items-start justify-between relative animate-in fade-in">
          <div className="flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-emerald-900">
                Leads Account & Admin Created Successfully!
              </h4>
              <p className="text-xs text-emerald-700 mt-0.5 leading-relaxed">
                Account <strong>{successMessage.companyName}</strong> (Tenant ID: <span className="font-mono font-medium">{successMessage.accountId}</span>) has been provisioned. Admin <strong>{successMessage.adminEmail}</strong> can now log in using the configured password.
              </p>
            </div>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-800 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Card 1: Total Leads Accounts */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Accounts
            </p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{stats.totalAccounts}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Tenant accounts configured</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Active Leads Accounts */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Accounts
            </p>
            <h3 className="text-2xl font-bold text-emerald-600 mt-1">{stats.activeAccounts}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Operational & running</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Suspended Leads Accounts */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Suspended Accounts
            </p>
            <h3 className="text-2xl font-bold text-amber-600 mt-1">{stats.suspendedAccounts}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Access restricted</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4: Total Leads Account Admins */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Account Admins
            </p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{stats.totalAdmins}</h3>
            <p className="text-[11px] text-slate-400 mt-1">Tenant admins assigned</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
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
            placeholder="Search by company, account ID, admin..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">All Accounts</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>
        </div>
      </div>

      {/* Leads Accounts Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4 sm:px-6">Account / Company</th>
                <th className="py-3.5 px-4">Account ID</th>
                <th className="py-3.5 px-4">Account Admin</th>
                <th className="py-3.5 px-4">Admin Email</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Created Date</th>
                <th className="py-3.5 px-4 sm:px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span>Loading Leads Accounts...</span>
                    </div>
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Building2 className="w-8 h-8 text-slate-300" />
                      <p className="font-medium text-slate-700">No Leads Accounts Found</p>
                      <p className="text-xs text-slate-400">
                        {search || statusFilter !== "all"
                          ? "Try adjusting your search query or status filter."
                          : "Get started by adding your first Leads Account."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="font-semibold text-slate-900">{account.companyName}</div>
                      <div className="text-[11px] text-slate-400">{account.displayName}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="inline-flex items-center space-x-1.5 font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                        <span>{account.accountId}</span>
                        <button
                          onClick={() => handleCopy(account.accountId, account.id)}
                          title="Copy Account ID"
                          className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                        >
                          {copiedKey === account.id ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-slate-800">
                      {account.adminName}
                    </td>

                    <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                      {account.adminEmail}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
                          account.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            account.status === "active" ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                        />
                        {account.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {new Date(account.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>

                    <td className="py-3.5 px-4 sm:px-6 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setSelectedAccount(account)
                          setIsDetailsModalOpen(true)
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <Eye className="w-3 h-3 text-slate-500" />
                        <span>Details</span>
                      </button>

                      {account.status === "active" ? (
                        <button
                          onClick={() => {
                            setAccountToToggle(account)
                            setIsConfirmSuspendOpen(true)
                          }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors cursor-pointer"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>Suspend</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setAccountToToggle(account)
                            setIsConfirmSuspendOpen(true)
                          }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Activate</span>
                        </button>
                      )}
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
              Showing {accounts.length} of {totalAccountsCount} accounts
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

      {/* --- MODAL 1: Add Leads Account Form --- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 text-sm">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <span>Add Leads Account</span>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Company / Account Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Leads Account / Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Dynamics Ltd"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
                {formErrors.companyName && (
                  <p className="text-[11px] text-red-600 mt-1">{formErrors.companyName}</p>
                )}
              </div>

              {/* Account Display Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Display Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Dynamics"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
                {formErrors.displayName && (
                  <p className="text-[11px] text-red-600 mt-1">{formErrors.displayName}</p>
                )}
              </div>

              {/* Admin Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Admin Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Jenkins"
                  value={formData.adminName}
                  onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
                {formErrors.adminName && (
                  <p className="text-[11px] text-red-600 mt-1">{formErrors.adminName}</p>
                )}
              </div>

              {/* Admin Email */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Admin Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@apexdynamics.com"
                  value={formData.adminEmail}
                  onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                />
                {formErrors.adminEmail && (
                  <p className="text-[11px] text-red-600 mt-1">{formErrors.adminEmail}</p>
                )}
              </div>

              {/* Contact Number & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Number (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="+1 (555) 019-2834"
                    value={formData.contactNumber}
                    onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value })
                    }
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="active">Active (Default)</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* Password & Confirm Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Min. 8 characters"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full text-xs pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  {formErrors.password && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.password}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      placeholder="Re-enter password"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="w-full text-xs pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                      title={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  {formErrors.confirmPassword && (
                    <p className="text-[11px] text-red-600 mt-1">{formErrors.confirmPassword}</p>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex items-start space-x-2">
                <Lock className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                <span>
                  The Admin will use this email and password to log in. Passwords must be at least 8 characters and are securely hashed with bcrypt.
                </span>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <span>Create Leads Account</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: Account Details View --- */}
      {isDetailsModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 text-sm">
                <Info className="w-4 h-4 text-indigo-600" />
                <span>Account Details: {selectedAccount.companyName}</span>
              </div>
              <button
                onClick={() => setIsDetailsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                    Account / Company
                  </span>
                  <p className="font-semibold text-slate-800 text-sm mt-0.5">
                    {selectedAccount.companyName}
                  </p>
                  <p className="text-[11px] text-slate-500">{selectedAccount.displayName}</p>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <span className="text-slate-400 block text-[10px] font-semibold uppercase">
                    Tenant ID
                  </span>
                  <p className="font-mono font-semibold text-indigo-700 text-sm mt-0.5">
                    {selectedAccount.accountId}
                  </p>
                  <span className="text-[10px] text-slate-400">Isolated database partition</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                <h4 className="font-semibold text-slate-800 text-xs uppercase tracking-wide">
                  Account Administrator
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Full Name</span>
                    <span className="font-medium text-slate-700">{selectedAccount.adminName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Email</span>
                    <span className="font-mono text-slate-700">{selectedAccount.adminEmail}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Contact Number</span>
                    <span className="text-slate-700">
                      {selectedAccount.contactNumber || "Not specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Account Status</span>
                    <span
                      className={`font-semibold capitalize ${
                        selectedAccount.status === "active" ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {selectedAccount.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-center justify-between text-slate-500">
                <span>Created On:</span>
                <span className="font-medium text-slate-700">
                  {new Date(selectedAccount.createdAt).toLocaleString()}
                </span>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setIsDetailsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 3: Confirmation Dialog for Suspend/Activate --- */}
      {isConfirmSuspendOpen && accountToToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center space-x-3 text-slate-900">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  accountToToggle.status === "active"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {accountToToggle.status === "active" ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-sm">
                  {accountToToggle.status === "active"
                    ? `Suspend ${accountToToggle.companyName}?`
                    : `Activate ${accountToToggle.companyName}?`}
                </h3>
                <p className="text-xs text-slate-500">Confirmation required</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {accountToToggle.status === "active"
                ? `Suspending this account will immediately revoke API access and prevent account administrators (${accountToToggle.adminEmail}) from logging in.`
                : `Activating this account will restore full access to leads management for all associated administrators.`}
            </p>

            <div className="pt-3 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfirmSuspendOpen(false)
                  setAccountToToggle(null)
                }}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleStatus}
                className={`px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
                  accountToToggle.status === "active"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {accountToToggle.status === "active"
                  ? "Confirm Suspension"
                  : "Confirm Activation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
