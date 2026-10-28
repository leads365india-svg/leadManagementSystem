"use client"

import React, { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

const PUBLIC_EXACT_ROUTES = new Set([
  "/",
  "/portal/login",
  "/super-admin/login",
  "/login",
])

function isExemptRoute(pathname) {
  if (!pathname) return true

  // Root platform router handles its own redirection flow
  if (pathname === "/") return true

  // Public login routes
  if (PUBLIC_EXACT_ROUTES.has(pathname)) return true
  if (pathname.startsWith("/portal/login")) return true
  if (pathname.startsWith("/super-admin/login")) return true

  // Delegated layout guards
  if (pathname.startsWith("/super-admin")) return true
  if (pathname.startsWith("/portal")) return true

  return false
}

export default function AuthGuard({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, status, loading } = useAuth()

  const isExempt = isExemptRoute(pathname)

  useEffect(() => {
    // If route has its own guard or is public, do nothing here
    if (isExempt) return

    // If session check finished and user is not authenticated, redirect to portal login
    if (status === "unauthenticated") {
      router.replace("/portal/login")
      return
    }

    // Role-specific enforcement: Super Admin sessions should not access Client CRM directly
    if (status === "authenticated" && user?.role === "super_admin") {
      router.replace("/super-admin")
      return
    }
  }, [isExempt, status, user, router])

  // Public routes or delegated layouts render immediately
  if (isExempt) {
    return <>{children}</>
  }

  // Loading state while verifying authentication for protected CRM routes
  if (loading || status === "idle") {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center bg-slate-50 text-slate-600">
        <div className="flex flex-col items-center space-y-3.5">
          <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Verifying session...
          </p>
        </div>
      </div>
    )
  }

  // If unauthenticated or Super Admin redirecting, hold rendering to prevent UI flash
  if (status === "unauthenticated" || (status === "authenticated" && user?.role === "super_admin")) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center bg-slate-50 text-slate-600">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Authenticated Client CRM user (e.g. account_admin)
  return <>{children}</>
}
