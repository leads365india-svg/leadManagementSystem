/**
 * White-Label Domain Routing & Security Utilities (Phase 30)
 *
 * Enforces strict tenant domain boundaries:
 * - Core platform hosts (admin.leads365.in, localhost, *.vercel.app) have access to Super Admin.
 * - Client white-label domains (e.g. crm.medical365.in) are strictly locked to Client CRM (/portal/login).
 *   Visits to / or /super-admin/* on white-label domains are blocked and redirected to /portal/login.
 */

const CORE_PLATFORM_HOSTS = new Set([
  "admin.leads365.in",
  "leads365.in",
  "localhost",
  "127.0.0.1",
  "::1",
])

/**
 * Normalizes a hostname or URL string to a clean, lowercased host without port or protocol.
 */
export function normalizeHostname(host) {
  if (!host || typeof host !== "string") return ""
  return host
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase()
}

/**
 * Determines whether a given hostname is a tenant white-label domain.
 * Returns true for custom tenant domains like 'crm.medical365.in'.
 * Returns false for administrative/dev hosts ('admin.leads365.in', 'localhost', '*.vercel.app').
 */
export function isWhiteLabelDomain(hostname) {
  const host = normalizeHostname(hostname)
  if (!host) return false

  // Local development environments
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  ) {
    return false
  }

  // Vercel preview and deployment domains
  if (host.endsWith(".vercel.app")) {
    return false
  }

  // Core administrative platform domains
  if (CORE_PLATFORM_HOSTS.has(host) || host === "admin.leads365.in" || host === "leads365.in") {
    return false
  }

  // Any other domain is treated as a tenant white-label domain
  return true
}

/**
 * Determines whether the hostname is permitted to access the Super Admin console.
 */
export function isSuperAdminAllowedDomain(hostname) {
  return !isWhiteLabelDomain(hostname)
}
