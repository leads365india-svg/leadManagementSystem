"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import { isWhiteLabelDomain, normalizeHostname } from "@/lib/domain"
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
  workspaces: [],
  activeWorkspace: null,
  isMultiWorkspaceEnabled: false,
  setActiveWorkspace: () => {},
  reloadWorkspaces: async () => {},
})

// Robust base64url JWT payload parser compatible with WebKit / Safari and standard browsers
function parseJwtPayload(token) {
  if (!token || typeof token !== "string") return null
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    while (base64.length % 4) {
      base64 += "="
    }
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    )
    return JSON.parse(jsonStr)
  } catch (_) {
    try {
      let base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
      while (base64.length % 4) base64 += "="
      return JSON.parse(atob(base64))
    } catch (_e) {
      return null
    }
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState("loading")
  const [activeTenant, setActiveTenantState] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [isMultiWorkspaceEnabled, setIsMultiWorkspaceEnabled] = useState(false)
  const [activeWorkspace, setActiveWorkspaceState] = useState(null)
  const router = useRouter()

  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const lastWorkspaceTenantRef = useRef(null)

  // Hydrate client-only persisted values after initial SSR mount (tenant-namespaced)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedTenant = localStorage.getItem("leadflow_active_tenant")
      if (storedTenant) {
        setActiveTenantState(storedTenant)
      }
      const sessionTenant = localStorage.getItem("leadflow_session_tenant") || ""
      const wsTenant = localStorage.getItem("leadflow_active_workspace_tenant") || ""
      if (sessionTenant && (!wsTenant || wsTenant === sessionTenant)) {
        const namespacedWs =
          localStorage.getItem(`leadflow_active_workspace:${sessionTenant}`) ||
          localStorage.getItem("leadflow_active_workspace")
        if (namespacedWs) {
          setActiveWorkspaceState(namespacedWs)
        }
      } else if (wsTenant && sessionTenant && wsTenant !== sessionTenant) {
        localStorage.removeItem("leadflow_active_workspace")
        localStorage.removeItem("leadflow_active_workspace_tenant")
      }
    }
  }, [])

  const setActiveWorkspace = useCallback((wsId, explicitTenantId = null) => {
    if (typeof window !== "undefined") {
      const targetTenant =
        explicitTenantId ||
        userRef.current?.effectiveTenantId ||
        userRef.current?.tenantId ||
        localStorage.getItem("leadflow_session_tenant") ||
        ""
      if (wsId) {
        localStorage.setItem("leadflow_active_workspace", wsId)
        if (targetTenant) {
          localStorage.setItem("leadflow_active_workspace_tenant", targetTenant)
          localStorage.setItem(`leadflow_active_workspace:${targetTenant}`, wsId)
        }
      } else {
        localStorage.removeItem("leadflow_active_workspace")
        localStorage.removeItem("leadflow_active_workspace_tenant")
        if (targetTenant) {
          localStorage.removeItem(`leadflow_active_workspace:${targetTenant}`)
        }
      }
    }
    setActiveWorkspaceState(wsId || null)
  }, [])

  const isReloadingWorkspacesRef = useRef(false)
  const lastReloadWorkspacesTsRef = useRef(0)

  const reloadWorkspaces = useCallback(async (targetUser = null, force = false) => {
    // If on a login page or super-admin management console and not authenticating, skip
    if (typeof window !== "undefined" && !targetUser) {
      const pathname = window.location.pathname || ""
      if (pathname.includes("/login") || pathname.startsWith("/super-admin")) {
        setWorkspaces([])
        setIsMultiWorkspaceEnabled(false)
        setActiveWorkspace(null)
        return []
      }
    }

    const effectiveUser = targetUser || userRef.current
    if (!effectiveUser) {
      setWorkspaces([])
      setIsMultiWorkspaceEnabled(false)
      setActiveWorkspace(null)
      return []
    }

    // Platform Super Admin does not operate on tenant workspaces unless actively inspecting a tenant inside /portal
    let effectiveTenantId = effectiveUser.tenantId || null
    if (effectiveUser.role === "super_admin") {
      const pathname = typeof window !== "undefined" ? window.location.pathname || "" : ""
      const activeTenant = typeof window !== "undefined" ? localStorage.getItem("leadflow_active_tenant") : null
      if (!activeTenant || !pathname.startsWith("/portal")) {
        setWorkspaces([])
        setIsMultiWorkspaceEnabled(false)
        setActiveWorkspace(null)
        return []
      }
      effectiveTenantId = activeTenant
    }

    const tenantChanged = lastWorkspaceTenantRef.current !== effectiveTenantId
    if (tenantChanged) {
      // Immediately clear previous tenant workspaces before fetching new tenant
      setWorkspaces([])
      if (!effectiveUser.targetWorkspace?.id) {
        setActiveWorkspaceState(null)
      }
      lastReloadWorkspacesTsRef.current = 0
    }

    // In-flight deduplication and throttle: prevent duplicate network requests for the same tenant
    if (isReloadingWorkspacesRef.current && !force && !tenantChanged) return []
    if (!force && !tenantChanged && Date.now() - lastReloadWorkspacesTsRef.current < 1500) return []
    isReloadingWorkspacesRef.current = true
    lastReloadWorkspacesTsRef.current = Date.now()
    lastWorkspaceTenantRef.current = effectiveTenantId

    try {
      const res = await apiClient.getWorkspaces({ force: Boolean(targetUser || force) })
      if (res?.status === 429 || res?.isRateLimit) {
        console.warn("Workspaces request throttled by rate limit")
        return []
      }
      if (res && res.success) {
        const isEnabled = Boolean(res.workspaceModeEnabled)
        setIsMultiWorkspaceEnabled(isEnabled)
        const rawList = Array.isArray(res.data) ? res.data : []
        // Enforce tenant boundary and exclude any system-managed workspaces on client cache too
        const wsList = (effectiveTenantId
          ? rawList.filter((w) => !w.tenantId || String(w.tenantId) === String(effectiveTenantId))
          : rawList
        ).filter((w) => !w.isSystemManaged)
        setWorkspaces(wsList)

        const isOrgAdmin = effectiveUser.role === "account_admin" || effectiveUser.role === "super_admin"
        if (isEnabled && wsList.length > 0) {
          let storedWs = null
          if (typeof window !== "undefined" && effectiveTenantId) {
            const wsTenant = localStorage.getItem("leadflow_active_workspace_tenant") || ""
            storedWs =
              localStorage.getItem(`leadflow_active_workspace:${effectiveTenantId}`) ||
              (wsTenant === effectiveTenantId ? localStorage.getItem("leadflow_active_workspace") : null)
          }

          let selected = null
          const targetWsId = effectiveUser.targetWorkspace?.id
          const targetWsSlug = effectiveUser.targetWorkspace?.slug

          // Prioritize targetWorkspace if explicitly requested during login
          if (targetWsId && wsList.some((w) => (w._id?.toString() === targetWsId || w.id?.toString() === targetWsId))) {
            const matched = wsList.find((w) => (w._id?.toString() === targetWsId || w.id?.toString() === targetWsId))
            selected = matched ? (matched._id || matched.id).toString() : targetWsId
          } else if (targetWsSlug && wsList.some((w) => w.slug === targetWsSlug)) {
            const matched = wsList.find((w) => w.slug === targetWsSlug)
            selected = matched ? (matched._id || matched.id).toString() : targetWsSlug
          } else if (storedWs === "all" && isOrgAdmin) {
            selected = "all"
          } else if (storedWs && (wsList.some((w) => w._id?.toString() === storedWs) || wsList.some((w) => w.id?.toString() === storedWs) || wsList.some((w) => w.slug === storedWs))) {
            const matched = wsList.find((w) => w._id?.toString() === storedWs || w.id?.toString() === storedWs || w.slug === storedWs)
            selected = matched ? (matched._id || matched.id).toString() : storedWs
          } else {
            if (isOrgAdmin) {
              selected = "all"
            } else {
              const def = wsList.find((w) => w.isDefault) || wsList[0]
              selected = def ? (def._id || def.id)?.toString() : null
            }
          }

          if (selected) {
            setActiveWorkspace(selected, effectiveTenantId)
          }
        } else if (isEnabled && isOrgAdmin) {
          // Multi-workspace enabled with 0 user-created projects: default Org Admin to consolidated All Projects
          setActiveWorkspace("all", effectiveTenantId)
        } else {
          setActiveWorkspace(null, effectiveTenantId)
        }
        return wsList
      }
    } catch (err) {
      if (err?.status !== 401) {
        console.warn("Failed to load workspaces:", err?.message || err)
      }
    } finally {
      isReloadingWorkspacesRef.current = false
    }
    return []
  }, [setActiveWorkspace])

  const reloadWorkspacesRef = useRef(reloadWorkspaces)
  useEffect(() => {
    reloadWorkspacesRef.current = reloadWorkspaces
  }, [reloadWorkspaces])

  const setActiveTenant = useCallback((tenantId) => {
    if (typeof window !== "undefined") {
      if (tenantId) {
        localStorage.setItem("leadflow_active_tenant", tenantId)
        localStorage.setItem("leadflow_session_tenant", tenantId)
      } else {
        localStorage.removeItem("leadflow_active_tenant")
      }
      localStorage.removeItem("leadflow_active_workspace")
      localStorage.removeItem("leadflow_active_workspace_tenant")
    }
    setWorkspaces([])
    setIsMultiWorkspaceEnabled(false)
    setActiveWorkspaceState(null)
    lastWorkspaceTenantRef.current = null
    setActiveTenantState(tenantId || null)
  }, [])

  const isCheckingAuthRef = useRef(false)
  const lastCheckAuthTsRef = useRef(0)

  const checkAuth = useCallback(async () => {
    // Deduplicate in-flight and rapid duplicate calls
    if (isCheckingAuthRef.current) return null
    if (Date.now() - lastCheckAuthTsRef.current < 1000) return null
    isCheckingAuthRef.current = true
    lastCheckAuthTsRef.current = Date.now()

    try {
      // If unauthenticated visitor is on a login page and has no valid token,
      // skip calling /auth/me to avoid unnecessary 401 console errors.
      if (typeof window !== "undefined") {
        const token = localStorage.getItem("leadflow_token") || localStorage.getItem("token")
        const isLoginPage = window.location.pathname.includes("/login")

        if (token && typeof token === "string") {
          const payload = parseJwtPayload(token)
          if (payload && payload.exp && Date.now() >= payload.exp * 1000) {
            // Token is definitively expired
            try {
              localStorage.removeItem("token")
              localStorage.removeItem("leadflow_token")
            } catch (_) {}
            if (isLoginPage) {
              setUser(null)
              setStatus("unauthenticated")
              return null
            }
          }
        } else if (isLoginPage) {
          // No token on login page: skip calling /api/auth/me to avoid 401 console errors
          setUser(null)
          setStatus("unauthenticated")
          return null
        }
      }

      setStatus("loading")
      const response = await apiClient.getMe()
      if (response && response.success && response.data?.user) {
        const userData = response.data.user

        // Validate cross-tenant domain isolation for non-super-admin users
        if (typeof window !== "undefined") {
          const currentHost = normalizeHostname(window.location.hostname)
          const urlParams = new URLSearchParams(window.location.search)
          const testDomain = urlParams.get("domain") || urlParams.get("test_domain") || ""
          const effectiveHost = testDomain ? normalizeHostname(testDomain) : currentHost

          if (isWhiteLabelDomain(effectiveHost)) {
            const userDomain = userData.account?.customDomain ? normalizeHostname(userData.account.customDomain) : ""
            if (userDomain && userDomain !== effectiveHost && userData.role !== "super_admin") {
              console.warn("Cross-tenant session rejected on white-label domain:", {
                sessionDomain: userDomain,
                currentDomain: effectiveHost,
                userTenant: userData.tenantId,
              })
              setUser(null)
              setStatus("unauthenticated")
              return null
            }
          }
        }

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
        if (typeof window !== "undefined") {
          const effectiveSessionTenant =
            userData.role === "super_admin"
              ? (userData.account?.accountId || localStorage.getItem("leadflow_active_tenant") || "")
              : (userData.tenantId || "")

          // Non-super-admin must never retain stale leadflow_active_tenant from prior sessions
          if (userData.role) {
            localStorage.setItem("leadflow_user_role", userData.role)
          }
          if (userData.role !== "super_admin") {
            localStorage.removeItem("leadflow_active_tenant")
            setActiveTenantState(null)
          }

          const prevWsTenant = localStorage.getItem("leadflow_active_workspace_tenant") || ""
          if (prevWsTenant && effectiveSessionTenant && prevWsTenant !== effectiveSessionTenant) {
            localStorage.removeItem("leadflow_active_workspace")
            localStorage.removeItem("leadflow_active_workspace_tenant")
            setActiveWorkspaceState(null)
          }
          if (effectiveSessionTenant) {
            localStorage.setItem("leadflow_session_tenant", effectiveSessionTenant)
          } else {
            localStorage.removeItem("leadflow_session_tenant")
          }
        }
        const currentPath = typeof window !== "undefined" ? window.location.pathname || "" : ""
        if (userData.role !== "super_admin") {
          if (!currentPath.includes("/login") && !currentPath.startsWith("/super-admin")) {
            await reloadWorkspacesRef.current(userData)
          }
        } else {
          const storedTenant = typeof window !== "undefined" ? localStorage.getItem("leadflow_active_tenant") : null
          if (storedTenant && currentPath.startsWith("/portal")) {
            await reloadWorkspacesRef.current(userData)
          }
        }
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
    } finally {
      isCheckingAuthRef.current = false
    }
  }, [])

  useEffect(() => {
    checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        const authUser = response.data.user
        const effectiveSessionTenant =
          authUser.role === "super_admin"
            ? (authUser.account?.accountId || "")
            : (authUser.tenantId || "")

        if (typeof window !== "undefined") {
          const prevSessionTenant = localStorage.getItem("leadflow_session_tenant") || ""
          const prevWsTenant = localStorage.getItem("leadflow_active_workspace_tenant") || ""

          // Non-super-admin must never retain leadflow_active_tenant header override
          if (authUser.role !== "super_admin") {
            localStorage.removeItem("leadflow_active_tenant")
            setActiveTenantState(null)
          }

          // Clear stale cross-tenant workspace selection whenever tenant changes or no targetWorkspace is requested
          if (
            (prevSessionTenant && effectiveSessionTenant && prevSessionTenant !== effectiveSessionTenant) ||
            (prevWsTenant && effectiveSessionTenant && prevWsTenant !== effectiveSessionTenant)
          ) {
            localStorage.removeItem("leadflow_active_workspace")
            localStorage.removeItem("leadflow_active_workspace_tenant")
            setWorkspaces([])
            setActiveWorkspaceState(null)
            lastWorkspaceTenantRef.current = null
          }

          if (effectiveSessionTenant) {
            localStorage.setItem("leadflow_session_tenant", effectiveSessionTenant)
          } else {
            localStorage.removeItem("leadflow_session_tenant")
          }
        }

        if (authUser.targetWorkspace?.id) {
          setActiveWorkspace(authUser.targetWorkspace.id, effectiveSessionTenant || authUser.tenantId)
        } else if (authUser.role === "account_admin" && credentials?.portal !== "super_admin") {
          // Normal Org Admin login without ?workspace= parameter retains All Projects / Master Dashboard
          setActiveWorkspace("all", effectiveSessionTenant || authUser.tenantId)
        }
        setUser(authUser)
        setStatus("authenticated")
        if (
          authUser.role !== "super_admin" &&
          credentials?.portal !== "super_admin"
        ) {
          await reloadWorkspaces(authUser, true)
        }
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
  }, [reloadWorkspaces, setActiveWorkspace])

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
        localStorage.removeItem("leadflow_active_workspace")
        localStorage.removeItem("leadflow_active_workspace_tenant")
        localStorage.removeItem("leadflow_session_tenant")
        localStorage.removeItem("leadflow_token")
        localStorage.removeItem("token")
        localStorage.removeItem("leadflow_user_role")
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("leadflow_active_workspace:"))
            .forEach((k) => localStorage.removeItem(k))
        } catch (_) {}
      }
      lastWorkspaceTenantRef.current = null
      setActiveTenantState(null)
      setActiveWorkspace(null)
      setWorkspaces([])
      setIsMultiWorkspaceEnabled(false)
      setUser(null)
      setStatus("unauthenticated")
      const destination =
        targetRoute ||
        (roleAtLogout === "super_admin" ? "/super-admin/login" : "/portal/login")
      router.push(destination)
    }
  }, [user, router, setActiveWorkspace])

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
    workspaces,
    activeWorkspace,
    isMultiWorkspaceEnabled,
    setActiveWorkspace,
    reloadWorkspaces,
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
