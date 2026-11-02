const crypto = require("crypto")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const leadService = require("./leadService")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { decrypt } = require("../utils/cryptoUtils")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  claimIdempotency,
  completeIdempotency,
  failIdempotency,
} = require("./idempotencyService")

/**
 * Leads-365 CRM - Shopify Webhook Service (Phase 3A)
 *
 * Implements official Shopify webhook specification:
 * - Constant-time HMAC-SHA256 signature verification over exact raw request body
 * - Store domain resolution mapped exclusively to trusted server-side Integration record
 * - Strict multi-tenant isolation (tenant context derived exclusively from authenticated integration)
 * - Webhook delivery deduplication scoped to integration via X-Shopify-Webhook-Id
 * - Normalization and field mapping for Customer, Order, and Checkout topics
 * - Preservation of existing duplicate policies (reject, update, allow)
 */

/**
 * Validates the format of an incoming Shopify shop domain.
 */
function validateShopDomain(domain) {
  if (!domain || typeof domain !== "string") return false
  const clean = domain.trim().toLowerCase()
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/
  return domainRegex.test(clean)
}

/**
 * Verifies a Shopify webhook delivery using HMAC-SHA256 and constant-time comparison.
 *
 * @param {Object} params
 * @param {Buffer|string} params.rawBody - Exact unparsed raw request body bytes
 * @param {string} params.signatureHeader - Base64 digest from X-Shopify-Hmac-Sha256
 * @param {string} params.sharedSecret - Server-side registered Shopify shared secret
 * @returns {boolean} True if HMAC is valid and authentic
 */
function verifyShopifyWebhook({ rawBody, signatureHeader, sharedSecret }) {
  if (!rawBody || !signatureHeader || !sharedSecret) {
    return false
  }

  try {
    const rawBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), "utf8")

    const calculatedBase64 = crypto
      .createHmac("sha256", sharedSecret)
      .update(rawBuffer)
      .digest("base64")

    const providedBuf = Buffer.from(String(signatureHeader).trim(), "base64")
    const calculatedBuf = Buffer.from(calculatedBase64, "base64")

    if (
      providedBuf.length === 0 ||
      providedBuf.length !== calculatedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, calculatedBuf)
    ) {
      return false
    }

    return true
  } catch (err) {
    return false
  }
}

/**
 * Resolves the server-side Integration record matching the Shopify shop domain.
 */
async function resolveShopifyIntegration(shopDomain) {
  if (!validateShopDomain(shopDomain)) return null

  const cleanDomain = shopDomain.trim().toLowerCase()

  const integration = await Integration.findOne({
    type: "shopify",
    status: "active",
    $or: [
      { "settings.shopifyShopDomain": cleanDomain },
      { "settings.websiteDomain": cleanDomain },
    ],
  }).setOptions({ skipTenantFilter: true })

  if (!integration) return null

  let sharedSecret = integration.settings?.shopifySharedSecret || ""
  if (!sharedSecret && integration.credentials) {
    try {
      const decrypted = typeof integration.credentials === "string"
        ? decrypt(integration.credentials)
        : integration.credentials
      sharedSecret = decrypted.shopifySharedSecret || decrypted.sharedSecret || decrypted.secret || ""
    } catch (_) {}
  }

  return {
    integration,
    tenantId: integration.tenantId,
    sharedSecret,
  }
}

/**
 * Maps a Shopify webhook topic payload to Leads365 lead fields.
 */
function mapShopifyTopicToLead({ topic, body = {}, shopDomain }) {
  const cleanTopic = String(topic || "").toLowerCase().trim()

  if (cleanTopic.startsWith("customers/")) {
    const name = `${body.first_name || ""} ${body.last_name || ""}`.trim() || body.email || "Shopify Customer"
    const email = (body.email || "").toLowerCase().trim()
    const rawPhone = body.phone || body.default_address?.phone || ""
    const phone = rawPhone ? normalizePhoneE164(rawPhone, "+91") : ""
    const message = body.note || `Customer registered via Shopify (${shopDomain})`
    const tags = Array.isArray(body.tags)
      ? body.tags
      : (typeof body.tags === "string" ? body.tags.split(",").map((t) => t.trim()).filter(Boolean) : [])

    return {
      shouldCreateLead: true,
      payload: {
        name,
        email,
        phone,
        message,
        tags: [...tags, "shopify", "customer"],
        company: body.default_address?.company || "",
        city: body.default_address?.city || "",
        sourceId: body.id ? String(body.id) : "",
        metadata: {
          shopifyShopDomain: shopDomain,
          shopifyTopic: topic,
          shopifyCustomerId: body.id,
          ordersCount: body.orders_count || 0,
          totalSpent: body.total_spent || "0.00",
        },
      },
    }
  }

  if (cleanTopic.startsWith("orders/")) {
    const customer = body.customer || {}
    const billing = body.billing_address || {}
    const name =
      `${customer.first_name || billing.first_name || ""} ${customer.last_name || billing.last_name || ""}`.trim() ||
      billing.name ||
      customer.email ||
      body.email ||
      "Shopify Order Customer"

    const email = (customer.email || body.email || billing.email || "").toLowerCase().trim()
    const rawPhone = customer.phone || body.phone || billing.phone || ""
    const phone = rawPhone ? normalizePhoneE164(rawPhone, "+91") : ""
    const message = `Shopify Order #${body.order_number || body.name || ""} - ${body.currency || "INR"} ${body.total_price || 0}`
    const tags = Array.isArray(body.tags)
      ? body.tags
      : (typeof body.tags === "string" ? body.tags.split(",").map((t) => t.trim()).filter(Boolean) : [])

    return {
      shouldCreateLead: true,
      payload: {
        name,
        email,
        phone,
        message,
        tags: [...tags, "shopify", "order"],
        company: billing.company || "",
        city: billing.city || "",
        sourceId: body.id ? String(body.id) : "",
        utm_source: body.referring_site || "Shopify",
        landingPage: body.landing_site || "",
        metadata: {
          shopifyShopDomain: shopDomain,
          shopifyTopic: topic,
          shopifyOrderId: body.id,
          orderNumber: body.order_number || body.name,
          totalPrice: body.total_price,
          currency: body.currency,
          financialStatus: body.financial_status,
        },
      },
    }
  }

  if (cleanTopic.startsWith("checkouts/")) {
    const customer = body.customer || {}
    const billing = body.billing_address || {}
    const name =
      `${customer.first_name || billing.first_name || ""}`.trim() ||
      body.email ||
      "Shopify Checkout Customer"
    const email = (body.email || customer.email || "").toLowerCase().trim()
    const rawPhone = body.phone || billing.phone || customer.phone || ""
    const phone = rawPhone ? normalizePhoneE164(rawPhone, "+91") : ""
    const message = `Shopify Abandoned Checkout (${body.abandoned_checkout_url || ""})`

    return {
      shouldCreateLead: true,
      payload: {
        name,
        email,
        phone,
        message,
        tags: ["shopify", "checkout"],
        sourceId: body.id ? String(body.id) : (body.token ? String(body.token) : ""),
        landingPage: body.landing_site || "",
        metadata: {
          shopifyShopDomain: shopDomain,
          shopifyTopic: topic,
          checkoutToken: body.token,
          abandonedCheckoutUrl: body.abandoned_checkout_url,
        },
      },
    }
  }

  // Non-lead topics (acknowledged without creating unwanted leads)
  return {
    shouldCreateLead: false,
    reason: `Shopify topic '${topic}' acknowledged; no lead generated.`,
  }
}

/**
 * Processes an incoming Shopify webhook request end-to-end.
 */
async function processShopifyWebhook({ rawBody, headers = {}, body = {}, ip = "unknown" }) {
  // 1. Extract and validate shop domain
  const shopDomain = headers["x-shopify-shop-domain"]
  if (!shopDomain || !validateShopDomain(shopDomain)) {
    return {
      success: false,
      status: 400,
      error: "Invalid or missing X-Shopify-Shop-Domain header",
    }
  }

  // 2. Resolve server-side integration & secret
  const resolved = await resolveShopifyIntegration(shopDomain)
  if (!resolved) {
    return {
      success: false,
      status: 404,
      error: "Shopify store is not registered or integration is inactive",
    }
  }

  const { integration, tenantId, sharedSecret } = resolved

  // 3. Verify server-side secret exists
  if (!sharedSecret) {
    return {
      success: false,
      status: 401,
      error: "Shopify app shared secret is not configured on the server for this store",
    }
  }

  // 4. Verify HMAC signature
  const signature = headers["x-shopify-hmac-sha256"]
  if (!signature) {
    return {
      success: false,
      status: 401,
      error: "Unauthorized: Missing X-Shopify-Hmac-Sha256 header",
    }
  }

  const isAuthentic = verifyShopifyWebhook({
    rawBody,
    signatureHeader: signature,
    sharedSecret,
  })

  if (!isAuthentic) {
    return {
      success: false,
      status: 401,
      error: "Unauthorized: Invalid Shopify webhook HMAC signature",
    }
  }

  // 5. Wrap execution in tenant ambient context
  return await runWithTenantContext({ tenantId, isSuperAdmin: false }, async () => {
    const topic = headers["x-shopify-topic"] || "unknown"
    const webhookId = (headers["x-shopify-webhook-id"] || "").trim()

    // 6. Delivery Deduplication via idempotency reservation
    let idempotencyReservationId = null
    if (webhookId) {
      const claimResult = await claimIdempotency({
        tenantId,
        integrationId: integration._id.toString(),
        idempotencyKey: webhookId,
        payload: body,
      })

      if (claimResult.action === "conflict") {
        return {
          success: false,
          status: 409,
          error: claimResult.error,
        }
      }

      if (claimResult.action === "cached") {
        return {
          ...claimResult.response,
          idempotent: true,
          message: "Shopify webhook delivery already processed",
        }
      }

      if (claimResult.action === "in_progress") {
        return {
          success: true,
          status: 200,
          inProgress: true,
          message: "Shopify webhook delivery is currently processing",
        }
      }

      if (claimResult.action === "claimed") {
        idempotencyReservationId = claimResult.reservationId
      }
    }

    // 7. Append-only ledger record
    const event = new IntegrationEvent({
      tenantId,
      integrationId: integration._id,
      integrationType: "shopify",
      idempotencyKey: webhookId || null,
      headers,
      rawPayload: body,
      source: "Shopify",
      status: "received",
    })
    await event.save()

    // 8. Map Topic to Lead Payload
    const mapped = mapShopifyTopicToLead({ topic, body, shopDomain })

    if (!mapped.shouldCreateLead) {
      event.status = "processed"
      event.httpStatus = 200
      event.result = { action: "acknowledged", message: mapped.reason }
      await event.save()

      const ackResponse = {
        success: true,
        status: 200,
        message: mapped.reason,
      }

      if (idempotencyReservationId) {
        await completeIdempotency({
          reservationId: idempotencyReservationId,
          response: ackResponse,
          leadId: null,
        })
      }

      return ackResponse
    }

    // 9. Execute Lead Ingestion through shared leadService
    event.status = "processing"
    await event.save().catch(() => {})

    const duplicateHandling = integration.settings?.duplicateHandling || "reject"
    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: "Shopify",
      payload: mapped.payload,
      options: {
        duplicateHandling,
      },
      actor: {
        role: "system",
        name: `Shopify Webhook (${shopDomain})`,
      },
    })

    // 10. Record Result and Update Stats
    if (serviceResult.action === "duplicate_rejected") {
      event.status = "rejected"
      event.httpStatus = 409
      event.errorMessage = "Duplicate lead detected"
      event.result = { action: "duplicate_rejected" }
      await event.save()

      const dupResponse = {
        success: false,
        status: 409,
        duplicate: true,
        error: "Duplicate lead detected: A lead with this email or phone number already exists in this account.",
      }

      if (idempotencyReservationId) {
        await completeIdempotency({
          reservationId: idempotencyReservationId,
          response: dupResponse,
          leadId: serviceResult.lead?._id,
        })
      }

      return dupResponse
    }

    // Success: Either merged or created
    integration.stats.totalReceived = (integration.stats.totalReceived || 0) + 1
    integration.stats.totalSuccess = (integration.stats.totalSuccess || 0) + 1
    integration.stats.lastReceivedAt = new Date()
    integration.stats.lastSuccessAt = new Date()
    await integration.save()

    event.status = "processed"
    event.httpStatus = serviceResult.action === "merged" ? 200 : 201
    event.result = {
      leadId: serviceResult.lead ? serviceResult.lead._id : null,
      action: serviceResult.action,
      message: serviceResult.action === "merged" ? "Lead record updated from Shopify" : "Lead created from Shopify",
    }
    await event.save()

    const finalResponse = {
      success: true,
      status: serviceResult.action === "merged" ? 200 : 201,
      action: serviceResult.action,
      leadId: serviceResult.lead._id.toString(),
      message: serviceResult.action === "merged" ? "Lead record updated from Shopify" : "Lead created from Shopify",
    }

    if (idempotencyReservationId) {
      await completeIdempotency({
        reservationId: idempotencyReservationId,
        response: finalResponse,
        leadId: serviceResult.lead._id,
      })
    }

    return finalResponse
  })
}

module.exports = {
  validateShopDomain,
  verifyShopifyWebhook,
  resolveShopifyIntegration,
  mapShopifyTopicToLead,
  processShopifyWebhook,
}
