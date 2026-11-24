"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { isWhiteLabelDomain, normalizeHostname } from "@/lib/domain"
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

/**
 * Clean neutral skeleton displayed exclusively during initial branding resolution
 * on white-label candidate domains when SSR payload was unavailable.
 * Strictly prevents flashing generic "Client CRM Portal Login" or "Tenant Account ID".
 */
function PortalLoginSkeleton() {
  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-indigo-50/20 to-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo Placeholder */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-200/80 animate-pulse shadow-sm" />
        </div>

        {/* Title & Subtitle Placeholders */}
        <div className="text-center mt-4 space-y-2">
          <div className="h-7 w-48 bg-slate-200/80 rounded-lg animate-pulse mx-auto" />
          <div className="h-3.5 w-60 bg-slate-100 rounded animate-pulse mx-auto" />
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="relative overflow-hidden bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10 space-y-4">
          {/* Shimmer header line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-slate-100 overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-transparent via-slate-300 to-transparent animate-shimmer" />
          </div>

          {/* Email field skeleton */}
          <div className="space-y-1.5">
            <div className="h-3 w-28 bg-slate-200/80 rounded animate-pulse" />
            <div className="h-10 w-full bg-slate-100 rounded-lg animate-pulse" />
          </div>

          {/* Password field skeleton */}
          <div className="space-y-1.5 pt-1">
            <div className="h-3 w-20 bg-slate-200/80 rounded animate-pulse" />
            <div className="h-10 w-full bg-slate-100 rounded-lg animate-pulse" />
          </div>

          {/* Button skeleton */}
          <div className="pt-2">
            <div className="h-10 w-full bg-slate-200/90 rounded-lg animate-pulse flex items-center justify-center">
              <span className="text-xs text-slate-400 font-medium">Resolving CRM workspace...</span>
            </div>
          </div>

          {/* Security badge skeleton */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="rounded-xl p-3 bg-slate-50 border border-slate-100 space-y-1.5">
              <div className="h-3.5 w-36 bg-slate-200/70 rounded animate-pulse" />
              <div className="h-3 w-full bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PortalLoginClient({
  initialBranding = null,
  initialHost = "",
  initialIsWhiteLabelCandidate = false,
  initialIsWhiteLabel = false,
  initialSearchParams = {},
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantParam = searchParams.get("tenant") || initialSearchParams?.tenant || ""
  const { login, user: authUser, status: authStatus } = useAuth()

  // Determine candidate domain status synchronously to prevent flash of generic form
  const [effectiveHost] = useState(() => {
    if (typeof window !== "undefined") {
      const clientHost = normalizeHostname(window.location.hostname)
      const urlParams = new URLSearchParams(window.location.search)
      const testDomain = urlParams.get("domain") || urlParams.get("test_domain") || ""
      return testDomain ? normalizeHostname(testDomain) : clientHost
    }
    return initialHost
  })

  const [isWhiteLabelCandidate, setIsWhiteLabelCandidate] = useState(() => {
    if (initialIsWhiteLabelCandidate) return true
    if (typeof window !== "undefined") {
      const clientHost = normalizeHostname(window.location.hostname)
      const urlParams = new URLSearchParams(window.location.search)
      const testDomain = urlParams.get("domain") || urlParams.get("test_domain") || ""
      const qHost = testDomain ? normalizeHostname(testDomain) : clientHost
      return isWhiteLabelDomain(qHost) || Boolean(testDomain)
    }
    return false
  })

  // State initialized with server-resolved props if present
  const [tenantId, setTenantId] = useState(
    () => initialBranding?.tenantId || initialBranding?.accountId || tenantParam || ""
  )
  const [tenantInfo, setTenantInfo] = useState(initialBranding)
  const [isWhiteLabel, setIsWhiteLabel] = useState(initialIsWhiteLabel)
  const [domainUnresolved, setDomainUnresolved] = useState(false)
  // If we are on a white label candidate domain but initialBranding is null, we stay in skeleton state until resolved
  const [loadingTenantInfo, setLoadingTenantInfo] = useState(() => {
    if (initialBranding) return false
    return isWhiteLabelCandidate
  })

  const [logoError, setLogoError] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState(null)
  const [checkingExistingSession, setCheckingExistingSession] = useState(authStatus === "loading")

  const emailInputRef = useRef(null)
  const passwordInputRef = useRef(null)
  const isSubmittingRef = useRef(false)

  // Apply theme styling and document title
  const applyBrandingVisuals = useCallback((brand) => {
    if (typeof window === "undefined" || !brand) return
    const brandTitle = brand.browserPageTitle || brand.displayName || brand.companyName
    if (brandTitle) {
      document.title = `${brandTitle} - Sign In`
    }
    const color = brand.brandPrimaryColor || brand.primaryColor
    if (color) {
      document.documentElement.style.setProperty("--brand-primary", color)
    }
  }, [])

  // On mount: Apply initial branding visuals immediately if present from SSR
  useEffect(() => {
    if (tenantInfo) {
      applyBrandingVisuals(tenantInfo)
    }
  }, [tenantInfo, applyBrandingVisuals])

  // Client-side branding resolution / verification
  useEffect(() => {
    if (typeof window === "undefined") return

    const clientHost = normalizeHostname(window.location.hostname)
    const testDomain = searchParams.get("domain") || searchParams.get("test_domain") || ""
    const queryHost = testDomain ? normalizeHostname(testDomain) : clientHost
    const domainIsCandidate = isWhiteLabelDomain(queryHost) || Boolean(testDomain)

    setIsWhiteLabelCandidate(domainIsCandidate)

    // If initial SSR already resolved branding for this domain, skip full network call
    if (initialBranding && initialBranding.isWhiteLabel && initialHost === queryHost) {
      applyBrandingVisuals(initialBranding)
      setLoadingTenantInfo(false)
      return
    }

    let isMounted = true

    const resolveBranding = async () => {
      try {
        setLogoError(false)

        // 1. Fetch public branding by queryHost
        const res = await apiClient.getBranding(queryHost)
        if (isMounted && res?.success && res?.data?.isWhiteLabel) {
          const brand = res.data
          setIsWhiteLabel(true)
          setDomainUnresolved(false)
          const resolvedInfo = {
            accountId: brand.accountId || brand.tenantId,
            tenantId: brand.tenantId || brand.accountId,
            companyName: brand.companyName,
            displayName: brand.displayName || brand.companyName,
            browserPageTitle: brand.browserPageTitle || brand.displayName || brand.companyName,
            logoUrl: brand.logoUrl || "",
            primaryColor: brand.brandPrimaryColor || "#4f46e5",
            brandPrimaryColor: brand.brandPrimaryColor || "#4f46e5",
            status: brand.status || "active",
          }
          setTenantInfo(resolvedInfo)
          applyBrandingVisuals(resolvedInfo)
          if (resolvedInfo.tenantId) {
            setTenantId(resolvedInfo.tenantId)
          }
          setLoadingTenantInfo(false)
          return
        }

        // 2. If domain is not white-labeled according to DB, transition out of skeleton
        if (isMounted) {
          setIsWhiteLabel(false)
          setTenantInfo(null)
          if (domainIsCandidate) {
            setDomainUnresolved(true)
          }
        }

        // 3. Fallback: check ?tenant= parameter if specified on non-white-label domain
        const effectiveTenant = tenantParam || tenantId
        if (effectiveTenant && effectiveTenant.trim()) {
          const tenantRes = await apiClient.getTenantInfo(effectiveTenant.trim())
          if (isMounted && tenantRes?.success && tenantRes?.data) {
            setTenantInfo(tenantRes.data)
            if (tenantRes.data.accountId) {
              setTenantId(tenantRes.data.accountId)
            }
            const brandTitle =
              tenantRes.data.pageTitle ||
              tenantRes.data.displayName ||
              tenantRes.data.companyName
            if (brandTitle) {
              document.title = `${brandTitle} - Sign In`
            }
          }
        }
      } catch (_err) {
        if (isMounted) {
          setIsWhiteLabel(false)
          setTenantInfo(null)
          if (domainIsCandidate) {
            setDomainUnresolved(true)
          }
        }
      } finally {
        if (isMounted) {
          setLoadingTenantInfo(false)
        }
      }
    }

    resolveBranding()

    return () => {
      isMounted = false
    }
  }, [
    initialBranding,
    initialHost,
    tenantParam,
    searchParams,
    tenantId,
    applyBrandingVisuals,
  ])

  // Prefetch destination routes in production
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      try {
        router.prefetch("/portal")
        router.prefetch("/super-admin")
      } catch (_e) {}
    }
  }, [router])

  // Check if user is already logged in on initial page load
  useEffect(() => {
    if (isSubmittingRef.current) return

    if (authStatus === "authenticated" && authUser) {
      if (authUser.role === "super_admin") {
        if (tenantParam) {
          if (typeof window !== "undefined") {
            localStorage.setItem("leadflow_active_tenant", tenantParam)
          }
          router.replace("/portal")
          return
        }
        router.replace("/super-admin")
        return
      }
      router.replace("/portal")
      return
    }
    if (authStatus === "unauthenticated") {
      setCheckingExistingSession(false)
    }
  }, [authStatus, authUser, router, tenantParam])

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
      const loginPayload = {
        email: cleanEmail,
        password,
      }
      if (typeof window !== "undefined" && window.location.hostname) {
        loginPayload.domain = window.location.hostname
      }
      if (tenantId && tenantId.trim()) {
        loginPayload.tenantId = tenantId.trim()
      }

      const response = await login(loginPayload)

      if (response && response.success && response.data?.user) {
        setIsRedirecting(true)
        if (response.data.user.role === "super_admin") {
          if (tenantId && tenantId.trim()) {
            if (typeof window !== "undefined") {
              localStorage.setItem("leadflow_active_tenant", tenantId.trim())
            }
            toast.success(`Super Admin: Accessing tenant ${tenantId.trim()}`)
            router.replace("/portal")
            return
          }
          toast.success(`Welcome back, ${response.data.user.name}!`)
          router.replace("/super-admin")
          return
        }
        toast.success(`Welcome back, ${response.data.user.name}!`)
        router.replace("/portal")
      } else {
        const errMsg = response?.error || "Login failed. Please check your credentials."
        setError(errMsg)
        toast.error(errMsg)
        setPassword("")
        isSubmittingRef.current = false
        setLoading(false)
        setIsRedirecting(false)
        if (response?.code === "USER_NOT_FOUND" && emailInputRef.current) {
          emailInputRef.current.focus()
        } else if (passwordInputRef.current) {
          passwordInputRef.current.focus()
        }
      }
    } catch (err) {
      const errMsg = err.message || "Login failed. Please check your credentials."
      setError(errMsg)
      toast.error(errMsg)
      setPassword("")
      isSubmittingRef.current = false
      setLoading(false)
      setIsRedirecting(false)
      if (err?.code === "USER_NOT_FOUND" && emailInputRef.current) {
        emailInputRef.current.focus()
      } else if (passwordInputRef.current) {
        passwordInputRef.current.focus()
      }
    }
  }

  if (isRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 via-indigo-50/20 to-slate-100">
        <div className="flex flex-col items-center space-y-4 text-center animate-in fade-in duration-150">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-100 text-white">
            <Building2 className="w-7 h-7" />
          </div>
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <div>
            <h3 className="text-base font-bold text-slate-900">Access Granted</h3>
            <p className="text-xs text-slate-500 mt-0.5">Opening your CRM workspace...</p>
          </div>
        </div>
      </div>
    )
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

  // During resolution on a white-label candidate domain without tenant branding yet:
  // Render neutral skeleton to strictly avoid flashing generic Client CRM branding or Tenant ID input
  if (loadingTenantInfo && isWhiteLabelCandidate && !tenantInfo) {
    return <PortalLoginSkeleton />
  }

  // If visitor is on an unconfigured custom domain candidate, display safe resolution error
  // Strictly avoids displaying another tenant's branding or generic portal without context
  if (domainUnresolved && isWhiteLabelCandidate && !tenantInfo) {
    return (
      <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-indigo-50/20 to-slate-100">
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
          <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Custom Domain Not Active</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                The domain <span className="font-mono text-slate-700 font-semibold">{effectiveHost}</span> is not linked to an active CRM organization or is pending DNS setup.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setDomainUnresolved(false)
                  setIsWhiteLabelCandidate(false)
                }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
              >
                Sign in using Tenant Account ID
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-indigo-50/20 to-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Icon & Heading */}
        <div className="flex justify-center">
          {tenantInfo?.logoUrl && !logoError ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={tenantInfo.logoUrl}
              alt={tenantInfo.displayName || tenantInfo.companyName || "Logo"}
              onError={() => setLogoError(true)}
              className="h-14 max-w-[240px] object-contain drop-shadow-sm transition-transform hover:scale-105 duration-200"
            />
          ) : (
            <div
              className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-100 text-white transition-transform hover:scale-105 duration-200"
              style={{
                backgroundColor:
                  tenantInfo?.brandPrimaryColor || tenantInfo?.primaryColor || undefined,
              }}
            >
              <Building2 className="w-7 h-7" />
            </div>
          )}
        </div>

        {tenantInfo ? (
          <div className="text-center mt-4">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
              {tenantInfo.displayName || tenantInfo.browserPageTitle || tenantInfo.companyName}
            </h2>
            <p className="mt-1 text-center text-xs text-slate-500">
              {tenantInfo.displayName
                ? `Sign in to access ${tenantInfo.displayName}'s CRM workspace`
                : "Client CRM Workspace & Leads Portal"}
            </p>
          </div>
        ) : (
          <div className="text-center mt-4">
            <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
              {isWhiteLabel ? "Client CRM Portal" : "Client CRM Portal Login"}
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

          {searchParams.get("session") === "mismatch" && !error && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Session Switched:</strong> Your previous session belonged to another organization. Please sign in with your credentials for this workspace.
              </span>
            </div>
          )}

          {searchParams.get("session") === "expired" && !error && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Session Expired:</strong> Your previous session has timed out. Please sign in
                again to continue.
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
            {/* When isWhiteLabel is true, HIDE the Tenant Account ID field completely since domain locks the tenant */}
            {!isWhiteLabel && (
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
            )}

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
                  ref={emailInputRef}
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
                style={{
                  backgroundColor:
                    tenantInfo?.brandPrimaryColor || tenantInfo?.primaryColor || undefined,
                }}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-xs font-semibold text-white bg-indigo-600 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-85 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed select-none"
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
                    <span>
                      {tenantInfo?.displayName
                        ? `Sign In to ${tenantInfo.displayName}`
                        : isWhiteLabel
                        ? "Sign In to Client CRM"
                        : "Sign In to Client CRM"}
                    </span>
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
                <ShieldCheck
                  className="w-3.5 h-3.5 text-indigo-600"
                  style={{
                    color:
                      tenantInfo?.brandPrimaryColor || tenantInfo?.primaryColor || undefined,
                  }}
                />
                <span>Isolated Multi-Tenant CRM</span>
              </div>
              <p className="text-slate-500">
                {tenantInfo?.displayName
                  ? `Sign in with authorized credentials for ${tenantInfo.displayName} to access your team's leads, calls, and performance reports.`
                  : "Each client organization operates in its own isolated database partition. Only authorized administrators of this account can access its leads."}
              </p>
            </div>

            {!isWhiteLabel && (
              <div className="flex items-center justify-center text-xs pt-2">
                <Link
                  href="/"
                  className="text-slate-400 hover:text-slate-600 transition-colors text-[11px]"
                >
                  Home
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
