"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"

export const SCOPE_RANKS = {
  own: 1,
  team: 2,
  all: 3,
}

export const LEGACY_PERMISSION_MAP = {
  "leads.view": "leads.view",
  "leads.edit": "leads.edit",
  "leads.delete": "leads.delete",
  "followups.view": "followups.view",
  "followups.manage": "followups.manage",
  "calls.view": "calls.view",
  "calls.manage": "calls.log",
  "users.view": "staff.view",
  "users.manage": "staff.manage",
}

/**
 * Robust Permission Evaluator supporting:
 * 1. super_admin -> always true
 * 2. account_admin -> full permissions unless constrained by ceiling
 * 3. Wildcard prefix matching e.g. "leads.view*", "calls.view*"
 * 4. 3-part scoped permissions e.g. "leads.view.own", "leads.view.team", "leads.view.all"
 * 5. 2-part action permissions e.g. "leads.delete", "leads.create", "dashboard.view"
 */
export function hasPermission(user, requiredPermission, requiredScope = null) {
  if (!user) return false
  if (user.role === "super_admin") return true

  const userPerms = Array.isArray(user.permissions) ? user.permissions : []
  const permSet = new Set(userPerms)

  // Account admin with empty custom array receives full tenant access
  if (user.role === "account_admin" && userPerms.length === 0) {
    return true
  }

  if (!requiredPermission) return true

  // Support wildcard prefix matching (e.g. "leads.view*", "calls.view*", "settings.*")
  if (requiredPermission.endsWith("*")) {
    const prefix = requiredPermission.slice(0, -1)
    for (const p of userPerms) {
      if (p.startsWith(prefix) || p === prefix.replace(/\.$/, "")) {
        return true
      }
    }
    const cleanPrefix = prefix.replace(/\.$/, "")
    if (permSet.has(cleanPrefix)) return true
    return false
  }

  // Direct match
  if (permSet.has(requiredPermission)) return true

  // Legacy alias check
  if (LEGACY_PERMISSION_MAP[requiredPermission] && permSet.has(LEGACY_PERMISSION_MAP[requiredPermission])) {
    return true
  }
  for (const [legacyKey, modernKey] of Object.entries(LEGACY_PERMISSION_MAP)) {
    if (modernKey === requiredPermission && permSet.has(legacyKey)) {
      return true
    }
  }

  // 3-part key: resource.action.scope (e.g. "leads.view.own")
  const parts = requiredPermission.split(".")
  if (parts.length === 3) {
    const [resource, action, requestedScope] = parts
    const prefix = `${resource}.${action}`
    let currentScope = null
    if (permSet.has(`${prefix}.all`) || permSet.has(`${resource}.*.all`)) {
      currentScope = "all"
    } else if (permSet.has(`${prefix}.team`) || permSet.has(`${resource}.*.team`)) {
      currentScope = "team"
    } else if (permSet.has(`${prefix}.own`) || permSet.has(`${resource}.*.own`)) {
      currentScope = "own"
    } else if (permSet.has(prefix)) {
      currentScope = "all"
    }

    if (!currentScope) return false
    const minScope = requiredScope || requestedScope
    const minRank = SCOPE_RANKS[minScope] || 1
    const currentRank = SCOPE_RANKS[currentScope] || 0
    return currentRank >= minRank
  }

  // 2-part key: resource.action (e.g. "leads.delete", "leads.view", "calls.view")
  if (parts.length === 2) {
    const [resource, action] = parts
    const prefix = `${resource}.${action}`
    if (
      permSet.has(`${prefix}.all`) ||
      permSet.has(`${prefix}.team`) ||
      permSet.has(`${prefix}.own`) ||
      permSet.has(`${resource}.*.all`) ||
      permSet.has(`${resource}.*.team`) ||
      permSet.has(`${resource}.*.own`)
    ) {
      if (requiredScope) {
        let currentScope = "own"
        if (permSet.has(`${prefix}.all`) || permSet.has(`${resource}.*.all`)) currentScope = "all"
        else if (permSet.has(`${prefix}.team`) || permSet.has(`${resource}.*.team`)) currentScope = "team"
        return (SCOPE_RANKS[currentScope] || 0) >= (SCOPE_RANKS[requiredScope] || 1)
      }
      return true
    }
  }

  return false
}

const AuthContext = createContext({
  user: null,
  status: "idle", // "idle" | "loading" | "authenticated" | "unauthenticated"
  loading: true,
  checkAuth: async () => {},
  login: async () => {},
  setSession: () => {},
  logout: async () => {},
  hasPermission: () => false,
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState("loading")
  const [activeTenant, setActiveTenantState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("leadflow_active_tenant") || null
    }
    return null
  })
  const router = useRouter()

  const setActiveTenant = useCallback((tenantId) => {
    if (typeof window !== "undefined") {
      if (tenantId) {
        localStorage.setItem("leadflow_active_tenant", tenantId)
      } else {
        localStorage.removeItem("leadflow_active_tenant")
      }
    }
    setActiveTenantState(tenantId || null)
  }, [])

  const checkAuth = useCallback(async () => {
    try {
      // If unauthenticated visitor is on a login page and has no valid token,
      // skip calling /auth/me to avoid unnecessary 401 console errors.
      if (typeof window !== "undefined") {
        const token = localStorage.getItem("token")
        let isExpired = true
        if (token && typeof token === "string") {
          try {
            const parts = token.split(".")
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]))
              isExpired = payload.exp ? Date.now() >= payload.exp * 1000 : false
            }
          } catch (_) {
            isExpired = true
          }
        }
        if (isExpired) {
          try {
            localStorage.removeItem("token")
          } catch (_) {}
        }

        const isLoginPage = window.location.pathname.includes("/login")
        if (isExpired && isLoginPage) {
          setUser(null)
          setStatus("unauthenticated")
          return null
        }
      }

      setStatus("loading")
      const response = await apiClient.getMe()
      if (response.success && response.data?.user) {
        const userData = response.data.user

        // Validate active tenant context for Super Admin sessions
        if (userData.role === "super_admin") {
          const storedTenant = typeof window !== "undefined" ? localStorage.getItem("leadflow_active_tenant") : null
          if (storedTenant) {
            if (!userData.account) {
              console.warn(`Active tenant '${storedTenant}' not found on backend. Clearing invalid tenant context.`)
              if (typeof window !== "undefined") {
                localStorage.removeItem("leadflow_active_tenant")
              }
              setActiveTenantState(null)
              apiClient.switchTenant(null).catch(() => {})
              toast.error("The selected tenant account was not found or is no longer accessible.")
            } else if (userData.account.status === "suspended") {
              console.warn(`Active tenant '${userData.account.companyName}' is suspended. Clearing tenant context.`)
              if (typeof window !== "undefined") {
                localStorage.removeItem("leadflow_active_tenant")
              }
              setActiveTenantState(null)
              apiClient.switchTenant(null).catch(() => {})
              toast.error(`Tenant account '${userData.account.companyName}' is suspended.`)
            } else {
              setActiveTenantState(userData.account.accountId || storedTenant)
            }
          }
        }

        setUser(userData)
        setStatus("authenticated")
        return userData
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

  const setSession = useCallback((userData) => {
    if (userData) {
      setUser(userData)
      setStatus("authenticated")
    } else {
      setUser(null)
      setStatus("unauthenticated")
    }
  }, [])

  const login = useCallback(async (credentials) => {
    setStatus("loading")
    try {
      const response = await apiClient.login(credentials)
      if (response.success && response.data?.user) {
        setUser(response.data.user)
        setStatus("authenticated")
        return response
      } else {
        setUser(null)
        setStatus("unauthenticated")
        return response
      }
    } catch (err) {
      setUser(null)
      setStatus("unauthenticated")
      throw err
    }
  }, [])

  const logout = useCallback(async (targetRoute) => {
    const roleAtLogout = user?.role
    try {
      await apiClient.logout()
      await apiClient.switchTenant(null).catch(() => {})
      toast.success("Signed out successfully")
    } catch (err) {
      console.error("Logout error:", err)
    } finally {
      if (typeof window !== "undefined") {
        localStorage.removeItem("leadflow_active_tenant")
        localStorage.removeItem("leadflow_token")
      }
      setActiveTenantState(null)
      setUser(null)
      setStatus("unauthenticated")
      const destination =
        targetRoute ||
        (roleAtLogout === "super_admin" ? "/super-admin/login" : "/portal/login")
      router.push(destination)
    }
  }, [user, router])

  const checkPermission = useCallback(
    (requiredPermission, requiredScope = null) => {
      return hasPermission(user, requiredPermission, requiredScope)
    },
    [user]
  )

  const value = {
    user,
    status,
    loading: status === "loading",
    activeTenant,
    setActiveTenant,
    checkAuth,
    login,
    setSession,
    logout,
    hasPermission: checkPermission,
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
