"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import {
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Sparkles,
} from "lucide-react"

export default function SuperAdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [checkingExistingSession, setCheckingExistingSession] = useState(true)

  // Redirect authenticated users away from login page to dashboard
  useEffect(() => {
    let isMounted = true
    const checkSession = async () => {
      try {
        const response = await apiClient.getMe()
        if (response.success && response.data?.user?.role === "super_admin") {
          router.replace("/super-admin")
          return
        }
      } catch (_err) {
        // Not logged in
      } finally {
        if (isMounted) {
          setCheckingExistingSession(false)
        }
      }
    }
    checkSession()
    return () => {
      isMounted = false
    }
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError("Please enter both email and password")
      return
    }

    try {
      setLoading(true)
      const response = await apiClient.login({
        email: email.trim(),
        password,
      })

      if (response.success && response.data?.user) {
        if (response.data.user.role !== "super_admin") {
          setError("Access denied. This portal is restricted to Super Administrators.")
          await apiClient.logout()
          return
        }
        // Redirect to Super Admin Dashboard
        router.push("/super-admin")
      } else {
        setError(response.error || "Invalid email or password")
      }
    } catch (err) {
      setError(err.message || "Invalid email or password. Please verify your credentials.")
    } finally {
      setLoading(false)
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
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Icon & Heading */}
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-100 text-white">
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
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl border border-slate-200 sm:px-10">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start space-x-3 text-red-800 text-sm animate-in fade-in">
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="superadmin@leadflow.io"
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-colors"
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
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 focus:bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Signing in securely...</span>
                  </>
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
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
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

          <div className="mt-5 text-center">
            <Link
              href="/"
              className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              ← Back to Lead Management Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
