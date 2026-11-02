/**
 * Phase 1: Universal Website Integration Security Hardening Test Suite
 * 
 * Verifies:
 * 1. P0: Site Key Origin Enforcement:
 *    - Valid allowed Origin + valid Site Key -> Accepted (200/201)
 *    - Invalid Origin + valid Site Key -> 403 Forbidden
 *    - Missing Origin + valid Site Key -> 403 Forbidden
 *    - "null" Origin -> 403 Forbidden
 *    - Malformed Origin -> 403 Forbidden
 *    - Cross-tenant origin attempt -> 403 Forbidden
 *    - Valid private API Key without Origin -> Accepted (server-to-server independent of Origin)
 *    - Production environment (NODE_ENV=production) strictly rejects missing origin
 * 2. P1: Rate Limiter Routing & Key Protection:
 *    - dashboardLimiter skips /api/integrations (no double-counting)
 *    - integrationLimiter hashes credentials safely with SHA-256
 * 3. P1: CORS Preflight for HMAC & Timestamp Headers:
 *    - OPTIONS /api/integrations/leads/website allows x-signature-256 and x-timestamp
 * 4. P1: Secret-Safe Logging:
 *    - IntegrationEvent scrubs signatures, site keys, API keys, tokens
 */

process.env.NODE_ENV = "test"
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const http = require("http")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const integrationService = require("../services/integrationService")
const { dashboardLimiter, integrationLimiter } = require("../middleware/rateLimiters")

let passed = 0
let failed = 0

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  [PASS] ${testName}`)
    passed++
  } else {
    console.error(`  [FAIL] ${testName}${details ? " - " + details : ""}`)
    failed++
  }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 1 SECURITY HARDENING: VERIFICATION SUITE                          ===")
  console.log("================================================================================\n")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)

  const tenantA = `p1_sec_a_${Date.now()}`
  const tenantB = `p1_sec_b_${Date.now()}`

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------
    const rawApiKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashA = crypto.createHash("sha256").update(rawApiKeyA).digest("hex")
    const siteKeyA = `lf_site_${crypto.randomBytes(16).toString("hex")}`

    const rawApiKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashB = crypto.createHash("sha256").update(rawApiKeyB).digest("hex")
    const siteKeyB = `lf_site_${crypto.randomBytes(16).toString("hex")}`

    const configA = new LeadFeedConfig({
      tenantId: tenantA,
      websiteSource: {
        enabled: true,
        apiKeyHash: apiKeyHashA,
        apiKeyMasked: `lf_live_••••••••••••••••${rawApiKeyA.slice(-4)}`,
        siteKey: siteKeyA,
        allowedOrigins: ["https://myshop.tenant-a.com", "https://*.tenant-a.com"],
        duplicateHandling: "update",
      },
    })
    await configA.save()

    const configB = new LeadFeedConfig({
      tenantId: tenantB,
      websiteSource: {
        enabled: true,
        apiKeyHash: apiKeyHashB,
        apiKeyMasked: `lf_live_••••••••••••••••${rawApiKeyB.slice(-4)}`,
        siteKey: siteKeyB,
        allowedOrigins: ["https://store.tenant-b.com"],
        duplicateHandling: "reject",
      },
    })
    await configB.save()

    await integrationService.syncLegacyToIntegration(configA)
    await integrationService.syncLegacyToIntegration(configB)

    console.log("--- PART 1: P0 - Public Site Key Origin Enforcement & Bypass Prevention ---")

    // 1. Valid allowed Origin + valid Site Key
    const res1 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://myshop.tenant-a.com",
      body: { name: "Test 1 Valid", email: `t1_${Date.now()}@example.com`, phone: "+919876543210" },
    })
    assert(res1.success === true && (res1.status === 200 || res1.status === 201), "Case 1: Valid allowed Origin + valid Site Key is accepted (200/201)")

    // 2. Invalid Origin + valid Site Key
    const res2 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://evil-unauthorized.com",
      body: { name: "Test 2 Invalid", email: `t2_${Date.now()}@example.com` },
    })
    assert(res2.success === false && res2.status === 403, "Case 2: Invalid Origin + valid Site Key rejected with HTTP 403")

    // 3. Missing Origin + valid Site Key
    const res3 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: null,
      body: { name: "Test 3 Missing Origin", email: `t3_${Date.now()}@example.com` },
    })
    assert(res3.success === false && res3.status === 403, "Case 3: Missing Origin + valid Site Key rejected with HTTP 403")

    // 4. Null Origin string ("null")
    const res4 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "null",
      body: { name: "Test 4 Null Origin", email: `t4_${Date.now()}@example.com` },
    })
    assert(res4.success === false && res4.status === 403, "Case 4: 'null' Origin string rejected with HTTP 403")

    // 5. Malformed Origin
    const res5 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "not_a_valid_url",
      body: { name: "Test 5 Malformed", email: `t5_${Date.now()}@example.com` },
    })
    assert(res5.success === false && res5.status === 403, "Case 5: Malformed Origin rejected with HTTP 403")

    // 6. Cross-tenant origin attempt (Tenant B origin using Tenant A siteKey)
    const res6 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://store.tenant-b.com",
      body: { name: "Test 6 Cross Tenant", email: `t6_${Date.now()}@example.com` },
    })
    assert(res6.success === false && res6.status === 403, "Case 6: Cross-tenant origin rejected with HTTP 403")

    // 7. Valid private API Key without Origin (Server-to-server)
    const res7 = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      incomingOrigin: null,
      body: { name: "Test 7 Server Ingest", email: `t7_${Date.now()}@example.com`, phone: "+919876543212" },
    })
    assert(res7.success === true, "Case 7: Valid private API Key succeeds without Origin (server-to-server independent of Origin)")

    // 8. Production environment cannot use localhost fallback
    const originalEnv = process.env.NODE_ENV
    const originalAllow = process.env.ALLOW_TEST_ORIGINLESS_SITE_KEY
    try {
      process.env.NODE_ENV = "production"
      process.env.ALLOW_TEST_ORIGINLESS_SITE_KEY = "true" // Even if test flag set, production must override and reject
      const res8 = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyA,
        incomingOrigin: null,
        body: { name: "Test 8 Prod Missing Origin", email: `t8_${Date.now()}@example.com` },
      })
      assert(res8.success === false && res8.status === 403, "Case 8: Production environment strictly rejects missing Origin (no localhost fallback)")
    } finally {
      process.env.NODE_ENV = originalEnv
      process.env.ALLOW_TEST_ORIGINLESS_SITE_KEY = originalAllow
    }

    console.log("\n--- PART 2: P1 - Rate Limiter Routing & Key Protection ---")

    // 9. Verify dashboardLimiter skips integration routes
    const fakeIntegrationReq = { originalUrl: "/api/integrations/leads/website", url: "/api/integrations/leads/website", method: "POST" }
    const fakeDashboardReq = { originalUrl: "/api/leads", url: "/api/leads", method: "GET" }

    const isIntegrationSkipped = typeof dashboardLimiter.skip === "function" && dashboardLimiter.skip(fakeIntegrationReq)
    const isDashboardSkipped = typeof dashboardLimiter.skip === "function" && dashboardLimiter.skip(fakeDashboardReq)
    assert(isIntegrationSkipped === true, "dashboardLimiter skips /api/integrations (avoids throttling webhooks)")
    assert(isDashboardSkipped === false, "dashboardLimiter enforces rate limiting on normal dashboard APIs (/api/leads)")

    // 10. Verify integrationLimiter keys by cryptographic hash (never leaks raw secret in memory)
    const testApiKey = "lf_live_1234567890abcdef1234567890abcdef12345678"
    const fakeReqWithKey = { headers: { "x-api-key": testApiKey } }
    const generatedKey = integrationLimiter.keyGenerator(fakeReqWithKey)
    const expectedHashPrefix = crypto.createHash("sha256").update(testApiKey).digest("hex").slice(0, 16)
    assert(generatedKey === `integration_${expectedHashPrefix}`, "integrationLimiter keys requests by SHA-256 hash without exposing raw secrets")
    assert(!generatedKey.includes(testApiKey.slice(-12)), "integrationLimiter does not use plaintext raw key slice")

    // 10b. Safe endpoint-level threshold test: Verify limiter blocks after configured max threshold
    const integrationRoutes = require("../routes/integrationRoutes")
    const webhookLimiter = integrationRoutes.webhookLimiter
    let blockedAtThreshold = false
    let blockStatusCode = 0
    let blockErrorMessage = ""

    // Execute requests up to threshold + 1 with async Promise resolution
    for (let i = 1; i <= 65; i++) {
      await new Promise((resolve) => {
        let finished = false
        const done = () => {
          if (!finished) {
            finished = true
            resolve()
          }
        }
        const mockLimiterReq = {
          ip: "10.99.88.77",
          headers: {},
          app: { get: () => 1 },
        }
        const mockLimiterRes = {
          setHeader: () => {},
          getHeader: () => {},
          status: function(code) {
            blockStatusCode = code
            return this
          },
          send: function(body) {
            blockErrorMessage = typeof body === "object" ? body?.error : String(body)
            blockedAtThreshold = true
            done()
            return this
          },
          json: function(body) {
            blockErrorMessage = body?.error || ""
            blockedAtThreshold = true
            done()
            return this
          },
        }
        webhookLimiter(mockLimiterReq, mockLimiterRes, done)
      })
      if (blockedAtThreshold) break
    }
    assert(
      blockedAtThreshold === true && blockStatusCode === 429,
      "Endpoint limiter threshold: 61st request is blocked with HTTP 429 Too Many Requests"
    )

    console.log("\n--- PART 3: P1 - CORS Preflight & Header Support ---")

    // 11. Verify CORS headers for OPTIONS request on webhook endpoint
    const { webhookCors } = require("../start")
    let allowedHeadersOutput = ""
    const mockReq = {
      method: "OPTIONS",
      headers: {
        origin: "https://myshop.tenant-a.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "Content-Type, x-signature-256, x-timestamp, x-api-key",
      },
    }
    const mockRes = {
      setHeader: (name, val) => {
        if (name.toLowerCase() === "access-control-allow-headers") {
          allowedHeadersOutput = String(val).toLowerCase()
        }
      },
      getHeader: () => {},
      statusCode: 204,
      end: () => {},
    }
    webhookCors(mockReq, mockRes, () => {})

    assert(allowedHeadersOutput.includes("x-signature-256"), "CORS preflight allows x-signature-256")
    assert(allowedHeadersOutput.includes("x-timestamp"), "CORS preflight allows x-timestamp")
    assert(allowedHeadersOutput.includes("x-api-key"), "CORS preflight allows x-api-key")

    console.log("\n--- PART 4: P1 - Secret-Safe Logging in IntegrationEvent ---")

    // 12. Verify header sanitization in IntegrationEvent
    const testEvent = new IntegrationEvent({
      tenantId: tenantA,
      source: "Website",
      headers: {
        authorization: "Bearer secret-token-xyz-123456",
        "x-api-key": rawApiKeyA,
        "x-site-key": siteKeyA,
        "x-signature-256": "4a7b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
        "user-agent": "Mozilla/5.0",
      },
      rawPayload: { name: "Sanitization Test", email: "clean@test.com" },
    })
    await testEvent.save()

    assert(testEvent.headers["authorization"] === "[REDACTED]", "IntegrationEvent pre-save hook redacts 'authorization' header")
    assert(testEvent.headers["x-api-key"] === "[REDACTED]", "IntegrationEvent pre-save hook redacts 'x-api-key' header")
    assert(testEvent.headers["x-site-key"] === "[REDACTED]", "IntegrationEvent pre-save hook redacts 'x-site-key' header")
    assert(testEvent.headers["x-signature-256"] === "[REDACTED]", "IntegrationEvent pre-save hook redacts 'x-signature-256' header")
    assert(testEvent.headers["user-agent"] === "Mozilla/5.0", "IntegrationEvent preserves safe diagnostic headers ('user-agent')")

    await IntegrationEvent.deleteOne({ _id: testEvent._id }).setOptions({ skipTenantFilter: true })

  } catch (err) {
    console.error("Test execution error:", err)
    assert(false, "Unexpected error in test runner", err.message)
  } finally {
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`)
  console.log("================================================================================\n")

  process.exit(failed > 0 ? 1 : 0)
}

runTests()
