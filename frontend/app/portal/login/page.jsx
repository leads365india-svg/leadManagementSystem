"use client"

import React, { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { toast } from "react-hot-toast"
import {
  Building2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  KeyRound,
} from "lucide-react"

function PortalLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantParam = searchParams.get("tenant") || ""
  const { login, user: authUser, status: authStatus } = useAuth()

  const [tenantId, setTenantId] = useState(tenantParam)
  const [tenantInfo, setTenantInfo] = useState(null)
  const [loadingTenantInfo, setLoadingTenantInfo] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState(null)
  const [checkingExistingSession, setCheckingExistingSession] = useState(authStatus === "loading")

  const passwordInputRef = useRef(null)
  const isSubmittingRef = useRef(false)

  // Sync tenant from URL param
  useEffect(() => {
    if (tenantParam) {
      setTenantId(tenantParam)
    }
  }, [tenantParam])

  // Fetch tenant metadata if tenant ID is provided
  useEffect(() => {
    let isMounted = true
    if (!tenantId.trim()) {
      setTenantInfo(null)
      return
    }

    const fetchTenant = async () => {
      try {
        setLoadingTenantInfo(true)
        const response = await apiClient.getTenantInfo(tenantId.trim())
        if (isMounted && response.success && response.data) {
          setTenantInfo(response.data)
        } else if (isMounted) {
          setTenantInfo(null)
        }
      } catch (_err) {
        if (isMounted) {
          setTenantInfo(null)
        }
      } finally {
        if (isMounted) {
          setLoadingTenantInfo(false)
        }
      }
    }

    fetchTenant()

    return () => {
      isMounted = false
    }
  }, [tenantId])

  // Check if user is already logged in on initial page load
  useEffect(() => {
    if (isSubmittingRef.current) return

    if (authStatus === "authenticated" && authUser) {
      if (authUser.role === "super_admin") {
        router.replace("/super-admin")
        return
      }
      if (authUser.role === "account_admin") {
        router.replace("/portal")
        return
      }
    }
    if (authStatus === "unauthenticated") {
      setCheckingExistingSession(false)
    }
  }, [authStatus, authUser, router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading || isSubmittingRef.current) return
    setError(null)

    const cleanEmail = email.trim()
    if (!cleanEmail || !password) {
      const msg = "Please enter both email and password"
      setError(msg)
      return
    }

    isSubmittingRef.current = true
    setLoading(true)

    try {
      const response = await login({
        email: cleanEmail,
        password,
      })

      if (response && response.success && response.data?.user) {
        setIsRedirecting(true)
        if (response.data.user.role === "super_admin") {
          toast.success("Super Admin authenticated. Redirecting to console...")
          router.replace("/super-admin")
          return
        }
        toast.success(`Welcome back, ${response.data.user.name}!`)
        router.replace("/portal")
      } else {
        const errMsg = response?.error || "Invalid email or password"
        setError(errMsg)
        setPassword("")
        isSubmittingRef.current = false
        setLoading(false)
        setIsRedirecting(false)
        if (passwordInputRef.current) {
          passwordInputRef.current.focus()
        }
      }
    } catch (err) {
      const errMsg = err.message || "Invalid credentials. Please verify your email and password."
      setError(errMsg)
      setPassword("")
      isSubmittingRef.current = false
      setLoading(false)
      setIsRedirecting(false)
      if (passwordInputRef.current) {
        passwordInputRef.current.focus()
      }
    }
  }

  if (checkingExistingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
          <p className="text-xs font-medium text-slate-500">Checking active session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-indigo-50/20 to-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Icon & Heading */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-100 text-white transition-transform hover:scale-105 duration-200">
            <Building2 className="w-7 h-7" />
          </div>
        </div>

        {tenantInfo ? (
          <div className="text-center mt-4">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 uppercase tracking-wider">
              Tenant: {tenantInfo.accountId}
            </span>
            <h2 className="mt-2 text-center text-2xl font-bold tracking-tight text-slate-900">
              {tenantInfo.companyName}
            </h2>
            <p className="mt-1 text-center text-xs text-slate-500">
              Client CRM Workspace & Leads Portal
            </p>
          </div>
        ) : (
          <div className="text-center mt-4">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
              Client CRM Portal Login
            </h2>
            <p className="mt-1 text-center text-xs text-slate-500">
              Sign in with your Leads Account Administrator credentials
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="relative overflow-hidden bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10">
          {/* Top animated shimmer bar during active login */}
          {loading && (
            <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-100 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-transparent via-indigo-600 to-transparent animate-shimmer" />
            </div>
          )}

          {searchParams.get("session") === "expired" && !error && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Session Expired:</strong> Your previous session has timed out. Please sign in again to continue.
              </span>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start space-x-3 text-red-800 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {tenantInfo?.status === "suspended" && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Account Suspended:</strong> Access for this account has been suspended by
                the system administrator.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Optional Tenant ID Field (autofilled if URL query param exists) */}
            <div>
              <label
                htmlFor="tenantId"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Tenant Account ID
              </label>
              <div className="mt-1.5 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="tenantId"
                  name="tenantId"
                  type="text"
                  disabled={loading}
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value.toUpperCase())}
                  placeholder="e.g. ACC-XXXX (optional)"
                  className="block w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-all disabled:opacity-75 disabled:cursor-not-allowed"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Leave empty or provide your company Tenant ID
              </p>
            </div>

            {/* Admin Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Admin Email Address <span className="text-red-500">*</span>
              </label>
              <div className="mt-1.5 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@yourcompany.com"
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-all disabled:opacity-75 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Password <span className="text-red-500">*</span>
              </label>
              <div className="mt-1.5 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  ref={passwordInputRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-all disabled:opacity-75 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 disabled:opacity-50 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || tenantInfo?.status === "suspended"}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-85 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed select-none"
              >
                {loading ? (
                  isRedirecting ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-300 animate-in zoom-in-50 duration-200" />
                      <span>Access Granted. Opening Portal...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white motion-reduce:animate-none"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Signing in...</span>
                    </>
                  )
                ) : (
                  <>
                    <span>Sign In to Client CRM</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Info & Help */}
          <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
            <div className="rounded-xl p-3 bg-slate-50 border border-slate-200/90 text-[11px] text-slate-600 space-y-1">
              <div className="flex items-center space-x-1.5 font-semibold text-slate-700">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                <span>Isolated Multi-Tenant CRM</span>
              </div>
              <p className="text-slate-500">
                Each client organization operates in its own isolated database partition. Only
                authorized administrators of this account can access its leads.
              </p>
            </div>

            <div className="flex items-center justify-between text-xs pt-2">
              <Link
                href="/super-admin/login"
                className="text-slate-500 hover:text-indigo-600 transition-colors font-medium text-[11px]"
              >
                Super Admin Login →
              </Link>
              <Link
                href="/"
                className="text-slate-400 hover:text-slate-600 transition-colors text-[11px]"
              >
                Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PortalLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
        </div>
      }
    >
      <PortalLoginForm />
    </Suspense>
  )
}
