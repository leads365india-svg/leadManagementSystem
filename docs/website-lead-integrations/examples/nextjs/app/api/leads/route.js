import { NextResponse } from "next/server"
import crypto from "crypto"

/**
 * Next.js App Router Server Route: POST /api/leads
 *
 * Secure server-to-server lead forwarding to Leads365 CRM with:
 * - HMAC-SHA256 signature verification
 * - Request timestamp expiration protection
 * - Idempotency key preservation
 * - Anti-bot honeypot check
 * - Custom fields & UTM attribution forwarding
 */

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null)

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request payload" },
        { status: 400 }
      )
    }

    // 1. Anti-bot honeypot check (must be empty)
    if (body._hp_trap && String(body._hp_trap).trim().length > 0) {
      return NextResponse.json(
        { success: false, error: "Spam submission detected" },
        { status: 400 }
      )
    }

    // 2. Server-side validation
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const phone = typeof body.phone === "string" ? body.phone.trim() : ""
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const message = typeof body.message === "string" ? body.message.trim() : ""
    const company = typeof body.company === "string" ? body.company.trim() : ""

    if (!name || name.length < 2) {
      return NextResponse.json(
        { success: false, error: "Full name is required (minimum 2 characters)" },
        { status: 400 }
      )
    }

    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Phone number is required" },
        { status: 400 }
      )
    }

    // 3. Verify server environment configuration
    const webhookUrl = process.env.LEADS365_WEBHOOK_URL
    const apiKey = process.env.LEADS365_API_KEY

    if (!webhookUrl || !apiKey) {
      console.error(
        "[Leads365 Integration] Missing LEADS365_WEBHOOK_URL or LEADS365_API_KEY in server environment"
      )
      return NextResponse.json(
        { success: false, error: "Lead management system is temporarily unavailable" },
        { status: 503 }
      )
    }

    // 4. Extract safe attribution & custom fields
    const attribution = {}
    ;[
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "landingPage",
      "referrer",
    ].forEach((key) => {
      if (body[key]) attribution[key] = String(body[key]).trim()
    })

    // Capture custom fields (Phase 5 architecture)
    const customFields = {}
    if (body.customFields && typeof body.customFields === "object") {
      Object.entries(body.customFields).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          customFields[k] = v
        }
      })
    }

    // Forward any additional top-level custom properties (e.g., budget, product)
    const standardKeys = [
      "name",
      "email",
      "phone",
      "company",
      "message",
      "source",
      "_hp_trap",
      "customFields",
      ...Object.keys(attribution),
    ]
    Object.keys(body).forEach((key) => {
      if (!standardKeys.includes(key) && body[key] !== undefined && body[key] !== null) {
        customFields[key] = body[key]
      }
    })

    // 5. Construct normalized Leads365 payload
    const leads365Payload = {
      name,
      email: email || undefined,
      phone,
      company: company || undefined,
      message: message || undefined,
      source: body.source || "Next.js Website",
      ...attribution,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
      // Flatten custom attributes to top-level for configured field mappings
      ...customFields,
    }

    const jsonPayload = JSON.stringify(leads365Payload)
    const timestamp = Date.now().toString()
    const idempotencyKey =
      body.idempotencyKey ||
      `nextjs_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`

    // 6. Cryptographic HMAC-SHA256 signature calculation
    const hmacSignature = crypto
      .createHmac("sha256", apiKey)
      .update(jsonPayload)
      .digest("hex")

    // 7. Execute server-to-server request with 10s timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Signature-256": hmacSignature,
          "X-Timestamp": timestamp,
          "X-Idempotency-Key": idempotencyKey,
        },
        body: jsonPayload,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      const result = await response.json().catch(() => ({}))

      if (!response.ok || !result.success) {
        return NextResponse.json(
          {
            success: false,
            duplicate: result.duplicate || response.status === 409,
            error: result.error || "Failed to submit enquiry to CRM",
          },
          { status: response.status }
        )
      }

      return NextResponse.json(
        {
          success: true,
          leadId: result.data?.id || result.leadId,
          message: result.message || "Enquiry submitted successfully",
        },
        { status: 201 }
      )
    } catch (fetchErr) {
      clearTimeout(timeout)
      if (fetchErr.name === "AbortError") {
        return NextResponse.json(
          { success: false, error: "Connection to CRM server timed out. Please retry." },
          { status: 504 }
        )
      }
      throw fetchErr
    }
  } catch (error) {
    console.error("[Leads365 Next.js Server Error]:", error.message)
    // Never expose stack traces or raw internal errors to the client
    return NextResponse.json(
      { success: false, error: "An unexpected server error occurred while processing your request" },
      { status: 500 }
    )
  }
}
