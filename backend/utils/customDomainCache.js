const mongoose = require("mongoose")
const Account = require("../models/Account")

/**
 * In-memory cache for tenant custom domains with 60s TTL.
 * Enables dynamic multi-tenant CORS for white-label domains
 * without requiring manual FRONTEND_URL environment changes.
 */

let cachedDomainsSet = null
let cachedAccountByDomainMap = new Map()
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

  // Await DB connection if still establishing
  if (mongoose.connection && mongoose.connection.readyState !== 1) {
    try {
      await new Promise((resolve) => {
        if (mongoose.connection.readyState === 1) return resolve()
        const timer = setTimeout(resolve, 4000)
        mongoose.connection.once("open", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    } catch (_) {}
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
  cachedAccountByDomainMap.clear()
  lastFetchedAt = 0
}

/**
 * Retrieve an active Account mapped to a custom domain with in-memory caching.
 * @param {string} hostname e.g. "crm.medical365.in"
 * @returns {Promise<object|null>}
 */
const getAccountByCustomDomainCached = async (hostname) => {
  if (!hostname || typeof hostname !== "string") return null
  const cleanHost = sanitizeHostname(hostname)
  if (!cleanHost) return null

  // Fast rejection of core platform or local hosts
  if (
    cleanHost === "localhost" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".vercel.app") ||
    cleanHost === "admin.leads365.in" ||
    cleanHost === "leads365.in"
  ) {
    return null
  }

  const now = Date.now()
  const cachedEntry = cachedAccountByDomainMap.get(cleanHost)
  if (cachedEntry && now - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return cachedEntry.account
  }

  try {
    const escaped = cleanHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const account = await Account.findOne({
      customDomain: { $regex: new RegExp(`^${escaped}$`, "i") },
      status: { $ne: "suspended" },
    }).lean()

    cachedAccountByDomainMap.set(cleanHost, {
      account: account || null,
      cachedAt: now,
    })

    return account || null
  } catch (error) {
    console.error("Error in getAccountByCustomDomainCached:", error.message)
    return null
  }
}

/**
 * Verify if an incoming HTTP Origin belongs to an active tenant's custom domain.
 * @param {string} origin e.g. "https://crm.medical365.in"
 * @returns {Promise<boolean>}
 */
const isCustomDomainAllowed = async (origin) => {
  if (!origin || typeof origin !== "string") return false

  const cleanHost = sanitizeHostname(origin)
  if (!cleanHost) return false

  // Disallow localhost or IP from custom domain bypass
  if (
    cleanHost === "localhost" ||
    cleanHost === "127.0.0.1" ||
    cleanHost === "::1" ||
    cleanHost.endsWith(".localhost")
  ) {
    return false
  }

  // Only allow secure HTTPS in production, allow HTTP in development/testing
  const isDev = process.env.NODE_ENV !== "production"
  if (!isDev) {
    if (origin.startsWith("http://") && !origin.startsWith("https://")) {
      return false
    }
  }

  try {
    const allowedDomains = await getCustomDomainsCached()
    if (allowedDomains && allowedDomains.has(cleanHost)) {
      return true
    }

    // Direct database fallback if cache is cold or missed on first request
    const escaped = cleanHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = await Account.findOne({
      customDomain: { $regex: new RegExp(`^${escaped}$`, "i") },
      status: { $ne: "suspended" },
    })
      .select("customDomain")
      .lean()

    if (match && match.customDomain) {
      if (allowedDomains) {
        allowedDomains.add(cleanHost)
      }
      return true
    }

    return false
  } catch (err) {
    console.error("isCustomDomainAllowed check error:", err.message)
    return false
  }
}

module.exports = {
  getCustomDomainsCached,
  getAccountByCustomDomainCached,
  invalidateCustomDomainCache,
  isCustomDomainAllowed,
  sanitizeHostname,
}
