const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Call = require("../models/Call")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const User = require("../models/User")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { scheduleAutomaticCallbackFromAiCall } = require("../services/aiCallbackScheduling.service")

const JWT_SECRET = process.env.JWT_SECRET || "leads365_super_secret_jwt_key_2026_production"

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    throw new Error(message)
  }
}

async function runTests() {
  console.log("=== STARTING AI CALL REPORT DELETION & PRESERVATION VERIFICATION ===")
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/leads365"
  await mongoose.connect(mongoUri)
  console.log("Connected to MongoDB for synthetic verification.")

  const tenantA = `SYNTH_TENANT_A_${Date.now()}`
  const tenantB = `SYNTH_TENANT_B_${Date.now()}`

  try {
    // 1. Create synthetic admin users
    const adminUserA = await User.create({
      tenantId: tenantA,
      name: "Admin User Tenant A",
      email: `admin_a_${Date.now()}@synthetic-test.local`,
      password: "HashedPassword123!",
      role: "account_admin",
      status: "active",
    })

    const adminUserB = await User.create({
      tenantId: tenantB,
      name: "Admin User Tenant B",
      email: `admin_b_${Date.now()}@synthetic-test.local`,
      password: "HashedPassword123!",
      role: "account_admin",
      status: "active",
    })

    // 2. Create synthetic Lead
    const synthLead = await Lead.create({
      tenantId: tenantA,
      name: "Synthetic Customer",
      phone: "+919999900001",
      email: "synth.customer@test.local",
      status: "Engaged",
      source: "Phone Inbound",
      metadata: {
        aiAnalysisId: null,
        lastCallOutcome: "FOLLOW_UP_REQUIRED",
      },
    })

    // 3. Create synthetic Call record with audio recording
    const synthAudioFileId = new mongoose.Types.ObjectId()
    const synthCall = await Call.create({
      tenantId: tenantA,
      leadId: synthLead._id,
      agentId: adminUserA._id,
      customerNumber: "+919999900001",
      customerName: "Synthetic Customer",
      direction: "inbound",
      duration: 185,
      hasRecording: true,
      recording: {
        status: "stored",
        fileId: synthAudioFileId,
        url: "https://synthetic-storage.local/call_12345.mp3",
        duration: 185,
      },
      metadata: {
        aiAnalysisStatus: "COMPLETED",
        aiAnalysisId: null,
        aiCallOutcome: "FOLLOW_UP_REQUIRED",
        aiSentiment: "POSITIVE",
        aiProductRelevanceScore: 0.95,
        aiProductFit: "SUPPORTED",
        aiCustomerRequestedProduct: "Enterprise CRM Suite",
        aiLeadQualificationScore: 0.9,
        aiQualificationStatus: "QUALIFIED",
        aiCallbackRequested: true,
        aiRequestedCallbackDateTime: new Date(Date.now() + 86400000),
      },
    })

    // 4. Create synthetic Transcript
    const synthTranscript = await AITranscript.create({
      tenantId: tenantA,
      callId: synthCall._id,
      version: 1,
      status: "COMPLETED",
      transcriptText: "Customer: I am very interested in the Enterprise CRM Suite. Agent: Excellent, let me schedule a follow-up for tomorrow.",
      duration: 185,
      language: "en-US",
      completedAt: new Date(),
    })

    // 5. Create synthetic AICallAnalysis report v1
    const synthAnalysis = await AICallAnalysis.create({
      tenantId: tenantA,
      callId: synthCall._id,
      transcriptId: synthTranscript._id,
      analysisVersion: 1,
      status: "COMPLETED",
      summary: "Customer requested pricing and follow-up call for Enterprise CRM Suite.",
      customerIntent: "Product Inquiry",
      sentiment: "POSITIVE",
      sentimentScore: 0.92,
      callOutcome: "FOLLOW_UP_REQUIRED",
      callbackRequested: true,
      requestedCallbackDateTime: new Date(Date.now() + 86400000),
      callbackReason: "Pricing review",
      completedAt: new Date(),
    })

    // Link analysis ID to Call and Lead metadata
    synthCall.metadata.aiAnalysisId = synthAnalysis._id
    synthCall.metadata.aiTranscriptId = synthTranscript._id
    synthCall.markModified("metadata")
    await synthCall.save()

    synthLead.metadata.aiAnalysisId = synthAnalysis._id
    synthLead.markModified("metadata")
    await synthLead.save()

    // 6. Create AI-scheduled FollowUp task
    const synthFollowUp = await FollowUp.create({
      tenantId: tenantA,
      leadId: synthLead._id,
      title: "Call Synthetic Customer",
      type: "call",
      status: "pending",
      scheduledAt: new Date(Date.now() + 86400000),
      sourceCallId: synthCall._id.toString(),
      aiAnalysisId: synthAnalysis._id,
      createdBy: "AI Call Intelligence",
      customerName: "Synthetic Customer",
      customerPhone: "+919999900001",
    })

    // 7. Create a distinct manually created FollowUp task (Human Sales Rep for this customer)
    const manualFollowUp = await FollowUp.create({
      tenantId: tenantA,
      leadId: synthLead._id,
      title: "Manual in-person demo scheduled by representative",
      type: "meeting",
      status: "pending",
      scheduledAt: new Date(Date.now() + 120000000),
      sourceCallId: null,
      createdBy: "Sales Rep John",
      notes: "Client requested in-person demo of enterprise security",
      metadata: { manualNotes: "High-value enterprise lead", customTag: "priority_deal" },
      customerName: "Synthetic Customer",
      customerPhone: "+919999900001",
    })

    // 8. Create a user holding ONLY leads.delete permission
    const leadOnlyUser = await User.create({
      tenantId: tenantA,
      name: "Lead Cleaner Only",
      email: `leadcleaner_${Date.now()}@synthetic-test.local`,
      password: "HashedPassword123!",
      role: "sales_rep",
      permissions: ["leads.delete", "leads.view.all"],
      status: "active",
    })

    synthAnalysis.scheduledFollowUpId = synthFollowUp._id
    await synthAnalysis.save()

    console.log("✅ Step 1: Synthetic data (including manual follow-up & leads-only user) created successfully.")

    // ----------------------------------------------------
    // TEST 1: Check Linked Follow-Ups API endpoint logic
    // ----------------------------------------------------
    console.log("TEST 1: Linked follow-ups detection...")
    const { getLinkedFollowUps } = require("../controllers/aiCallController")

    let linkedResData = null
    const fakeReqLinked = {
      tenantId: tenantA,
      user: adminUserA,
      params: { callId: synthCall._id.toString() },
    }
    const fakeResLinked = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        linkedResData = payload
        return this
      },
    }

    await getLinkedFollowUps(fakeReqLinked, fakeResLinked)
    assert(fakeResLinked.statusCode === 200, `Expected 200, got ${fakeResLinked.statusCode}`)
    assert(linkedResData.success === true, "Expected success: true")
    assert(linkedResData.data.totalLinked === 1, `Expected 1 linked follow-up, got ${linkedResData.data.totalLinked}`)
    assert(linkedResData.data.pendingCount === 1, `Expected 1 pending follow-up, got ${linkedResData.data.pendingCount}`)
    console.log("✅ TEST 1 PASSED: Linked AI follow-up detected correctly.")

    // ----------------------------------------------------
    // TEST 2: RBAC Separation & Cross-Tenant Deletion Isolation
    // ----------------------------------------------------
    console.log("TEST 2: RBAC separation & Cross-tenant deletion isolation...")
    const { deleteCallAnalysis } = require("../controllers/aiCallController")

    // 2a. User with ONLY leads.delete must be REJECTED (cannot delete AI reports)
    let leadOnlyResData = null
    const fakeReqLeadOnly = {
      tenantId: tenantA,
      user: leadOnlyUser,
      params: { callId: synthCall._id.toString() },
    }
    const fakeResLeadOnly = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        leadOnlyResData = payload
        return this
      },
    }
    await deleteCallAnalysis(fakeReqLeadOnly, fakeResLeadOnly)
    assert(
      fakeResLeadOnly.statusCode === 403,
      `Expected 403 Forbidden for leads.delete user, got ${fakeResLeadOnly.statusCode}`
    )
    console.log("   ✅ Subtest 2a: User with leads.delete only is strictly rejected (RBAC decoupled).")

    // 2b. Cross-tenant deletion isolation
    let crossTenantResData = null
    const fakeReqCrossTenant = {
      tenantId: tenantB, // Different tenant!
      user: adminUserB,
      params: { callId: synthCall._id.toString() },
    }
    const fakeResCrossTenant = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        crossTenantResData = payload
        return this
      },
    }

    await deleteCallAnalysis(fakeReqCrossTenant, fakeResCrossTenant)
    assert(
      fakeResCrossTenant.statusCode === 404,
      `Expected 404 on cross-tenant delete attempt, got ${fakeResCrossTenant.statusCode}`
    )
    console.log("   ✅ Subtest 2b: Cross-tenant report deletion strictly rejected.")
    console.log("✅ TEST 2 PASSED: RBAC separation and cross-tenant protection verified.")

    // ----------------------------------------------------
    // TEST 3: Authorized Soft Deletion of AI Report
    // ----------------------------------------------------
    console.log("TEST 3: Authorized soft-deletion execution...")
    let deleteResData = null
    const fakeReqDelete = {
      tenantId: tenantA,
      user: adminUserA,
      params: { callId: synthCall._id.toString() },
      body: { reason: "Customer requested report removal during test" },
    }
    const fakeResDelete = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        deleteResData = payload
        return this
      },
    }

    await deleteCallAnalysis(fakeReqDelete, fakeResDelete)
    assert(fakeResDelete.statusCode === 200, `Expected 200, got ${fakeResDelete.statusCode}`)
    assert(deleteResData.success === true, "Expected success: true on delete")
    assert(deleteResData.data.preservedFollowUpsCount === 1, `Expected preserved count 1, got ${deleteResData.data.preservedFollowUpsCount}`)

    // Check AICallAnalysis in DB
    const deletedAnalysisDoc = await AICallAnalysis.findById(synthAnalysis._id)
    assert(deletedAnalysisDoc !== null, "AICallAnalysis doc must still exist in DB (soft-delete)")
    assert(deletedAnalysisDoc.deletedAt instanceof Date, "deletedAt must be a valid Date timestamp")
    assert(String(deletedAnalysisDoc.deletedBy) === String(adminUserA._id), "deletedBy must equal adminUserA._id")
    assert(deletedAnalysisDoc.deletedByName === adminUserA.name, "deletedByName must be set")
    console.log("✅ TEST 3 PASSED: Report successfully soft-deleted with audit metadata.")

    // ----------------------------------------------------
    // TEST 4: Query Exclusion (List, Detail, Status, Dashboard)
    // ----------------------------------------------------
    console.log("TEST 4: Exclusion of soft-deleted report from APIs...")
    const { getCallAnalysis, getCallStatus, listAnalyzedCalls, getDashboardMetrics } = require("../controllers/aiCallController")

    // 4a. getCallAnalysis should return 404
    let detailResData = null
    const fakeReqDetail = {
      tenantId: tenantA,
      user: adminUserA,
      params: { callId: synthCall._id.toString() },
    }
    const fakeResDetail = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        detailResData = payload
        return this
      },
    }
    await getCallAnalysis(fakeReqDetail, fakeResDetail)
    assert(fakeResDetail.statusCode === 404, `Expected 404 for deleted report detail, got ${fakeResDetail.statusCode}`)

    // 4b. getCallStatus should have analysis = null
    let statusResData = null
    const fakeResStatus = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        statusResData = payload
        return this
      },
    }
    await getCallStatus(fakeReqDetail, fakeResStatus)
    assert(fakeResStatus.statusCode === 200, "Expected 200 for call status")
    assert(statusResData.data.analysis === null, "Analysis payload must be null after deletion")
    assert(statusResData.data.overallStatus !== "COMPLETED", "Overall status must not be COMPLETED")

    // 4c. listAnalyzedCalls should report intelligenceStatus: "NOT_ANALYZED"
    let listResData = null
    const fakeReqList = {
      tenantId: tenantA,
      user: adminUserA,
      query: {},
    }
    const fakeResList = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        listResData = payload
        return this
      },
    }
    await listAnalyzedCalls(fakeReqList, fakeResList)
    assert(fakeResList.statusCode === 200, "Expected 200 for listAnalyzedCalls")
    const foundCallInList = listResData.calls.find((c) => String(c._id) === String(synthCall._id))
    assert(Boolean(foundCallInList), "Call must still appear in recorded calls list")
    assert(foundCallInList.intelligenceStatus === "NOT_ANALYZED", `Expected NOT_ANALYZED, got ${foundCallInList.intelligenceStatus}`)
    assert(foundCallInList.aiAnalysis === null, "aiAnalysis on call must be null")

    // 4d. getDashboardMetrics should not count deleted report as analyzed
    let dashResData = null
    const fakeResDash = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        dashResData = payload
        return this
      },
    }
    await getDashboardMetrics(fakeReqList, fakeResDash)
    assert(fakeResDash.statusCode === 200, "Expected 200 for dashboard metrics")
    assert(dashResData.data.analyzedCalls === 0, `Expected 0 analyzed calls, got ${dashResData.data.analyzedCalls}`)
    console.log("✅ TEST 4 PASSED: Soft-deleted report excluded from all query surfaces.")

    // ----------------------------------------------------
    // TEST 5: Preservation of Call, Audio, Transcript, Lead & FollowUp
    // ----------------------------------------------------
    console.log("TEST 5: Strict preservation of core CRM data...")

    // 5a. Call record & audio file reference
    const reloadedCall = await Call.findById(synthCall._id)
    assert(reloadedCall !== null, "Call record must NOT be deleted")
    assert(reloadedCall.hasRecording === true, "hasRecording must remain true")
    assert(String(reloadedCall.recording.fileId) === String(synthAudioFileId), "Audio fileId must remain intact")
    assert(reloadedCall.metadata.aiAnalysisStatus === "NOT_ANALYZED", "aiAnalysisStatus must be reset to NOT_ANALYZED")
    assert(reloadedCall.metadata.aiAnalysisId === null, "aiAnalysisId must be cleared")
    assert(reloadedCall.metadata.aiCallOutcome === null, "aiCallOutcome must be cleared")
    assert(reloadedCall.metadata.aiSentiment === null, "aiSentiment must be cleared")

    // 5b. Original Transcript
    const reloadedTranscript = await AITranscript.findById(synthTranscript._id)
    assert(reloadedTranscript !== null, "Transcript must NOT be deleted")
    assert(reloadedTranscript.status === "COMPLETED", "Transcript status must remain COMPLETED")
    assert(reloadedTranscript.transcriptText.includes("Enterprise CRM Suite"), "Transcript text must remain intact")

    // 5c. Customer / Lead
    const reloadedLead = await Lead.findById(synthLead._id)
    assert(reloadedLead !== null, "Lead record must NOT be deleted")
    assert(reloadedLead.name === "Synthetic Customer", "Lead name must remain intact")
    assert(reloadedLead.phone === "+919999900001", "Lead phone must remain intact")
    assert(reloadedLead.metadata.aiAnalysisId === null, "Lead aiAnalysisId must be cleared")
    assert(reloadedLead.metadata.lastCallOutcome === null, "Lead lastCallOutcome must be cleared")

    // 5d. Both AI and manual follow-up tasks completely preserved & untouched
    const reloadedFollowUp = await FollowUp.findById(synthFollowUp._id)
    assert(reloadedFollowUp !== null, "AI Follow-up task must NOT be deleted")
    assert(reloadedFollowUp.status === "pending", "AI Follow-up must remain in pending status")
    assert(reloadedFollowUp.title === "Call Synthetic Customer", "AI Follow-up title must remain intact")

    const reloadedManualFollowUp = await FollowUp.findById(manualFollowUp._id)
    assert(reloadedManualFollowUp !== null, "Manual Follow-up task must NOT be deleted")
    assert(reloadedManualFollowUp.status === "pending", "Manual follow-up must remain in pending status")
    assert(reloadedManualFollowUp.title === "Manual in-person demo scheduled by representative", "Manual title must be intact")
    assert(reloadedManualFollowUp.createdBy === "Sales Rep John", "Manual createdBy must remain intact")
    assert(reloadedManualFollowUp.notes === "Client requested in-person demo of enterprise security", "Manual notes must remain intact")
    assert(reloadedManualFollowUp.metadata?.customTag === "priority_deal", "Manual metadata.customTag must remain untouched")
    assert(reloadedManualFollowUp.metadata?.manualNotes === "High-value enterprise lead", "Manual metadata.manualNotes must remain untouched")
    console.log("✅ TEST 5 PASSED: All core records (call, recording, transcript, lead, AI follow-up, and manual follow-up) 100% preserved and untouched.")

    // ----------------------------------------------------
    // TEST 6: Reprocessing Generates Fresh Analysis Without Duplicate Follow-Ups
    // ----------------------------------------------------
    console.log("TEST 6: Reprocessing after deletion without duplicate follow-ups...")

    // Verify v1 soft-deleted document remains in DB for audit trail
    const auditV1Doc = await AICallAnalysis.findById(synthAnalysis._id)
    assert(auditV1Doc !== null && auditV1Doc.deletedAt instanceof Date, "v1 document must remain in DB with deletedAt for audit trail")

    // Determine next version using pipeline logic: max(existing) + 1
    const lastAnalysisDoc = await AICallAnalysis.findOne({ tenantId: tenantA, callId: synthCall._id })
      .sort({ analysisVersion: -1 })
      .setOptions({ skipTenantFilter: true })
    const computedNextVersion = lastAnalysisDoc ? lastAnalysisDoc.analysisVersion + 1 : 1
    assert(computedNextVersion === 2, `Expected next version 2, got ${computedNextVersion}`)

    // Simulate reprocessing creating analysis v2
    const freshAnalysis = await AICallAnalysis.create({
      tenantId: tenantA,
      callId: synthCall._id,
      transcriptId: synthTranscript._id,
      analysisVersion: computedNextVersion,
      status: "COMPLETED",
      summary: "Fresh analysis after previous report deletion.",
      customerIntent: "Product Inquiry",
      sentiment: "POSITIVE",
      sentimentScore: 0.95,
      callOutcome: "FOLLOW_UP_REQUIRED",
      callbackRequested: true,
      requestedCallbackDateTime: new Date(Date.now() + 172800000), // 2 days from now
      callbackReason: "Follow up with detailed proposal",
      isProductRelevant: true,
      qualificationStatus: "QUALIFIED",
      completedAt: new Date(),
    })

    // Call scheduleAutomaticCallbackFromAiCall with fresh analysis
    const schedResult = await scheduleAutomaticCallbackFromAiCall({
      call: reloadedCall,
      analysis: freshAnalysis,
      tenantId: tenantA,
      lead: reloadedLead,
    })

    assert(schedResult.success === true, "Callback scheduling on reprocess must succeed")
    assert(schedResult.isRescheduled === true, "Must reschedule existing follow-up instead of duplicating")

    // Verify exactly 2 follow-ups exist for this lead: 1 manual + 1 rescheduled AI task (0 duplicates)
    const totalFollowUps = await FollowUp.countDocuments({
      tenantId: tenantA,
      leadId: synthLead._id,
      deletedAt: null,
    })
    assert(totalFollowUps === 2, `Expected exactly 2 follow-ups (1 manual + 1 AI task), got ${totalFollowUps}`)

    const updatedFollowUp = await FollowUp.findById(synthFollowUp._id)
    assert(
      updatedFollowUp.scheduledAt.getTime() === freshAnalysis.requestedCallbackDateTime.getTime(),
      "Follow-up scheduled time should be updated to fresh analysis callback time"
    )

    const preservedManualFollowUp = await FollowUp.findById(manualFollowUp._id)
    assert(
      preservedManualFollowUp.notes === "Client requested in-person demo of enterprise security",
      "Manual follow-up must remain completely untouched after reprocessing"
    )
    console.log("✅ TEST 6 PASSED: Reprocessing correctly incremented version to v2, updated existing callback, preserved manual tasks, and created 0 duplicates.")

    console.log("=== ALL DELETION AND PRESERVATION TESTS PASSED SUCCESSFULLY! ===")
  } finally {
    // Clean up synthetic test records
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await FollowUp.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await AITranscript.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await AICallAnalysis.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true })
    await mongoose.disconnect()
    console.log("Cleaned up synthetic records and disconnected.")
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
