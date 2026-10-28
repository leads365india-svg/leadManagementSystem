/**
 * Leads-365 — Phase 18: Do-Not-Record, Consent & Privacy Controls Verification Suite
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const { Readable } = require("stream")

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const DnrRule = require("../models/DnrRule")
const privacyService = require("../services/privacyService")
const recordingStorage = require("../services/recordingStorage")
const { issueRecordingTicket } = require("../services/mobileSyncService")

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

function createDummyAudioStream(sizeBytes = 1024 * 4) {
  const buffer = crypto.randomBytes(sizeBytes)
  const hash = crypto.createHash("sha256").update(buffer).digest("hex")
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return { stream, buffer, hash, sizeBytes }
}

async function runTests() {
  console.log("=".repeat(80))
  console.log("=== PHASE 18: DO-NOT-RECORD, CONSENT & PRIVACY CONTROLS SUITE ===")
  console.log("=".repeat(80))

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("Missing MONGODB_URI in environment")
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log("Connected to MongoDB Atlas\n")

  const tenantA = `TEST-P18-ALPHA-${Date.now()}`
  const tenantB = `TEST-P18-BETA-${Date.now()}`
  const agentAId = new mongoose.Types.ObjectId()
  const agentBId = new mongoose.Types.ObjectId()

  try {
    // 0. Setup test users and accounts
    const userA = await User.create({
      _id: agentAId,
      name: "Agent Alice",
      email: `alice_p18_${Date.now()}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: tenantA,
      status: "active",
    })

    const userB = await User.create({
      _id: agentBId,
      name: "Agent Bob",
      email: `bob_p18_${Date.now()}@example.com`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: tenantB,
      status: "active",
    })

    // Setup leads
    const leadNormal = await Lead.create({
      tenantId: tenantA,
      name: "Normal Lead",
      phone: "+919876543210",
      status: "New",
      ownerId: agentAId,
    })

    const leadDnrFlag = await Lead.create({
      tenantId: tenantA,
      name: "DNR Flag Lead",
      phone: "+919876511111",
      status: "New",
      ownerId: agentAId,
      metadata: { doNotRecord: true },
    })

    const leadDnrTag = await Lead.create({
      tenantId: tenantA,
      name: "DNR Tag Lead",
      phone: "+919876522222",
      status: "New",
      ownerId: agentAId,
      tags: ["RESTRICTED", "DNR"],
    })

    const leadConsentDeclined = await Lead.create({
      tenantId: tenantA,
      name: "Declined Consent Lead",
      phone: "+919876533333",
      status: "New",
      ownerId: agentAId,
      metadata: { consent: { status: "declined", updatedAt: new Date() } },
    })

    // Setup calls
    const callNormal = await Call.create({
      tenantId: tenantA,
      agentId: agentAId,
      leadId: leadNormal._id,
      number: "+919876543210",
      duration: 60,
    })

    const callDnrFlag = await Call.create({
      tenantId: tenantA,
      agentId: agentAId,
      leadId: leadDnrFlag._id,
      number: "+919876511111",
      duration: 45,
    })

    const callDnrTag = await Call.create({
      tenantId: tenantA,
      agentId: agentAId,
      leadId: leadDnrTag._id,
      number: "+919876522222",
      duration: 30,
    })

    const callConsentDeclined = await Call.create({
      tenantId: tenantA,
      agentId: agentAId,
      leadId: leadConsentDeclined._id,
      number: "+919876533333",
      duration: 40,
    })

    // =========================================================================
    // 1. DNR LEAD CANNOT OBTAIN RECORDING TICKET
    // =========================================================================
    console.log("--- 1. PRE-FLIGHT TICKET REJECTION FOR DNR LEADS ---")
    try {
      await issueRecordingTicket({
        tenantId: tenantA,
        agentId: agentAId.toString(),
        callId: callDnrFlag._id.toString(),
      })
      assert(false, "Lead with metadata.doNotRecord should have failed ticket issuance")
    } catch (err) {
      assert(err.statusCode === 403, "Ticket rejected with 403 Forbidden")
      assert(err.code === "RECORDING_FORBIDDEN_DNR", "Error code is RECORDING_FORBIDDEN_DNR")
    }

    try {
      await issueRecordingTicket({
        tenantId: tenantA,
        agentId: agentAId.toString(),
        callId: callDnrTag._id.toString(),
      })
      assert(false, "Lead with DNR tag should have failed ticket issuance")
    } catch (err) {
      assert(err.statusCode === 403, "Ticket rejected for DNR tag lead")
      assert(err.code === "RECORDING_FORBIDDEN_DNR", "Error code matches RECORDING_FORBIDDEN_DNR")
    }

    // =========================================================================
    // 2. DNR CALL CANNOT UPLOAD A RECORDING DIRECTLY
    // =========================================================================
    console.log("\n--- 2. STREAMING UPLOAD REJECTION FOR DNR CALLS ---")
    try {
      const dummyAudio = createDummyAudioStream()
      await recordingStorage.streamUpload({
        callId: callDnrFlag._id.toString(),
        tenantId: tenantA,
        user: userA,
        readStream: dummyAudio.stream,
        mimeType: "audio/mp4",
      })
      assert(false, "Direct upload for DNR lead must fail")
    } catch (err) {
      assert(err.statusCode === 403, "Direct upload rejected with 403 Forbidden")
      assert(err.code === "RECORDING_FORBIDDEN_DNR", "Error code is RECORDING_FORBIDDEN_DNR")
    }

    // Verify call status updated to skipped_dnr
    const checkCall = await Call.findById(callDnrFlag._id)
    assert(checkCall.recording.status === "skipped_dnr", "Call.recording.status set to skipped_dnr")

    // =========================================================================
    // 3. TENANT-LEVEL DNR NUMBER & TAG RULES
    // =========================================================================
    console.log("\n--- 3. TENANT-LEVEL DNR EXCLUSION RULES ---")
    // Add rule for a specific phone number
    const ruleAddResult = await privacyService.addDnrRule({
      tenantId: tenantA,
      type: "number",
      value: "+919876543210", // Matches callNormal
      reason: "Customer requested global exclusion",
      actor: userA,
    })
    assert(ruleAddResult.rule && ruleAddResult.rule.type === "number", "DNR rule added for phone number")

    // Now callNormal (which was previously normal) should be blocked by the tenant DNR number rule!
    const ruleCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: leadNormal,
      phoneNumber: "+919876543210",
    })
    assert(ruleCheck.allowed === false, "Call blocked by tenant-level DNR number rule")
    assert(ruleCheck.reason === "RECORDING_FORBIDDEN_DNR_NUMBER", "Reason code is RECORDING_FORBIDDEN_DNR_NUMBER")

    // Remove the rule and verify recording eligibility restores
    await privacyService.removeDnrRule({
      tenantId: tenantA,
      ruleId: ruleAddResult.rule._id,
      actor: userA,
    })
    const restoredCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: leadNormal,
      phoneNumber: "+919876543210",
    })
    assert(restoredCheck.allowed === true, "Eligibility restored after removing DNR rule")

    // =========================================================================
    // 4. CROSS-TENANT CONSENT & DNR ISOLATION
    // =========================================================================
    console.log("\n--- 4. CROSS-TENANT ISOLATION ---")
    // Tenant B cannot remove Tenant A's DNR rule
    const ruleTenantA = await privacyService.addDnrRule({
      tenantId: tenantA,
      type: "tag",
      value: "COMPLIANCE_HOLD",
      reason: "Legal hold",
      actor: userA,
    })

    try {
      await privacyService.removeDnrRule({
        tenantId: tenantB, // Wrong tenant
        ruleId: ruleTenantA.rule._id,
        actor: userB,
      })
      assert(false, "Cross-tenant rule deletion should have failed")
    } catch (err) {
      assert(err.statusCode === 404, "Cross-tenant rule deletion rejected with 404 Not Found")
    }

    // =========================================================================
    // 5. CONSENT POLICY & DECLINED CONSENT REJECTION
    // =========================================================================
    console.log("\n--- 5. CONSENT ENFORCEMENT & POLICY GUARDS ---")
    // Declined consent always blocks recording
    const declinedCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: leadConsentDeclined,
      phoneNumber: callConsentDeclined.number,
    })
    assert(declinedCheck.allowed === false, "Declined consent strictly blocks recording")
    assert(declinedCheck.reason === "RECORDING_FORBIDDEN_CONSENT_DECLINED", "Reason is RECORDING_FORBIDDEN_CONSENT_DECLINED")

    // Test explicit opt-in policy: unknown consent is rejected
    const optInCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: leadNormal, // Normal lead has unknown consent status
    })
    // Under default implied_disclosure, unknown is permitted:
    assert(optInCheck.allowed === true, "Implied disclosure permits recording when consent is not declined")

    // Update tenant to explicit_opt_in policy
    await Account.create({
      accountId: tenantA,
      companyName: "Tenant A Agency",
      displayName: "Tenant A",
      adminUserId: agentAId,
      adminName: "Alice Admin",
      adminEmail: `alice_admin_${Date.now()}@example.com`,
      metadata: { consentPolicy: "explicit_opt_in" },
    })

    const optInStrictCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: leadNormal, // Unknown consent
    })
    assert(optInStrictCheck.allowed === false, "Explicit opt-in policy blocks recording when consent is unknown")
    assert(optInStrictCheck.reason === "RECORDING_FORBIDDEN_CONSENT_REQUIRED", "Reason is RECORDING_FORBIDDEN_CONSENT_REQUIRED")

    // Update lead consent to granted
    await privacyService.updateLeadPrivacy({
      tenantId: tenantA,
      leadId: leadNormal._id,
      consent: { status: "granted", method: "verbal", notes: "Opted-in at call start" },
      actor: userA,
    })

    const grantedCheck = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: await Lead.findById(leadNormal._id),
    })
    assert(grantedCheck.allowed === true, "Explicit opt-in permits recording when consent is granted")

    // =========================================================================
    // 6. PER-LEAD PRIVACY SWITCH (doNotRecord) PERSISTENCE
    // =========================================================================
    console.log("\n--- 6. PER-LEAD PRIVACY SWITCH ---")
    const switchUpdate = await privacyService.updateLeadPrivacy({
      tenantId: tenantA,
      leadId: leadNormal._id,
      doNotRecord: true,
      actor: userA,
    })
    assert(switchUpdate.lead.metadata.doNotRecord === true, "Per-lead DNR toggle set to true")
    assert(switchUpdate.lead.tags.includes("DNR"), "DNR tag automatically synchronized on lead")

    const recheckAfterSwitch = await privacyService.evaluateRecordingEligibility({
      tenantId: tenantA,
      lead: switchUpdate.lead,
    })
    assert(recheckAfterSwitch.allowed === false, "Lead recording blocked after toggle set to true")

    // Toggle back to false
    const switchBack = await privacyService.updateLeadPrivacy({
      tenantId: tenantA,
      leadId: leadNormal._id,
      doNotRecord: false,
      actor: userA,
    })
    assert(switchBack.lead.metadata.doNotRecord === false, "Per-lead DNR toggle set back to false")
    assert(!switchBack.lead.tags.includes("DNR"), "DNR tag removed when switch toggled false")

    // =========================================================================
    // 7. ERASURE: DELETING LEAD PURGES CALL RECORDINGS FROM GRIDFS
    // =========================================================================
    console.log("\n--- 7. RIGHT TO ERASURE: PURGING RECORDINGS ON LEAD DELETE ---")
    // Upload a test recording for leadNormal
    const eraseAudio = createDummyAudioStream(1024 * 8)
    const eraseUpload = await recordingStorage.streamUpload({
      callId: callNormal._id.toString(),
      tenantId: tenantA,
      user: userA,
      readStream: eraseAudio.stream,
      mimeType: "audio/mp4",
    })
    assert(Boolean(eraseUpload.fileId), "Recording uploaded for erasure test")

    const bucket = recordingStorage.getBucket()
    const fileBefore = await bucket.find({ _id: eraseUpload.fileId }).next()
    assert(Boolean(fileBefore), "File exists in GridFS before erasure")

    // Trigger lead recordings erasure
    const eraseResult = await privacyService.eraseLeadRecordings({
      tenantId: tenantA,
      leadId: leadNormal._id,
      actor: userA,
    })
    assert(eraseResult.erasedCount >= 1, `Erased ${eraseResult.erasedCount} recording(s)`)

    const fileAfter = await bucket.find({ _id: eraseUpload.fileId }).next()
    assert(fileAfter === null, "File completely deleted from GridFS upon erasure")

    const callAfter = await Call.findById(callNormal._id)
    assert(callAfter.recording.status === "expired", "Call.recording.status updated to expired")
    assert(callAfter.recording.fileId === null, "Call.recording.fileId reset to null")

  } finally {
    // Cleanup test data
    try {
      await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
      await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
      await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
      await DnrRule.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
      await Account.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    } catch (_) {}

    await mongoose.disconnect()
    console.log("\nDisconnected from MongoDB Atlas")
  }

  console.log("\n" + "=".repeat(80))
  console.log(`=== PHASE 18 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("=".repeat(80))

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
