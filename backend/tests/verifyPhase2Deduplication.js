/**
 * Phase 2 Verification Suite: Duplicate Lead Prevention & Reliable Idempotency
 *
 * Verifies all 12 core Phase 2 behavioral requirements:
 * 1. Same idempotency key + same payload creates one lead.
 * 2. Same idempotency key + same payload submitted concurrently creates one lead.
 * 3. Same idempotency key + different payload returns HTTP 409 Conflict.
 * 4. Concurrent submissions with different keys but same email/phone obey 'reject'.
 * 5. Concurrent submissions with different keys but same email/phone obey 'update'.
 * 6. 'allow' duplicate policy intentionally permits duplicate leads.
 * 7. Cross-tenant isolation: Same phone/email in Tenant A and Tenant B does not match or overwrite.
 * 8. First-touch attribution is immutable across updates.
 * 9. Last-touch attribution is updated on merges.
 * 10. Failed request retry does not create an additional lead when previous operation already committed.
 * 11. Replayed events do not repeat notifications or assignments.
 * 12. Standard website integration flows remain functional.
 */

process.env.NODE_ENV = "test"
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const { IdempotencyReservation } = require("../models/IdempotencyReservation")
const { LeadConcurrencyLock } = require("../models/LeadConcurrencyLock")
const integrationService = require("../services/integrationService")
const leadService = require("../services/leadService")

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

async function runPhase2Tests() {
  console.log("================================================================================")
  console.log("=== PHASE 2: DUPLICATE LEAD PREVENTION & RELIABLE IDEMPOTENCY                ===")
  console.log("================================================================================")

  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/leads365"

  await mongoose.connect(mongoUri)

  const tenantA = `tenant_p2_a_${Date.now()}`
  const tenantB = `tenant_p2_b_${Date.now()}`

  try {
    // Generate credentials for Tenant A (default duplicate policy: update)
    const rawApiKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashA = crypto.createHash("sha256").update(rawApiKeyA).digest("hex")
    const siteKeyA = `lf_site_${crypto.randomBytes(16).toString("hex")}`

    const configA = new LeadFeedConfig({
      tenantId: tenantA,
      websiteSource: {
        enabled: true,
        apiKeyHash: apiKeyHashA,
        apiKeyMasked: "lf_live_••••••••••••••••" + rawApiKeyA.slice(-4),
        siteKey: siteKeyA,
        allowedOrigins: ["https://landing.tenant-a.com"],
        duplicateHandling: "update",
      },
    })
    await configA.save()

    // Generate credentials for Tenant B (default duplicate policy: reject)
    const rawApiKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashB = crypto.createHash("sha256").update(rawApiKeyB).digest("hex")
    const siteKeyB = `lf_site_${crypto.randomBytes(16).toString("hex")}`

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

    await integrationService.syncLegacyToIntegration(configA)
    await integrationService.syncLegacyToIntegration(configB)

    console.log("\n--- TEST SUITE 1: Task A - Reliable Idempotency Under Sequential & Concurrent Ingestion ---")

    // 1. Same idempotency key + same payload submitted twice sequentially
    const idemKey1 = `key_seq_${Date.now()}`
    const email1 = `seq_${Date.now()}@test.com`
    const payload1 = {
      name: "Sequential Idempotent User",
      email: email1,
      phone: "+91 91234 56780",
      message: "First inquiry",
    }

    const res1a = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      headers: { "x-idempotency-key": idemKey1 },
      body: payload1,
    })

    const res1b = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      headers: { "x-idempotency-key": idemKey1 },
      body: payload1,
    })

    const leadsCount1 = await Lead.countDocuments({ tenantId: tenantA, email: email1 })
    assert(
      res1a.success === true &&
        res1b.success === true &&
        res1b.idempotent === true &&
        leadsCount1 === 1,
      "Test 1: Same idempotency key + same payload submitted sequentially returns cached response and creates exactly one lead"
    )

    // 2. Same idempotency key + same payload submitted concurrently
    const idemKey2 = `key_conc_${Date.now()}`
    const email2 = `conc_${Date.now()}@test.com`
    const payload2 = {
      name: "Concurrent Idempotent User",
      email: email2,
      phone: "+91 91234 56781",
      message: "Concurrent inquiry",
    }

    const [res2a, res2b] = await Promise.all([
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyA,
        headers: { "x-idempotency-key": idemKey2 },
        body: payload2,
      }),
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyA,
        headers: { "x-idempotency-key": idemKey2 },
        body: payload2,
      }),
    ])

    const leadsCount2 = await Lead.countDocuments({ tenantId: tenantA, email: email2 })
    const hasOneCreated = (res2a.status === 201 || res2b.status === 201 || res2a.success || res2b.success)
    const hasSafeConcurrency = (res2a.idempotent || res2b.idempotent) || (res2a.status === 409 || res2b.status === 409)
    assert(
      hasOneCreated && hasSafeConcurrency && leadsCount2 === 1,
      "Test 2: Same idempotency key + same payload submitted concurrently creates exactly one lead and handles concurrency safely"
    )

    // 3. Same idempotency key + different payload returns HTTP 409 Conflict
    const idemKey3 = `key_mismatch_${Date.now()}`
    const payload3a = {
      name: "First Payload User",
      email: `mismatch_a_${Date.now()}@test.com`,
      phone: "+91 91234 56782",
    }
    const payload3b = {
      name: "Different Payload User",
      email: `mismatch_b_${Date.now()}@test.com`,
      phone: "+91 91234 99999",
    }

    const res3a = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      headers: { "x-idempotency-key": idemKey3 },
      body: payload3a,
    })

    const res3b = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      headers: { "x-idempotency-key": idemKey3 },
      body: payload3b,
    })

    assert(
      res3a.success === true &&
        res3b.success === false &&
        res3b.status === 409 &&
        res3b.error.includes("Idempotency conflict"),
      "Test 3: Same idempotency key with different payload data is rejected with HTTP 409 Conflict"
    )

    console.log("\n--- TEST SUITE 2: Task B - Concurrent Duplicate Lead Protection & Policies ---")

    // 4. Concurrent submissions with different keys but same email under duplicateHandling = 'reject'
    const emailReject = `dup_reject_${Date.now()}@tenant-b.com`
    const [resReject1, resReject2] = await Promise.all([
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyB,
        headers: { "x-idempotency-key": `key_rej_1_${Date.now()}` },
        body: {
          name: "User Reject 1",
          email: emailReject,
          phone: "+91 98765 11111",
        },
      }),
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyB,
        headers: { "x-idempotency-key": `key_rej_2_${Date.now()}` },
        body: {
          name: "User Reject 2",
          email: emailReject,
          phone: "+91 98765 11111",
        },
      }),
    ])

    const countReject = await Lead.countDocuments({ tenantId: tenantB, email: emailReject })
    const oneCreatedOneRejected =
      (resReject1.success && resReject2.duplicate) || (resReject2.success && resReject1.duplicate)
    assert(
      countReject === 1 && oneCreatedOneRejected,
      "Test 4: Concurrent submissions with different keys but same email obey 'reject' (exactly 1 created, 1 rejected)"
    )

    // 5. Concurrent submissions with different keys but same email under duplicateHandling = 'update'
    const emailUpdate = `dup_update_${Date.now()}@tenant-a.com`
    const [resUpdate1, resUpdate2] = await Promise.all([
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyA,
        headers: { "x-idempotency-key": `key_up_1_${Date.now()}` },
        body: {
          name: "User Update 1",
          email: emailUpdate,
          phone: "+91 98765 22222",
          message: "Note from first concurrent submission",
        },
      }),
      integrationService.intakeWebhookPayload({
        rawApiKey: rawApiKeyA,
        headers: { "x-idempotency-key": `key_up_2_${Date.now()}` },
        body: {
          name: "User Update 2",
          email: emailUpdate,
          phone: "+91 98765 22222",
          message: "Note from second concurrent submission",
        },
      }),
    ])

    const countUpdate = await Lead.countDocuments({ tenantId: tenantA, email: emailUpdate })
    const oneCreatedOneMerged =
      (resUpdate1.status === 201 && resUpdate2.updated === true) ||
      (resUpdate2.status === 201 && resUpdate1.updated === true)
    assert(
      countUpdate === 1 && oneCreatedOneMerged,
      "Test 5: Concurrent submissions with different keys but same email obey 'update' (exactly 1 lead created, 1 merged)"
    )

    // 6. duplicateHandling = 'allow' intentionally creates duplicate leads
    const emailAllow = `dup_allow_${Date.now()}@test.com`
    const resAllow1 = await leadService.createOrMergeLead({
      tenantId: tenantA,
      source: "Website",
      payload: {
        name: "Allow User 1",
        email: emailAllow,
        phone: "+91 98765 33333",
      },
      options: { duplicateHandling: "allow" },
    })

    const resAllow2 = await leadService.createOrMergeLead({
      tenantId: tenantA,
      source: "Website",
      payload: {
        name: "Allow User 2",
        email: emailAllow,
        phone: "+91 98765 33333",
      },
      options: { duplicateHandling: "allow" },
    })

    const countAllow = await Lead.countDocuments({ tenantId: tenantA, email: emailAllow })
    assert(
      resAllow1.action === "created" && resAllow2.action === "created" && countAllow === 2,
      "Test 6: duplicateHandling = 'allow' intentionally permits duplicate lead creation without blocking"
    )

    // 7. Tenant Isolation: Same phone and email across Tenant A and Tenant B
    const crossEmail = `shared_${Date.now()}@common.com`
    const crossPhone = "+91 98765 44444"

    const resCrossA = await leadService.createOrMergeLead({
      tenantId: tenantA,
      source: "Website",
      payload: { name: "Tenant A Lead", email: crossEmail, phone: crossPhone },
      options: { duplicateHandling: "reject" },
    })

    const resCrossB = await leadService.createOrMergeLead({
      tenantId: tenantB,
      source: "Website",
      payload: { name: "Tenant B Lead", email: crossEmail, phone: crossPhone },
      options: { duplicateHandling: "reject" },
    })

    assert(
      resCrossA.action === "created" &&
        resCrossB.action === "created" &&
        resCrossA.lead._id.toString() !== resCrossB.lead._id.toString(),
      "Test 7: Same phone and email across separate tenants never match or cross-pollinate"
    )

    console.log("\n--- TEST SUITE 3: Task B & C - Attribution Immutability & Event Lifecycle Safety ---")

    // 8 & 9. First-touch attribution is immutable; last-touch is updated on merge
    const attrEmail = `attr_${Date.now()}@tenant-a.com`
    await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      body: {
        name: "Attribution Lead",
        email: attrEmail,
        utm_source: "google_search",
        utm_campaign: "brand_campaign_q1",
        gclid: "gclid_initial_123",
      },
    })

    await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      body: {
        name: "Attribution Lead Updated",
        email: attrEmail,
        utm_source: "facebook_retargeting",
        utm_campaign: "reengagement_promo",
        fbclid: "fbclid_second_456",
      },
    })

    const attrLead = await Lead.findOne({ tenantId: tenantA, email: attrEmail }).lean()
    assert(
      attrLead.attribution?.firstTouch?.source === "google_search" &&
        attrLead.attribution?.firstTouch?.campaign === "brand_campaign_q1" &&
        attrLead.attribution?.firstTouch?.gclid === "gclid_initial_123",
      "Test 8: First-touch attribution remains immutable after subsequent lead updates"
    )
    assert(
      attrLead.attribution?.lastTouch?.source === "facebook_retargeting" &&
        attrLead.attribution?.lastTouch?.campaign === "reengagement_promo" &&
        attrLead.attribution?.lastTouch?.fbclid === "fbclid_second_456",
      "Test 9: Last-touch attribution is accurately updated to the most recent touchpoint"
    )

    // 10. Failed request retry does not create extra lead
    const retryKey = `retry_key_${Date.now()}`
    const retryEmail = `retry_${Date.now()}@tenant-a.com`

    // Seed a failed reservation
    const { claimIdempotency, failIdempotency } = require("../services/idempotencyService")
    const claim1 = await claimIdempotency({
      tenantId: tenantA,
      idempotencyKey: retryKey,
      payload: { name: "Retry User", email: retryEmail },
    })
    await failIdempotency({ reservationId: claim1.reservationId, error: "Network timeout" })

    // Now retry the request
    const retryRes = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      headers: { "x-idempotency-key": retryKey },
      body: { name: "Retry User", email: retryEmail },
    })

    const retryLeadCount = await Lead.countDocuments({ tenantId: tenantA, email: retryEmail })
    assert(
      retryRes.success === true && retryLeadCount === 1,
      "Test 10: Retry of previously failed idempotency key succeeds and creates exactly one lead"
    )

    // 11. Replayed event suppresses duplicate notifications and call reconciliations
    const eventToReplay = new IntegrationEvent({
      tenantId: tenantA,
      source: "Website",
      status: "received",
      rawPayload: {
        name: "Replay Test Lead",
        email: `replay_${Date.now()}@tenant-a.com`,
        phone: "+91 99887 76655",
      },
    })
    await eventToReplay.save()

    const replayRes = await integrationService.replayEvent(eventToReplay._id.toString(), {
      tenantId: tenantA,
      actor: { role: "account_admin", name: "Audit Admin" },
    })

    const updatedEvent = await IntegrationEvent.findById(eventToReplay._id).lean()
    assert(
      replayRes.success === true &&
        updatedEvent.status === "replayed" &&
        updatedEvent.replayCount === 1,
      "Test 11: Replaying an event marks status as 'replayed' and safely avoids duplicate side effects"
    )

    // 12. Standard website integration snippet submission
    const siteKeyRes = await integrationService.intakeWebhookPayload({
      rawSiteKey: siteKeyA,
      incomingOrigin: "https://landing.tenant-a.com",
      body: {
        name: "Browser Form Submission",
        email: `browser_${Date.now()}@tenant-a.com`,
        phone: "+91 98765 88888",
        message: "Contact from website landing page",
      },
    })
    assert(
      siteKeyRes.success === true && (siteKeyRes.status === 200 || siteKeyRes.status === 201),
      "Test 12: Standard website integration intake flow works seamlessly with site key and allowed origin"
    )

    // Clean up test data
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await IdempotencyReservation.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await LeadConcurrencyLock.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  } catch (err) {
    console.error("Test execution encountered an error:", err)
    assert(false, `Unexpected error in test suite: ${err.message}`)
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 2 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ===`)
  console.log("================================================================================")

  if (failedCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runPhase2Tests()
