"use client"

import React, { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"

export default function PortalLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const isLoginPage = pathname === "/portal/login"

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
          if (response.data.user.role === "super_admin") {
            router.replace("/super-admin")
            return
          }
          if (response.data.user.role === "account_admin") {
            if (isMounted) {
              setUser(response.data.user)
            }
            return
          }
        }
        router.replace("/portal/login")
      } catch (error) {
        router.replace("/portal/login")
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

  if (isLoginPage) {
    return <div className="min-h-screen bg-slate-50 text-slate-900">{children}</div>
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-600">Loading Client CRM Portal...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full flex-1">
      {children}
    </div>
  )
}
