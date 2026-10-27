"use client"

import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Sparkles,
  CheckCircle2,
} from "lucide-react"

export default function SuperAdminLoginPage() {
  const router = useRouter()
  const { login, user: authUser, status: authStatus } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState(null)
  const [checkingExistingSession, setCheckingExistingSession] = useState(authStatus === "loading")

  const passwordInputRef = useRef(null)
  const isSubmittingRef = useRef(false)

  // Redirect authenticated users away from login page if already logged in on initial visit
  useEffect(() => {
    // Avoid conflicting with active form submission
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
    // Prevent double submission
    if (loading || isSubmittingRef.current) return
    setError(null)

    const cleanEmail = email.trim()
    if (!cleanEmail || !password) {
      setError("Please enter both email and password")
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
        if (response.data.user.role === "account_admin") {
          router.replace("/portal")
          return
        }
        if (response.data.user.role !== "super_admin") {
          setIsRedirecting(false)
          setError("Access denied. Please check your account role.")
          await apiClient.logout()
          isSubmittingRef.current = false
          setLoading(false)
          return
        }
        // Immediate clean navigation to Super Admin Dashboard
        router.replace("/super-admin")
      } else {
        setError(response?.error || "Invalid email or password")
        setPassword("")
        isSubmittingRef.current = false
        setLoading(false)
        setIsRedirecting(false)
        if (passwordInputRef.current) {
          passwordInputRef.current.focus()
        }
      }
    } catch (err) {
      setError(err.message || "Invalid email or password. Please verify your credentials.")
      setPassword("")
      isSubmittingRef.current = false
      setLoading(false)
      setIsRedirecting(false)
      if (passwordInputRef.current) {
        passwordInputRef.current.focus()
      }
    }
  }

  // Quick fill helper for testing
  const handleQuickFill = () => {
    setEmail("superadmin@leadflow.io")
    setPassword("SuperAdmin@2026!")
    setError(null)
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
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Icon & Heading */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-100 text-white transition-transform hover:scale-105 duration-200">
            <ShieldCheck className="w-8 h-8" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-slate-900">
          Super Admin Portal
        </h2>
        <p className="mt-1 text-center text-sm text-slate-500">
          Sign in to manage multi-tenant accounts, roles & permissions
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="relative overflow-hidden bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10">
          {/* Top animated shimmer bar during active login */}
          {loading && (
            <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-100 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-transparent via-indigo-600 to-transparent animate-shimmer" />
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start space-x-3 text-red-800 text-sm animate-in fade-in slide-in-from-top-1 duration-150">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Super Admin Email
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
                  placeholder="superadmin@leadflow.io"
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-all disabled:opacity-75 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
              >
                Password
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
                  className="block w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-all disabled:opacity-75 disabled:cursor-not-allowed"
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

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-85 transition-all duration-150 cursor-pointer disabled:cursor-not-allowed select-none"
              >
                {loading ? (
                  isRedirecting ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-300 animate-in zoom-in-50 duration-200" />
                      <span>Access Granted. Opening Console...</span>
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
                    <span>Sign In to Super Admin</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Demo Credentials Assistant */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/90 text-xs text-slate-600 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Bootstrapped Super Admin</span>
                </span>
                <button
                  type="button"
                  onClick={handleQuickFill}
                  disabled={loading}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline cursor-pointer disabled:opacity-50"
                >
                  Auto-fill Credentials
                </button>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                Email: <span className="text-slate-700">superadmin@leadflow.io</span>
                <br />
                Pass: <span className="text-slate-700">SuperAdmin@2026!</span>
              </p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col items-center space-y-2">
            <Link
              href="/portal/login"
              className="w-full text-center py-2 px-3 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors border border-indigo-200"
            >
              Client / Leads Account Login Portal →
            </Link>
            <Link
              href="/"
              className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors pt-1"
            >
              ← Back to Lead Management Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
