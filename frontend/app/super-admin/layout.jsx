"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import {
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ShieldAlert,
  Building2,
} from "lucide-react"

export default function SuperAdminLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const isLoginPage = pathname === "/super-admin/login"

  useEffect(() => {
    // If on login page, don't block on auth check
    if (isLoginPage) {
      setLoading(false)
      return
    }

    let isMounted = true

    const verifyAuth = async () => {
      try {
        const response = await apiClient.getMe()
        if (response.success && response.data?.user) {
          if (response.data.user.role !== "super_admin") {
            router.replace("/super-admin/login?error=unauthorized")
            return
          }
          if (isMounted) {
            setUser(response.data.user)
          }
        } else {
          router.replace("/super-admin/login")
        }
      } catch (error) {
        router.replace("/super-admin/login")
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    verifyAuth()

    return () => {
      isMounted = false
    }
  }, [pathname, isLoginPage, router])

  const handleLogout = async () => {
    try {
      setLoggingOut(true)
      await apiClient.logout()
    } catch (error) {
      console.error("Logout error:", error)
    } finally {
      setUser(null)
      setLoggingOut(false)
      router.replace("/super-admin/login")
    }
  }

  // Render clean layout without sidebar for login page
  if (isLoginPage) {
    return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>
  }

  // Loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-600">Verifying Super Admin session...</p>
        </div>
      </div>
    )
  }

  // Exactly Two Main Navigation Tabs as requested
  const navigationTabs = [
    {
      name: "Dashboard Overview",
      href: "/super-admin",
      icon: LayoutDashboard,
      active: pathname === "/super-admin",
    },
    {
      name: "Roles & Permissions",
      href: "/super-admin/roles-permissions",
      icon: ShieldCheck,
      active: pathname === "/super-admin/roles-permissions",
    },
  ]

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-800">
      {/* Desktop Minimal Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 fixed inset-y-0 z-30">
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-100 bg-white">
          <Link href="/super-admin" className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-100">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-slate-900 tracking-tight">LeadFlow</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 uppercase tracking-wider">
                  Super
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Administration</p>
            </div>
          </Link>
        </div>

        {/* Navigation Tabs - Exactly Two Tabs */}
        <div className="flex-1 py-6 px-3 space-y-1.5 overflow-y-auto">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Super Admin Controls
          </p>

          {navigationTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <Link
                key={tab.name}
                href={tab.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  tab.active
                    ? "bg-indigo-50 text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon
                    className={`w-4 h-4 ${
                      tab.active ? "text-indigo-600" : "text-slate-400"
                    }`}
                  />
                  <span>{tab.name}</span>
                </div>
                {tab.active && <ChevronRight className="w-3.5 h-3.5 text-indigo-600" />}
              </Link>
            )
          })}

          <div className="pt-6 px-3">
            <div className="rounded-xl p-3.5 bg-slate-50 border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
              <div className="flex items-center space-x-2 font-medium text-slate-800">
                <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
                <span>Multi-Tenant Security</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Tenant isolation and Leads Account Admin permissions are enforced across all APIs.
              </p>
            </div>
          </div>
        </div>

        {/* Super Admin Profile Area & Secure Logout */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-sm">
                {user?.name ? user.name.charAt(0).toUpperCase() : "S"}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {user?.name || "Super Admin"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Secure Logout"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 bg-white flex flex-col z-50 shadow-xl">
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                  <Building2 className="w-4 h-4" />
                </div>
                <span className="font-semibold text-slate-900">LeadFlow Admin</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 py-6 px-3 space-y-1.5 overflow-y-auto">
              {navigationTabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <Link
                    key={tab.name}
                    href={tab.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                      tab.active
                        ? "bg-indigo-50 text-indigo-700 font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon className="w-4 h-4" />
                      <span>{tab.name}</span>
                    </div>
                  </Link>
                )
              })}
            </div>

            <div className="p-4 border-t border-slate-100">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-8">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                {pathname === "/super-admin/roles-permissions"
                  ? "Roles & Permissions"
                  : "Super Admin Dashboard"}
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                {pathname === "/super-admin/roles-permissions"
                  ? "Configure permissions available to Leads Account Admins"
                  : "Manage Leads Accounts, Tenant Isolation, and Account Admins"}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Multi-Tenant Active</span>
            </div>

            <Link
              href="/"
              className="text-xs font-medium text-slate-600 hover:text-indigo-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-indigo-200 transition-colors"
            >
              Customer App →
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  )
}
