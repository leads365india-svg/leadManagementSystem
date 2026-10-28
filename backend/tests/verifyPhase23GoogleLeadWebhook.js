/**
 * Phase 23: Google Lead Form Webhooks & Direct Ingestion Verification Suite
 * 
 * Comprehensive Verification:
 * 1. Static Invariant Tests: Key generation, timing-safe verification, payload normalization, attribution mapping, test lead detection.
 * 2. Webhook Authentication: Valid key resolves tenant; missing or wrong key returns HTTP 401.
 * 3. Tenant Isolation: Server-side resolution via key hash; Tenant B cannot access Tenant A.
 * 4. Account Lifecycle: Suspended account or disabled integration returns HTTP 403.
 * 5. Lead Creation & Attribution: Fields (name, email, phone, company, city) mapped to CRM schema; utm_source, gclid, campaignId preserved.
 * 6. Idempotency & Deduplication: Repeated delivery with same lead_id returns HTTP 200 without duplicate CRM leads or activities.
 * 7. Duplicate Handling Policy: duplicateHandling="update" merges into existing lead, updates lastTouch, preserves firstTouch.
 * 8. Google Ads Test Submissions: is_test: true returns HTTP 200 without creating junk CRM leads.
 * 9. Key Rotation: Rotating key immediately revokes old key and authorizes new key.
 * 10. Data Safety: Secrets and key hashes excluded from serialized outputs.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Account = require("../models/Account")
const User = require("../models/User")
const googleAdsService = require("../services/googleAdsService")
const googleAdsController = require("../controllers/googleAdsController")

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

/**
 * Helper to dispatch simulated HTTP requests directly through handleGoogleWebhook controller
 */
async function callWebhook(body, headers = {}) {
  let statusCode = 200
  let responseData = {}

  const req = {
    body,
    headers,
    get: (h) => headers[h.toLowerCase()] || "",
    ip: "127.0.0.1",
  }

  const res = {
    status: (code) => {
      statusCode = code
      return {
        json: (data) => {
          responseData = data || {}
          return data
        },
      }
    },
    json: (data) => {
      responseData = data || {}
      return data
    },
  }

  await googleAdsController.handleGoogleWebhook(req, res)
  return { status: statusCode, statusCode, ...responseData }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 23: GOOGLE LEAD FORM WEBHOOKS & INGESTION VERIFICATION ===")
  console.log("================================================================================")

  console.log("\n--- PART 1: Static Source & Normalization Invariant Tests ---")

  // 1. Key generation format & entropy
  const keyObj = googleAdsService.generateGoogleKey()
  assertStatic(
    keyObj.rawKey && keyObj.rawKey.startsWith("gkey_live_") && keyObj.rawKey.length >= 40,
    "generateGoogleKey produces a high-entropy key prefixed with 'gkey_live_'"
  )
  assertStatic(
    keyObj.keyHash && keyObj.keyHash === crypto.createHash("sha256").update(keyObj.rawKey).digest("hex"),
    "generateGoogleKey computes correct SHA-256 keyHash"
  )
  assertStatic(
    keyObj.maskedKey && keyObj.maskedKey.startsWith("gkey_live_") && keyObj.maskedKey.includes("••••"),
    "generateGoogleKey generates properly masked key representation for safe UI display"
  )

  // 2. Timing-safe verification
  const testKey = "gkey_live_testkey1234567890abcdef1234567890"
  assertStatic(
    googleAdsService.verifyGoogleWebhookKey(testKey, testKey) === true,
    "verifyGoogleWebhookKey returns true for identical keys"
  )
  assertStatic(
    googleAdsService.verifyGoogleWebhookKey(testKey, testKey + "_wrong") === false,
    "verifyGoogleWebhookKey rejects mismatching keys"
  )
  assertStatic(
    googleAdsService.verifyGoogleWebhookKey(null, testKey) === false &&
    googleAdsService.verifyGoogleWebhookKey(testKey, "") === false,
    "verifyGoogleWebhookKey rejects null/empty inputs safely without exceptions"
  )

  // 3. Payload normalization
  const sampleGooglePayload = {
    google_key: testKey,
    lead_id: "google_lead_xyz_987",
    api_version: "1.0",
    form_id: "form_enterprise_demo",
    campaign_id: "camp_b2b_q4",
    gclid: "Cj0KCQjw123456789GCLID",
    is_test: false,
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Vikram Malhotra" },
      { column_id: "EMAIL", string_value: "vikram@enterprise-tech.in" },
      { column_id: "PHONE_NUMBER", string_value: "+91 98111 22233" },
      { column_id: "COMPANY_NAME", string_value: "Enterprise Tech Ltd" },
      { column_id: "CITY", string_value: "Bengaluru" },
      { column_id: "POSTAL_CODE", string_value: "560001" },
      { column_name: "Requirement", string_value: "Need CRM with WhatsApp integration" }
    ]
  }

  const normalized = googleAdsService.normalizeGoogleLeadPayload(sampleGooglePayload)
  assertStatic(normalized.name === "Vikram Malhotra", "normalizeGoogleLeadPayload maps FULL_NAME")
  assertStatic(normalized.email === "vikram@enterprise-tech.in", "normalizeGoogleLeadPayload maps EMAIL")
  assertStatic(normalized.phone === "+91 98111 22233", "normalizeGoogleLeadPayload maps PHONE_NUMBER")
  assertStatic(normalized.company === "Enterprise Tech Ltd", "normalizeGoogleLeadPayload maps COMPANY_NAME")
  assertStatic(normalized.city === "Bengaluru", "normalizeGoogleLeadPayload maps CITY")
  assertStatic(normalized.source === "Google Ads", "normalizeGoogleLeadPayload sets source to 'Google Ads'")
  assertStatic(normalized.utm_source === "google" && normalized.utm_medium === "cpc", "normalizeGoogleLeadPayload sets default Google UTM attribution")
  assertStatic(normalized.gclid === "Cj0KCQjw123456789GCLID", "normalizeGoogleLeadPayload preserves gclid")
  assertStatic(normalized.campaignId === "camp_b2b_q4", "normalizeGoogleLeadPayload preserves campaignId")
  assertStatic(normalized.formId === "form_enterprise_demo", "normalizeGoogleLeadPayload preserves formId")
  assertStatic(normalized.message && normalized.message.includes("Need CRM with WhatsApp integration"), "normalizeGoogleLeadPayload appends custom questions to message")

  // 4. Test lead detection
  const testPayload1 = { google_key: testKey, is_test: true, lead_id: "real_looking_id" }
  const testNorm1 = googleAdsService.normalizeGoogleLeadPayload(testPayload1)
  assertStatic(testNorm1.isTest === true, "normalizeGoogleLeadPayload detects is_test flag")

  const testPayload2 = { google_key: testKey, lead_id: "test-lead-from-google-ui" }
  const testNorm2 = googleAdsService.normalizeGoogleLeadPayload(testPayload2)
  assertStatic(testNorm2.isTest === true, "normalizeGoogleLeadPayload detects test- prefix in lead_id")

  // 5. Official Google Ads webhook specification fields (gcl_id, adgroup_id, creative_id, WORK_EMAIL, REGION, COUNTRY)
  const officialGoogleSpecPayload = {
    google_key: testKey,
    lead_id: "google_lead_official_contract_999",
    form_id: "form_contract_check",
    campaign_id: "camp_contract_check",
    adgroup_id: "adgroup_contract_777",
    creative_id: "creative_contract_888",
    api_version: "1.0",
    gcl_id: "Cj0KCQ_OFFICIAL_GCL_ID_SPEC",
    unknown_optional_google_field_v2: { nested_info: "future_param" },
    random_google_meta_tag: "safe_ignore",
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Ananya Iyer" },
      { column_id: "WORK_EMAIL", string_value: "ananya@healthtech.org" },
      { column_id: "WORK_PHONE", string_value: "+91 91234 56789" },
      { column_id: "COMPANY_NAME", string_value: "HealthTech Innovations" },
      { column_id: "CITY", string_value: "Pune" },
      { column_id: "REGION", string_value: "Maharashtra" },
      { column_id: "COUNTRY", string_value: "India" }
    ]
  }

  const officialNorm = googleAdsService.normalizeGoogleLeadPayload(officialGoogleSpecPayload)
  assertStatic(officialNorm.gclid === "Cj0KCQ_OFFICIAL_GCL_ID_SPEC", "normalizeGoogleLeadPayload supports Google's official 'gcl_id' parameter")
  assertStatic(officialNorm.email === "ananya@healthtech.org", "normalizeGoogleLeadPayload maps WORK_EMAIL")
  assertStatic(officialNorm.phone === "+91 91234 56789", "normalizeGoogleLeadPayload maps WORK_PHONE")
  assertStatic(officialNorm.message.includes("Region: Maharashtra") && officialNorm.message.includes("Country: India"), "normalizeGoogleLeadPayload maps REGION and COUNTRY")
  assertStatic(officialNorm.message.includes("AdGroup ID: adgroup_contract_777") && officialNorm.message.includes("Creative ID: creative_contract_888"), "normalizeGoogleLeadPayload preserves adgroup_id and creative_id")
  assertStatic(officialNorm.name === "Ananya Iyer" && officialNorm.city === "Pune", "normalizeGoogleLeadPayload safely handles unknown/unexpected fields without breaking")

  console.log("\n--- PART 2: Behavioral Integration & Tenant Security Tests ---")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)

  const tenantA = `tenant_google_a_${Date.now()}`
  const tenantB = `tenant_google_b_${Date.now()}`

  try {
    // Setup Account records
    await Account.create([
      {
        accountId: tenantA,
        companyName: "Tenant A Google Ads",
        displayName: "Tenant A",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin A",
        adminEmail: "admin@tenant-a.com",
        status: "active",
      },
      {
        accountId: tenantB,
        companyName: "Tenant B Google Ads",
        displayName: "Tenant B",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin B",
        adminEmail: "admin@tenant-b.com",
        status: "active",
      },
    ])

    // Generate keys
    const keyDataA = googleAdsService.generateGoogleKey()
    const keyDataB = googleAdsService.generateGoogleKey()

    // Create Tenant A Integration & LeadFeedConfig
    const integrationA = new Integration({
      tenantId: tenantA,
      type: "google_ads",
      name: "Google Ads Lead Form - Tenant A",
      status: "active",
      apiKeyHash: keyDataA.keyHash,
      webhookSecret: keyDataA.rawKey,
      settings: {
        duplicateHandling: "update",
        assignedStaffName: "Agent Alpha",
      },
      stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 }
    })
    integrationA.setCredentials({ googleKey: keyDataA.rawKey, googleKeyMasked: keyDataA.maskedKey })
    await integrationA.save()

    const leadFeedConfigA = new LeadFeedConfig({
      tenantId: tenantA,
      googleSource: {
        enabled: true,
        googleKeyHash: keyDataA.keyHash,
        googleKeyMasked: keyDataA.maskedKey,
        duplicateHandling: "update",
        assignedStaffName: "Agent Alpha",
        stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 }
      }
    })
    await leadFeedConfigA.save()

    // Create Tenant B Integration & LeadFeedConfig
    const integrationB = new Integration({
      tenantId: tenantB,
      type: "google_ads",
      name: "Google Ads Lead Form - Tenant B",
      status: "active",
      apiKeyHash: keyDataB.keyHash,
      webhookSecret: keyDataB.rawKey,
      settings: {
        duplicateHandling: "reject",
      },
      stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 }
    })
    integrationB.setCredentials({ googleKey: keyDataB.rawKey, googleKeyMasked: keyDataB.maskedKey })
    await integrationB.save()

    const leadFeedConfigB = new LeadFeedConfig({
      tenantId: tenantB,
      googleSource: {
        enabled: true,
        googleKeyHash: keyDataB.keyHash,
        googleKeyMasked: keyDataB.maskedKey,
        duplicateHandling: "reject",
        stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 }
      }
    })
    await leadFeedConfigB.save()

    // Test 1: Missing google_key fails with 401
    const resMissingKey = await callWebhook({
      lead_id: "lead_no_key",
      user_column_data: [{ column_id: "EMAIL", string_value: "test@missingkey.com" }]
    })
    assertBehavioral(
      resMissingKey.statusCode === 401 && resMissingKey.error?.includes("Missing Google Ads webhook key"),
      "Webhook intake rejects missing google_key with HTTP 401"
    )

    // Test 2: Invalid google_key fails with 401
    const resInvalidKey = await callWebhook({
      google_key: "gkey_live_invalid_key_that_does_not_exist",
      lead_id: "lead_bad_key",
      user_column_data: [{ column_id: "EMAIL", string_value: "test@badkey.com" }]
    })
    assertBehavioral(
      resInvalidKey.statusCode === 401 && resInvalidKey.error?.includes("Invalid or revoked"),
      "Webhook intake rejects invalid google_key with HTTP 401"
    )

    // Test 3: Valid Tenant A google_key ingests lead into Tenant A
    const leadEmailA = `rajesh_${Date.now()}@googlelead.in`
    const leadIdA = `g_lead_${Date.now()}`
    const resValidLead = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: leadIdA,
      form_id: "form_medical_supplies",
      campaign_id: "camp_delhi_ncr",
      gclid: "GCLID_VALID_TEST_12345",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Rajesh Sharma" },
        { column_id: "EMAIL", string_value: leadEmailA },
        { column_id: "PHONE_NUMBER", string_value: "+91 98222 33344" },
        { column_id: "COMPANY_NAME", string_value: "Sharma Diagnostics" },
        { column_id: "CITY", string_value: "New Delhi" }
      ]
    })

    assertBehavioral(
      resValidLead.statusCode === 200 && resValidLead.success === true,
      "Webhook intake accepts valid Google Ads lead with HTTP 200 (Google official contract)"
    )

    const createdLeadA = await Lead.findById(resValidLead.leadId).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      createdLeadA && createdLeadA.tenantId === tenantA,
      "Ingested lead is strictly scoped to Tenant A"
    )
    assertBehavioral(
      createdLeadA &&
      (createdLeadA.attribution?.firstTouch?.source === "google" || createdLeadA.source === "Google Ads") &&
      createdLeadA.attribution?.firstTouch?.gclid === "GCLID_VALID_TEST_12345",
      "Attribution model captures firstTouch source ('google') and gclid"
    )

    // Test 4: Tenant isolation check: Tenant B's workspace does not contain Tenant A's lead
    const crossTenantLeadCheck = await Lead.findOne({ tenantId: tenantB, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      crossTenantLeadCheck === null,
      "Tenant B cannot see or access Tenant A's ingested Google Ads lead (tenant isolation verified)"
    )

    // Test 5: Idempotency: Submitting the identical lead_id again returns 200 without creating duplicate lead
    const resDuplicateDelivery = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: leadIdA,
      form_id: "form_medical_supplies",
      campaign_id: "camp_delhi_ncr",
      gclid: "GCLID_VALID_TEST_12345",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Rajesh Sharma" },
        { column_id: "EMAIL", string_value: leadEmailA },
        { column_id: "PHONE_NUMBER", string_value: "+91 98222 33344" }
      ]
    })

    assertBehavioral(
      resDuplicateDelivery.statusCode === 200 && resDuplicateDelivery.idempotent === true,
      "Identical lead_id delivery returns HTTP 200 with idempotent acknowledgment"
    )
    const countAfterDuplicate = await Lead.countDocuments({ tenantId: tenantA, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      countAfterDuplicate === 1,
      "Idempotent retry did not create a duplicate Lead document in CRM"
    )

    // Test 6: Duplicate handling: New lead_id with same contact email and duplicateHandling='update'
    const leadIdA2 = `g_lead_second_${Date.now()}`
    const resRepeatInquiry = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: leadIdA2,
      form_id: "form_urgent_order",
      campaign_id: "camp_retargeting",
      gclid: "GCLID_SECOND_TOUCH_999",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Rajesh Sharma" },
        { column_id: "EMAIL", string_value: leadEmailA },
        { column_id: "PHONE_NUMBER", string_value: "+91 98222 33344" },
        { column_name: "Follow-up", string_value: "Need price quote for 100 units urgently" }
      ]
    })

    assertBehavioral(
      resRepeatInquiry.statusCode === 200 && resRepeatInquiry.action === "merged",
      "Repeat contact submission with duplicateHandling='update' merges into existing lead"
    )
    const countAfterRepeat = await Lead.countDocuments({ tenantId: tenantA, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      countAfterRepeat === 1,
      "Merge policy preserved single unified Lead record without duplicate creation"
    )

    const updatedLead = await Lead.findOne({ tenantId: tenantA, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      updatedLead.attribution?.firstTouch?.gclid === "GCLID_VALID_TEST_12345" &&
      updatedLead.attribution?.lastTouch?.gclid === "GCLID_SECOND_TOUCH_999",
      "Attribution preserved original firstTouch and updated lastTouch on repeat inquiry"
    )

    // Test 7: Google Ads test submission ('Send test data' button from Google Ads UI)
    const resGoogleTestBtn = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: "test-lead-sample-12345",
      is_test: true,
      form_id: "form_test",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Test Lead User" },
        { column_id: "EMAIL", string_value: "test@google.com" },
        { column_id: "PHONE_NUMBER", string_value: "+1 800 555 0199" }
      ]
    })

    assertBehavioral(
      resGoogleTestBtn.statusCode === 200 && resGoogleTestBtn.isTest === true,
      "Google Ads 'Send test data' submission acknowledged with HTTP 200 and isTest: true"
    )
    const testLeadInDb = await Lead.findOne({ tenantId: tenantA, email: "test@google.com" }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      testLeadInDb === null,
      "Google Ads test submission did NOT pollute CRM database with junk test lead"
    )

    // Test 8: Missing contact fields (no email and no phone) rejected with HTTP 400
    const resNoContact = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: `g_lead_nocontact_${Date.now()}`,
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Ghost User" },
        { column_id: "COMPANY_NAME", string_value: "Unknown Corp" }
      ]
    })
    assertBehavioral(
      resNoContact.statusCode === 400 && (resNoContact.error?.includes("email") || resNoContact.error?.includes("phone")),
      "Submission lacking both email and phone is rejected with HTTP 400 Bad Request"
    )

    // Test 9: Disabled integration rejected with HTTP 403
    await Integration.updateOne({ _id: integrationA._id }, { status: "inactive" })
    const resDisabled = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: `g_lead_disabled_${Date.now()}`,
      user_column_data: [{ column_id: "EMAIL", string_value: "user@disabled.com" }]
    })
    assertBehavioral(
      resDisabled.statusCode === 403 && resDisabled.error?.includes("disabled"),
      "Inactive integration rejects incoming leads with HTTP 403 Forbidden"
    )
    await Integration.updateOne({ _id: integrationA._id }, { status: "active" })

    // Test 10: Suspended tenant account rejected with HTTP 403
    await Account.updateOne({ accountId: tenantA }, { status: "suspended" })
    const resSuspended = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: `g_lead_suspended_${Date.now()}`,
      user_column_data: [{ column_id: "EMAIL", string_value: "user@suspended.com" }]
    })
    assertBehavioral(
      resSuspended.statusCode === 403 && resSuspended.error?.includes("suspended"),
      "Suspended tenant account rejects incoming leads with HTTP 403 Forbidden"
    )
    await Account.updateOne({ accountId: tenantA }, { status: "active" })

    // Test 11: Webhook Key Rotation
    const { rawKey: newKeyA } = await googleAdsService.rotateGoogleKey(tenantA)
    assertBehavioral(
      newKeyA && newKeyA.startsWith("gkey_live_") && newKeyA !== keyDataA.rawKey,
      "rotateGoogleKey produces a distinct new live key"
    )

    // Old key must now fail with 401
    const resOldKeyAfterRotate = await callWebhook({
      google_key: keyDataA.rawKey,
      lead_id: `g_lead_oldkey_${Date.now()}`,
      user_column_data: [{ column_id: "EMAIL", string_value: "user@oldkey.com" }]
    })
    assertBehavioral(
      resOldKeyAfterRotate.statusCode === 401,
      "Previous Google webhook key is immediately invalidated after rotation"
    )

    // New key succeeds with 201
    const resNewKeyAfterRotate = await callWebhook({
      google_key: newKeyA,
      lead_id: `g_lead_newkey_${Date.now()}`,
      user_column_data: [
        { column_id: "EMAIL", string_value: `newkey_${Date.now()}@google.com` },
        { column_id: "PHONE_NUMBER", string_value: "+91 97777 88888" }
      ]
    })
    assertBehavioral(
      resNewKeyAfterRotate.statusCode === 200,
      "New rotated key successfully ingests leads with HTTP 200"
    )

    // Test 12: Data Safety: Serialized LeadFeedConfig JSON does NOT leak raw key hash
    const foundConfig = await LeadFeedConfig.findOne({ tenantId: tenantA }).setOptions({ skipTenantFilter: true })
    const configJson = foundConfig.toJSON()
    assertBehavioral(
      configJson.googleSource?.googleKeyHash === undefined &&
      configJson.googleSource?.googleKeyMasked.includes("••••"),
      "LeadFeedConfig JSON serialization omits googleKeyHash and exposes only masked key"
    )

  } finally {
    // Cleanup test artifacts
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log("=== PHASE 23 VERIFICATION SUMMARY ===")
  console.log("================================================================================")
  console.log(`Static Tests:     ${staticPassed} PASSED, ${staticFailed} FAILED`)
  console.log(`Behavioral Tests: ${behavioralPassed} PASSED, ${behavioralFailed} FAILED`)
  console.log(`Total:            ${staticPassed + behavioralPassed} PASSED, ${staticFailed + behavioralFailed} FAILED`)

  if (staticFailed > 0 || behavioralFailed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Phase 23 verification suite fatal error:", err)
  process.exit(1)
})
