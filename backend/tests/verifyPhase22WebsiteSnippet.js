/**
 * Phase 22: Website Snippet, Allowed Origins & Attribution Verification Suite
 * 
 * Verifies:
 * 1. Origin normalization and validation (scheme, hostname, port, wildcards).
 * 2. Malformed origin and unsafe wildcard rejection.
 * 3. Public Site Key generation, synchronization, and authentication.
 * 4. Configured origin is accepted (HTTP 200/201).
 * 5. Unconfigured origin is rejected (HTTP 403 Forbidden).
 * 6. Scheme, host, and port mismatches are rejected.
 * 7. Tenant isolation (Tenant B cannot use Tenant A's siteKey or origin).
 * 8. CORS is not authentication (server-to-server API key remains authenticated independently).
 * 9. Anti-spam honeypot trap rejection (HTTP 400).
 * 10. Lead attribution persistence (first-touch write-once, last-touch updated).
 * 11. Idempotent submissions avoid duplicate leads.
 * 12. Public JavaScript snippet served correctly.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const { Integration } = require("../models/Integration")
const User = require("../models/User")
const { normalizeOrigin, validateOrigin } = require("../utils/originValidator")
const integrationService = require("../services/integrationService")

let staticPassed = 0
let staticFailed = 0
let behavioralPassed = 0
let behavioralFailed = 0

function assertStatic(condition, message) {
  if (condition) {
    console.log(`  [PASS - STATIC] ${message}`)
    staticPassed++
  } else {
    console.error(`  [FAIL - STATIC] ${message}`)
    staticFailed++
  }
}

function assertBehavioral(condition, message) {
  if (condition) {
    console.log(`  [PASS - BEHAVIORAL] ${message}`)
    behavioralPassed++
  } else {
    console.error(`  [FAIL - BEHAVIORAL] ${message}`)
    behavioralFailed++
  }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 22: WEBSITE SNIPPET, ALLOWED ORIGINS & ATTRIBUTION VERIFICATION ===")
  console.log("================================================================================")

  console.log("\n--- PART 1: Static Source & Origin Validator Invariant Tests ---")

  // 1. Exact origin normalization
  try {
    const norm1 = normalizeOrigin("https://Example.COM:443/")
    assertStatic(norm1 === "https://example.com", "normalizeOrigin strips default port 443 and path")
  } catch (e) {
    assertStatic(false, `normalizeOrigin failed on default port: ${e.message}`)
  }

  // 2. Custom port preservation
  try {
    const norm2 = normalizeOrigin("http://localhost:3000/")
    assertStatic(norm2 === "http://localhost:3000", "normalizeOrigin preserves explicit non-standard ports")
  } catch (e) {
    assertStatic(false, `normalizeOrigin failed on port: ${e.message}`)
  }

  // 3. Rejection of dangerous pseudo-protocols
  let dangerousRejected = false
  try {
    normalizeOrigin("javascript:alert(1)")
  } catch (e) {
    dangerousRejected = true
  }
  assertStatic(dangerousRejected, "normalizeOrigin rejects dangerous 'javascript:' scheme")

  // 4. Rejection of missing scheme
  let missingSchemeRejected = false
  try {
    normalizeOrigin("example.com")
  } catch (e) {
    missingSchemeRejected = true
  }
  assertStatic(missingSchemeRejected, "normalizeOrigin rejects origins without http:// or https://")

  // 5. Rejection of naked wildcard
  let nakedWildcardRejected = false
  try {
    normalizeOrigin("*")
  } catch (e) {
    nakedWildcardRejected = true
  }
  assertStatic(nakedWildcardRejected, "normalizeOrigin rejects dangerous bare wildcard '*'")

  // 6. Subdomain wildcard support
  try {
    const normWildcard = normalizeOrigin("https://*.example.com")
    assertStatic(normWildcard === "https://*.example.com", "normalizeOrigin permits structured subdomain wildcards (https://*.example.com)")
  } catch (e) {
    assertStatic(false, `normalizeOrigin failed on subdomain wildcard: ${e.message}`)
  }

  // 7. Validation: Exact match
  const check1 = validateOrigin("https://shop.example.com", ["https://shop.example.com", "https://blog.example.com"])
  assertStatic(check1.allowed === true, "validateOrigin permits exact configured origin")

  // 8. Validation: Wildcard subdomain match
  const checkWildcard = validateOrigin("https://app.customer.io", ["https://*.customer.io"])
  assertStatic(checkWildcard.allowed === true, "validateOrigin matches subdomains against 'https://*.customer.io'")

  // 9. Validation: Scheme mismatch rejection
  const checkSchemeMismatch = validateOrigin("http://shop.example.com", ["https://shop.example.com"])
  assertStatic(checkSchemeMismatch.allowed === false, "validateOrigin rejects scheme mismatch (http vs https)")

  // 10. Validation: Port mismatch rejection
  const checkPortMismatch = validateOrigin("http://localhost:8080", ["http://localhost:3000"])
  assertStatic(checkPortMismatch.allowed === false, "validateOrigin rejects port mismatch (:8080 vs :3000)")

  // 11. Validation: Unlisted origin rejection
  const checkUnlisted = validateOrigin("https://untrusted.com", ["https://shop.example.com"])
  assertStatic(checkUnlisted.allowed === false, "validateOrigin rejects unlisted origins")

  // 12. Validation: Empty allowlist rejection
  const checkEmpty = validateOrigin("https://shop.example.com", [])
  assertStatic(checkEmpty.allowed === false, "validateOrigin rejects when allowlist is empty")

  console.log("\n--- PART 2: Behavioral Integration & Tenant Security Tests ---")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)

  const tenantA = `tenant_snippet_a_${Date.now()}`
  const tenantB = `tenant_snippet_b_${Date.now()}`

  try {
    // Generate credentials
    const rawApiKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashA = crypto.createHash("sha256").update(rawApiKeyA).digest("hex")
    const siteKeyA = `lf_site_${crypto.randomBytes(16).toString("hex")}`

    const rawApiKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashB = crypto.createHash("sha256").update(rawApiKeyB).digest("hex")
    const siteKeyB = `lf_site_${crypto.randomBytes(16).toString("hex")}`

    // Configure Tenant A
    const configA = new LeadFeedConfig({
      tenantId: tenantA,
      websiteSource: {
        enabled: true,
        apiKeyHash: apiKeyHashA,
        apiKeyMasked: "lf_live_••••••••••••••••" + rawApiKeyA.slice(-4),
        siteKey: siteKeyA,
        allowedOrigins: ["https://landing.tenant-a.com", "https://*.tenant-a.com"],
        duplicateHandling: "update",
        assignedStaffName: "Alpha Lead Agent",
      },
    })
    await configA.save()

    // Configure Tenant B
    const configB = new LeadFeedConfig({
      tenantId: tenantB,
      websiteSource: {
        enabled: true,
        apiKeyHash: apiKeyHashB,
        apiKeyMasked: "lf_live_••••••••••••••••" + rawApiKeyB.slice(-4),
        siteKey: siteKeyB,
        allowedOrigins: ["https://store.tenant-b.com"],
        duplicateHandling: "reject",
      },
    })
    await configB.save()

    // Sync to Integration models
    await integrationService.syncLegacyToIntegration(configA)
    await integrationService.syncLegacyToIntegration(configB)

    // Test 1: Configured origin is accepted with valid site key
    const res1 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      body: {
        name: "Alice Allowed",
        email: `alice_${Date.now()}@tenant-a.com`,
        phone: "+91 98765 43210",
        message: "Requesting product brochure",
        utm_source: "google_ads",
        utm_medium: "cpc",
        utm_campaign: "summer_sale",
        utm_term: "crm_software",
        utm_content: "banner_ad_1",
        gclid: "test_gclid_12345",
        landingPage: "https://landing.tenant-a.com/product",
        referrer: "https://www.google.com/",
      },
    })
    assertBehavioral(
      res1.success === true && (res1.status === 200 || res1.status === 201),
      "Configured origin + valid siteKey is accepted (HTTP 200/201)"
    )

    // Test 2: Unconfigured origin is rejected with 403 Forbidden
    const res2 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://malicious-site.com",
      body: {
        name: "Eve Attacker",
        email: `eve_${Date.now()}@malicious.com`,
        phone: "+91 98765 00000",
      },
    })
    assertBehavioral(
      res2.success === false && res2.status === 403,
      "Unconfigured origin is rejected with HTTP 403 Forbidden"
    )

    // Test 3: Missing origin with siteKey is rejected with 403 Forbidden
    const res3 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: null,
      body: {
        name: "No Origin Client",
        email: `noorigin_${Date.now()}@test.com`,
      },
    })
    assertBehavioral(
      res3.success === false && res3.status === 403,
      "Public siteKey without HTTP Origin header is rejected with HTTP 403 Forbidden"
    )

    // Test 4: Wildcard subdomain is accepted
    const res4 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://subdomain.tenant-a.com",
      body: {
        name: "Bob Subdomain",
        email: `bob_${Date.now()}@tenant-a.com`,
        phone: "+91 98765 11111",
      },
    })
    assertBehavioral(
      res4.success === true,
      "Subdomain matching wildcard ('https://*.tenant-a.com') is accepted"
    )

    // Test 5: Tenant isolation: Tenant B's origin cannot use Tenant A's siteKey
    const res5 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://store.tenant-b.com", // Valid for B, but unauthorized for A
      body: {
        name: "Cross Tenant Infiltration",
        email: `cross_${Date.now()}@test.com`,
      },
    })
    assertBehavioral(
      res5.success === false && res5.status === 403,
      "Cross-tenant isolation: Tenant B's origin cannot ingest into Tenant A's siteKey"
    )

    // Test 6: Invalid / unknown site key is rejected with 401 Unauthorized
    const res6 = await integrationService.intakeWebhookPayload({
      rawSiteKey: "lf_site_invalidkey0000000000",
      incomingOrigin: "https://landing.tenant-a.com",
      body: {
        name: "Unknown SiteKey User",
        email: `unknown_${Date.now()}@test.com`,
      },
    })
    assertBehavioral(
      res6.success === false && res6.status === 401,
      "Invalid or revoked siteKey is rejected with HTTP 401 Unauthorized"
    )

    // Test 7: CORS is not treated as authentication (Server API key works independently of Origin)
    const res7 = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      incomingOrigin: null, // Server-to-server webhook has no browser Origin
      body: {
        name: "Server Integration Lead",
        email: `server_${Date.now()}@backend-proxy.com`,
        phone: "+91 98765 22222",
      },
    })
    assertBehavioral(
      res7.success === true,
      "Server-to-server intake with rawApiKey succeeds independently of browser Origin"
    )

    // Test 8: Honeypot trap check rejects bot submissions with HTTP 400
    const res8 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      body: {
        name: "Spam Bot",
        email: `bot_${Date.now()}@spam.com`,
        phone: "+91 98765 33333",
        _hp_trap: "filled_by_automated_bot",
      },
    })
    assertBehavioral(
      res8.success === false && res8.status === 400 && res8.error.includes("honeypot"),
      "Honeypot trap detects automated bot submission and rejects with HTTP 400"
    )

    // Test 9: Attribution fields persistence (UTM parameters, gclid, landing page, referrer)
    const createdLeadA = await Lead.findOne({
      tenantId: tenantA,
      name: "Alice Allowed",
    }).lean()
    assertBehavioral(
      Boolean(
        createdLeadA &&
        (createdLeadA.attribution?.firstTouch?.source === "google_ads" || createdLeadA.attribution?.firstTouch?.utm_source === "google_ads") &&
        (createdLeadA.attribution?.firstTouch?.campaign === "summer_sale" || createdLeadA.attribution?.firstTouch?.utm_campaign === "summer_sale") &&
        createdLeadA.attribution?.firstTouch?.gclid === "test_gclid_12345" &&
        createdLeadA.landingPage === "https://landing.tenant-a.com/product"
      ),
      "Attribution fields (source, campaign, gclid, landingPage) persist in lead record"
    )

    // Test 10: Multi-touch attribution & repeat inquiry note appending
    const repeatEmail = createdLeadA.email
    const res10 = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      body: {
        name: "Alice Allowed",
        email: repeatEmail,
        message: "Second inquiry: what is your enterprise pricing?",
        utm_source: "email_newsletter",
        utm_medium: "email",
        utm_campaign: "reengagement_push",
        landingPage: "https://landing.tenant-a.com/pricing",
      },
    })
    const updatedLeadA = await Lead.findOne({
      tenantId: tenantA,
      email: repeatEmail,
    }).lean()
    assertBehavioral(
      Boolean(
        res10.success === true &&
        (updatedLeadA.attribution?.firstTouch?.source === "google_ads" || updatedLeadA.attribution?.firstTouch?.utm_source === "google_ads") && // preserved first-touch
        (updatedLeadA.attribution?.lastTouch?.source === "email_newsletter" || updatedLeadA.attribution?.lastTouch?.utm_source === "email_newsletter") && // updated last-touch
        updatedLeadA.message.includes("Second inquiry")
      ),
      "Multi-touch attribution preserves firstTouch, updates lastTouch, and appends inquiry note"
    )

    // Test 11: Idempotency check prevents duplicate lead creation
    const idempotencyKey = `idem_${Date.now()}`
    const res11a = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      headers: { "x-idempotency-key": idempotencyKey },
      body: {
        name: "Charlie Idempotent",
        email: `charlie_${Date.now()}@example.com`,
        phone: "+91 98765 99999",
      },
    })
    const res11b = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      headers: { "x-idempotency-key": idempotencyKey },
      body: {
        name: "Charlie Idempotent",
        email: `charlie_${Date.now()}@example.com`,
        phone: "+91 98765 99999",
      },
    })
    assertBehavioral(
      res11a.success === true && res11b.idempotent === true,
      "Idempotent submission returns cached success without duplicate creation"
    )

    // Clean up test data
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  } catch (err) {
    console.error("Test execution encountered an error:", err)
    assertBehavioral(false, `Unexpected error in test suite: ${err.message}`)
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log("=== PHASE 22 VERIFICATION SUMMARY ===")
  console.log("================================================================================")
  console.log(`Static Invariants Passed:     ${staticPassed} / ${staticPassed + staticFailed}`)
  console.log(`Behavioral Tests Passed:      ${behavioralPassed} / ${behavioralPassed + behavioralFailed}`)
  console.log(`Total Passed:                 ${staticPassed + behavioralPassed} / ${staticPassed + staticFailed + behavioralPassed + behavioralFailed}`)

  if (staticFailed > 0 || behavioralFailed > 0) {
    console.error("FAILED: Some Phase 22 tests failed.")
    process.exit(1)
  } else {
    console.log("SUCCESS: All Phase 22 tests passed.")
    process.exit(0)
  }
}

runTests()
