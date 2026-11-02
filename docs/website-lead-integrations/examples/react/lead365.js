/**
 * Leads365 CRM - Client-Side Integration SDK for React / Vite
 *
 * Secure browser-to-CRM communication using public Site Key authentication.
 * Never embed private API keys in browser bundles.
 */

// Helper: Extract UTM attribution and click identifiers from current URL
export const extractAttribution = () => {
  if (typeof window === "undefined") return {}

  const params = new URLSearchParams(window.location.search)
  const attribution = {}

  const trackingKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ]

  trackingKeys.forEach((key) => {
    const val = params.get(key)
    if (val) attribution[key] = val.trim()
  })

  // Add referrer and landing page
  if (document.referrer) {
    attribution.referrer = document.referrer
  }
  attribution.landingPage = window.location.href

  return attribution
}

// Helper: Generate client-side idempotency key for safe retries
export const generateIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "idemp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 10)
}

/**
 * Submit lead enquiry directly to Leads365 CRM using public Site Key.
 *
 * @param {Object} options
 * @param {string} options.siteKey - Public Site Key (e.g. lf_site_...)
 * @param {string} options.webhookUrl - Leads365 ingestion URL (e.g. https://crm.yourcompany.com/api/integrations/leads/website)
 * @param {Object} options.leadData - Lead details (name, email, phone, company, message)
 * @param {Object} [options.customFields] - Configured CRM custom attributes (budget, product_choice, etc.)
 * @param {string} [options.source="React Website"] - Default lead source
 * @param {string} [options.honeypot=""] - Anti-bot honeypot trap field (must be empty)
 * @param {string} [options.idempotencyKey] - Optional custom idempotency key
 */
export const submitLead = async ({
  siteKey,
  webhookUrl,
  leadData,
  customFields = {},
  source = "React Website",
  honeypot = "",
  idempotencyKey,
}) => {
  // 1. Anti-bot honeypot validation
  if (honeypot && String(honeypot).trim().length > 0) {
    return {
      success: false,
      error: "Spam submission detected",
      status: 400,
    }
  }

  // 2. Validate mandatory credentials & endpoint
  if (!siteKey) {
    throw new Error("Leads365 Integration Error: Missing public Site Key (X-Site-Key).")
  }
  if (!webhookUrl) {
    throw new Error("Leads365 Integration Error: Missing Leads365 webhook intake URL.")
  }

  // 3. Prepare payload with attribution and custom attributes
  const attribution = extractAttribution()
  const key = idempotencyKey || generateIdempotencyKey()

  const payload = {
    ...leadData,
    source,
    ...attribution,
    _hp_trap: "",
  }

  // Attach custom attributes (preserves Phase 5 custom fields architecture)
  if (customFields && typeof customFields === "object" && Object.keys(customFields).length > 0) {
    payload.customFields = customFields
    // Flatten custom attributes to top-level for configured field mappings
    Object.entries(customFields).forEach(([k, v]) => {
      if (payload[k] === undefined) {
        payload[k] = v
      }
    })
  }

  // 4. Execute browser request with public Site Key and Idempotency Key
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Site-Key": siteKey,
      "X-Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok || !result.success) {
    return {
      success: false,
      status: response.status,
      duplicate: result.duplicate || response.status === 409,
      error: result.error || `Submission failed with status HTTP ${response.status}`,
    }
  }

  return {
    success: true,
    status: response.status,
    leadId: result.data?.id || result.leadId,
    message: result.message || "Enquiry submitted successfully!",
  }
}
