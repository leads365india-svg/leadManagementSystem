/**
 * Origin Validator - Roadmap Phase 22: Website Snippet, Allowed Origins & Attribution
 * 
 * Strict normalization and comparison of scheme, hostname and port.
 * Rejects malformed, untrusted, or unsafe wildcard configurations.
 */

/**
 * Normalizes an origin string into standard canonical format: scheme://hostname[:port]
 * Returns normalized lowercase origin or throws an Error if malformed/unsupported.
 * 
 * @param {string} raw - Origin string (e.g. "https://example.com:8080" or "http://localhost:3000")
 * @returns {string} Normalized origin
 */
function normalizeOrigin(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Origin must be a non-empty string")
  }

  const trimmed = raw.trim()

  // Reject dangerous pseudo-protocols, data URIs, or wildcards
  if (
    trimmed === "*" ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith("blob:")
  ) {
    throw new Error(`Invalid or unsafe origin specification: '${trimmed}'`)
  }

  // Ensure scheme is present
  let urlStr = trimmed
  if (!/^https?:\/\//i.test(urlStr)) {
    throw new Error(`Origin must specify an explicit http:// or https:// scheme: '${trimmed}'`)
  }

  // Handle wildcard subdomain format: e.g. https://*.example.com
  if (urlStr.includes("://*.")) {
    const parts = urlStr.split("://*.")
    if (parts.length !== 2) {
      throw new Error(`Malformed wildcard origin specification: '${trimmed}'`)
    }
    const scheme = parts[0].toLowerCase()
    if (scheme !== "http" && scheme !== "https") {
      throw new Error(`Unsupported origin protocol '${scheme}'. Only HTTP and HTTPS are permitted.`)
    }
    const domainPart = parts[1].toLowerCase().split("/")[0].split("?")[0].split("#")[0]
    if (!domainPart || domainPart.includes("*") || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domainPart)) {
      throw new Error(`Invalid wildcard domain in origin: '${trimmed}'`)
    }
    return `${scheme}://*.${domainPart}`
  }

  let parsed = null
  try {
    parsed = new URL(urlStr)
  } catch (err) {
    throw new Error(`Malformed origin URL: '${trimmed}' (${err.message})`)
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Unsupported origin protocol '${protocol}'. Only HTTP and HTTPS are permitted.`)
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname || hostname.includes("..")) {
    throw new Error(`Invalid hostname in origin: '${trimmed}'`)
  }

  // Handle standard port stripping according to W3C Origin spec
  const isDefaultPort =
    (protocol === "http:" && (parsed.port === "" || parsed.port === "80")) ||
    (protocol === "https:" && (parsed.port === "" || parsed.port === "443"))

  const portPart = isDefaultPort ? "" : `:${parsed.port}`
  return `${protocol}//${hostname}${portPart}`
}

/**
 * Validates whether an incoming HTTP Origin header is authorized against a tenant's allowed-origins list.
 * 
 * @param {string} incomingOrigin - Header Origin from client request
 * @param {string[]} allowedOrigins - Configured origins for tenant
 * @returns {{ allowed: boolean, normalizedOrigin: string|null, reason?: string }}
 */
function validateOrigin(incomingOrigin, allowedOrigins = []) {
  if (!incomingOrigin || typeof incomingOrigin !== "string") {
    return {
      allowed: false,
      normalizedOrigin: null,
      reason: "Missing or invalid HTTP Origin header",
    }
  }

  let normalizedIncoming = null
  try {
    normalizedIncoming = normalizeOrigin(incomingOrigin)
  } catch (err) {
    return {
      allowed: false,
      normalizedOrigin: null,
      reason: `Malformed Origin header: ${err.message}`,
    }
  }

  // If no origins configured, default to permissive (allow all) so integrations work out-of-the-box
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return {
      allowed: true,
      normalizedOrigin: normalizedIncoming,
    }
  }

  // Always permit local development origins
  if (
    normalizedIncoming.startsWith("http://localhost:") ||
    normalizedIncoming.startsWith("http://127.0.0.1:") ||
    normalizedIncoming === "http://localhost" ||
    normalizedIncoming === "http://127.0.0.1"
  ) {
    return {
      allowed: true,
      normalizedOrigin: normalizedIncoming,
    }
  }

  // Check exact normalized match or wildcard subdomain match (e.g., https://*.example.com)
  for (const rawAllowed of allowedOrigins) {
    if (!rawAllowed || typeof rawAllowed !== "string") continue

    try {
      // Check for wildcard subdomain pattern, e.g., https://*.example.com
      if (rawAllowed.includes("://*.")) {
        const [schemePart, domainPart] = rawAllowed.split("://*.")
        const incomingUrl = new URL(normalizedIncoming)
        const incomingScheme = incomingUrl.protocol.replace(":", "")

        if (
          incomingScheme.toLowerCase() === schemePart.toLowerCase() &&
          (incomingUrl.hostname.toLowerCase().endsWith("." + domainPart.toLowerCase()) ||
            incomingUrl.hostname.toLowerCase() === domainPart.toLowerCase())
        ) {
          return {
            allowed: true,
            normalizedOrigin: normalizedIncoming,
          }
        }
      } else {
        const normalizedAllowed = normalizeOrigin(rawAllowed)
        if (normalizedIncoming === normalizedAllowed) {
          return {
            allowed: true,
            normalizedOrigin: normalizedIncoming,
          }
        }
      }
    } catch (e) {
      // Ignore unparseable entry in config list during matching
      continue
    }
  }

  return {
    allowed: false,
    normalizedOrigin: normalizedIncoming,
    reason: `Origin '${normalizedIncoming}' is not authorized. Permitted origins: ${allowedOrigins.join(", ")}`,
  }
}

module.exports = {
  normalizeOrigin,
  validateOrigin,
}
