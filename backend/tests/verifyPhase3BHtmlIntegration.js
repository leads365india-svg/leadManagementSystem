/**
 * Phase 3B: HTML Website Live Integration Verification Suite
 * 
 * Verifies:
 * 1. Plain HTML form structure, required fields, honeypot, and zero secret leakage.
 * 2. HTTP static hosting of plain-html/index.html over HTTP (not file://).
 * 3. Live HTTP POST from allowed browser origin (http://localhost:8088) to backend (http://localhost:5000).
 * 4. Tenant isolation: lead arrives in the registered test tenant.
 * 5. CRM Lead verification: lead record persisted with contact details, source, and UTM attribution.
 * 6. Duplicate enquiry handling: duplicate submission handled according to tenant policy.
 * 7. Security: Disallowed origin rejected with HTTP 403 Forbidden.
 * 8. Security: Invalid siteKey rejected with HTTP 401 Unauthorized.
 * 9. Anti-spam: Honeypot populated form rejected with HTTP 400 Bad Request.
 */

const path = require("path")
require("dotenv").config({ path: path.resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const http = require("http")
const fs = require("fs")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")

let passedCount = 0
let failedCount = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    passedCount++
  } else {
    console.error(`  [FAIL] ${message}`)
    failedCount++
  }
}

async function runPhase3BTests() {
  console.log("================================================================================")
  console.log("=== PHASE 3B: HTML WEBSITE LIVE INTEGRATION VERIFICATION                     ===")
  console.log("================================================================================")

  const mongoURI = process.env.MONGODB_URI
  if (!mongoURI) {
    console.error("MONGODB_URI not found in environment")
    process.exit(1)
  }

  await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })

  const testTenantId = `tenant_html_test_${Date.now()}`
  const rawSiteKey = `lf_site_${crypto.randomBytes(16).toString("hex")}`
  const staticPort = 8088
  const backendUrl = "http://localhost:5000/api/integrations/leads/website"
  const allowedOrigin = `http://localhost:${staticPort}`

  let staticServer = null

  try {
    // ------------------------------------------------------------------------
    // Part 1: Static Code Inspection & Invariant Checks
    // ------------------------------------------------------------------------
    console.log("\n--- PART 1: Plain HTML File & Security Invariants ---")
    const htmlFilePath = path.resolve(__dirname, "../../docs/website-lead-integrations/examples/plain-html/index.html")
    assert(fs.existsSync(htmlFilePath), "Test 1: docs/website-lead-integrations/examples/plain-html/index.html exists")

    const htmlContent = fs.readFileSync(htmlFilePath, "utf8")
    assert(htmlContent.includes('name="_hp_trap"'), "Test 2: Anti-spam honeypot field (_hp_trap) is present")
    assert(htmlContent.includes('style="display:none !important;"') || htmlContent.includes("display:none"), "Test 3: Honeypot field is styled hidden from human visitors")
    assert(htmlContent.includes('name="name"') && htmlContent.includes('name="phone"') && htmlContent.includes('name="email"') && htmlContent.includes('name="message"'), "Test 4: All required input fields (name, phone, email, message) are present")
    assert(htmlContent.includes("thank-you-view"), "Test 5: Thank You state screen exists in DOM")
    assert(!htmlContent.includes("lf_live_") && !htmlContent.includes("shpss_") && !htmlContent.includes("sk_live_"), "Test 6: Zero private API keys, Shopify secrets, or credentials leaked in HTML code")

    // ------------------------------------------------------------------------
    // Part 2: Local HTTP Static Server
    // ------------------------------------------------------------------------
    console.log("\n--- PART 2: HTTP Static Server Hosting ---")
    staticServer = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      fs.createReadStream(htmlFilePath).pipe(res)
    })

    await new Promise((resolve) => staticServer.listen(staticPort, resolve))
    console.log(`  HTML test page serving at ${allowedOrigin}`)

    // Verify static server responds over HTTP
    const pageRes = await fetch(allowedOrigin)
    const pageBody = await pageRes.text()
    assert(pageRes.status === 200 && pageBody.includes("Leads365 CRM Integration"), "Test 7: Static HTML page is accessible over HTTP (not file://)")

    // ------------------------------------------------------------------------
    // Part 3: Test Tenant & Integration Setup
    // ------------------------------------------------------------------------
    console.log("\n--- PART 3: CRM Test Integration Setup ---")
    const testConfig = new LeadFeedConfig({
      tenantId: testTenantId,
      websiteSource: {
        enabled: true,
        siteKey: rawSiteKey,
        allowedOrigins: [allowedOrigin, `http://127.0.0.1:${staticPort}`],
        duplicateHandling: "update",
        assignedStaffName: "Test Lead Agent",
      },
    })
    await testConfig.save()

    const testIntegration = new Integration({
      tenantId: testTenantId,
      name: "Plain HTML Test Integration",
      type: "website",
      siteKey: rawSiteKey,
      status: "active",
      settings: {
        allowedOrigins: [allowedOrigin, `http://127.0.0.1:${staticPort}`],
        duplicateHandling: "update",
        websiteDomain: `localhost:${staticPort}`,
      },
    })
    await testIntegration.save()
    assert(testIntegration._id != null, "Test 8: Test Integration saved with allowed origin http://localhost:8088")

    // ------------------------------------------------------------------------
    // Part 4: Live HTTP Submission from Allowed Browser Origin
    // ------------------------------------------------------------------------
    console.log("\n--- PART 4: Real Browser Origin HTTP Lead Ingestion ---")
    const testLeadEmail = `lead_html_${Date.now()}@example.com`
    const testLeadPhone = "+91 98765 43210"
    const testLeadName = "Vikram Aditya"

    const leadPayload = {
      name: testLeadName,
      phone: testLeadPhone,
      email: testLeadEmail,
      message: "Need enterprise CRM demo for our sales team",
      _hp_trap: "", // Clean honeypot
      landingPage: `${allowedOrigin}/?utm_source=google_search&utm_campaign=q4_growth`,
      utm_source: "google_search",
      utm_campaign: "q4_growth",
      utm_medium: "cpc",
      source: "Website Form (Plain HTML)",
      formId: "plain_html_callback_form",
    }

    const liveSubmitRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": allowedOrigin,
        "X-Site-Key": rawSiteKey,
        "X-Idempotency-Key": `idem_${Date.now()}_test`,
      },
      body: JSON.stringify(leadPayload),
    })

    const submitData = await liveSubmitRes.json()
    if (!submitData.success) {
      console.log("  [DEBUG Test 9 failed]:", liveSubmitRes.status, submitData)
    }
    assert(
      (liveSubmitRes.status === 200 || liveSubmitRes.status === 201) && submitData.success === true,
      `Test 9: Live submission from allowed Origin returned HTTP ${liveSubmitRes.status} (success: true)`
    )

    // ------------------------------------------------------------------------
    // Part 5: CRM Lead Verification in Database
    // ------------------------------------------------------------------------
    console.log("\n--- PART 5: CRM Lead Database & Attribution Verification ---")
    const createdLead = await Lead.findOne({
      tenantId: testTenantId,
      email: testLeadEmail,
    }).lean()

    assert(
      createdLead != null &&
        createdLead.tenantId === testTenantId &&
        createdLead.name === testLeadName &&
        createdLead.phone === testLeadPhone,
      "Test 10: Lead successfully reached test CRM tenant and persisted with correct contact details"
    )

    assert(
      createdLead != null &&
        (createdLead.source === "Website" || createdLead.source === "Website Form (Plain HTML)") &&
        (createdLead.attribution?.firstTouch?.utm_source === "google_search" ||
          createdLead.attribution?.firstTouch?.source === "google_search") &&
        (createdLead.attribution?.firstTouch?.utm_campaign === "q4_growth" ||
          createdLead.attribution?.firstTouch?.campaign === "q4_growth"),
      "Test 11: Lead attribution metadata (source, utm_source, utm_campaign) correctly mapped"
    )

    // ------------------------------------------------------------------------
    // Part 6: Duplicate Handling Policy Verification
    // ------------------------------------------------------------------------
    console.log("\n--- PART 6: Duplicate Enquiry Handling ---")
    const duplicatePayload = {
      name: testLeadName,
      phone: testLeadPhone,
      email: testLeadEmail,
      message: "Follow-up message from second enquiry submission",
      _hp_trap: "",
      source: "Website Form (Plain HTML)",
    }

    const dupSubmitRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": allowedOrigin,
        "X-Site-Key": rawSiteKey,
        "X-Idempotency-Key": `idem_dup_${Date.now()}`,
      },
      body: JSON.stringify(duplicatePayload),
    })

    const dupData = await dupSubmitRes.json()
    const leadsCount = await Lead.countDocuments({
      tenantId: testTenantId,
      email: testLeadEmail,
    })



    assert(
      (dupSubmitRes.status === 200 || dupSubmitRes.status === 201) &&
        dupData.success === true &&
        leadsCount === 1,
      "Test 12: Duplicate enquiry merges smoothly into existing lead without duplicate creation (leadsCount: 1)"
    )

    // ------------------------------------------------------------------------
    // Part 7: Security Validations (Origin, Key, Honeypot)
    // ------------------------------------------------------------------------
    console.log("\n--- PART 7: Security & Abuse Prevention Invariants ---")

    // Test 13: Disallowed Origin rejection (HTTP 403)
    const unauthorizedOriginRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://evil-unauthorized-domain.com",
        "X-Site-Key": rawSiteKey,
      },
      body: JSON.stringify({
        name: "Attacker",
        email: "attacker@evil.com",
        phone: "+91 99999 88888",
      }),
    })
    const unauthData = await unauthorizedOriginRes.json()
    assert(
      unauthorizedOriginRes.status === 403 && unauthData.success === false,
      "Test 13: Disallowed Origin is rejected with HTTP 403 Forbidden"
    )

    // Test 14: Invalid Site Key rejection (HTTP 401)
    const invalidKeyRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": allowedOrigin,
        "X-Site-Key": "lf_site_invalid_key_99999999",
      },
      body: JSON.stringify({
        name: "Test User",
        email: "user@test.com",
        phone: "+91 99999 77777",
      }),
    })
    const invalidKeyData = await invalidKeyRes.json()
    assert(
      invalidKeyRes.status === 401 && invalidKeyData.success === false,
      "Test 14: Invalid or unrecognized Site Key is rejected with HTTP 401 Unauthorized"
    )

    // Test 15: Honeypot trap rejection (HTTP 400)
    const botPayload = {
      name: "Spam Bot",
      email: "bot@spammer.com",
      phone: "+91 00000 00000",
      _hp_trap: "automated bot text", // Populated honeypot
    }
    const honeypotRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": allowedOrigin,
        "X-Site-Key": rawSiteKey,
      },
      body: JSON.stringify(botPayload),
    })
    const honeypotData = await honeypotRes.json()
    assert(
      honeypotRes.status === 400 && honeypotData.success === false,
      "Test 15: Populated honeypot (_hp_trap) is caught and rejected with HTTP 400 Bad Request"
    )

    // Clean up test data
    await LeadFeedConfig.deleteMany({ tenantId: testTenantId })
    await Integration.deleteMany({ tenantId: testTenantId })
    await Lead.deleteMany({ tenantId: testTenantId })
    await IntegrationEvent.deleteMany({ tenantId: testTenantId })

  } catch (err) {
    console.error("Test execution encountered an error:", err)
    assert(false, `Unexpected error: ${err.message}`)
  } finally {
    if (staticServer) {
      staticServer.close()
    }
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 3B TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ===`)
  console.log("================================================================================")

  if (failedCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runPhase3BTests()
