const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Account = require("../models/Account")
const RolePermission = require("../models/RolePermission")
const Device = require("../models/Device")
const { getEffectiveTenant, tenantStorage } = require("./tenantContext")

const Role = require("../models/Role")
const { ensureTenantRoles } = require("../models/Role")
const { ALLOWED_PERMISSIONS } = require("../models/RolePermission")
const {
  hasPermission,
  getUserScope,
  scopeFilter,
  checkDirectObjectAccess,
  isPermissionCoveredByCeiling,
} = require("../utils/rbacScope")

// In-memory cache for tenant roles: Map<tenantId, { roles: Array, timestamp: number }>
const tenantRoleCache = new Map()

const getTenantRolesCached = async (tenantId) => {
  if (!tenantId) return []
  const now = Date.now()
  const cached = tenantRoleCache.get(tenantId)
  if (cached && now - cached.timestamp < 60000) {
    return cached.roles
  }
  const roles = await ensureTenantRoles(tenantId)
  tenantRoleCache.set(tenantId, {
    roles,
    timestamp: now,
  })
  return roles
}

const invalidateTenantRoleCache = (tenantId = null) => {
  if (tenantId) {
    tenantRoleCache.delete(tenantId)
  } else {
    tenantRoleCache.clear()
  }
}

// Attach resolved permissions to user object
const resolveUserPermissions = async (user) => {
  let permissions = []
  let roleName = user.role
  let roleSlug = user.role

  if (user.role === "super_admin") {
    permissions = ALLOWED_PERMISSIONS
    roleName = "Super Admin"
  } else if (user.tenantId) {
    if (user.role === "account_admin") {
      const ceiling = await getCachedRolePermissions("account_admin")
      permissions = ceiling
      roleName = "Account Admin"
      roleSlug = "account_admin"
    } else {
      const tenantRoles = await getTenantRolesCached(user.tenantId)
      let userRoleDoc = null
      if (user.roleId) {
        userRoleDoc = tenantRoles.find(
          (r) => (r.id || r._id)?.toString() === user.roleId.toString(),
        )
      }
      if (!userRoleDoc) {
        userRoleDoc = tenantRoles.find((r) => r.slug === user.role)
      }
      if (!userRoleDoc) {
        userRoleDoc = tenantRoles.find((r) => r.slug === "agent")
      }
      if (userRoleDoc) {
        permissions = userRoleDoc.permissions || []
        roleName = userRoleDoc.name
        roleSlug = userRoleDoc.slug
      }
    }
  }

  return { permissions, roleName, roleSlug }
}

const INSECURE_DEFAULT_SECRETS = [
  "leadflow-superadmin-secret-key-2026-secure",
  "your-random-secure-jwt-secret-here",
  "secret",
  "jwt-secret",
]

// Validate and retrieve JWT secret securely
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  const env = process.env.NODE_ENV
  const isDevOrTest = env === "development" || env === "test"

  if (!isDevOrTest) {
    if (!secret || typeof secret !== "string" || !secret.trim()) {
      throw new Error("FATAL: JWT_SECRET environment variable is missing or empty. Server refusing to start.")
    }
    if (INSECURE_DEFAULT_SECRETS.includes(secret.trim()) || secret.trim().length < 32) {
      throw new Error(
        "FATAL: Insecure or weak JWT_SECRET configured. Must be at least 32 characters and not a known placeholder.",
      )
    }
    return secret.trim()
  }

  // Explicit Development / Test fallback
  return (secret && secret.trim()) || "leadflow-dev-secret-key-min32-chars-for-local-only"
}

// Extract candidate JWT tokens from cookies or Authorization header
const extractCandidateTokens = (req) => {
  const isSuperAdminRoute =
    Boolean(req.originalUrl && req.originalUrl.includes("/super-admin")) ||
    Boolean(req.headers?.referer && req.headers.referer.includes("/super-admin"))

  const tokens = []
  if (req.cookies) {
    if (isSuperAdminRoute) {
      if (req.cookies.superadmin_token) {
        tokens.push(req.cookies.superadmin_token)
      }
      // Strict Auth Isolation (Phase 27): Never accept client_token on Super Admin routes
    } else {
      if (req.cookies.client_token) {
        tokens.push(req.cookies.client_token)
      }
      if (req.cookies.superadmin_token) {
        tokens.push(req.cookies.superadmin_token)
      }
    }
  }
  const authHeader = req.headers?.authorization
  if (authHeader && authHeader.startsWith("Bearer ")) {
    tokens.push(authHeader.split(" ")[1])
  }
  if (req.query && req.query.token) {
    tokens.push(req.query.token)
  }
  return tokens
}

// Extract JWT token from cookie or Authorization header (primary)
const extractToken = (req) => {
  const tokens = extractCandidateTokens(req)
  return tokens.length > 0 ? tokens[0] : null
}

// Authenticate user token - Mandatory
const authenticate = async (req, res, next) => {
  try {
    const candidateTokens = extractCandidateTokens(req)

    if (candidateTokens.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Please log in.",
      })
    }

    let decoded = null
    let lastError = null

    for (const token of candidateTokens) {
      try {
        decoded = jwt.verify(token, getJwtSecret())
        if (decoded) break
      } catch (err) {
        lastError = err
      }
    }

    if (!decoded) {
      if (lastError && (lastError.name === "TokenExpiredError" || lastError.name === "JsonWebTokenError")) {
        return res.status(401).json({
          success: false,
          error: "Session expired or invalid. Please log in again.",
        })
      }
      return res.status(401).json({
        success: false,
        error: "Authentication required. Please log in.",
      })
    }

    const user = await User.findById(decoded.id).select("-password").lean()
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found or session invalid.",
      })
    }

    if (user.status === "suspended" || user.isActive === false) {
      return res.status(403).json({
        success: false,
        error: "Your account is deactivated. Please contact your administrator.",
      })
    }

    // Invalidate session if user tokenVersion has incremented (e.g., logout-all or deactivation)
    if (
      decoded.tokenVersion !== undefined &&
      user.tokenVersion !== undefined &&
      decoded.tokenVersion !== user.tokenVersion
    ) {
      return res.status(401).json({
        success: false,
        error: "Session has been invalidated. Please log in again.",
      })
    }

    // Check if the tenant account is suspended
    if (user.tenantId && user.role !== "super_admin") {
      const account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account && account.status === "suspended") {
        return res.status(403).json({
          success: false,
          error: `Your Leads Account (${account.companyName}) is currently suspended. Please contact your administrator.`,
        })
      }
    }

    const { permissions, roleName, roleSlug } = await resolveUserPermissions(user)

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      roleSlug,
      roleName,
      tenantId: user.tenantId,
      status: user.status,
      teamId: user.teamId ? user.teamId.toString() : null,
      managerId: user.managerId ? user.managerId.toString() : null,
      permissions,
    }

    if (user.tenantId) {
      req.tenantId = user.tenantId
    }

    // Check device revocation status if x-device-id header is provided
    const deviceIdHeader = req.headers["x-device-id"]
    if (deviceIdHeader) {
      const device = await Device.findOne({
        $or: [
          { deviceId: deviceIdHeader.trim() },
          { deviceUuid: deviceIdHeader.trim() },
        ],
      }).lean()
      if (device && (device.status === "REVOKED" || device.status === "revoked")) {
        return res.status(403).json({
          success: false,
          error: "This device has been revoked by your agency administrator.",
          errorCode: "DEVICE_REVOKED",
          code: "DEVICE_REVOKED",
        })
      }
    }

    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const context = {
      tenantId: tenantId || null,
      isSuperAdmin,
      userId: req.user.id,
      userRole: req.user.role,
      userEmail: req.user.email,
    }
    req.tenantContext = context

    return tenantStorage.run(context, () => {
      next()
    })
  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Session expired or invalid. Please log in again.",
    })
  }
}

// Optional Authentication - Attaches user if valid token present, otherwise continues without error
const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = extractToken(req)
    if (!token) {
      return next()
    }

    const decoded = jwt.verify(token, getJwtSecret())
    const user = await User.findById(decoded.id).select("-password").lean()

    if (user && user.status !== "suspended" && user.isActive !== false) {
      if (
        decoded.tokenVersion !== undefined &&
        user.tokenVersion !== undefined &&
        decoded.tokenVersion !== user.tokenVersion
      ) {
        return next()
      }
      const { permissions, roleName, roleSlug } = await resolveUserPermissions(user)

      req.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        roleSlug,
        roleName,
        tenantId: user.tenantId,
        status: user.status,
        teamId: user.teamId ? user.teamId.toString() : null,
        managerId: user.managerId ? user.managerId.toString() : null,
        permissions,
      }
      if (user.tenantId) {
        req.tenantId = user.tenantId
      }
      const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
      const context = {
        tenantId: tenantId || null,
        isSuperAdmin,
        userId: req.user.id,
        userRole: req.user.role,
        userEmail: req.user.email,
      }
      req.tenantContext = context

      return tenantStorage.run(context, () => {
        next()
      })
    }
    next()
  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Invalid or expired session token.",
    })
  }
}

// Authorize Super Admin only
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      error: "Access denied. Super Admin privileges required.",
    })
  }
  next()
}

// Authorize Account Admin only (and enforce tenant)
const requireAccountAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== "account_admin" && req.user.role !== "super_admin")) {
    return res.status(403).json({
      success: false,
      error: "Access denied. Leads Account Admin privileges required.",
    })
  }
  next()
}

// In-memory cache for role permissions (30-60 second TTL to prevent DB query on every request)
let permissionCache = {
  data: null,
  timestamp: 0,
}

const getCachedRolePermissions = async (targetRole = "account_admin") => {
  const now = Date.now()
  if (permissionCache.data && now - permissionCache.timestamp < 60000) {
    return permissionCache.data
  }
  const { getSuperAdminCeiling } = require("../models/RolePermission")
  const activePermissions = await getSuperAdminCeiling()
  permissionCache = {
    data: activePermissions,
    timestamp: now,
  }
  return activePermissions
}

const invalidatePermissionCache = () => {
  permissionCache = {
    data: null,
    timestamp: 0,
  }
}

// Automatically clear cache on any RolePermission update via Mongoose
if (RolePermission && typeof RolePermission.onRolePermissionChange === "function") {
  RolePermission.onRolePermissionChange(() => {
    invalidatePermissionCache()
    invalidateTenantRoleCache()
  })
}

/**
 * Reusable permission check middleware supporting RBAC v2 scopes and Super Admin ceiling.
 * @param {string} requiredPermission e.g. "leads.view.own" or "leads.create"
 * @param {Object} [options] { scope: "own" | "team" | "all" }
 */
const requirePermission = (requiredPermission, options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Authentication required. Please log in.",
        })
      }

      // Super Admin always bypasses role-specific permission restrictions
      if (req.user.role === "super_admin") {
        req.permissionScope = "all"
        return next()
      }

      const permissionsToCheck = Array.isArray(requiredPermission)
        ? requiredPermission
        : [requiredPermission]

      const ceiling = await getCachedRolePermissions("account_admin")

      let anyAuthorized = false
      let authorizedPermission = null

      for (const perm of permissionsToCheck) {
        if (ceiling && Array.isArray(ceiling)) {
          if (!isPermissionCoveredByCeiling(perm, ceiling)) {
            continue
          }
        }
        if (hasPermission(req.user, perm, options.scope)) {
          anyAuthorized = true
          authorizedPermission = perm
          break
        }
      }

      if (!anyAuthorized) {
        const primaryPerm = permissionsToCheck[0]
        return res.status(403).json({
          success: false,
          error: `Permission denied. Missing required permission: '${primaryPerm}'`,
        })
      }

      const parts = (authorizedPermission || permissionsToCheck[0]).split(".")
      if (parts.length >= 2) {
        const [resource, action] = parts
        req.permissionScope = getUserScope(req.user.permissions || [], resource, action) || "own"
      } else {
        req.permissionScope = "all"
      }

      next()
    } catch (error) {
      console.error("Permission check error:", error)
      res.status(500).json({ success: false, error: "Failed to verify permissions" })
    }
  }
}

// checkPermission is an alias to requirePermission for full backward compatibility
const checkPermission = requirePermission

const isOriginMatch = (origin, patterns = []) => {
  if (!origin) return false
  const normalized = origin.trim().replace(/\/+$/, "")
  if (patterns.includes(normalized)) return true
  return patterns.some((pattern) => {
    if (pattern && pattern.includes("://*.")) {
      const [proto, domain] = pattern.split("://*.")
      const escapedDomain = domain.replace(/\./g, "\\.")
      const regex = new RegExp(`^${proto}:\\/\\/([a-z0-9-]+\\.)*${escapedDomain}$`, "i")
      return regex.test(normalized)
    }
    return false
  })
}

// CSRF Protection Middleware for state-changing requests using cookie authentication
const verifyCSRF = (allowedOrigins = []) => {
  return (req, res, next) => {
    const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"]
    if (!mutatingMethods.includes(req.method)) {
      return next()
    }

    // Skip CSRF verification for public integration webhooks (authenticated via API key/signature, no session cookies)
    if (
      req.originalUrl &&
      (req.originalUrl.includes("/integrations/leads/website") ||
        req.originalUrl.includes("/integrations/webhooks") ||
        req.originalUrl.includes("/webhooks/"))
    ) {
      return next()
    }

    if (req.cookies && (req.cookies.superadmin_token || req.cookies.client_token)) {
      const originHeader = req.headers.origin || req.headers.referer
      if (originHeader) {
        try {
          // Exact-origin match check (parse with new URL(origin).origin) to block prefix-spoofed domains
          const parsedOrigin = new URL(originHeader).origin
          const isExplicitlyAllowed = isOriginMatch(parsedOrigin, allowedOrigins)
          const isDevLocalhost =
            process.env.NODE_ENV !== "production" &&
            /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(parsedOrigin)

          if (!isExplicitlyAllowed && !isDevLocalhost) {
            return res.status(403).json({
              success: false,
              error: "CSRF verification failed: Origin not allowed",
            })
          }
        } catch (_) {
          return res.status(403).json({
            success: false,
            error: "CSRF verification failed: Malformed origin header",
          })
        }
      }
    }

    next()
  }
}

module.exports = {
  getJwtSecret,
  extractToken,
  authenticate,
  optionalAuthenticate,
  requireSuperAdmin,
  requireAccountAdmin,
  requirePermission,
  checkPermission,
  verifyCSRF,
  getCachedRolePermissions,
  invalidatePermissionCache,
  getTenantRolesCached,
  invalidateTenantRoleCache,
  resolveUserPermissions,
  scopeFilter,
  checkDirectObjectAccess,
}
