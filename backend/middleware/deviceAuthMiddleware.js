const jwt = require("jsonwebtoken")
const Device = require("../models/Device")
const User = require("../models/User")
const Account = require("../models/Account")
const { getJwtSecret } = require("./authMiddleware")
const { runWithTenantContext } = require("./tenantContext")

/**
 * Leads-365 CRM - Mobile Device Authentication & Versioning Middleware (Phase 15)
 */

/**
 * Compares two semantic version strings (e.g., "1.2.3" vs "1.2.0").
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 */
function compareVersions(v1, v2) {
  const parts1 = String(v1 || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0)
  const parts2 = String(v2 || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0)

  const len = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

/**
 * Enforces minimum supported app version header (X-App-Version / X-Client-Version).
 * Rejects outdated clients with HTTP 426 Upgrade Required.
 */
const checkAppVersion = (req, res, next) => {
  const clientVersion =
    req.headers["x-app-version"] ||
    req.headers["x-client-version"] ||
    req.query?.appVersion ||
    req.body?.appVersion

  const minVersion = process.env.MIN_MOBILE_APP_VERSION || "1.0.0"

  if (clientVersion) {
    if (compareVersions(clientVersion, minVersion) < 0) {
      return res.status(426).json({
        success: false,
        code: "UPGRADE_REQUIRED",
        error: `App update required. Your version (${clientVersion}) is no longer supported. Please update to v${minVersion} or higher.`,
        minVersion,
        clientVersion,
      })
    }
  }

  next()
}

/**
 * Validates device-bound JWT token, verifies device active status, and sets tenant context.
 * Rejects revoked devices immediately with HTTP 403 DEVICE_REVOKED.
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    let token = null

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1].trim()
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        error: "Device authentication token required. Please authenticate via /api/mobile/auth/login",
      })
    }

    let decoded = null
    try {
      decoded = jwt.verify(token, getJwtSecret())
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN",
        error: "Device token expired or invalid. Please refresh token or log in again.",
      })
    }

    if (decoded.tokenType !== "device_access") {
      return res.status(401).json({
        success: false,
        code: "INVALID_TOKEN_TYPE",
        error: "Invalid token type for mobile endpoint. Expected device_access token.",
      })
    }

    const { tenantId, deviceId, id, userId } = decoded
    const effectiveUserId = id || userId

    // 1. Lookup Device & Verify Revocation Status
    const device = await Device.findOne({ _id: deviceId, tenantId }).setOptions({ skipTenantFilter: true })
    if (!device) {
      return res.status(401).json({
        success: false,
        code: "DEVICE_NOT_FOUND",
        error: "Device hardware not recognized or deregistered",
      })
    }

    if (device.status === "revoked") {
      return res.status(403).json({
        success: false,
        code: "DEVICE_REVOKED",
        error: "This device has been revoked by an administrator. Telephony access disabled.",
      })
    }

    // 2. Lookup User & Check Account Active
    const user = await User.findOne({ _id: effectiveUserId, tenantId }).setOptions({ skipTenantFilter: true })
    if (!user) {
      return res.status(401).json({
        success: false,
        code: "USER_NOT_FOUND",
        error: "Agent user record not found",
      })
    }

    if (user.status === "suspended" || user.isActive === false) {
      return res.status(403).json({
        success: false,
        code: "USER_DEACTIVATED",
        error: "Your staff account has been deactivated",
      })
    }

    // 3. Verify Tenant Account Status
    if (user.tenantId && user.role !== "super_admin") {
      const account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account && account.status === "suspended") {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_SUSPENDED",
          error: "Your CRM account is suspended. Contact administrator.",
        })
      }
    }

    // Update last seen timestamp asynchronously
    Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } }).exec().catch(() => {})

    req.user = user
    req.device = device
    req.tenantId = user.tenantId

    // Run downstream handlers inside ambient tenant context
    runWithTenantContext(user.tenantId, () => {
      next()
    })
  } catch (err) {
    console.error("[DeviceAuthMiddleware Error]:", err)
    return res.status(500).json({
      success: false,
      error: `Device authentication error: ${err.message}`,
    })
  }
}

/**
 * Mobile-specific in-memory rate limiter: 150 requests per minute per device/IP.
 */
const mobileRateMap = new Map()

const mobileRateLimiter = (req, res, next) => {
  const key = req.device?._id?.toString() || req.headers["x-device-id"] || req.ip || "unknown"
  const now = Date.now()
  const windowMs = 60 * 1000
  const maxRequests = 150

  let entry = mobileRateMap.get(key)
  if (!entry || now - entry.startTime > windowMs) {
    entry = { count: 1, startTime: now }
    mobileRateMap.set(key, entry)
  } else {
    entry.count++
  }

  if (entry.count > maxRequests) {
    return res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Too many mobile requests. Please slow down.",
      retryAfterSeconds: Math.ceil((entry.startTime + windowMs - now) / 1000),
    })
  }

  // Periodic cleanup of stale entries (every 1000 requests)
  if (mobileRateMap.size > 5000) {
    for (const [k, v] of mobileRateMap.entries()) {
      if (now - v.startTime > windowMs) mobileRateMap.delete(k)
    }
  }

  next()
}

module.exports = {
  authenticateDevice,
  checkAppVersion,
  mobileRateLimiter,
  compareVersions,
}
