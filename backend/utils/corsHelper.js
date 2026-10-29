/**
 * Leads-365 CORS & Origin Verification Utilities
 * Robust multi-environment origin parsing, wildcard matching, and security enforcement
 */

/**
 * Parses a comma-separated list of allowed frontend URLs from environment variables.
 * Handles surrounding quotes, trailing slashes, whitespace, and missing protocols.
 * @param {string} envUrlString Comma-separated URL string from process.env.FRONTEND_URL
 * @returns {string[]} Array of normalized allowed origin strings/patterns
 */
const parseAllowedOrigins = (envUrlString = "") => {
  const rawList = (envUrlString || "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, ""))
    .filter(Boolean)

  const origins = new Set()
  for (const raw of rawList) {
    if (raw) {
      origins.add(raw)
      // If entered without protocol, e.g. "my-app.vercel.app" or "*.vercel.app"
      if (!/^https?:\/\//i.test(raw)) {
        origins.add(`https://${raw}`)
      }
    }
  }
  return Array.from(origins)
}

/**
 * Determines whether a given request origin is allowed based on explicit origins,
 * wildcard patterns (e.g., https://*.vercel.app), and dev localhost ports.
 * Rejects prefix/suffix spoofed domains (e.g. evil-vercel.app or vercel.app.attacker.com).
 * @param {string} origin The requesting origin (from req.headers.origin)
 * @param {string[]} allowedOrigins List of allowed origin strings and patterns
 * @param {boolean} isDevelopment Whether the environment is non-production
 * @returns {boolean} True if origin is permitted
 */
const isOriginAllowed = (origin, allowedOrigins = [], isDevelopment = false) => {
  // Allow requests with no origin (curl, mobile apps, server-to-server calls)
  if (!origin) return true

  const normalized = origin.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").toLowerCase()

  const normalizedAllowed = allowedOrigins.map((pat) =>
    pat.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").toLowerCase()
  )

  // Direct exact match
  if (normalizedAllowed.includes(normalized)) {
    return true
  }

  // Wildcard pattern matching (e.g. https://*.vercel.app or *.vercel.app)
  for (const pattern of normalizedAllowed) {
    let p = pattern
    if (!/^https?:\/\//i.test(p)) {
      p = `https://${p}`
    }

    if (p.includes("*")) {
      const parts = p.split("*")
      const escapedParts = parts.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      // Match single or nested subdomains containing a-z, 0-9, dash, underscore
      const regexPattern = `^${escapedParts.join("(?:[a-z0-9_-]+(?:\\.[a-z0-9_-]+)*)")}(?::\\d+)?$`
      try {
        const regex = new RegExp(regexPattern, "i")
        if (regex.test(normalized)) {
          return true
        }
      } catch (_) {}
    }
  }

  // Local development fallback for any localhost or 127.0.0.1 port
  if (isDevelopment && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
    return true
  }

  return false
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
}
