const rateLimit = require("express-rate-limit")

/**
 * LeadFlow CRM - Configurable Domain Rate Limiters
 * Complies with Roadmap Phase 1: Security leftovers and repo hygiene.
 * 
 * Separates traffic concerns so sales offices sharing a single IP or background mobile/integration
 * devices never bottleneck against the standard dashboard web limiter.
 */

// 1. Dashboard Limiter: Standard web portal and admin interface
const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  keyGenerator: (req) => {
    // Key by authenticated user ID if present, otherwise IP
    return req.user?.id ? `user_${req.user.id}` : (req.ip || "unknown_ip")
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many dashboard requests. Please slow down and try again shortly.",
  },
})

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
  keyGenerator: (req) => {
    // Keyed by API credential if available, preventing office-wide IP blocking
    const apiKey = req.headers["x-api-key"] || req.headers["x-site-key"] || req.query?.apiKey
    if (apiKey) {
      return `integration_${String(apiKey).slice(-12)}`
    }
    return `integration_ip_${req.ip || "unknown_ip"}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Integration rate limit exceeded. Please regulate webhook delivery rate.",
  },
})

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
