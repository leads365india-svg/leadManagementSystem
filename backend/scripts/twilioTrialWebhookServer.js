/**
 * Leads365 AI Receptionist — Dedicated Twilio Trial Webhook Server
 * 
 * Safe, isolated, test-only webhook listener for Twilio Trial integration:
 * - Completely decoupled from MongoDB Atlas, GridFS, and CRM background workers.
 * - Does NOT create Leads, Calls, or FollowUps.
 * - Does NOT invoke Gemini or upload recordings.
 * - Timing-safe HMAC-SHA1 Twilio signature validation.
 * - Validates expected AccountSid.
 * - Returns clean TwiML voice response:
 *   "Hello! You are connected to Leads365 local AI Receptionist testing server. Your Twilio webhook integration is working successfully."
 * 
 * Safety restrictions:
 * - Refuses to start if NODE_ENV === 'production'.
 * - Must never be mounted as a production endpoint.
 */

const express = require("express")
const crypto = require("crypto")
const http = require("http")
const path = require("path")

// Load environment variables safely
require("dotenv").config({ path: path.join(__dirname, "../.env") })

// 1. Production Mode Guard
if (process.env.NODE_ENV === "production") {
  console.error("FATAL: twilioTrialWebhookServer cannot be executed in production environment.")
  process.exit(1)
}

/**
 * Masks phone numbers to protect privacy in logs.
 * Example: +919876543210 -> +9198****3210
 */
function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== "string") return "[UNKNOWN]"
  const trimmed = phone.trim()
  if (trimmed.length <= 6) return "******"
  const prefix = trimmed.slice(0, 5)
  const suffix = trimmed.slice(-4)
  return `${prefix}****${suffix}`
}

/**
 * Timing-safe HMAC-SHA1 Twilio signature validation.
 * Complies with official Twilio webhook verification algorithm.
 */
function validateTwilioSignature({ url, headers = {}, body = {}, authToken = "" }) {
  if (!authToken || typeof authToken !== "string") {
    return false
  }

  const signature = headers["x-twilio-signature"] || headers["X-Twilio-Signature"]
  if (!signature || typeof signature !== "string") {
    return false
  }

  let data = url
  if (body && typeof body === "object") {
    const keys = Object.keys(body).sort()
    for (const key of keys) {
      data += key + (body[key] !== undefined && body[key] !== null ? body[key] : "")
    }
  }

  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64")

  const sigBuf = Buffer.from(signature, "utf8")
  const expBuf = Buffer.from(expected, "utf8")

  if (sigBuf.length !== expBuf.length) {
    return false
  }

  return crypto.timingSafeEqual(sigBuf, expBuf)
}

/**
 * Creates the isolated Express application instance.
 */
function createTrialApp(options = {}) {
  const app = express()

  // Support both standard urlencoded Twilio webhooks and JSON test payloads
  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())

  // Dynamically resolve credentials to support runtime .env additions
  const getExpectedAccountSid = () => options.accountSid || process.env.TWILIO_ACCOUNT_SID || ""
  const getAuthToken = () => options.authToken || process.env.TWILIO_AUTH_TOKEN || ""
  const getPublicUrlOverride = () => options.publicUrl || process.env.TWILIO_PUBLIC_URL || ""

  // Health and safety check endpoint
  app.get("/twilio-trial/health", (req, res) => {
    res.status(200).json({
      status: "healthy",
      service: "Leads365 Twilio Trial Test Server",
      database: "completely_isolated_no_connection",
      gemini: "isolated_disabled",
      accountSidConfigured: Boolean(getExpectedAccountSid()),
      authTokenConfigured: Boolean(getAuthToken()),
    })
  })

  // Twilio Trial Voice Webhook
  app.post("/twilio-trial/voice", (req, res) => {
    const expectedAccountSid = getExpectedAccountSid()
    const authToken = getAuthToken()
    const publicUrlOverride = getPublicUrlOverride()

    // 1. Resolve effective request URL for signature validation
    let fullUrl = publicUrlOverride
    if (!fullUrl) {
      const proto = req.headers["x-forwarded-proto"] || req.protocol || "http"
      const host = req.headers["x-forwarded-host"] || req.headers.host
      fullUrl = `${proto}://${host}${req.originalUrl || req.url}`
    }

    // 2. Reject caller-supplied tenant identifiers
    if (req.body && req.body.tenantId) {
      delete req.body.tenantId
    }

    // 3. Validate Twilio Signature
    const isSignatureValid = validateTwilioSignature({
      url: fullUrl,
      headers: req.headers,
      body: req.body,
      authToken,
    })

    if (!isSignatureValid) {
      console.warn("⚠️ [TwilioTrial] Webhook rejected: Invalid or missing X-Twilio-Signature")
      return res.status(401).type("text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Unauthorized request. Signature verification failed.</Say><Hangup/></Response>`
      )
    }

    // 4. Validate Account SID
    const incomingAccountSid = req.body?.AccountSid || req.body?.accountSid || ""
    if (expectedAccountSid && incomingAccountSid !== expectedAccountSid) {
      console.warn("⚠️ [TwilioTrial] Webhook rejected: Account SID mismatch")
      return res.status(403).type("text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Forbidden. Account SID mismatch.</Say><Hangup/></Response>`
      )
    }

    // 5. Safe logging (masking all phone numbers, zero secrets)
    const maskedCaller = maskPhoneNumber(req.body?.From || req.body?.Caller)
    const maskedCalled = maskPhoneNumber(req.body?.To || req.body?.Called)
    const callSid = req.body?.CallSid ? req.body.CallSid.slice(0, 8) + "..." : "[NO_SID]"
    console.log(`✅ [TwilioTrial] Verified inbound call: CallSid=${callSid}, From=${maskedCaller}, To=${maskedCalled}`)

    // 6. Return TwiML Voice Response
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="en-US" voice="Polly.Joanna">Hello! You are connected to Leads365 local AI Receptionist testing server. Your Twilio webhook integration is working successfully.</Say>
    <Pause length="1"/>
    <Say language="en-US" voice="Polly.Joanna">Goodbye.</Say>
    <Hangup/>
</Response>`

    res.set("Content-Type", "text/xml; charset=utf-8")
    return res.status(200).send(twimlResponse)
  })

  // Catch-all 404 for unmapped routes
  app.use((req, res) => {
    res.status(404).type("text/plain").send("Not Found - Twilio Trial Listener")
  })

  return app
}

/**
 * Starts the standalone HTTP server.
 */
function startServer(options = {}) {
  const port = options.port || process.env.TWILIO_TRIAL_PORT || 5055
  const app = createTrialApp(options)
  const server = http.createServer(app)

  return new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      console.log(`\n======================================================`)
      console.log(`   LEADS365 TWILIO TRIAL WEBHOOK SERVER ACTIVE        `)
      console.log(`======================================================`)
      console.log(`📡 Local Port:         ${port}`)
      console.log(`🔒 Isolation:          Zero MongoDB, Zero Gemini, Zero CRM Workers`)
      console.log(`📞 Webhook Endpoint:    POST /twilio-trial/voice`)
      console.log(`🩺 Health Endpoint:     GET  /twilio-trial/health`)
      console.log(`======================================================\n`)
      resolve(server)
    })

    server.on("error", (err) => {
      reject(err)
    })
  })
}

// Auto-start if invoked directly via CLI: node scripts/twilioTrialWebhookServer.js
if (require.main === module) {
  if (process.env.TWILIO_TRIAL_TEST_ENABLED !== "true") {
    console.log("ℹ️ TWILIO_TRIAL_TEST_ENABLED is not set to 'true'.")
    console.log("   Set TWILIO_TRIAL_TEST_ENABLED=true in environment or run with test runner.")
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    console.warn("⚠️ Twilio credentials missing from local environment:")
    if (!accountSid) console.warn("   - TWILIO_ACCOUNT_SID is required")
    if (!authToken) console.warn("   - TWILIO_AUTH_TOKEN is required")
    console.warn("   Server will reject unauthenticated calls until credentials are provided.\n")
  }

  startServer().catch((err) => {
    console.error("❌ Failed to start Twilio Trial Webhook Server:", err.message)
    process.exit(1)
  })
}

module.exports = {
  createTrialApp,
  startServer,
  validateTwilioSignature,
  maskPhoneNumber,
}
