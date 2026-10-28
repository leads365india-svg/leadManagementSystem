/**
 * Phase 24: Generic Connector (Zapier, Make, n8n, Pabbly) Verification Suite
 * 
 * Comprehensive Verification:
 * 1. Static Invariant Tests: Key generation, timing-safe verification, payload normalization, flexible field mapping, attribution extraction.
 * 2. Webhook Authentication: Header 'x-api-key', 'Authorization: Bearer', '?api_key=' query param, body key.
 * 3. Security Rejection: Missing or invalid API key returns HTTP 401.
 * 4. Tenant Isolation: Server-side resolution via key hash; Tenant B cannot see Tenant A's leads.
 * 5. Account Lifecycle: Suspended account or disabled integration returns HTTP 403.
 * 6. Lead Creation & Attribution: Fields mapped to CRM schema; utm_source, gclid, custom parameters preserved.
 * 7. Idempotency & Deduplication: Repeated delivery with same idempotency_key returns HTTP 200 without duplicate CRM leads.
 * 8. Duplicate Handling Policy: duplicateHandling="update" merges into existing lead; duplicateHandling="reject" returns HTTP 409.
 * 9. Key Rotation: Rotating key immediately revokes old key and authorizes new key.
 * 10. Data Safety: Secrets and key hashes excluded from serialized outputs.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const Lead = require("../models/Lead")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Account = require("../models/Account")
const User = require("../models/User")
const genericConnectorService = require("../services/genericConnectorService")
const genericConnectorController = require("../controllers/genericConnectorController")

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
 * Helper to dispatch simulated HTTP requests directly through handleGenericWebhook controller
 */
async function callWebhook(body = {}, headers = {}, query = {}) {
  let statusCode = 200
  let responseData = {}

  const req = {
    body,
    headers,
    query,
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

  await genericConnectorController.handleGenericWebhook(req, res)
  return { status: statusCode, statusCode, ...responseData }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 24: GENERIC CONNECTOR (ZAPIER, MAKE, N8N, PABBLY) VERIFICATION ===")
  console.log("================================================================================")

  console.log("\n--- PART 1: Static Source & Normalization Invariant Tests ---")

  // 1. Key generation format & entropy
  const keyObj = genericConnectorService.generateGenericApiKey()
  assertStatic(
    keyObj.rawKey && keyObj.rawKey.startsWith("gen_live_") && keyObj.rawKey.length >= 40,
    "generateGenericApiKey produces a high-entropy key prefixed with 'gen_live_'"
  )
  assertStatic(
    keyObj.keyHash && keyObj.keyHash === crypto.createHash("sha256").update(keyObj.rawKey).digest("hex"),
    "generateGenericApiKey computes correct SHA-256 keyHash"
  )
  assertStatic(
    keyObj.maskedKey && keyObj.maskedKey.startsWith("gen_live_") && keyObj.maskedKey.includes("••••"),
    "generateGenericApiKey generates properly masked key representation for safe UI display"
  )

  // 2. Timing-safe verification
  const testKey = "gen_live_testkey1234567890abcdef1234567890"
  assertStatic(
    genericConnectorService.verifyGenericApiKey(testKey, testKey) === true,
    "verifyGenericApiKey returns true for identical keys"
  )
  assertStatic(
    genericConnectorService.verifyGenericApiKey(testKey, testKey + "_wrong") === false,
    "verifyGenericApiKey rejects mismatching keys"
  )
  assertStatic(
    genericConnectorService.verifyGenericApiKey(null, testKey) === false &&
    genericConnectorService.verifyGenericApiKey(testKey, "") === false,
    "verifyGenericApiKey rejects null/empty inputs safely without exceptions"
  )

  // 3. Flexible Name Normalization
  const norm1 = genericConnectorService.normalizeGenericPayload({ name: "Amitabh Bachchan" })
  assertStatic(norm1.name === "Amitabh Bachchan", "normalizeGenericPayload maps direct 'name'")

  const norm2 = genericConnectorService.normalizeGenericPayload({ first_name: "Rahul", last_name: "Dravid" })
  assertStatic(norm2.name === "Rahul Dravid", "normalizeGenericPayload concatenates 'first_name' and 'last_name'")

  const norm3 = genericConnectorService.normalizeGenericPayload({ fullName: "Sachin Tendulkar" })
  assertStatic(norm3.name === "Sachin Tendulkar", "normalizeGenericPayload maps 'fullName'")

  // 4. Flexible Contact Normalization
  const normContact = genericConnectorService.normalizeGenericPayload({
    work_email: "sachin@bcci.tv",
    mobile_number: "+91 98222 11111",
    company_name: "Cricket Club of India",
    location: "Mumbai",
  })
  assertStatic(normContact.email === "sachin@bcci.tv", "normalizeGenericPayload maps 'work_email'")
  assertStatic(normContact.phone === "+91 98222 11111", "normalizeGenericPayload maps 'mobile_number'")
  assertStatic(normContact.company === "Cricket Club of India", "normalizeGenericPayload maps 'company_name'")
  assertStatic(normContact.city === "Mumbai", "normalizeGenericPayload maps 'location'")

  // 5. Attribution & Idempotency Key Extraction
  const normAttr = genericConnectorService.normalizeGenericPayload({
    name: "Virat Kohli",
    email: "virat@rcb.in",
    source: "Facebook Lead Ads",
    utm_source: "fb_lead_form",
    utm_medium: "cpc",
    utm_campaign: "ipl_surge_q2",
    gclid: "GCLID_ZAPIER_999",
    event_id: "evt_zapier_12345",
  })
  assertStatic(normAttr.source === "Facebook Lead Ads", "normalizeGenericPayload maps incoming 'source'")
  assertStatic(normAttr.utm_source === "fb_lead_form", "normalizeGenericPayload maps 'utm_source'")
  assertStatic(normAttr.gclid === "GCLID_ZAPIER_999", "normalizeGenericPayload maps 'gclid'")
  assertStatic(normAttr.idempotencyKey === "evt_zapier_12345", "normalizeGenericPayload extracts 'event_id' as idempotencyKey")

  // 6. Custom / Unexpected fields handling
  const normCustom = genericConnectorService.normalizeGenericPayload({
    name: "Sunil Chhetri",
    email: "sunil@bengaluru.fc",
    budget: "50 Lakhs",
    preferred_call_time: "Morning 10 AM",
  })
  assertStatic(
    normCustom.customFields.budget === "50 Lakhs" &&
    normCustom.message.includes("budget: 50 Lakhs") &&
    normCustom.message.includes("preferred_call_time: Morning 10 AM"),
    "normalizeGenericPayload preserves extra/custom fields in customFields and message summary"
  )

  // 7. Field Mapping Configuration
  const customMappings = [
    { sourceField: "contact_person", targetField: "name", transform: "trim" },
    { sourceField: "contact_mail", targetField: "email", transform: "lowercase" },
  ]
  const normMapped = genericConnectorService.normalizeGenericPayload(
    { contact_person: "  Anil Kumble  ", contact_mail: "ANIL@KUMBLE.ORG" },
    customMappings
  )
  assertStatic(normMapped.name === "Anil Kumble", "normalizeGenericPayload applies custom source-to-target field mapping with trim")
  assertStatic(normMapped.email === "anil@kumble.org", "normalizeGenericPayload applies custom field mapping with lowercase transform")

  console.log("\n--- PART 2: Behavioral Integration & Tenant Security Tests ---")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)

  const tenantA = `tenant_generic_a_${Date.now()}`
  const tenantB = `tenant_generic_b_${Date.now()}`

  try {
    // Setup Account records
    await Account.create([
      {
        accountId: tenantA,
        companyName: "Tenant A Automation",
        displayName: "Tenant A",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin A",
        adminEmail: "admin@tenant-a-gen.com",
        status: "active",
      },
      {
        accountId: tenantB,
        companyName: "Tenant B Automation",
        displayName: "Tenant B",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin B",
        adminEmail: "admin@tenant-b-gen.com",
        status: "active",
      },
    ])

    // Generate keys
    const keyDataA = genericConnectorService.generateGenericApiKey()
    const keyDataB = genericConnectorService.generateGenericApiKey()

    // Create Tenant A Generic Integration
    const integrationA = new Integration({
      tenantId: tenantA,
      type: "generic",
      name: "Generic Connector - Tenant A",
      status: "active",
      apiKeyHash: keyDataA.keyHash,
      apiKeyMasked: keyDataA.maskedKey,
      settings: {
        duplicateHandling: "update",
      },
      stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 },
    })
    integrationA.setCredentials({ apiKey: keyDataA.rawKey, apiKeyMasked: keyDataA.maskedKey })
    await integrationA.save()

    // Create Tenant B Generic Integration (duplicateHandling: "reject")
    const integrationB = new Integration({
      tenantId: tenantB,
      type: "generic",
      name: "Generic Connector - Tenant B",
      status: "active",
      apiKeyHash: keyDataB.keyHash,
      apiKeyMasked: keyDataB.maskedKey,
      settings: {
        duplicateHandling: "reject",
      },
      stats: { totalReceived: 0, totalSuccess: 0, totalErrors: 0 },
    })
    integrationB.setCredentials({ apiKey: keyDataB.rawKey, apiKeyMasked: keyDataB.maskedKey })
    await integrationB.save()

    // Test 1: Missing API key fails with 401
    const resMissingKey = await callWebhook({
      name: "No Key Lead",
      email: "test@nokey.com",
    })
    assertBehavioral(
      resMissingKey.statusCode === 401 && resMissingKey.error?.includes("Missing API key"),
      "Webhook intake rejects missing API key with HTTP 401"
    )

    // Test 2: Invalid API key fails with 401
    const resInvalidKey = await callWebhook(
      { name: "Bad Key Lead", email: "test@badkey.com" },
      { "x-api-key": "gen_live_invalid_key_hash_not_found" }
    )
    assertBehavioral(
      resInvalidKey.statusCode === 401 && resInvalidKey.error?.includes("Invalid or revoked"),
      "Webhook intake rejects invalid API key with HTTP 401"
    )

    // Test 3: Valid x-api-key header ingests lead into Tenant A
    const leadEmailA = `deepak_${Date.now()}@automation-test.in`
    const evtIdA = `evt_zap_${Date.now()}`
    const resValidHeader = await callWebhook(
      {
        first_name: "Deepak",
        last_name: "Chopra",
        email: leadEmailA,
        phone: "+91 98333 44455",
        company: "Chopra MedTech",
        city: "Bengaluru",
        source: "Zapier",
        utm_source: "linkedin_leads",
        idempotency_key: evtIdA,
      },
      { "x-api-key": keyDataA.rawKey }
    )

    assertBehavioral(
      resValidHeader.statusCode === 200 && resValidHeader.success === true,
      "Webhook intake accepts valid lead via 'x-api-key' header with HTTP 200"
    )

    const createdLeadA = await Lead.findById(resValidHeader.leadId).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      createdLeadA && createdLeadA.tenantId === tenantA,
      "Ingested lead is strictly isolated to Tenant A"
    )
    assertBehavioral(
      createdLeadA && createdLeadA.name === "Deepak Chopra" && createdLeadA.source === "Zapier",
      "Lead fields (name concatenation, source) correctly saved to CRM model"
    )

    // Test 4: Tenant isolation: Tenant B's workspace does NOT contain Tenant A's lead
    const crossTenantLeadCheck = await Lead.findOne({ tenantId: tenantB, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      crossTenantLeadCheck === null,
      "Tenant B cannot view or access Tenant A's lead (tenant isolation verified)"
    )

    // Test 5: Authorization: Bearer header authentication
    const leadEmailBearer = `bearer_${Date.now()}@auth-test.in`
    const resBearer = await callWebhook(
      {
        name: "Pooja Hegde",
        email: leadEmailBearer,
        phone: "+91 97777 66655",
        source: "Make.com",
      },
      { authorization: `Bearer ${keyDataA.rawKey}` }
    )
    assertBehavioral(
      resBearer.statusCode === 200 && resBearer.success === true,
      "Webhook intake accepts authentication via 'Authorization: Bearer <key>'"
    )

    // Test 6: Query Parameter authentication (?api_key=...)
    const leadEmailQuery = `query_${Date.now()}@query-test.in`
    const resQuery = await callWebhook(
      {
        name: "Karan Johar",
        email: leadEmailQuery,
        phone: "+91 96666 55544",
        source: "n8n",
      },
      {},
      { api_key: keyDataA.rawKey }
    )
    assertBehavioral(
      resQuery.statusCode === 200 && resQuery.success === true,
      "Webhook intake accepts authentication via '?api_key=' query parameter"
    )

    // Test 7: Idempotency deduplication on idempotency_key
    const resDuplicateEvt = await callWebhook(
      {
        name: "Deepak Chopra",
        email: leadEmailA,
        phone: "+91 98333 44455",
        idempotency_key: evtIdA,
      },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resDuplicateEvt.statusCode === 200 && resDuplicateEvt.idempotent === true,
      "Submitting duplicate idempotency_key returns HTTP 200 with idempotent acknowledgment"
    )
    const countAfterIdempotent = await Lead.countDocuments({ tenantId: tenantA, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      countAfterIdempotent === 1,
      "Idempotent retry did not create duplicate Lead document in CRM"
    )

    // Test 8: Duplicate Handling Policy: duplicateHandling="update" merges into existing lead
    const resRepeatUpdate = await callWebhook(
      {
        name: "Deepak Chopra",
        email: leadEmailA,
        phone: "+91 98333 44455",
        message: "Second inquiry: Urgent follow-up required",
        utm_campaign: "retargeting_campaign",
      },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resRepeatUpdate.statusCode === 200 && resRepeatUpdate.action === "merged",
      "Repeat submission with duplicateHandling='update' merges into existing lead record"
    )
    const countAfterMerge = await Lead.countDocuments({ tenantId: tenantA, email: leadEmailA }).setOptions({ skipTenantFilter: true })
    assertBehavioral(
      countAfterMerge === 1,
      "Merge policy preserved single unified Lead document without duplicates"
    )

    // Test 9: Duplicate Handling Policy: duplicateHandling="reject" rejects duplicate with 409
    const leadEmailB = `client_b_${Date.now()}@reject-test.in`
    const resFirstB = await callWebhook(
      {
        name: "Client Beta",
        email: leadEmailB,
        phone: "+91 95555 44433",
        source: "Pabbly",
      },
      { "x-api-key": keyDataB.rawKey }
    )
    assertBehavioral(
      resFirstB.statusCode === 200 && resFirstB.success === true,
      "First submission in Tenant B succeeds with HTTP 200"
    )

    const resRepeatB = await callWebhook(
      {
        name: "Client Beta Repeat",
        email: leadEmailB,
        phone: "+91 95555 44433",
        source: "Pabbly",
      },
      { "x-api-key": keyDataB.rawKey }
    )
    assertBehavioral(
      resRepeatB.statusCode === 409 && resRepeatB.duplicate === true,
      "Repeat submission with duplicateHandling='reject' is rejected with HTTP 409 Conflict"
    )

    // Test 10: Submission lacking both email and phone rejected with 400
    const resNoContact = await callWebhook(
      {
        name: "Ghost Automation Lead",
        company: "Nameless Corp",
      },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resNoContact.statusCode === 400 && (resNoContact.error?.includes("email") || resNoContact.error?.includes("phone")),
      "Submission lacking both email and phone is rejected with HTTP 400 Bad Request"
    )

    // Test 11: Inactive integration rejected with 403
    await Integration.updateOne({ _id: integrationA._id }, { status: "inactive" })
    const resDisabled = await callWebhook(
      { name: "Inactive Lead", email: "test@inactive.com" },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resDisabled.statusCode === 403 && resDisabled.error?.includes("disabled"),
      "Inactive integration rejects incoming leads with HTTP 403 Forbidden"
    )
    await Integration.updateOne({ _id: integrationA._id }, { status: "active" })

    // Test 12: Suspended account rejected with 403
    await Account.updateOne({ accountId: tenantA }, { status: "suspended" })
    const resSuspended = await callWebhook(
      { name: "Suspended Lead", email: "test@suspended.com" },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resSuspended.statusCode === 403 && resSuspended.error?.includes("suspended"),
      "Suspended tenant account rejects incoming leads with HTTP 403 Forbidden"
    )
    await Account.updateOne({ accountId: tenantA }, { status: "active" })

    // Test 13: Key Rotation
    const { rawKey: newKeyA } = await genericConnectorService.rotateGenericApiKey(tenantA)
    assertBehavioral(
      newKeyA && newKeyA.startsWith("gen_live_") && newKeyA !== keyDataA.rawKey,
      "rotateGenericApiKey produces a distinct new high-entropy key"
    )

    // Old key must now fail with 401
    const resOldKeyAfterRotate = await callWebhook(
      { name: "Old Key Lead", email: "test@oldkey.com" },
      { "x-api-key": keyDataA.rawKey }
    )
    assertBehavioral(
      resOldKeyAfterRotate.statusCode === 401,
      "Previous Generic Connector API key is immediately invalidated after rotation"
    )

    // New key succeeds with 200
    const resNewKeyAfterRotate = await callWebhook(
      {
        name: "New Key Lead",
        email: `newkey_${Date.now()}@automation.in`,
        phone: "+91 94444 33322",
      },
      { "x-api-key": newKeyA }
    )
    assertBehavioral(
      resNewKeyAfterRotate.statusCode === 200,
      "New rotated key successfully authenticates and ingests leads with HTTP 200"
    )

    // Test 14: Data Safety: Serialized Integration JSON does NOT leak raw key hash or encrypted credentials
    const foundIntg = await Integration.findOne({ tenantId: tenantA }).setOptions({ skipTenantFilter: true })
    const intgJson = foundIntg.toJSON()
    assertBehavioral(
      intgJson.apiKeyHash === undefined &&
      intgJson.credentials === undefined &&
      intgJson.apiKeyMasked.includes("••••"),
      "Integration JSON serialization omits apiKeyHash and credentials, exposing only masked key"
    )

  } finally {
    // Cleanup test artifacts
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log("=== PHASE 24 VERIFICATION SUMMARY ===")
  console.log("================================================================================")
  console.log(`Static Tests:     ${staticPassed} PASSED, ${staticFailed} FAILED`)
  console.log(`Behavioral Tests: ${behavioralPassed} PASSED, ${behavioralFailed} FAILED`)
  console.log(`Total:            ${staticPassed + behavioralPassed} PASSED, ${staticFailed + behavioralFailed} FAILED`)

  if (staticFailed > 0 || behavioralFailed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Phase 24 verification suite fatal error:", err)
  process.exit(1)
})
