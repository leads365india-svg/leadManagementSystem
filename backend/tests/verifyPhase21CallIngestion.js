/**
 * Phase 21: Call Ingestion (Manual Upload & Review Queue) Verification Suite
 * 
 * Verifies:
 * 1. Filename phone number parsing & sanitization.
 * 2. Automatic CRM Lead matching by phone number.
 * 3. Audio streaming ingestion into MongoDB GridFS with 30-day retention.
 * 4. Do-Not-Record (DNR) & Consent policy enforcement (rejects DNR numbers with 403).
 * 5. CSV batch call records ingestion with duplicate skipping (idempotency).
 * 6. Review queue retrieval for unmatched manual calls.
 * 7. Manual lead matching & quick-create lead resolution.
 * 8. Tenant isolation & cross-tenant security rejection.
 * 9. Call Reports & metrics compatibility.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const { Readable } = require("stream")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const DnrRule = require("../models/DnrRule")
const callIngestionService = require("../services/callIngestionService")
const callService = require("../services/callService")
const recordingStorage = require("../services/recordingStorage")

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

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 21: CALL INGESTION (MANUAL UPLOAD) VERIFICATION SUITE ===")
  console.log("================================================================================")

  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/leads365_test"
  await mongoose.connect(mongoUri)

  const testTenantA = `tenant_ingest_a_${Date.now()}`
  const testTenantB = `tenant_ingest_b_${Date.now()}`

  try {
    // Setup test users
    const userA = new User({
      tenantId: testTenantA,
      name: "Agent Alpha",
      email: `alpha_${Date.now()}@example.com`,
      password: "Password123!",
      role: "agent",
    })
    await userA.save()

    const adminA = new User({
      tenantId: testTenantA,
      name: "Admin Alpha",
      email: `admin_${Date.now()}@example.com`,
      password: "Password123!",
      role: "account_admin",
    })
    await adminA.save()

    const userB = new User({
      tenantId: testTenantB,
      name: "Agent Beta",
      email: `beta_${Date.now()}@example.com`,
      password: "Password123!",
      role: "agent",
    })
    await userB.save()

    // Setup CRM Leads
    const leadA1 = new Lead({
      tenantId: testTenantA,
      name: "Rajesh Sharma",
      phone: "9876543210",
      phoneNormalized: "+919876543210",
      ownerId: userA._id,
      status: "New",
    })
    await leadA1.save()

    const leadA2_Dnr = new Lead({
      tenantId: testTenantA,
      name: "DNR Lead Suresh",
      phone: "9811122233",
      phoneNormalized: "+919811122233",
      ownerId: userA._id,
      status: "Engaged",
      doNotRecord: true,
      tags: ["DNR"],
      metadata: {
        doNotRecord: true,
      },
      privacy: {
        doNotRecord: true,
        consentStatus: "declined",
      },
    })
    await leadA2_Dnr.save()

    console.log("\n--- 1. FILENAME PHONE PARSING & SANITIZATION ---")
    const p1 = callIngestionService.extractPhoneFromFilename("9876543210_call_recording.m4a")
    assert(p1 === "9876543210", "Extracts standard 10-digit phone from filename")

    const p2 = callIngestionService.extractPhoneFromFilename("call_+919876543210_20261027.mp3")
    assert(p2 === "+919876543210", "Extracts country-coded +91 phone from filename")

    const p3 = callIngestionService.extractPhoneFromFilename("09876543210.wav")
    assert(p3 === "09876543210", "Extracts trunk zero prefix phone from filename")

    const safeName = callIngestionService.sanitizeFilename("../../etc/passwd_9876543210.m4a")
    assert(!safeName.includes("..") && !safeName.includes("/"), "Sanitizes directory traversal attempts")

    console.log("\n--- 2. AUDIO STREAMING INGESTION & AUTO-MATCHING ---")
    // Mock audio stream
    const audioBytes = Buffer.from("dummy-audio-content-test-1234567890")
    const audioStream = Readable.from(audioBytes)

    const ingestRes1 = await callIngestionService.ingestAudioRecording({
      tenantId: testTenantA,
      user: userA,
      readStream: audioStream,
      filename: "9876543210_customer_discussion.m4a",
      mimeType: "audio/m4a",
      contentLength: audioBytes.length,
      duration: 125,
      direction: "outbound",
      disposition: "interested",
      notes: "Customer wants enterprise demo next week",
    })

    assert(ingestRes1.success === true, "Audio ingestion succeeds")
    assert(ingestRes1.status === "matched", "Call auto-matches to Lead Rajesh Sharma")
    assert(ingestRes1.lead.id.toString() === leadA1._id.toString(), "Linked to correct lead ID")
    assert(ingestRes1.call.source === "manual", "Call source marked as 'manual'")
    assert(ingestRes1.call.duration === 125, "Duration persisted accurately")
    assert(Boolean(ingestRes1.call.recording?.fileId), "Recording saved into GridFS with valid fileId")
    assert(ingestRes1.call.recording?.status === "stored", "Recording status transitions to 'stored'")

    // Check retention policy (30 days)
    const thirtyDaysAhead = Date.now() + 29 * 24 * 60 * 60 * 1000
    assert(new Date(ingestRes1.call.recording.expiresAt).getTime() > thirtyDaysAhead, "Recording retention set to 30 days")

    console.log("\n--- 3. DO-NOT-RECORD (DNR) PRIVACY ENFORCEMENT ---")
    let dnrRejected = false
    try {
      const dnrStream = Readable.from(Buffer.from("audio-for-dnr-lead"))
      await callIngestionService.ingestAudioRecording({
        tenantId: testTenantA,
        user: userA,
        readStream: dnrStream,
        filename: "9811122233_call.mp3",
        mimeType: "audio/mp3",
      })
    } catch (err) {
      dnrRejected = err.statusCode === 403 && err.code?.includes("RECORDING_FORBIDDEN")
    }
    assert(dnrRejected, "Ingestion strictly rejects audio for DNR lead with HTTP 403")

    console.log("\n--- 4. UNMATCHED AUDIO & REVIEW QUEUE ---")
    // Ingest audio for unknown phone number
    const unmatchedStream = Readable.from(Buffer.from("audio-for-unknown-phone"))
    const ingestRes2 = await callIngestionService.ingestAudioRecording({
      tenantId: testTenantA,
      user: userA,
      readStream: unmatchedStream,
      filename: "9998887776_inbound_lead.wav",
      mimeType: "audio/wav",
      duration: 45,
      direction: "inbound",
      notes: "Inbound caller asking for pricing",
    })

    assert(ingestRes2.success === true, "Unmatched audio ingestion succeeds")
    assert(ingestRes2.status === "unmatched", "Status flagged as 'unmatched'")
    assert(ingestRes2.lead === null, "Lead ID is null")
    assert(ingestRes2.call.leadId === null, "Persisted call has null leadId")
    assert(Boolean(ingestRes2.call.recording?.fileId), "Audio recording held in GridFS awaiting resolution")

    // Fetch Review Queue
    const reviewQueue = await callIngestionService.getReviewQueue({
      tenantId: testTenantA,
      user: adminA,
    })
    assert(reviewQueue.success === true, "Review queue retrieved successfully")
    assert(reviewQueue.total >= 1, "Review queue contains unmatched call")
    const unmatchedItem = reviewQueue.calls.find(c => c._id.toString() === ingestRes2.call._id.toString())
    assert(Boolean(unmatchedItem), "Ingested unmatched call exists in review queue")

    console.log("\n--- 5. MANUAL RESOLUTION & LEAD MATCHING ---")
    // Staff matches unmatched item to newly created lead
    const matchRes = await callIngestionService.matchUnmatchedCall({
      tenantId: testTenantA,
      user: adminA,
      callId: ingestRes2.call._id,
      newLead: {
        name: "Pooja Mehta",
        phone: "9998887776",
        email: "pooja@example.com",
      },
    })

    assert(matchRes.success === true, "Manual match resolution succeeds")
    assert(matchRes.lead.name === "Pooja Mehta", "New lead created successfully")
    assert(matchRes.call.leadId.toString() === matchRes.lead.id.toString(), "Call linked to newly created lead")

    // Check review queue has cleared this item
    const reviewQueueAfter = await callIngestionService.getReviewQueue({
      tenantId: testTenantA,
      user: adminA,
    })
    const clearedItem = reviewQueueAfter.calls.find(c => c._id.toString() === ingestRes2.call._id.toString())
    assert(!clearedItem, "Matched call removed from review queue")

    console.log("\n--- 6. CSV BATCH CALL RECORDS INGESTION & IDEMPOTENCY ---")
    const csvContent = `phone,duration,direction,disposition,notes,clientcallid
9876543210,180,outbound,closed-deal,Agreed on annual contract,csv_idemp_001
9998887776,90,inbound,support,Inquiry regarding invoice,csv_idemp_002
9771122334,45,outbound,callback,Will call back tomorrow,csv_idemp_003`

    const csvRes1 = await callIngestionService.ingestCsvRecords({
      tenantId: testTenantA,
      user: userA,
      csvText: csvContent,
    })

    assert(csvRes1.total === 3, "Processes all 3 CSV rows")
    assert(csvRes1.matched === 2, "Matches 2 rows to known leads (Rajesh Sharma & Pooja Mehta)")
    assert(csvRes1.unmatched === 1, "Queues 1 row for manual review")
    assert(csvRes1.failed === 0, "Zero failures on valid records")

    // Test Idempotency: Re-submitting identical CSV should skip existing clientCallId
    const csvResDuplicate = await callIngestionService.ingestCsvRecords({
      tenantId: testTenantA,
      user: userA,
      csvText: csvContent,
    })
    assert(csvResDuplicate.skippedDuplicates === 3, "Idempotent duplicate CSV submission skipped existing records")

    console.log("\n--- 7. TENANT ISOLATION & RBAC SECURITY GUARDS ---")
    // Agent B (Tenant B) attempts to match Call from Tenant A
    let crossTenantBlocked = false
    try {
      await callIngestionService.matchUnmatchedCall({
        tenantId: testTenantB,
        user: userB,
        callId: ingestRes1.call._id,
        newLead: { name: "Attacker", phone: "9876543210" },
      })
    } catch (err) {
      crossTenantBlocked = err.statusCode === 404
    }
    assert(crossTenantBlocked, "Cross-tenant call match strictly rejected with 404")

    console.log("\n--- 8. CALL REPORTS VISIBILITY & METRICS INTEGRATION ---")
    const reportsList = await callService.listCalls({
      tenantId: testTenantA,
      user: adminA,
      scope: "all",
      source: "manual",
    })
    const callCount = reportsList.data?.calls?.length || reportsList.calls?.length || 0
    assert(reportsList.success === true && callCount >= 3, "Ingested manual calls visible in Call Reports API")

    const metrics = await callService.getCallMetrics({
      tenantId: testTenantA,
      user: adminA,
      scope: "all",
    })
    const totalCalls = metrics.data?.totalCalls ?? metrics.totalCalls ?? 0
    assert(totalCalls >= 3, "Ingested manual calls counted in CRM metrics")

  } finally {
    // Teardown test artifacts
    await Call.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
    await User.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
    await DnrRule.deleteMany({ tenantId: { $in: [testTenantA, testTenantB] } })
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 21 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("================================================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
