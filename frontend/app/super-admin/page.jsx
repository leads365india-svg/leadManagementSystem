"use client"

import React, { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
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
  ExternalLink,
  Edit2,
  Globe,
  Palette,
  ChevronLeft,
  ChevronRight,
  Phone,
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
  const [isSearching, setIsSearching] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalAccountsCount, setTotalAccountsCount] = useState(0)
  const [accountsLoadError, setAccountsLoadError] = useState(null)

  const activeReqIdRef = useRef(0)

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [isConfirmSuspendOpen, setIsConfirmSuspendOpen] = useState(false)
  const [accountToToggle, setAccountToToggle] = useState(null)

  // Success Notification Banner State
  const [successMessage, setSuccessMessage] = useState(null)

  // Add Account Form Data
  const [formData, setFormData] = useState({
    companyName: "",
    displayName: "",
    adminName: "",
    adminEmail: "",
    countryCode: "IN",
    contactNumber: "",
    password: "",
    confirmPassword: "",
    status: "active",
    customDomain: "",
    logoUrl: "",
    primaryColor: "#4f46e5",
    pageTitle: "",
  })

  // Edit Account Form Data
  const [editFormData, setEditFormData] = useState({
    id: "",
    companyName: "",
    displayName: "",
    adminName: "",
    countryCode: "IN",
    contactNumber: "",
    customDomain: "",
    logoUrl: "",
    primaryColor: "#4f46e5",
    pageTitle: "",
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [editFormErrors, setEditFormErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)

  // Debounce search input by 200ms so typing feels instantaneous and avoids unnecessary backend load
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
      setPage(1)
    }, 200)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Fetch Global Summary Stats (only on mount, manual refresh, or mutate actions)
  const loadStats = useCallback(async () => {
    try {
      const statsRes = await apiClient.getSuperAdminStats()
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data)
      }
    } catch (error) {
      console.error("Failed to load dashboard stats:", error)
    }
  }, [])

  // Fetch Accounts List with fast cancellation/ignoring of stale network queries
  const loadAccounts = useCallback(async (queryTerm, statusVal, pageVal) => {
    const reqId = ++activeReqIdRef.current
    setIsSearching(true)
    setAccountsLoadError(null)
    try {
      const accountsRes = await apiClient.getSuperAdminAccounts({
        page: pageVal,
        limit: 10,
        search: (queryTerm || "").trim(),
        status: statusVal !== "all" ? statusVal : undefined,
      })

      if (reqId === activeReqIdRef.current && accountsRes.success && accountsRes.data) {
        setAccounts(accountsRes.data.accounts || [])
        setTotalPages(accountsRes.data.totalPages || 1)
        setTotalAccountsCount(accountsRes.data.total || 0)
        setAccountsLoadError(null)
      }
    } catch (error) {
      if (reqId === activeReqIdRef.current) {
        console.error("Failed to load accounts:", error)
        setAccountsLoadError(error.message || "Failed to load accounts list")
        toast.error("Failed to load accounts list")
      }
    } finally {
      if (reqId === activeReqIdRef.current) {
        setLoading(false)
        setIsSearching(false)
        setRefreshing(false)
      }
    }
  }, [])

  // Initial load of global metrics
  useEffect(() => {
    loadStats()
  }, [loadStats])

  // Instant or debounced trigger for accounts list
  useEffect(() => {
    loadAccounts(debouncedSearch, statusFilter, page)
  }, [debouncedSearch, statusFilter, page, loadAccounts])

  // Complete data refresh (both stats and accounts)
  const refreshAllData = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([
      loadStats(),
      loadAccounts(debouncedSearch, statusFilter, page),
    ])
    setRefreshing(false)
  }, [debouncedSearch, statusFilter, page, loadStats, loadAccounts])

  // Copy helper
  const handleCopy = (text, key) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Copy full client package
  const copyClientPackage = (pkg) => {
    const text = `🌟 LeadFlow CRM - Client Portal Credentials
🏢 Organization: ${pkg.companyName}
🆔 Tenant ID: ${pkg.accountId}
🌐 Portal URL: ${pkg.portalUrl}
📧 Admin Email: ${pkg.adminEmail}
🔑 Password: ${pkg.password}

Please sign in at the URL above to access your dedicated CRM pipeline.`
    navigator.clipboard.writeText(text)
    setCopiedKey("pkg")
    toast.success("Credentials copied to clipboard!")
    setTimeout(() => setCopiedKey(null), 3000)
  }

  // Validation helper for Indian mobile numbers (10 digits starting with 6-9, handles +91, 0 prefix, spaces)
  const validateMobile = (number, countryCode) => {
    if (!number || !number.trim()) return true // Optional
    let clean = number.trim().replace(/[\s\-+()]/g, "")
    if (countryCode === "IN") {
      if (clean.startsWith("91") && clean.length === 12) {
        clean = clean.slice(2)
      } else if (clean.startsWith("0")) {
        clean = clean.replace(/^0+/, "")
      }
      return /^[6-9]\d{9}$/.test(clean)
    }
    // Generic phone check for other countries: 7 to 15 digits
    return /^\d{7,15}$/.test(clean)
  }

  // Domain sanitization helper (strips protocol, paths, and ports)
  const sanitizeDomain = (domain) => {
    if (!domain || !domain.trim()) return ""
    return domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .trim()
  }

  // Domain format validation helper
  const validateDomain = (domain) => {
    if (!domain || !domain.trim()) return true // Optional
    const clean = sanitizeDomain(domain)
    if (!clean || clean.includes("://") || clean.includes("/") || clean.includes(":") || clean.includes("?")) {
      return false
    }
    return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(clean)
  }

  // Validate Add Account form fields
  const validateForm = () => {
    const errors = {}
    if (!formData.companyName.trim()) {
      errors.companyName = "Company / Leads Account name is required"
    } else if (formData.companyName.trim().length < 2) {
      errors.companyName = "Company name must be at least 2 characters long"
    }

    if (!formData.displayName.trim()) {
      errors.displayName = "Display name is required"
    } else if (formData.displayName.trim().length < 2) {
      errors.displayName = "Display name must be at least 2 characters long"
    }

    if (!formData.adminName.trim()) {
      errors.adminName = "Account Admin full name is required"
    } else if (formData.adminName.trim().length < 2) {
      errors.adminName = "Account Admin full name must be at least 2 characters long"
    }

    if (!formData.adminEmail.trim()) {
      errors.adminEmail = "Admin email address is required"
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(formData.adminEmail.trim())) {
        errors.adminEmail = "Please enter a valid email address"
      }
    }

    if (formData.contactNumber.trim()) {
      if (!validateMobile(formData.contactNumber, formData.countryCode)) {
        errors.contactNumber =
          formData.countryCode === "IN"
            ? "Enter a valid 10-digit Indian mobile number (e.g. 9876543210)"
            : "Enter a valid phone number (digits only)"
      }
    }

    if (formData.customDomain.trim()) {
      if (!validateDomain(formData.customDomain)) {
        errors.customDomain = "Invalid domain format. Example: crm.yourcompany.com"
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

  // Validate Edit Account form fields
  const validateEditForm = () => {
    const errors = {}
    if (!editFormData.companyName.trim()) {
      errors.companyName = "Company name is required"
    } else if (editFormData.companyName.trim().length < 2) {
      errors.companyName = "Company name must be at least 2 characters long"
    }

    if (!editFormData.displayName.trim()) {
      errors.displayName = "Display name is required"
    } else if (editFormData.displayName.trim().length < 2) {
      errors.displayName = "Display name must be at least 2 characters long"
    }

    if (!editFormData.adminName.trim()) {
      errors.adminName = "Admin full name is required"
    } else if (editFormData.adminName.trim().length < 2) {
      errors.adminName = "Admin full name must be at least 2 characters long"
    }

    if (editFormData.contactNumber.trim()) {
      if (!validateMobile(editFormData.contactNumber, editFormData.countryCode)) {
        errors.contactNumber =
          editFormData.countryCode === "IN"
            ? "Enter a valid 10-digit Indian mobile number (e.g. 9876543210)"
            : "Enter a valid phone number (digits only)"
      }
    }
    if (editFormData.customDomain.trim()) {
      if (!validateDomain(editFormData.customDomain)) {
        errors.customDomain = "Invalid domain format. Example: crm.yourcompany.com"
      }
    }
    setEditFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Handle Add Account Form Submission
  const handleCreateAccount = async (e) => {
    e.preventDefault()
    setActionError(null)

    if (!validateForm()) {
      toast.error("Please resolve the validation errors")
      return
    }

    let toastId = null
    try {
      setIsSubmitting(true)
      toastId = toast.loading("Creating Leads Account & Admin user...")
      const { confirmPassword, ...payload } = formData
      
      // Sanitize custom domain if provided
      if (payload.customDomain) {
        payload.customDomain = sanitizeDomain(payload.customDomain)
      }

      // Normalize Indian mobile number format before sending
      if (payload.countryCode === "IN" && payload.contactNumber) {
        let clean = payload.contactNumber.trim().replace(/[\s\-+()]/g, "")
        if (clean.startsWith("91") && clean.length === 12) clean = clean.slice(2)
        else if (clean.startsWith("0")) clean = clean.replace(/^0+/, "")
        payload.contactNumber = clean
      }

      const response = await apiClient.createSuperAdminAccount(payload)

      if (response.success && response.data) {
        const acc = response.data.account
        const origin = typeof window !== "undefined" ? window.location.origin : ""
        const portalUrl = `${origin}/portal/login?tenant=${acc.accountId}`

        toast.success(`Leads Account "${acc.companyName}" created successfully!`)

        setSuccessMessage({
          accountId: acc.accountId,
          companyName: acc.companyName,
          adminEmail: acc.adminEmail,
          password: payload.password,
          portalUrl,
        })

        // Reset form
        setFormData({
          companyName: "",
          displayName: "",
          adminName: "",
          adminEmail: "",
          countryCode: "IN",
          contactNumber: "",
          password: "",
          confirmPassword: "",
          status: "active",
          customDomain: "",
          logoUrl: "",
          primaryColor: "#4f46e5",
          pageTitle: "",
        })
        setShowPassword(false)
        setShowConfirmPassword(false)
        setIsAddModalOpen(false)

        // Seamlessly refresh stats and accounts
        loadStats()
        loadAccounts(debouncedSearch, statusFilter, 1)
      } else {
        const errMsg = response.error || "Failed to create Leads Account"
        setActionError(errMsg)
        toast.error(errMsg)
      }
    } catch (err) {
      const errMsg = err.message || "Failed to create Leads Account"
      setActionError(errMsg)
      toast.error(errMsg)
    } finally {
      if (toastId) toast.dismiss(toastId)
      setIsSubmitting(false)
    }
  }

  // Open Edit Modal for an Account
  const handleOpenEditModal = (account) => {
    setEditFormData({
      id: account.id,
      companyName: account.companyName || "",
      displayName: account.displayName || "",
      adminName: account.adminName || "",
      countryCode: "IN",
      contactNumber: account.contactNumber || "",
      customDomain: account.customDomain || "",
      logoUrl: account.logoUrl || "",
      primaryColor: account.primaryColor || "#4f46e5",
      pageTitle: account.pageTitle || "",
    })
    setEditFormErrors({})
    setIsEditModalOpen(true)
  }

  // Handle Edit Account Form Submission
  const handleUpdateAccount = async (e) => {
    e.preventDefault()
    if (!validateEditForm()) {
      toast.error("Please resolve the validation errors")
      return
    }

    try {
      setIsUpdating(true)
      const toastId = toast.loading("Saving account & white-label settings...")
      const { id, ...payload } = editFormData
      const response = await apiClient.updateSuperAdminAccount(id, payload)
      toast.dismiss(toastId)

      if (response.success) {
        toast.success(`Account "${editFormData.companyName}" updated successfully!`)
        setIsEditModalOpen(false)
        loadStats()
        loadAccounts(debouncedSearch, statusFilter, page)
      } else {
        toast.error(response.error || "Failed to update account")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update account")
    } finally {
      setIsUpdating(false)
    }
  }

  // Handle Account Status Toggle (Activate/Suspend)
  const handleToggleStatus = async () => {
    if (!accountToToggle) return

    const newStatus = accountToToggle.status === "active" ? "suspended" : "active"
    const toastId = toast.loading(`Updating account status to ${newStatus}...`)

    try {
      const response = await apiClient.updateAccountStatus(accountToToggle.id, newStatus)
      toast.dismiss(toastId)
      if (response.success) {
        toast.success(`Account "${accountToToggle.companyName}" is now ${newStatus}!`)
        setIsConfirmSuspendOpen(false)
        setAccountToToggle(null)
        loadStats()
        loadAccounts(debouncedSearch, statusFilter, page)
      } else {
        const errMsg = response.error || "Failed to update status"
        toast.error(errMsg)
      }
    } catch (err) {
      toast.dismiss(toastId)
      const errMsg = err.message || "Failed to update status"
      toast.error(errMsg)
    }
  }

  // Compute pagination record count string
  const startRecord = totalAccountsCount === 0 ? 0 : (page - 1) * 10 + 1
  const endRecord = Math.min(page * 10, totalAccountsCount)

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2.5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leads Accounts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage customer accounts, tenant administrators, and white-label branding
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => refreshAllData()}
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
                countryCode: "IN",
                contactNumber: "",
                password: "",
                confirmPassword: "",
                status: "active",
                customDomain: "",
                logoUrl: "",
                primaryColor: "#4f46e5",
                pageTitle: "",
              })
              setFormErrors({})
              setActionError(null)
              setIsAddModalOpen(true)
            }}
            className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Leads Account</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner when Account is created */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 shadow-2xs space-y-3 animate-in fade-in">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-emerald-950">
                  Leads Account & Client Portal Provisioned Successfully!
                </h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Account <strong>{successMessage.companyName}</strong> is active. You can share these credentials with the client:
                </p>
              </div>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-500 hover:text-emerald-800 p-1 rounded-lg cursor-pointer"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-white p-3.5 rounded-lg border border-emerald-200">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Dedicated Client Portal URL
              </span>
              <div className="flex items-center space-x-2 mt-1">
                <a
                  href={successMessage.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline truncate max-w-[260px] flex items-center space-x-1"
                >
                  <span>{successMessage.portalUrl}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
                <button
                  onClick={() => handleCopy(successMessage.portalUrl, "success-url")}
                  className="text-slate-400 hover:text-indigo-600 cursor-pointer p-0.5"
                  title="Copy URL"
                >
                  {copiedKey === "success-url" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Account ID & Admin Email
              </span>
              <p className="font-mono text-xs text-slate-800 mt-1">
                ID: <span className="font-semibold text-indigo-700">{successMessage.accountId}</span> | Email: <span className="font-semibold">{successMessage.adminEmail}</span>
              </p>
            </div>

            <div className="md:col-span-2 pt-2 border-t border-emerald-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-slate-500 text-xs font-medium">Configured Password:</span>
                <span className="font-mono font-bold bg-slate-100 px-2.5 py-0.5 rounded text-slate-800 text-xs">
                  {successMessage.password}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => copyClientPackage(successMessage)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  {copiedKey === "pkg" ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === "pkg" ? "Copied!" : "Copy Full Client Package"}</span>
                </button>

                <a
                  href={successMessage.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors"
                >
                  <span>Open Portal</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4 Compact Summary Cards (Full Dataset Metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Accounts
            </p>
            <h3 className="text-xl font-bold text-slate-900 mt-1">{stats.totalAccounts}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Active Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Active Accounts
            </p>
            <h3 className="text-xl font-bold text-emerald-600 mt-1">{stats.activeAccounts}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Suspended Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Suspended Accounts
            </p>
            <h3 className="text-xl font-bold text-amber-600 mt-1">{stats.suspendedAccounts}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Account Admins */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Account Admins
            </p>
            <h3 className="text-xl font-bold text-slate-900 mt-1">{stats.totalAdmins}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          {isSearching ? (
            <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          ) : (
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by company, ID, admin email, domain..."
            className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("")
                setDebouncedSearch("")
                setPage(1)
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500 font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1) // Reset to page 1 on status change
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
          >
            <option value="all">All Accounts</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>
        </div>
      </div>

      {/* Leads Accounts Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 sm:px-6">Company / Account Name</th>
                <th className="py-3 px-4">Account ID</th>
                <th className="py-3 px-4">Account Admin</th>
                <th className="py-3 px-4">Admin Email</th>
                <th className="py-3 px-4">Custom Domain / Portal</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                      <span>Loading Leads Accounts...</span>
                    </div>
                  </td>
                </tr>
              ) : accountsLoadError ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <AlertTriangle className="w-8 h-8 text-rose-500" />
                      <p className="font-bold text-slate-800">Failed to Load Leads Accounts</p>
                      <p className="text-xs text-rose-600 max-w-sm">{accountsLoadError}</p>
                      <button
                        type="button"
                        onClick={() => loadAccounts(debouncedSearch, statusFilter, page)}
                        className="mt-2 inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Building2 className="w-8 h-8 text-slate-300" />
                      <p className="font-medium text-slate-700">No Leads Accounts Found</p>
                      <p className="text-xs text-slate-400">
                        {debouncedSearch || statusFilter !== "all"
                          ? "Try adjusting your search query or status filter."
                          : "Get started by clicking 'Add Leads Account'."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 sm:px-6">
                      <div className="font-semibold text-slate-900">{account.companyName}</div>
                      <div className="text-[11px] text-slate-400">{account.displayName}</div>
                    </td>

                    <td className="py-3 px-4">
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

                    <td className="py-3 px-4 font-medium text-slate-800">
                      {account.adminName}
                    </td>

                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                      {account.adminEmail}
                    </td>

                    <td className="py-3 px-4">
                      {account.customDomain ? (
                        <div className="flex flex-col space-y-1">
                          <div className="flex items-center space-x-1">
                            <Globe className="w-3 h-3 text-indigo-600 shrink-0" />
                            <span className="font-mono font-medium text-slate-800 text-[11px] truncate max-w-[130px]">
                              {account.customDomain}
                            </span>
                          </div>
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                            Pending DNS
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1.5">
                          <Link
                            href={`/portal/login?tenant=${account.accountId}`}
                            target="_blank"
                            className="inline-flex items-center space-x-1 text-[11px] font-mono text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200/80 transition-colors"
                            title="Open Client Portal in New Tab"
                          >
                            <span className="truncate max-w-[90px]">/portal?tenant={account.accountId}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </Link>
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
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

                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {new Date(account.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>

                    <td className="py-3 px-4 sm:px-6 text-right space-x-1.5 whitespace-nowrap">
                      {/* View Details */}
                      <button
                        onClick={() => {
                          setSelectedAccount(account)
                          setIsDetailsModalOpen(true)
                        }}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                        title="View Account Details & White-Label"
                      >
                        <Eye className="w-3 h-3 text-slate-500" />
                        <span>Details</span>
                      </button>

                      {/* Edit Account & White-Label */}
                      <button
                        onClick={() => handleOpenEditModal(account)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors cursor-pointer"
                        title="Edit Account & Branding"
                      >
                        <Edit2 className="w-3 h-3 text-indigo-600" />
                        <span>Edit</span>
                      </button>

                      {/* Activate / Suspend with Confirmation */}
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

        {/* Section 3: Pagination Controls (Max 10 per page) */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            Showing {startRecord}–{endRecord} of {totalAccountsCount} accounts
          </div>

          <div className="flex items-center space-x-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center space-x-1 px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            <span className="px-3 py-1 font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg">
              Page {page} of {Math.max(1, totalPages)}
            </span>

            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center space-x-1 px-3 py-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* --- MODAL 1: Add Leads Account Form (Sections A & B + White-Label) --- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full my-8 overflow-hidden">
            <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 text-sm">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <span>Add New Leads Account</span>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              {actionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Section A: Account & White-Label Information */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-100">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Section A: Account & White-Label Information
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Company / Leads Account Name <span className="text-red-500">*</span>
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

                  {/* Display Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Display Name <span className="text-red-500">*</span>
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

                  {/* Custom Domain (Optional) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Custom Domain (Optional)
                    </label>
                    <div className="relative">
                      <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="crm.yourcompany.com"
                        value={formData.customDomain}
                        onChange={(e) => setFormData({ ...formData, customDomain: e.target.value })}
                        className="w-full text-xs pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                      />
                    </div>
                    {formErrors.customDomain && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.customDomain}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Pending DNS CNAME pointing to <code className="font-mono">portal.leadflow.io</code>
                    </p>
                  </div>

                  {/* Logo URL (Optional) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Logo URL (Optional)
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={formData.logoUrl}
                      onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                    />
                  </div>

                  {/* Primary Brand Colour */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Primary Brand Colour
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={formData.primaryColor}
                        onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer p-0.5 bg-white"
                      />
                      <input
                        type="text"
                        value={formData.primaryColor}
                        onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                        placeholder="#4f46e5"
                        className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono"
                      />
                    </div>
                  </div>

                  {/* Account Status */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Initial Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="active">Active (Default)</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section B: Account Admin Information */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-100">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Section B: Account Admin Information
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Admin Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Admin Full Name <span className="text-red-500">*</span>
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
                      Admin Email <span className="text-red-500">*</span>
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

                  {/* Mobile Number with Indian / Global Rule */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mobile Number (Validated)
                    </label>
                    <div className="flex space-x-2">
                      <select
                        value={formData.countryCode}
                        onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                        className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      >
                        <option value="IN">🇮🇳 India (+91)</option>
                        <option value="US">🇺🇸 USA / Canada (+1)</option>
                        <option value="UK">🇬🇧 UK (+44)</option>
                        <option value="OTHER">🌐 Other</option>
                      </select>
                      <input
                        type="text"
                        placeholder={formData.countryCode === "IN" ? "10-digit mobile (e.g. 9876543210)" : "Phone number"}
                        value={formData.contactNumber}
                        onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                        className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono"
                      />
                    </div>
                    {formErrors.contactNumber && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.contactNumber}</p>
                    )}
                  </div>

                  {/* Password */}
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
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {formErrors.password && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.password}</p>
                    )}
                  </div>

                  {/* Confirm Password */}
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
                        {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {formErrors.confirmPassword && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Informational Guidance */}
              <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-start space-x-2">
                <Lock className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <span>
                  The Admin will log in using this email and password. Passwords are securely hashed with bcrypt. A dedicated client portal path (<code className="font-mono text-indigo-700">/portal/login?tenant=...</code>) is automatically generated.
                </span>
              </div>

              {/* Modal Buttons */}
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

      {/* --- MODAL 2: Edit Account & White-Label Settings --- */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full my-8 overflow-hidden">
            <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 text-sm">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                <span>Edit Account & White-Label Settings</span>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateAccount} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.companyName}
                    onChange={(e) => setEditFormData({ ...editFormData, companyName: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  {editFormErrors.companyName && (
                    <p className="text-[11px] text-red-600 mt-1">{editFormErrors.companyName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Display Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.displayName}
                    onChange={(e) => setEditFormData({ ...editFormData, displayName: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  {editFormErrors.displayName && (
                    <p className="text-[11px] text-red-600 mt-1">{editFormErrors.displayName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Admin Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.adminName}
                    onChange={(e) => setEditFormData({ ...editFormData, adminName: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  {editFormErrors.adminName && (
                    <p className="text-[11px] text-red-600 mt-1">{editFormErrors.adminName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact Number
                  </label>
                  <input
                    type="text"
                    placeholder="10-digit mobile"
                    value={editFormData.contactNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, contactNumber: e.target.value })}
                    className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                  />
                  {editFormErrors.contactNumber && (
                    <p className="text-[11px] text-red-600 mt-1">{editFormErrors.contactNumber}</p>
                  )}
                </div>
              </div>

              {/* White-Label Settings Section */}
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center space-x-2">
                  <Palette className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    White-Label Customization
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Custom Domain
                    </label>
                    <input
                      type="text"
                      placeholder="crm.yourbrand.com"
                      value={editFormData.customDomain}
                      onChange={(e) => setEditFormData({ ...editFormData, customDomain: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    {editFormErrors.customDomain && (
                      <p className="text-[11px] text-red-600 mt-1">{editFormErrors.customDomain}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Browser Page Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Apex CRM Portal"
                      value={editFormData.pageTitle}
                      onChange={(e) => setEditFormData({ ...editFormData, pageTitle: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Logo URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={editFormData.logoUrl}
                      onChange={(e) => setEditFormData({ ...editFormData, logoUrl: e.target.value })}
                      className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Brand Primary Colour
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={editFormData.primaryColor}
                        onChange={(e) => setEditFormData({ ...editFormData, primaryColor: e.target.value })}
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer p-0.5 bg-white"
                      />
                      <input
                        type="text"
                        value={editFormData.primaryColor}
                        onChange={(e) => setEditFormData({ ...editFormData, primaryColor: e.target.value })}
                        className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* DNS Notice */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[11px] leading-relaxed">
                  <strong>Notice on Domain Activation:</strong> Custom domain activation remains pending until DNS configuration is verified. Add a <code>CNAME</code> record pointing to <code>portal.leadflow.io</code> in your DNS provider.
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  {isUpdating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 3: Account Details View + White-Label Summary --- */}
      {isDetailsModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full my-8 overflow-hidden">
            <div className="h-14 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-2 font-semibold text-slate-900 text-sm">
                <Info className="w-4 h-4 text-indigo-600" />
                <span>Account Details: {selectedAccount.companyName}</span>
              </div>
              <button
                onClick={() => setIsDetailsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
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

              {/* Dedicated Client Portal Link */}
              <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3.5 space-y-1.5">
                <span className="text-slate-500 block text-[10px] font-semibold uppercase tracking-wider">
                  Client CRM Portal URL
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-indigo-700 text-xs truncate">
                    {typeof window !== "undefined" ? window.location.origin : ""}/portal/login?tenant={selectedAccount.accountId}
                  </span>
                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => {
                        const origin = typeof window !== "undefined" ? window.location.origin : ""
                        handleCopy(`${origin}/portal/login?tenant=${selectedAccount.accountId}`, `modal-url`)
                      }}
                      className="p-1 text-slate-500 hover:text-indigo-600 rounded cursor-pointer"
                      title="Copy Portal Link"
                    >
                      {copiedKey === "modal-url" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <a
                      href={`/portal/login?tenant=${selectedAccount.accountId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-indigo-600 hover:text-indigo-800 rounded cursor-pointer"
                      title="Launch Portal"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* White-Label Settings Summary */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center space-x-2">
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  <h4 className="font-semibold text-slate-800 text-xs uppercase tracking-wide">
                    White-Label Configuration
                  </h4>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Custom Domain</span>
                    <span className="font-mono text-slate-800">
                      {selectedAccount.customDomain || "Not configured"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Domain Status</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      {selectedAccount.customDomain ? "Pending DNS Verification" : "Unconfigured"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Brand Colour</span>
                    <div className="flex items-center space-x-2 mt-0.5">
                      <span
                        className="w-4 h-4 rounded-full border border-slate-300"
                        style={{ backgroundColor: selectedAccount.primaryColor || "#4f46e5" }}
                      />
                      <span className="font-mono text-slate-700">
                        {selectedAccount.primaryColor || "#4f46e5"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Page Title</span>
                    <span className="text-slate-700">
                      {selectedAccount.pageTitle || "Default (LeadFlow CRM)"}
                    </span>
                  </div>
                </div>

                {selectedAccount.customDomain && (
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-800">DNS CNAME Setup:</p>
                    <p>Host: <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">{selectedAccount.customDomain}</code></p>
                    <p>Value: <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">portal.leadflow.io</code></p>
                  </div>
                )}
              </div>

              {/* Account Administrator Details */}
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
                    <span className="text-slate-700 font-mono">
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

      {/* --- MODAL 4: Confirmation Dialog for Suspend/Activate --- */}
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
