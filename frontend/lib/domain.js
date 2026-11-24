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
  "crm.leads365.in",
  "app.leads365.in",
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

  // Render deployment domains
  if (host.endsWith(".onrender.com")) {
    return false
  }

  // Core administrative platform domains
  if (
    CORE_PLATFORM_HOSTS.has(host) ||
    host === "admin.leads365.in" ||
    host === "leads365.in" ||
    host.endsWith(".leads365.in")
  ) {
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

/**
 * Safely constructs a validated HTTPS URL from a stored custom domain value.
 *
 * Rules:
 * - Rejects empty, null, non-string, or dangerous schemes (javascript:, data:, vbscript:, file:).
 * - If value already starts with https://, retains protocol without duplicating.
 * - If value starts with http://, upgrades to https://.
 * - If value has no protocol, prepends https://.
 * - Preserves any valid subdomain or path.
 * - Returns null for invalid or malicious inputs.
 */
export function buildCustomDomainUrl(domain) {
  if (!domain || typeof domain !== "string") return null
  const trimmed = domain.trim()
  if (!trimmed) return null

  // Reject dangerous schemes
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return null
  }

  // Reject strings with dangerous characters or control characters
  if (/[\s<>"'`\\]/.test(trimmed)) {
    return null
  }

  let candidate = trimmed
  if (/^https?:\/\//i.test(candidate)) {
    if (/^http:\/\//i.test(candidate)) {
      candidate = candidate.replace(/^http:\/\//i, "https://")
    }
  } else if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`
  } else {
    candidate = `https://${candidate}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== "https:") {
      return null
    }
    // Must contain a valid hostname with at least one dot or localhost
    if (!parsed.hostname || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) {
      return null
    }
    // Hostname must conform to valid domain characters
    if (!/^[a-zA-Z0-9.-]+$/.test(parsed.hostname)) {
      return null
    }
    return parsed.href
  } catch (_e) {
    return null
  }
}
