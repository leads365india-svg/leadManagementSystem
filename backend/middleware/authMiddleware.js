const jwt = require("jsonwebtoken")
const User = require("../models/User")
const RolePermission = require("../models/RolePermission")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-superadmin-secret-key-2026-secure"

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "leadflow-superadmin-secret-key-2026-secure")) {
  console.warn("⚠️ SECURITY WARNING: Insecure default JWT_SECRET is in use in production mode. Set JWT_SECRET in environment variables!")
}

// Extract JWT token from cookie or Authorization header
const extractToken = (req) => {
  if (req.cookies && req.cookies.superadmin_token) {
    return req.cookies.superadmin_token
  }
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1]
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

    const decoded = jwt.verify(token, JWT_SECRET)

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

    const decoded = jwt.verify(token, JWT_SECRET)
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
      // If user is unauthenticated (legacy/public customer demo):
      if (!req.user) {
        const targetTenant = (req.query && req.query.tenantId) || (req.body && req.body.tenantId)
        if (targetTenant && targetTenant !== "default-tenant") {
          return res.status(403).json({
            success: false,
            error: "Authentication required to access tenant partition.",
          })
        }
        return next()
      }

      // Super Admin always bypasses role-specific permission restrictions
      if (req.user.role === "super_admin") {
        return next()
      }

      // If user is account_admin, lookup active permissions configured by Super Admin
      const config = await RolePermission.findOne({ targetRole: "account_admin" })
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

    if (req.cookies && req.cookies.superadmin_token) {
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
  extractToken,
  authenticate,
  optionalAuthenticate,
  requireSuperAdmin,
  requireAccountAdmin,
  checkPermission,
  verifyCSRF,
}
