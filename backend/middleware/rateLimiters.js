const rateLimit = require("express-rate-limit")
const crypto = require("crypto")

/**
 * LeadFlow CRM - Configurable Domain Rate Limiters
 * Complies with Roadmap Phase 1: Security leftovers and repo hygiene.
 * 
 * Separates traffic concerns so sales offices sharing a single IP or background mobile/integration
 * devices never bottleneck against the standard dashboard web limiter.
 */

const shouldSkipDashboardRateLimit = (req) => {
  if (req.method === "OPTIONS") return true
  const url = req.originalUrl || req.baseUrl || req.url || ""
  return (
    url.startsWith("/api/integrations") ||
    url.startsWith("/api/auth") ||
    url.startsWith("/api/health") ||
    url === "/health"
  )
}

const generateIntegrationKey = (req) => {
  const apiKey = req.headers?.["x-api-key"] || req.headers?.["x-site-key"] || req.query?.apiKey
  if (apiKey) {
    const keyHash = crypto.createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 16)
    return `integration_${keyHash}`
  }
  return `integration_ip_${req.ip || "unknown_ip"}`
}

// 1. Dashboard Limiter: Standard web portal and admin interface
const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  keyGenerator: (req) => {
    // Key by authenticated user ID if present, otherwise IP
    if (req.user?.id || req.user?._id) {
      return `user_${req.user.id || req.user._id}`
    }
    try {
      const authHeader = req.headers?.authorization || req.headers?.Authorization
      let token = null
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1]
      } else if (req.cookies?.superadmin_token) {
        token = req.cookies.superadmin_token
      } else if (req.cookies?.client_token) {
        token = req.cookies.client_token
      } else if (req.headers?.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)(?:superadmin_token|client_token)=([^;]+)/)
        if (match) {
          token = decodeURIComponent(match[1])
        }
      }
      if (token) {
        const jwt = require("jsonwebtoken")
        const { getJwtSecret } = require("./authMiddleware")
        const verified = jwt.verify(token, getJwtSecret())
        if (verified && (verified.id || verified._id)) {
          return `user_${verified.id || verified._id}`
        }
      }
    } catch (_) {}
    return req.ip || "unknown_ip"
  },
  skip: shouldSkipDashboardRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many dashboard requests. Please slow down and try again shortly.",
  },
})
dashboardLimiter.skip = shouldSkipDashboardRateLimit

// 2. Auth Limiter: Login and password endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 login attempts per window
  keyGenerator: (req) => {
    // Configurable: Combines IP + normalized email to prevent targeted brute-force and IP collision
    const email = req.body?.email && typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : ""
    return email ? `auth_${req.ip}_${email}` : `auth_${req.ip || "unknown_ip"}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many authentication attempts. Please wait 15 minutes before retrying.",
  },
})

// 3. Integration Limiter: Webhooks, platform feeds (Meta, Google, IndiaMART, Website)
const integrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // High throughput allowance for high-volume lead capture
  keyGenerator: generateIntegrationKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Integration rate limit exceeded. Please regulate webhook delivery rate.",
  },
})
integrationLimiter.keyGenerator = generateIntegrationKey

// 4. Mobile Sync Limiter: Device-bound call logs and lead sync (Phase 15 readiness)
const mobileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 400,
  keyGenerator: (req) => {
    // Keyed by unique device token/ID
    const deviceId = req.headers["x-device-id"] || req.headers["device-id"]
    if (deviceId) {
      return `mobile_device_${deviceId}`
    }
    return req.user?.id ? `mobile_user_${req.user.id}` : `mobile_ip_${req.ip || "unknown_ip"}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Mobile synchronization limit reached. Please retry in a few moments.",
  },
})

module.exports = {
  dashboardLimiter,
  authLimiter,
  integrationLimiter,
  mobileLimiter,
}
