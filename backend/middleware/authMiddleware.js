const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Account = require("../models/Account")
const RolePermission = require("../models/RolePermission")
const Device = require("../models/Device")

const INSECURE_DEFAULT_SECRETS = [
  "leadflow-superadmin-secret-key-2026-secure",
  "your-random-secure-jwt-secret-here",
  "secret",
  "jwt-secret",
]

// Validate and retrieve JWT secret securely
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  const isProduction = process.env.NODE_ENV === "production"

  if (isProduction) {
    if (!secret || typeof secret !== "string" || !secret.trim()) {
      throw new Error("FATAL: JWT_SECRET environment variable is missing or empty in production mode.")
    }
    if (INSECURE_DEFAULT_SECRETS.includes(secret.trim()) || secret.trim().length < 32) {
      throw new Error(
        "FATAL: Insecure or weak JWT_SECRET configured in production. Must be at least 32 characters and not a known placeholder.",
      )
    }
    return secret.trim()
  }

  // Development / Test fallback
  return (secret && secret.trim()) || "leadflow-dev-secret-key-min32-chars-for-local-only"
}

// Extract JWT token from cookie or Authorization header
const extractToken = (req) => {
  const isSuperAdminRoute = req.originalUrl && req.originalUrl.includes("/super-admin")

  if (req.cookies) {
    if (isSuperAdminRoute) {
      if (req.cookies.superadmin_token) {
        return req.cookies.superadmin_token
      }
      if (req.cookies.client_token) {
        return req.cookies.client_token
      }
    } else {
      if (req.cookies.client_token) {
        return req.cookies.client_token
      }
      if (req.cookies.superadmin_token) {
        return req.cookies.superadmin_token
      }
    }
  }
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1]
  }
  if (req.query && req.query.token) {
    return req.query.token
  }
  return null
}

// Authenticate user token - Mandatory
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req)

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Please log in.",
      })
    }

    const decoded = jwt.verify(token, getJwtSecret())

    const user = await User.findById(decoded.id)
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found or session invalid.",
      })
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        error: "Your account is suspended. Please contact the administrator.",
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

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      status: user.status,
    }

    if (user.tenantId) {
      req.tenantId = user.tenantId
    }

    // Check device revocation status if x-device-id header is provided
    const deviceIdHeader = req.headers["x-device-id"]
    if (deviceIdHeader) {
      const device = await Device.findOne({ deviceId: deviceIdHeader.trim() }).lean()
      if (device && device.status === "REVOKED") {
        return res.status(403).json({
          success: false,
          error: "This device has been revoked by your agency administrator.",
          errorCode: "DEVICE_REVOKED",
        })
      }
    }

    next()
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
    const user = await User.findById(decoded.id)

    if (user && user.status !== "suspended") {
      req.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        status: user.status,
      }
      if (user.tenantId) {
        req.tenantId = user.tenantId
      }
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

// Check specific permission key against configured permissions
const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // Require authentication for all protected CRM permission checks
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Authentication required. Please log in.",
        })
      }

      // Super Admin always bypasses role-specific permission restrictions
      if (req.user.role === "super_admin") {
        return next()
      }

      // Lookup active permissions configured for the role or default account_admin
      const config =
        (await RolePermission.findOne({ targetRole: req.user.role })) ||
        (await RolePermission.findOne({ targetRole: "account_admin" }))
      const activePermissions = config ? config.permissions : []

      if (!activePermissions.includes(requiredPermission)) {
        return res.status(403).json({
          success: false,
          error: `Permission denied. Missing required permission: '${requiredPermission}'`,
        })
      }

      next()
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to verify permissions" })
    }
  }
}

// CSRF Protection Middleware for state-changing requests using cookie authentication
const verifyCSRF = (allowedOrigins) => {
  return (req, res, next) => {
    const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"]
    if (!mutatingMethods.includes(req.method)) {
      return next()
    }

    // Skip CSRF verification for public integration webhook (authenticated via API key, no session cookies)
    if (req.originalUrl && req.originalUrl.includes("/integrations/leads/website")) {
      return next()
    }

    if (req.cookies && (req.cookies.superadmin_token || req.cookies.client_token)) {
      const origin = req.headers.origin || req.headers.referer
      if (origin) {
        const isAllowed = allowedOrigins.some((allowed) => origin.startsWith(allowed))
        if (!isAllowed) {
          return res.status(403).json({
            success: false,
            error: "CSRF verification failed: Origin not allowed",
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
  checkPermission,
  verifyCSRF,
}
