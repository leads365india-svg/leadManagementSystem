const mongoose = require("mongoose")
const Account = require("../models/Account")
const DomainMapping = require("../models/DomainMapping")
const Workspace = require("../models/Workspace")

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
 * Determines whether a given hostname is a core Leads365 platform domain
 * or local dev environment (not a tenant white-label custom domain).
 * All tenant logins and Super Admin platform logins are permitted on platform domains.
 * @param {string} hostname
 * @returns {boolean}
 */
const isPlatformDomain = (hostname) => {
  if (!hostname || typeof hostname !== "string") return false
  const clean = sanitizeHostname(hostname)
  if (!clean) return false

  // Local development / loopback
  if (
    clean === "localhost" ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.endsWith(".localhost")
  ) {
    return true
  }

  // Core production & preview platform domains
  if (
    clean === "leads365.in" ||
    clean.endsWith(".leads365.in") ||
    clean.endsWith(".vercel.app") ||
    clean.endsWith(".onrender.com")
  ) {
    return true
  }

  return false
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
      if (clean && !isPlatformDomain(clean)) {
        domainSet.add(clean)
      }
    }

    // Include verified custom domains from DomainMapping (both Accounts and Workspaces)
    const verifiedMappings = await DomainMapping.find({
      status: "verified",
    })
      .setOptions({ skipTenantFilter: true })
      .select("domain")
      .lean()

    for (const m of verifiedMappings) {
      const clean = sanitizeHostname(m.domain)
      if (clean && !isPlatformDomain(clean)) {
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
  if (isPlatformDomain(cleanHost)) {
    return null
  }

  const now = Date.now()
  const cachedEntry = cachedAccountByDomainMap.get(cleanHost)
  if (cachedEntry && now - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return cachedEntry.account
  }

  try {
    const escaped = cleanHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    // 1. Check DomainMapping collection first (Mode B global domain router)
    let boundWorkspace = null
    const mapping = await DomainMapping.findOne({
      domain: cleanHost,
      status: "verified",
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    let account = null
    if (mapping) {
      if (mapping.targetType === "WORKSPACE") {
        boundWorkspace = await Workspace.findOne({ _id: mapping.targetId, status: "active" })
          .setOptions({ skipTenantFilter: true })
          .lean()
        account = await Account.findOne({ accountId: mapping.tenantId, status: { $ne: "suspended" } }).lean()
        if (account && boundWorkspace) {
          account.boundWorkspace = boundWorkspace
        }
      } else {
        account = await Account.findOne({ _id: mapping.targetId, status: { $ne: "suspended" } }).lean()
      }
    }

    // 2. Fallback to direct Account.customDomain for backward compatibility with existing accounts
    if (!account) {
      account = await Account.findOne({
        customDomain: { $regex: new RegExp(`^${escaped}$`, "i") },
        status: { $ne: "suspended" },
      }).lean()
    }

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

  // Fast-path: core platform domains are always allowed origins
  if (isPlatformDomain(cleanHost)) {
    return true
  }

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

    // Direct database fallback for DomainMapping verified domains
    const mappingMatch = await DomainMapping.findOne({
      domain: cleanHost,
      status: "verified",
    })
      .setOptions({ skipTenantFilter: true })
      .lean()

    if (mappingMatch && mappingMatch.domain) {
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
  isPlatformDomain,
  sanitizeHostname,
}
