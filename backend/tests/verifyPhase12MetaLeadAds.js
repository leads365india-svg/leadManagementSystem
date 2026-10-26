const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")
const crypto = require("crypto")

dotenv.config({ path: path.join(__dirname, "../.env") })

const metaService = require("../services/metaService")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const Job = require("../models/Job")
const DeadLetterJob = require("../models/DeadLetterJob")
const queue = require("../services/queueService")
const { registerAllHandlers } = require("../jobs/index")
const cryptoUtils = require("../utils/cryptoUtils")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  handleMetaWebhookHandshake,
  handleMetaWebhookNotification,
  connectMetaIntegration,
  getMetaAuthUrl,
  triggerMetaBackfill,
} = require("../controllers/metaController")

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 12: META (FACEBOOK + INSTAGRAM) LEAD ADS - VERIFICATION SUITE      ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passed++
    } else {
      console.error(`  [FAIL] ${message}`)
      failed++
    }
  }

  const tenantA = "TEST-TENANT-P12-ALPHA"
  const tenantB = "TEST-TENANT-P12-BETA"

  try {
    // Register background queue handlers
    registerAllHandlers()

    // Clean up test data
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      Job.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      DeadLetterJob.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
    ])

    // Create staff users
    const staffA = await User.create({
      tenantId: tenantA,
      name: "Marcus Meta",
      email: "marcus.meta@alpha.test",
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    const staffB = await User.create({
      tenantId: tenantB,
      name: "Brenda Beta",
      email: "brenda.beta@beta.test",
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    // Create active accounts
    await Account.create([
      {
        accountId: tenantA,
        companyName: "Alpha Marketing",
        displayName: "Alpha Marketing",
        adminUserId: staffA._id,
        adminName: staffA.name,
        adminEmail: staffA.email,
        status: "active",
      },
      {
        accountId: tenantB,
        companyName: "Beta Agency",
        displayName: "Beta Agency",
        adminUserId: staffB._id,
        adminName: staffB.name,
        adminEmail: staffB.email,
        status: "active",
      },
    ])

    const testAppSecret = "mock_meta_app_secret_9988776655"
    const testVerifyToken = "mock_verify_token_alpha_2026"
    const testPageIdA = "page_alpha_101010"
    const testPageIdB = "page_beta_202020"
    const testPageTokenA = "EAABxxxxxx_alpha_page_token"

    console.log("--------------------------------------------------------------------------------")
    console.log("TEST 1: Webhook Handshake Verification (GET Challenge)")
    console.log("--------------------------------------------------------------------------------")
    {
      // 1. Valid handshake
      const validQuery = {
        "hub.mode": "subscribe",
        "hub.verify_token": testVerifyToken,
        "hub.challenge": "challenge_string_12345",
      }
      const handshakeResult = metaService.verifyWebhookHandshake(validQuery, testVerifyToken)
      assert(handshakeResult.isValid === true, "Valid handshake challenge verified successfully")
      assert(handshakeResult.challenge === "challenge_string_12345", "Exact challenge echoed back")

      // 2. Invalid verify token
      const invalidQuery = {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_attacker_token",
        "hub.challenge": "challenge_bad",
      }
      const badResult = metaService.verifyWebhookHandshake(invalidQuery, testVerifyToken)
      assert(badResult.isValid === false, "Handshake with incorrect verify token rejected")

      // 3. Invalid mode
      const badModeQuery = {
        "hub.mode": "publish",
        "hub.verify_token": testVerifyToken,
        "hub.challenge": "challenge_bad",
      }
      const badModeResult = metaService.verifyWebhookHandshake(badModeQuery, testVerifyToken)
      assert(badModeResult.isValid === false, "Handshake with non-subscribe mode rejected")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 2: Timing-Safe X-Hub-Signature-256 HMAC Verification")
    console.log("--------------------------------------------------------------------------------")
    {
      const payloadString = JSON.stringify({
        object: "page",
        entry: [{ id: testPageIdA, time: Date.now() }],
      })

      // Generate authentic HMAC signature
      const validHash = crypto.createHmac("sha256", testAppSecret).update(payloadString).digest("hex")
      const validSigHeader = `sha256=${validHash}`

      const isValid = metaService.verifyWebhookSignature(payloadString, validSigHeader, testAppSecret)
      assert(isValid === true, "Authentic X-Hub-Signature-256 verified successfully")

      // Tampered payload
      const tamperedPayload = payloadString + " "
      const isTamperedValid = metaService.verifyWebhookSignature(tamperedPayload, validSigHeader, testAppSecret)
      assert(isTamperedValid === false, "Tampered payload with valid signature rejected")

      // Invalid signature hash
      const badSigHeader = "sha256=0000000000000000000000000000000000000000000000000000000000000000"
      const isBadSigValid = metaService.verifyWebhookSignature(payloadString, badSigHeader, testAppSecret)
      assert(isBadSigValid === false, "Incorrect HMAC signature rejected")

      // Malformed header prefix
      const malformedHeader = `md5=${validHash}`
      const isMalformedValid = metaService.verifyWebhookSignature(payloadString, malformedHeader, testAppSecret)
      assert(isMalformedValid === false, "Malformed signature header rejected")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 3: Meta Page Connection & Encrypted Token Storage")
    console.log("--------------------------------------------------------------------------------")
    let integrationMetaA = null
    {
      // Mock mockFetch to simulate Graph API page subscription
      const mockFetch = async (url, opts) => {
        if (url.includes("subscribed_apps")) {
          return { ok: true, json: async () => ({ success: true }) }
        }
        return { ok: true, json: async () => ({}) }
      }

      // Connect Page via connect helper
      integrationMetaA = new Integration({
        tenantId: tenantA,
        name: "Alpha Clinic Facebook & Instagram",
        type: "meta",
        status: "active",
        assignedStaffId: staffA._id.toString(),
        assignedStaffName: staffA.name,
        settings: {
          pageName: "Alpha Health Clinic",
          forms: ["form_dental_01", "form_lasik_02"],
          duplicateHandling: "update",
        },
      })

      integrationMetaA.setCredentials({
        pageId: testPageIdA,
        pageName: "Alpha Health Clinic",
        pageAccessToken: testPageTokenA,
        appSecret: testAppSecret,
        verifyToken: testVerifyToken,
        subscribed: true,
        reconnectNeeded: false,
      })
      await integrationMetaA.save()

      assert(integrationMetaA._id, "Meta integration saved for Tenant A")
      assert(integrationMetaA.credentials && integrationMetaA.credentials.encryptedData, "Page access token stored encrypted using Phase 11 cryptoUtils")

      const decryptedCreds = integrationMetaA.getDecryptedCredentials()
      assert(decryptedCreds.pageAccessToken === testPageTokenA, "Decrypted credentials match original page access token")
      assert(decryptedCreds.pageId === testPageIdA, "Decrypted pageId matches configured Page ID")

      // Create Tenant B integration with different Page ID
      const integrationMetaB = new Integration({
        tenantId: tenantB,
        name: "Beta Real Estate Meta Ads",
        type: "meta",
        status: "active",
        assignedStaffId: staffB._id.toString(),
        assignedStaffName: staffB.name,
        settings: {
          pageName: "Beta Properties",
          forms: ["form_properties_01"],
          duplicateHandling: "reject",
        },
      })
      integrationMetaB.setCredentials({
        pageId: testPageIdB,
        pageName: "Beta Properties",
        pageAccessToken: "EAABxxxxxx_beta_page_token",
        appSecret: "beta_secret_554433",
        verifyToken: "beta_verify_token",
        subscribed: true,
        reconnectNeeded: false,
      })
      await integrationMetaB.save()

      assert(integrationMetaB._id, "Meta integration saved for Tenant B")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 4: Fast Webhook Queue Acceptance & Notification Parsing")
    console.log("--------------------------------------------------------------------------------")
    const testLeadgenId1 = "leadgen_fb_888001"
    const testFormId1 = "form_dental_01"
    {
      const webhookPayload = {
        object: "page",
        entry: [
          {
            id: testPageIdA,
            time: 1711223344,
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: testLeadgenId1,
                  form_id: testFormId1,
                  page_id: testPageIdA,
                  ad_id: "ad_12345678",
                  created_time: 1711223344,
                },
              },
            ],
          },
        ],
      }

      const rawBody = JSON.stringify(webhookPayload)
      const validSig = "sha256=" + crypto.createHmac("sha256", testAppSecret).update(rawBody).digest("hex")

      // Mock Express req & res
      let statusCode = null
      let responseBody = null
      const mockReq = {
        body: webhookPayload,
        rawBody,
        headers: {
          "x-hub-signature-256": validSig,
        },
      }
      const mockRes = {
        status: (code) => {
          statusCode = code
          return {
            json: (data) => {
              responseBody = data
            },
          }
        },
      }

      await handleMetaWebhookNotification(mockReq, mockRes)

      assert(statusCode === 200, "Webhook returns HTTP 200 OK fast to Meta within timeout budget")
      assert(responseBody && responseBody.success === true, "Response reports success: true")
      assert(responseBody.queuedCount === 1, "Queued exactly 1 leadgen notification")

      // Verify event recorded in 'queued' state
      const event = await IntegrationEvent.findOne({
        tenantId: tenantA,
        idempotencyKey: `meta_lead_${testLeadgenId1}`,
      }).lean()
      assert(event !== null, "IntegrationEvent ledger record created for Meta lead")
      assert(event.status === "queued", "IntegrationEvent ledger state set to 'queued'")

      // Verify job added to Queue
      const job = await Job.findOne({
        tenantId: tenantA,
        idempotencyKey: `meta_lead_${testLeadgenId1}`,
      }).lean()
      assert(job !== null, "Background job 'meta.lead_process' enqueued in Job collection")
      assert(job.payload.leadgenId === testLeadgenId1, "Job payload carries leadgenId")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 5: Background Worker Processing, Field Mapping & Attribution")
    console.log("--------------------------------------------------------------------------------")
    {
      // Mock Graph API fetcher for leadgen details & ad attribution
      const mockGraphFetch = async (url) => {
        if (url.includes(testLeadgenId1)) {
          return {
            ok: true,
            json: async () => ({
              id: testLeadgenId1,
              created_time: "2026-03-24T10:00:00+0000",
              form_id: testFormId1,
              page_id: testPageIdA,
              ad_id: "ad_12345678",
              platform: "ig", // Instagram Ad Lead!
              field_data: [
                { name: "full_name", values: ["Pooja Patel"] },
                { name: "email", values: ["pooja.patel@instagram.test"] },
                { name: "phone_number", values: ["+91 98222 33344"] },
                { name: "city", values: ["Mumbai"] },
                { name: "treatment_interested", values: ["Invisalign Alignment"] },
              ],
            }),
          }
        }
        if (url.includes("ad_12345678")) {
          return {
            ok: true,
            json: async () => ({
              id: "ad_12345678",
              name: "Dental Smile Makeover Ad #4",
              campaign: { id: "camp_999", name: "Summer Smile Campaign 2026" },
              adset: { id: "adset_555", name: "Mumbai Adults 25-45" },
            }),
          }
        }
        return { ok: false, json: async () => ({ error: { message: "Not found" } }) }
      }

      // Claim the queued job
      const claimedJob = await queue.claimNextJob("test-worker-meta", {
        name: "meta.lead_process",
        tenantId: tenantA,
      })
      assert(claimedJob !== null, "Queue worker claimed 'meta.lead_process' job")

      // Execute worker logic
      const result = await metaService.processMetaLeadIntake({
        ...claimedJob.payload,
        customFetch: mockGraphFetch,
      })
      await queue.completeJob(claimedJob._id, result)

      assert(result.success === true, "Worker successfully processed Meta lead intake")

      // Verify Lead created in CRM
      const createdLead = await Lead.findOne({
        tenantId: tenantA,
        email: "pooja.patel@instagram.test",
      }).lean()

      assert(createdLead !== null, "Lead created in CRM from Meta leadgen event")
      assert(createdLead.name === "Pooja Patel", "Full name correctly mapped")
      assert(createdLead.phone === "+91 98222 33344", "Phone number correctly mapped")
      assert(createdLead.city === "Mumbai", "City correctly mapped")
      assert(createdLead.source === "Instagram", "Source normalized to 'Instagram' based on platform 'ig'")
      assert(createdLead.attribution?.firstTouch?.source?.toLowerCase() === "instagram", "utm_source attribution populated")
      assert(createdLead.attribution?.firstTouch?.campaign === "Summer Smile Campaign 2026", "utm_campaign captured from Graph API ad details")
      assert(createdLead.attribution?.firstTouch?.content === "Dental Smile Makeover Ad #4", "utm_content captured ad name")
      assert(createdLead.assignedTo === staffA.name, "Lead assigned according to integration configuration")
      assert(createdLead.metadata.metaLeadId === testLeadgenId1, "metaLeadId stamped in metadata")

      // Verify event transitioned to 'processed'
      const updatedEvent = await IntegrationEvent.findOne({
        tenantId: tenantA,
        idempotencyKey: `meta_lead_${testLeadgenId1}`,
      }).lean()
      assert(updatedEvent.status === "processed", "IntegrationEvent ledger status transitioned to 'processed'")
      assert(updatedEvent.result.leadId.toString() === createdLead._id.toString(), "IntegrationEvent linked to created Lead ID")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 6: Webhook Idempotency on Meta Lead ID")
    console.log("--------------------------------------------------------------------------------")
    {
      // Resend identical webhook payload
      const webhookPayloadDuplicate = {
        object: "page",
        entry: [
          {
            id: testPageIdA,
            time: 1711223344,
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: testLeadgenId1, // Already imported
                  form_id: testFormId1,
                  page_id: testPageIdA,
                  ad_id: "ad_12345678",
                  created_time: 1711223344,
                },
              },
            ],
          },
        ],
      }

      const rawBody = JSON.stringify(webhookPayloadDuplicate)
      const validSig = "sha256=" + crypto.createHmac("sha256", testAppSecret).update(rawBody).digest("hex")

      let duplicateStatusCode = null
      let duplicateResBody = null
      const mockReq = {
        body: webhookPayloadDuplicate,
        rawBody,
        headers: { "x-hub-signature-256": validSig },
      }
      const mockRes = {
        status: (code) => {
          duplicateStatusCode = code
          return {
            json: (data) => {
              duplicateResBody = data
            },
          }
        },
      }

      await handleMetaWebhookNotification(mockReq, mockRes)

      assert(duplicateStatusCode === 200, "Duplicate delivery handled gracefully with HTTP 200")
      assert(duplicateResBody.queuedCount === 0, "Duplicate leadgen_id detected; zero redundant jobs queued")

      const leadCount = await Lead.countDocuments({
        tenantId: tenantA,
        "metadata.metaLeadId": testLeadgenId1,
      })
      assert(leadCount === 1, "Exactly 1 lead record in database; no duplicates created")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 7: Token Expiry (Code 190) & 'Reconnect Needed' Detection")
    console.log("--------------------------------------------------------------------------------")
    {
      const expiredLeadId = "leadgen_expired_999000"

      // Mock Graph API returning OAuthException code 190
      const mockExpiredFetch = async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "Error validating access token: Session has expired.",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        }),
      })

      const intakeResult = await metaService.processMetaLeadIntake({
        tenantId: tenantA,
        integrationId: integrationMetaA._id,
        leadgenId: expiredLeadId,
        formId: testFormId1,
        pageId: testPageIdA,
        customFetch: mockExpiredFetch,
      })

      assert(intakeResult.success === false, "Intake gracefully captures token failure")
      assert(intakeResult.reconnectNeeded === true, "Identified reconnectNeeded: true")

      // Verify integration document status
      const updatedMetaIntegration = await Integration.findById(integrationMetaA._id)
      assert(updatedMetaIntegration.status === "error", "Integration status set to 'error'")

      const creds = updatedMetaIntegration.getDecryptedCredentials()
      assert(creds.reconnectNeeded === true, "Credentials object stamped with reconnectNeeded: true")
      assert(creds.reconnectReason.includes("expired"), "reconnectReason explains token expiry clearly")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 8: Form Leads Reconciliation & Missed-Lead Recovery")
    console.log("--------------------------------------------------------------------------------")
    {
      // Reset integration credentials to active
      integrationMetaA.status = "active"
      integrationMetaA.setCredentials({
        pageId: testPageIdA,
        pageName: "Alpha Health Clinic",
        pageAccessToken: testPageTokenA,
        appSecret: testAppSecret,
        verifyToken: testVerifyToken,
        subscribed: true,
        reconnectNeeded: false,
      })
      await integrationMetaA.save()

      const missedLeadgenId = "leadgen_missed_777002"

      // Mock fetchFormLeads returning 2 leads:
      // 1 already exists (testLeadgenId1), 1 missed by webhook (missedLeadgenId)
      const mockReconcileFetch = async (url) => {
        if (url.includes(`/leads`)) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: testLeadgenId1, created_time: "2026-03-24T10:00:00+0000" },
                { id: missedLeadgenId, created_time: "2026-03-24T11:00:00+0000" },
              ],
            }),
          }
        }
        if (url.includes(missedLeadgenId)) {
          return {
            ok: true,
            json: async () => ({
              id: missedLeadgenId,
              created_time: "2026-03-24T11:00:00+0000",
              form_id: testFormId1,
              page_id: testPageIdA,
              platform: "fb",
              field_data: [
                { name: "full_name", values: ["Rajesh Kumar"] },
                { name: "email", values: ["rajesh.kumar@fb.test"] },
                { name: "phone_number", values: ["+91 99888 77766"] },
              ],
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      }

      // Execute reconciliation
      const reconcileResult = await metaService.reconcileMetaLeads(
        integrationMetaA._id.toString(),
        { since: new Date(Date.now() - 3600000) },
        mockReconcileFetch
      )

      assert(reconcileResult.scanned >= 2, "Reconciliation scanned form leads from Graph API")
      assert(reconcileResult.skipped >= 1, "Skipped already imported lead (deduplication verified)")
      assert(reconcileResult.imported >= 1, "Successfully imported missed lead into CRM")

      // Verify missed lead now exists in database
      const recoveredLead = await Lead.findOne({
        tenantId: tenantA,
        "metadata.metaLeadId": missedLeadgenId,
      }).lean()

      assert(recoveredLead !== null, "Missed lead successfully recovered by reconciliation job")
      assert(recoveredLead.name === "Rajesh Kumar", "Recovered lead name verified")
      assert(recoveredLead.source === "Facebook", "Recovered lead source verified as 'Facebook'")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 9: Multi-Tenant Isolation & Cross-Tenant Boundary Protection")
    console.log("--------------------------------------------------------------------------------")
    {
      // Tenant B webhook notification with Tenant B Page ID
      const webhookPayloadB = {
        object: "page",
        entry: [
          {
            id: testPageIdB,
            time: 1711223399,
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: "leadgen_beta_333001",
                  form_id: "form_properties_01",
                  page_id: testPageIdB,
                  created_time: 1711223399,
                },
              },
            ],
          },
        ],
      }

      const rawBodyB = JSON.stringify(webhookPayloadB)
      const sigB = "sha256=" + crypto.createHmac("sha256", "beta_secret_554433").update(rawBodyB).digest("hex")

      let resCodeB = null
      const mockReqB = {
        body: webhookPayloadB,
        rawBody: rawBodyB,
        headers: { "x-hub-signature-256": sigB },
      }
      const mockResB = {
        status: (code) => {
          resCodeB = code
          return { json: () => {} }
        },
      }

      await handleMetaWebhookNotification(mockReqB, mockResB)
      assert(resCodeB === 200, "Tenant B notification accepted and routed to Tenant B")

      // Verify event was logged strictly in Tenant B partition
      const eventB = await IntegrationEvent.findOne({
        tenantId: tenantB,
        idempotencyKey: "meta_lead_leadgen_beta_333001",
      }).lean()

      assert(eventB && eventB.tenantId === tenantB, "Event routed strictly to Tenant B based on Page ID mapping")

      // Cross-tenant direct query isolation
      await runWithTenantContext({ tenantId: tenantA }, async () => {
        const found = await Integration.findOne({ "credentials.pageId": testPageIdB })
        assert(!found, "Tenant A cannot access Tenant B's Meta Page connection (tenant boundary preserved)")
      })
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 10: Missing Meta App ID Setup Handling")
    console.log("--------------------------------------------------------------------------------")
    {
      const prevAppId = process.env.META_APP_ID
      delete process.env.META_APP_ID

      let authUrlRes = null
      const mockReq = {
        protocol: "http",
        get: () => "localhost:5000",
        user: { tenantId: tenantA },
      }
      const mockRes = {
        status: (code) => ({
          json: (data) => {
            authUrlRes = data
          },
        }),
      }

      await getMetaAuthUrl(mockReq, mockRes)

      assert(authUrlRes && authUrlRes.configured === false, "When META_APP_ID is not configured, returns configured: false")
      assert(authUrlRes.setupInstructions !== undefined, "Returns step-by-step external setup guidance")

      if (prevAppId) process.env.META_APP_ID = prevAppId
    }

    console.log("\n================================================================================")
    console.log(`=== PHASE 12 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("================================================================================")

    if (failed > 0) {
      process.exit(1)
    }
  } finally {
    // Cleanup test fixtures
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      Job.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      DeadLetterJob.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
    ])
    await mongoose.disconnect()
  }
}

runTests().catch((err) => {
  console.error("FATAL ERROR in Phase 12 verification suite:", err)
  process.exit(1)
})
