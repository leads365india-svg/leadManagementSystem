"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"

const AuthContext = createContext({
  user: null,
  status: "idle", // "idle" | "loading" | "authenticated" | "unauthenticated"
  loading: true,
  checkAuth: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState("loading")
  const pathname = usePathname()
  const router = useRouter()

  const checkAuth = useCallback(async () => {
    try {
      setStatus("loading")
      const response = await apiClient.getMe()
      if (response.success && response.data?.user) {
        setUser(response.data.user)
        setStatus("authenticated")
        return response.data.user
      } else {
        setUser(null)
        setStatus("unauthenticated")
        return null
      }
    } catch (_error) {
      setUser(null)
      setStatus("unauthenticated")
      return null
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const logout = useCallback(async () => {
    try {
      await apiClient.logout()
      toast.success("Signed out successfully")
    } catch (err) {
      console.error("Logout error:", err)
    } finally {
      setUser(null)
      setStatus("unauthenticated")
      router.push("/portal/login")
    }
  }, [router])

  const value = {
    user,
    status,
    loading: status === "loading",
    checkAuth,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
