"use client"

import React, { useEffect, useState, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  LogOut,
  Building2,
  ChevronDown,
} from "lucide-react"

export default function SuperAdminLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const profileMenuRef = useRef(null)

  const isLoginPage = pathname === "/super-admin/login"

  // Handle outside click to close profile dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  useEffect(() => {
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
      const toastId = toast.loading("Signing out...")
      await apiClient.logout()
      toast.dismiss(toastId)
      toast.success("Signed out of Super Admin Console")
    } catch (error) {
      console.error("Logout error:", error)
    } finally {
      setUser(null)
      setLoggingOut(false)
      setProfileDropdownOpen(false)
      router.replace("/super-admin/login")
    }
  }

  // Render clean layout without navbar for login page
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      {/* Professional Clean Super Admin Navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Left: Compact LeadFlow Brand Identity */}
            <div className="flex items-center flex-shrink-0">
              <Link href="/super-admin" className="flex items-center space-x-3 group">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs group-hover:bg-indigo-700 transition-colors">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold text-slate-900 text-base tracking-tight">
                      LeadFlow
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">Super Admin Console</p>
                </div>
              </Link>
            </div>

            {/* Right: Avatar / Profile Dropdown Menu */}
            <div className="flex items-center flex-shrink-0 space-x-3">
              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => setProfileDropdownOpen((prev) => !prev)}
                  className="flex items-center space-x-2.5 p-1.5 rounded-full hover:bg-slate-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  aria-label="Open Super Admin user menu"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs hover:bg-indigo-700 transition-colors">
                    {user?.name ? user.name.charAt(0).toUpperCase() : "S"}
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                      profileDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* Profile Dropdown */}
                {profileDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {user?.name || "Super Admin"}
                        </p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Super Admin
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate font-mono">{user?.email}</p>
                    </div>

                    <div className="py-1">
                      <button
                        type="button"
                        onClick={handleLogout}
                        disabled={loggingOut}
                        className="w-full flex items-center space-x-2.5 px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Full-Width Content Area */}
      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 pt-3 pb-8">{children}</main>
    </div>
  )
}

