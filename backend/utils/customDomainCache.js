const Account = require("../models/Account")

/**
 * In-memory cache for tenant custom domains with 60s TTL.
 * Enables dynamic multi-tenant CORS for white-label domains
 * without requiring manual FRONTEND_URL environment changes.
 */

let cachedDomainsSet = null
let lastFetchedAt = 0
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

// Sanitize domain string to bare lowercase hostname
const sanitizeHostname = (domain) => {
  if (!domain || typeof domain !== "string") return ""
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .trim()
}

/**
 * Fetch and cache all active, unsuspended tenant custom domains.
 * @returns {Promise<Set<string>>}
 */
const getCustomDomainsCached = async () => {
  const now = Date.now()
  if (cachedDomainsSet && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedDomainsSet
  }

  try {
    const accounts = await Account.find({
      customDomain: { $exists: true, $ne: "" },
      status: { $ne: "suspended" },
    })
      .select("customDomain")
      .lean()

    const domainSet = new Set()
    for (const acc of accounts) {
      const clean = sanitizeHostname(acc.customDomain)
      if (clean) {
        domainSet.add(clean)
      }
    }

    cachedDomainsSet = domainSet
    lastFetchedAt = now
    return domainSet
  } catch (error) {
    console.error("Error fetching tenant custom domains for CORS:", error.message)
    return cachedDomainsSet || new Set()
  }
}

/**
 * Invalidate domain cache immediately when accounts are created or updated.
 */
const invalidateCustomDomainCache = () => {
  cachedDomainsSet = null
  lastFetchedAt = 0
}

/**
 * Verify if an incoming HTTP Origin belongs to an active tenant's custom domain.
 * @param {string} origin e.g. "https://crm.tenantcompany.com"
 * @returns {Promise<boolean>}
 */
const isCustomDomainAllowed = async (origin) => {
  if (!origin || typeof origin !== "string") return false

  try {
    const parsed = new URL(origin)
    // Only allow secure HTTPS in production, allow HTTP in development/testing
    const isDev = process.env.NODE_ENV !== "production"
    if (parsed.protocol !== "https:" && !isDev) {
      return false
    }

    const hostname = parsed.hostname.toLowerCase()
    if (!hostname) return false

    const allowedDomains = await getCustomDomainsCached()
    return allowedDomains.has(hostname)
  } catch (_) {
    return false
  }
}

module.exports = {
  getCustomDomainsCached,
  invalidateCustomDomainCache,
  isCustomDomainAllowed,
  sanitizeHostname,
}
