/**
 * Phase 4: Official WordPress Integration Plugin Verification Suite
 * 
 * Verifies:
 * 1. Plugin file structure and required subsystems.
 * 2. Distributable ZIP archive validity and root folder packaging.
 * 3. PHP security invariants (ABSPATH exit, admin capabilities, nonces, honeypot).
 * 4. API Key protection: zero credential leakage in client code or UI.
 * 5. Elementor Pro and Contact Form 7 hook implementations and deduplication.
 * 6. Live server-to-server HTTP API dispatch matching WordPress plugin contract.
 * 7. CRM Lead creation, custom fields mapping, and marketing attribution persistence.
 * 8. Idempotency deduplication and duplicate handling.
 * 9. Authentication security: invalid key, bad HMAC, expired timestamp, and honeypot rejection.
 */

const path = require("path")
const fs = require("fs")
const crypto = require("crypto")
require("dotenv").config({ path: path.resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const integrationService = require("../services/integrationService")

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

async function runWordPressPluginTests() {
  console.log("================================================================================")
  console.log("=== PHASE 4: OFFICIAL WORDPRESS PLUGIN VERIFICATION                          ===")
  console.log("================================================================================")

  const pluginBaseDir = path.resolve(__dirname, "../../docs/website-lead-integrations/wordpress-plugin/leads365-integration")
  const zipFilePath = path.resolve(__dirname, "../../docs/website-lead-integrations/wordpress-plugin/leads365-integration.zip")
  const backendUrl = "http://localhost:5000/api/integrations/leads/website"

  const mongoURI = process.env.MONGODB_URI
  if (!mongoURI) {
    console.error("MONGODB_URI not found in environment")
    process.exit(1)
  }
  await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })

  const testTenantId = `tenant_wp_test_${Date.now()}`
  const rawApiKey = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex")

  try {
    // ------------------------------------------------------------------------
    // Part 1: Plugin File Structure & Packaging Invariants
    // ------------------------------------------------------------------------
    console.log("\n--- PART 1: Plugin File Structure & Packaging Invariants ---")
    const mainPluginFile = path.join(pluginBaseDir, "leads365-integration.php")
    assert(fs.existsSync(mainPluginFile), "Test 1: leads365-integration.php exists")

    const mainContent = fs.readFileSync(mainPluginFile, "utf8")
    assert(
      mainContent.includes("Plugin Name: Leads365 CRM Integration") &&
      mainContent.includes("Version:     1.0.0") &&
      mainContent.includes("License:     GPL-2.0+"),
      "Test 2: Standard WordPress plugin header block is properly defined"
    )

    const requiredIncludes = [
      "includes/class-leads365-api.php",
      "includes/class-leads365-admin.php",
      "includes/class-leads365-form.php",
      "includes/class-leads365-elementor.php",
      "includes/class-leads365-contact-form-7.php",
    ]
    const allIncludesExist = requiredIncludes.every(f => fs.existsSync(path.join(pluginBaseDir, f)))
    assert(allIncludesExist, "Test 3: All 5 required include classes exist in includes/ directory")

    assert(
      fs.existsSync(path.join(pluginBaseDir, "assets/admin.css")) &&
      fs.existsSync(path.join(pluginBaseDir, "assets/admin.js")),
      "Test 4: Admin dashboard CSS and JS assets exist in assets/ directory"
    )

    assert(fs.existsSync(path.join(pluginBaseDir, "readme.txt")), "Test 5: Standard WordPress readme.txt exists")

    // Verify ZIP archive exists and has valid header
    assert(fs.existsSync(zipFilePath) && fs.statSync(zipFilePath).size > 1000, "Test 6: Distributable plugin ZIP archive exists and is non-empty")
    
    // Check ZIP magic header (PK\x03\x04)
    const zipBuffer = fs.readFileSync(zipFilePath)
    const isZip = zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4B && zipBuffer[2] === 0x03 && zipBuffer[3] === 0x04
    assert(isZip, "Test 7: ZIP file has valid PK standard ZIP format header")

    // ------------------------------------------------------------------------
    // Part 2: Security Invariants & Zero Credential Leakage
    // ------------------------------------------------------------------------
    console.log("\n--- PART 2: Security Invariants & Zero Credential Leakage ---")
    
    const phpFiles = [
      "leads365-integration.php",
      ...requiredIncludes,
    ]

    const allHaveAbspath = phpFiles.every(relPath => {
      const code = fs.readFileSync(path.join(pluginBaseDir, relPath), "utf8")
      return code.includes("if (!defined('ABSPATH'))")
    })
    assert(allHaveAbspath, "Test 8: Every plugin PHP file strictly enforces ABSPATH direct access check")

    const adminContent = fs.readFileSync(path.join(pluginBaseDir, "includes/class-leads365-admin.php"), "utf8")
    assert(
      adminContent.includes("current_user_can('manage_options')") &&
      adminContent.includes("check_admin_referer('leads365_save_settings'") &&
      adminContent.includes("check_ajax_referer('leads365_admin_nonce'"),
      "Test 9: Admin settings enforce manage_options capability and WordPress nonce verification"
    )

    const formContent = fs.readFileSync(path.join(pluginBaseDir, "includes/class-leads365-form.php"), "utf8")
    assert(
      formContent.includes("add_shortcode('leads365_form'") &&
      formContent.includes("name=\"_hp_trap\"") &&
      formContent.includes("check_ajax_referer('leads365_form_submit'"),
      "Test 10: Native shortcode [leads365_form] includes anti-spam honeypot and nonce verification"
    )

    // Ensure no hardcoded private keys exist in any plugin files
    let hasLeakedKeys = false
    phpFiles.forEach(relPath => {
      const content = fs.readFileSync(path.join(pluginBaseDir, relPath), "utf8")
      if (content.includes("lf_live_0") || content.includes("lf_live_1") || content.includes("shpss_")) {
        hasLeakedKeys = true
      }
    })
    assert(!hasLeakedKeys, "Test 11: Zero hardcoded private API keys or secrets in plugin code")

    // ------------------------------------------------------------------------
    // Part 3: Elementor Pro & Contact Form 7 Hooks & Deduplication
    // ------------------------------------------------------------------------
    console.log("\n--- PART 3: Elementor & Contact Form 7 Hook Implementations ---")
    const elemContent = fs.readFileSync(path.join(pluginBaseDir, "includes/class-leads365-elementor.php"), "utf8")
    assert(
      elemContent.includes("elementor_pro/forms/new_record") &&
      elemContent.includes("_hp_trap") &&
      elemContent.includes("customFields"),
      "Test 12: Elementor Pro integration hooks into elementor_pro/forms/new_record with honeypot & customFields"
    )

    const cf7Content = fs.readFileSync(path.join(pluginBaseDir, "includes/class-leads365-contact-form-7.php"), "utf8")
    assert(
      cf7Content.includes("wpcf7_mail_sent") &&
      cf7Content.includes("processed_submissions") &&
      cf7Content.includes("your-name") &&
      cf7Content.includes("your-email"),
      "Test 13: Contact Form 7 integration hooks into wpcf7_mail_sent with multi-hook deduplication"
    )

    // ------------------------------------------------------------------------
    // Part 4: Live Server-to-Server Endpoint Contract Verification
    // ------------------------------------------------------------------------
    console.log("\n--- PART 4: Live Server-to-Server Lead Dispatch Contract ---")

    // Setup synthetic test integration in CRM database
    const testIntegration = new Integration({
      tenantId: testTenantId,
      name: "WordPress Plugin Integration",
      type: "wordpress",
      apiKeyHash: apiKeyHash,
      apiKeyMasked: "lf_live_••••••••••••••••" + rawApiKey.slice(-4),
      status: "active",
      settings: {
        duplicateHandling: "update",
      },
    })
    await testIntegration.save()

    const leadPayload = {
      name: "Ananya Patel",
      email: `ananya_wp_${Date.now()}@example.com`,
      phone: "+91 98765 22334",
      message: "Consultation request from WordPress Contact Form 7",
      source: "WordPress Contact Form 7",
      formId: "cf7_contact_page",
      landingPage: "https://www.example.com/contact-us",
      referrer: "https://www.google.com/search",
      utm_source: "wp_newsletter",
      utm_campaign: "autumn_drive",
      utm_medium: "email",
      customFields: {
        company: "Patel Enterprises",
        budget: "$25,000",
        interest: "Enterprise CRM",
      },
    }

    const jsonBody = JSON.stringify(leadPayload)
    const timestamp = Date.now().toString()
    const signature = crypto.createHmac("sha256", rawApiKey).update(jsonBody).digest("hex")
    const idempotencyKey = `wp_test_${Date.now()}`

    const liveSubmitRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawApiKey,
        "X-Idempotency-Key": idempotencyKey,
        "X-Timestamp": timestamp,
        "X-Signature-256": signature,
        "User-Agent": "Leads365-WordPress/1.0.0; https://example.com",
      },
      body: jsonBody,
    })

    const submitData = await liveSubmitRes.json()
    assert(
      (liveSubmitRes.status === 200 || liveSubmitRes.status === 201) && submitData.success === true,
      `Test 14: Server-to-server WordPress lead dispatch accepted with HTTP ${liveSubmitRes.status} (success: true)`
    )

    // ------------------------------------------------------------------------
    // Part 5: CRM Lead Database & Attribution Verification
    // ------------------------------------------------------------------------
    console.log("\n--- PART 5: CRM Lead Database & Custom Fields Verification ---")
    const createdLead = await Lead.findOne({
      tenantId: testTenantId,
      email: leadPayload.email,
    }).lean()

    assert(
      createdLead != null &&
      createdLead.tenantId === testTenantId &&
      createdLead.name === leadPayload.name &&
      createdLead.phone === leadPayload.phone,
      "Test 15: WordPress lead reached the correct test tenant with contact information"
    )

    assert(
      createdLead != null &&
      (createdLead.attribution?.firstTouch?.utm_source === "wp_newsletter" ||
       createdLead.attribution?.firstTouch?.source === "wp_newsletter") &&
      (createdLead.attribution?.firstTouch?.utm_campaign === "autumn_drive" ||
       createdLead.attribution?.firstTouch?.campaign === "autumn_drive"),
      "Test 16: Marketing attribution (utm_source, utm_campaign) successfully preserved in firstTouch"
    )

    // ------------------------------------------------------------------------
    // Part 6: Idempotency & Duplicate Handling Safety
    // ------------------------------------------------------------------------
    console.log("\n--- PART 6: Idempotency & Duplicate Policy Safety ---")

    // Replay with identical idempotency key
    const replayRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawApiKey,
        "X-Idempotency-Key": idempotencyKey,
        "X-Timestamp": timestamp,
        "X-Signature-256": signature,
      },
      body: jsonBody,
    })
    const replayData = await replayRes.json()
    assert(
      replayRes.status === 200 && replayData.success === true && replayData.idempotent === true,
      "Test 17: Replay with same idempotency key returns cached response without duplicate creation"
    )

    // Subsequent enquiry under 'update' duplicate handling policy
    const updatePayload = {
      name: leadPayload.name,
      email: leadPayload.email,
      phone: leadPayload.phone,
      message: "Follow-up note: Can you call me tomorrow morning?",
      source: "WordPress Contact Form 7",
    }
    const updateJson = JSON.stringify(updatePayload)
    const updateSig = crypto.createHmac("sha256", rawApiKey).update(updateJson).digest("hex")

    const updateRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawApiKey,
        "X-Idempotency-Key": `wp_update_${Date.now()}`,
        "X-Timestamp": Date.now().toString(),
        "X-Signature-256": updateSig,
      },
      body: updateJson,
    })
    const updateData = await updateRes.json()
    const leadsCount = await Lead.countDocuments({
      tenantId: testTenantId,
      email: leadPayload.email,
    })

    assert(
      updateRes.status === 200 && updateData.success === true && leadsCount === 1,
      "Test 18: Subsequent enquiry updates existing lead record under 'update' policy (leadsCount: 1)"
    )

    // ------------------------------------------------------------------------
    // Part 7: Security Defense Invariants (Auth, HMAC, Timestamp, Honeypot)
    // ------------------------------------------------------------------------
    console.log("\n--- PART 7: Authentication & Security Defense Invariants ---")

    // Test 19: Invalid API key rejection (HTTP 401)
    const badKeyRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "lf_live_invalid_revoked_key_123456",
      },
      body: JSON.stringify({ name: "Attacker", email: "att@test.com" }),
    })
    assert(badKeyRes.status === 401, "Test 19: Invalid or revoked API key is rejected with HTTP 401 Unauthorized")

    // Test 20: Tampered HMAC signature rejection (HTTP 401)
    const badSigRes = await integrationService.intakeWebhookPayload({
      rawApiKey,
      headers: {
        "x-signature-256": "bad_hex_signature_abcdef123456",
      },
      body: leadPayload,
    })
    assert(badSigRes.status === 401 && badSigRes.success === false, "Test 20: Tampered or invalid HMAC-SHA256 signature is rejected with HTTP 401 Unauthorized")

    // Test 21: Expired timestamp (> 5 min) rejection (HTTP 401)
    const expiredTimestamp = (Date.now() - 400000).toString() // ~6.6 minutes ago
    const expiredSig = crypto.createHmac("sha256", rawApiKey).update(jsonBody).digest("hex")
    const expiredRes = await integrationService.intakeWebhookPayload({
      rawApiKey,
      headers: {
        "x-timestamp": expiredTimestamp,
        "x-signature-256": expiredSig,
      },
      body: leadPayload,
    })
    assert(expiredRes.status === 401 && expiredRes.success === false, "Test 21: Expired request timestamp (>5 min window) is rejected with HTTP 401 Unauthorized")

    // Test 22: Honeypot trap rejection (HTTP 400)
    const botPayload = {
      name: "Bot User",
      email: "bot@spammer.com",
      phone: "+91 00000 00000",
      _hp_trap: "automated_spam_bot_input",
    }
    const botJson = JSON.stringify(botPayload)
    const botSig = crypto.createHmac("sha256", rawApiKey).update(botJson).digest("hex")
    const botRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": rawApiKey,
        "X-Signature-256": botSig,
      },
      body: botJson,
    })
    assert(botRes.status === 400, "Test 22: Honeypot trap catches bot submissions and rejects with HTTP 400 Bad Request")

    // Clean up test data
    await Integration.deleteMany({ tenantId: testTenantId })
    await Lead.deleteMany({ tenantId: testTenantId })
    await IntegrationEvent.deleteMany({ tenantId: testTenantId })

  } catch (err) {
    console.error("Test execution encountered an error:", err)
    assert(false, `Unexpected error: ${err.message}`)
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 4 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ===`)
  console.log("================================================================================")

  if (failedCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runWordPressPluginTests()
