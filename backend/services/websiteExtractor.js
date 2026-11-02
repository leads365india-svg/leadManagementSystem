const http = require("http")
const https = require("https")
const dns = require("dns")
const { URL } = require("url")

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024 // 2MB
const REQUEST_TIMEOUT_MS = 12000 // 12 seconds
const MAX_REDIRECTS = 5
const MAX_EXTRACTED_CHARS = 100000 // 100,000 chars for website pages

/**
 * Checks whether an IP address belongs to private, loopback, link-local, or internal ranges.
 * Implements strict SSRF protection.
 * 
 * @param {string} ip
 * @returns {boolean} True if the IP is private or blocked
 */
function isPrivateOrBlockedIP(ip) {
  if (!ip || typeof ip !== "string") return true

  const trimmed = ip.trim()

  // 1. IPv4 checks
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".").map(Number)
    if (parts.length !== 4 || parts.some(isNaN)) return true
    const [a, b, c, d] = parts

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true
    // 127.0.0.0/8 (Loopback / localhost)
    if (a === 127) return true
    // 10.0.0.0/8 (Private A)
    if (a === 10) return true
    // 172.16.0.0/12 (Private B)
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16 (Private C)
    if (a === 192 && b === 168) return true
    // 169.254.0.0/16 (Link-local, AWS/GCP/Azure instance metadata)
    if (a === 169 && b === 254) return true
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true
    // Documentation / TEST-NETs
    if (a === 192 && b === 0 && c === 0) return true
    if (a === 192 && b === 0 && c === 2) return true
    if (a === 198 && b === 51 && c === 100) return true
    if (a === 203 && b === 0 && c === 113) return true
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true
    // Broadcast
    if (a === 255 && b === 255 && c === 255 && d === 255) return true

    return false
  }

  // 2. IPv6 checks
  const lower = trimmed.toLowerCase()
  if (lower === "::1" || lower === "::") return true
  // Unique local addresses (fc00::/7)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  // Link-local unicast (fe80::/10)
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true
  }
  // IPv4-mapped IPv6 (::ffff:192.168.1.1)
  if (lower.includes("::ffff:")) {
    const ipv4Part = lower.split("::ffff:")[1]
    if (ipv4Part) return isPrivateOrBlockedIP(ipv4Part)
  }
  // Multicast (ff00::/8)
  if (lower.startsWith("ff")) return true

  return false
}

/**
 * Validates a website URL and its DNS resolution for SSRF security.
 * 
 * @param {string} rawUrl
 * @returns {Promise<{ validUrl: URL, resolvedIps: string[] }>}
 */
async function validateUrlSecurity(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("A valid website URL is required.")
  }

  let parsed = null
  try {
    parsed = new URL(rawUrl.trim())
  } catch (err) {
    throw new Error(`Malformed website URL: ${err.message}`)
  }

  // Protocol check: Only HTTP and HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol '${parsed.protocol}'. Only http:// and https:// URLs are allowed.`)
  }

  const hostname = parsed.hostname.toLowerCase().trim()

  // Hostname check for obvious local/internal names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  ) {
    throw new Error(`Access to internal/localhost destination '${hostname}' is blocked for security reasons.`)
  }

  // Check if hostname is a raw IP literal
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    if (isPrivateOrBlockedIP(hostname)) {
      throw new Error(`Access to private/internal IP address '${hostname}' is blocked for security reasons.`)
    }
    return { validUrl: parsed, resolvedIps: [hostname] }
  }

  // Resolve DNS to verify all destination IPs against the blacklist
  let addresses = []
  try {
    addresses = await dns.promises.lookup(hostname, { all: true })
  } catch (dnsErr) {
    throw new Error(`DNS resolution failed for '${hostname}': ${dnsErr.message}`)
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`No IP addresses could be resolved for '${hostname}'.`)
  }

  const resolvedIps = []
  for (const addr of addresses) {
    const ip = addr.address
    resolvedIps.push(ip)
    if (isPrivateOrBlockedIP(ip)) {
      throw new Error(
        `Destination hostname '${hostname}' resolves to private/internal IP '${ip}'. Access is blocked (SSRF Protection).`
      )
    }
  }

  return { validUrl: parsed, resolvedIps }
}

/**
 * Strips HTML tags, scripts, styles, and extracts readable plain text.
 * 
 * @param {string} html
 * @returns {string} Clean plain text
 */
function extractTextFromHtml(html) {
  if (!html || typeof html !== "string") return ""

  let clean = html
    // Remove scripts, styles, noscript, svg, nav, footer, header, form elements
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, " ")
    // Convert structural block tags to newlines
    .replace(/<(?:p|div|section|article|h[1-6]|tr|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    // Strip all remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&copy;/gi, "©")
    .replace(/&reg;/gi, "®")
    .replace(/&trade;/gi, "™")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    // Normalize newlines and spaces
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim()

  if (clean.length > MAX_EXTRACTED_CHARS) {
    clean = clean.slice(0, MAX_EXTRACTED_CHARS) + "\n\n[Content truncated to 100,000 characters]"
  }

  return clean
}

/**
 * Safely fetches a public website URL with strict SSRF controls and redirect following.
 * 
 * @param {string} initialUrl
 * @param {number} [redirectCount=0]
 * @returns {Promise<{ html: string, finalUrl: string, httpStatus: number, resolvedIp: string }>}
 */
async function fetchSafeUrl(initialUrl, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded maximum limit of ${MAX_REDIRECTS}).`)
  }

  const { validUrl, resolvedIps } = await validateUrlSecurity(initialUrl)
  const resolvedIp = resolvedIps[0] || "unknown"

  return new Promise((resolve, reject) => {
    const isHttps = validUrl.protocol === "https:"
    const client = isHttps ? https : http

    const options = {
      hostname: validUrl.hostname,
      port: validUrl.port || (isHttps ? 443 : 80),
      path: validUrl.pathname + validUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Leads365-AI-Knowledge-Bot/1.0 (+https://leads-365.com)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
        "Accept-Encoding": "identity", // Keep uncompressed for predictable stream size calculation
        Connection: "close",
      },
      timeout: REQUEST_TIMEOUT_MS,
    }

    let settled = false
    const req = client.request(options, (res) => {
      const statusCode = res.statusCode || 200

      // Handle redirects securely
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        req.destroy()
        if (settled) return
        settled = true

        try {
          const redirectUrl = new URL(res.headers.location, validUrl).toString()
          return fetchSafeUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject)
        } catch (redirectErr) {
          return reject(new Error(`Invalid redirect location header: ${redirectErr.message}`))
        }
      }

      // Check HTTP status code
      if (statusCode < 200 || statusCode >= 400) {
        req.destroy()
        if (settled) return
        settled = true
        return reject(new Error(`Server returned HTTP ${statusCode} for '${validUrl.toString()}'`))
      }

      // Check Content-Type header
      const contentType = (res.headers["content-type"] || "").toLowerCase()
      if (
        contentType &&
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/xhtml") &&
        !contentType.includes("text/xml")
      ) {
        req.destroy()
        if (settled) return
        settled = true
        return reject(
          new Error(
            `Unsupported content type '${contentType}'. Only HTML and text web pages can be extracted as website knowledge.`
          )
        )
      }

      let receivedBytes = 0
      const chunks = []

      res.on("data", (chunk) => {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_RESPONSE_SIZE) {
          req.destroy()
          if (settled) return
          settled = true
          return reject(
            new Error(
              `Web page content exceeded maximum size limit of ${Math.round(MAX_RESPONSE_SIZE / (1024 * 1024))}MB.`
            )
          )
        }
        chunks.push(chunk)
      })

      res.on("end", () => {
        if (settled) return
        settled = true
        const buffer = Buffer.concat(chunks)
        const html = buffer.toString("utf-8")
        resolve({
          html,
          finalUrl: validUrl.toString(),
          httpStatus: statusCode,
          resolvedIp,
        })
      })

      res.on("error", (err) => {
        if (settled) return
        settled = true
        reject(new Error(`Response stream error: ${err.message}`))
      })
    })

    req.on("timeout", () => {
      req.destroy()
      if (settled) return
      settled = true
      reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`))
    })

    req.on("error", (err) => {
      if (settled) return
      settled = true
      reject(new Error(`HTTP request failed: ${err.message}`))
    })

    req.end()
  })
}

/**
 * Extracts readable plain text content from a public website URL.
 * 
 * @param {string} url - Public website URL
 * @returns {Promise<{ success: boolean, text: string, textLength: number, wordCount: number, domain: string, finalUrl: string, httpStatus: number, resolvedIp: string, error?: string }>}
 */
async function extractWebsiteContent(url) {
  try {
    const { html, finalUrl, httpStatus, resolvedIp } = await fetchSafeUrl(url)
    const cleanText = extractTextFromHtml(html)
    const domain = new URL(finalUrl).hostname

    if (!cleanText || cleanText.length < 20) {
      return {
        success: false,
        text: "",
        textLength: 0,
        wordCount: 0,
        domain,
        finalUrl,
        httpStatus,
        resolvedIp,
        error: "The page did not return readable public text content. It may require JavaScript rendering, authentication, or CAPTCHA.",
      }
    }

    const wordCount = cleanText.split(/\s+/).filter(Boolean).length

    return {
      success: true,
      text: cleanText,
      textLength: cleanText.length,
      wordCount,
      domain,
      finalUrl,
      httpStatus,
      resolvedIp,
    }
  } catch (err) {
    return {
      success: false,
      text: "",
      textLength: 0,
      wordCount: 0,
      domain: "",
      finalUrl: url,
      httpStatus: null,
      resolvedIp: "",
      error: err.message,
    }
  }
}

module.exports = {
  isPrivateOrBlockedIP,
  validateUrlSecurity,
  extractTextFromHtml,
  fetchSafeUrl,
  extractWebsiteContent,
  MAX_RESPONSE_SIZE,
  REQUEST_TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_EXTRACTED_CHARS,
}

