"use client"

import React, { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

/**
 * Platform Root Entry Router (Phase 27)
 *
 * Implements strict platform entry isolation:
 * 1. Fresh unauthenticated session -> Redirects to Super Admin login portal (/super-admin/login)
 * 2. Authenticated Super Admin session -> Redirects to Super Admin dashboard (/super-admin)
 * 3. Authenticated Tenant/Account user -> Redirects to Tenant CRM portal (/portal)
 *
 * Prevents:
 * - Silently exposing existing Leads accounts or dashboards to unauthenticated visitors
 * - Executing premature /api/leads or /api/leads/stats queries before authentication is established
 */
export default function RootEntryPage() {
  const router = useRouter()
  const { user, status, loading } = useAuth()

  useEffect(() => {
    // Wait until authentication status has been resolved from the session check
    if (loading || status === "idle" || status === "loading") {
      return
    }

    if (status === "authenticated" && user) {
      if (user.role === "super_admin") {
        router.replace("/super-admin")
      } else {
        router.replace("/portal")
      }
      return
    }

    if (status === "unauthenticated") {
      router.replace("/super-admin/login")
      return
    }
  }, [status, user, loading, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-400">Directing to platform portal...</p>
      </div>
    </div>
  )
}
