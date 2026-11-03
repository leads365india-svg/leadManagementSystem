"use client"

import React, { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

export default function PortalLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, status, loading } = useAuth()

  const isLoginPage = pathname === "/portal/login"

  useEffect(() => {
    if (isLoginPage) return

    if (status === "unauthenticated") {
      router.replace("/portal/login")
      return
    }

    if (status === "authenticated" && user?.role === "super_admin") {
      const activeTenant = typeof window !== "undefined" ? localStorage.getItem("leadflow_active_tenant") : null
      const urlTenant = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tenant") : null
      if (urlTenant && typeof window !== "undefined") {
        localStorage.setItem("leadflow_active_tenant", urlTenant)
      }
      if (!activeTenant && !urlTenant && !user?.tenantId) {
        router.replace("/super-admin")
        return
      }
    }
  }, [isLoginPage, status, user, router])

  if (isLoginPage) {
    return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>
  }

  if (loading || status === "idle") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-600">Loading Client CRM Portal...</p>
        </div>
      </div>
    )
  }

  const hasSuperAdminTenant = Boolean(
    typeof window !== "undefined" &&
    (localStorage.getItem("leadflow_active_tenant") ||
     new URLSearchParams(window.location.search).get("tenant") ||
     user?.tenantId)
  )
  if (status === "unauthenticated" || (status === "authenticated" && user?.role === "super_admin" && !hasSuperAdminTenant)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full flex-1">
      {children}
    </div>
  )
}
