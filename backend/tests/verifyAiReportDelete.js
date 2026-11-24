const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })
const connectDB = require("../db/connection")

async function runTests() {
  console.log("=== Starting Synthetic Verification: AI Report Deletion ===")
  await connectDB()
  console.log("[Setup] Connected to MongoDB")

  const Account = require("../models/Account")
  const Workspace = require("../models/Workspace")
  const WorkspaceMembership = require("../models/WorkspaceMembership")
  const User = require("../models/User")
  const Lead = require("../models/Lead")
  const Call = require("../models/Call")
  const { AITranscript } = require("../models/AITranscript")
  const AICallAnalysis = require("../models/AICallAnalysis")
  const FollowUp = require("../models/FollowUp")
  const { deleteCallAnalysis, listAnalyzedCalls, getCallAnalysis } = require("../controllers/aiCallController")

  const TENANT_A = "ACC-AI-DEL-A-" + Date.now()
  const TENANT_B = "ACC-AI-DEL-B-" + Date.now()

  let userA = null
  let userB = null
  let workspaceA = null
  let lead1 = null
  let call1 = null
  let transcript1 = null
  let analysis1 = null
  let followUp1 = null

  try {
    // 1. Create Tenant A & B Users
    userA = await User.create({
      name: "Tenant A Admin",
      email: `adminA-${Date.now()}@test.com`,
      password: "Password@123",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    userB = await User.create({
      name: "Tenant B Admin",
      email: `adminB-${Date.now()}@test.com`,
      password: "Password@123",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
      isActive: true,
    })

    // 2. Create Workspace in Tenant A
    workspaceA = await Workspace.create({
      tenantId: TENANT_A,
      name: "Cardiac Care",
      slug: "cardiac-care-" + Date.now(),
      status: "active",
    })

    // 2.5 Create Lead in Tenant A
    lead1 = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: workspaceA._id,
      name: "John Cardiac Patient",
      phone: "+919876543210",
      assignedTo: userA._id,
      status: "New",
    })

    // 3. Create synthetic Call in Tenant A with recording
    call1 = await Call.create({
      tenantId: TENANT_A,
      workspaceId: workspaceA._id,
      leadId: lead1._id,
      agentId: userA._id,
      callType: "inbound",
      direction: "inbound",
      status: "completed",
      hasRecording: true,
      recording: {
        fileId: new mongoose.Types.ObjectId(),
        mp3FileId: new mongoose.Types.ObjectId(),
        duration: 185,
        status: "stored",
        mimeType: "audio/mp3",
      },
      metadata: {
        aiAnalysisStatus: "COMPLETED",
        aiCallOutcome: "INTERESTED",
        aiSentiment: "POSITIVE",
      },
      customerNumber: "+919876543210",
      startedAt: new Date(Date.now() - 3600000),
      endedAt: new Date(),
    })

    // 4. Create synthetic AITranscript
    transcript1 = await AITranscript.create({
      tenantId: TENANT_A,
      callId: call1._id,
      transcript: "Agent: Hello, welcome. Customer: I need a cardiac consultation.",
      status: "COMPLETED",
      language: "en",
    })

    // 5. Create synthetic AICallAnalysis (Report)
    analysis1 = await AICallAnalysis.create({
      tenantId: TENANT_A,
      workspaceId: workspaceA._id,
      callId: call1._id,
      transcriptId: transcript1._id,
      analysisVersion: 1,
      status: "COMPLETED",
      summary: "Patient requested urgent cardiology consultation appointment.",
      customerIntent: "Appointment booking",
      callOutcome: "INTERESTED",
      sentiment: "POSITIVE",
    })

    // 6. Create linked FollowUp task
    followUp1 = await FollowUp.create({
      tenantId: TENANT_A,
      workspaceId: workspaceA._id,
      leadId: lead1._id,
      assignedTo: userA._id,
      title: "Schedule cardiac consultation callback",
      sourceCallId: call1._id.toString(),
      aiAnalysisId: analysis1._id,
      status: "pending",
      scheduledAt: new Date(Date.now() + 86400000),
      dueDate: new Date(Date.now() + 86400000),
    })

    // Mock Express req/res helper
    function createMockRes() {
      return {
        statusCode: 200,
        jsonData: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.jsonData = data
          return this
        },
      }
    }

    console.log("\n--- TEST 1: Tenant B attempts to delete Tenant A's AI Report (Cross-Tenant Rejection) ---")
    const reqCrossTenant = {
      params: { callId: call1._id.toString() },
      user: { _id: userB._id, role: "account_admin", tenantId: TENANT_B },
      tenantId: TENANT_B,
      headers: {},
      body: {},
    }
    const resCrossTenant = createMockRes()
    await deleteCallAnalysis(reqCrossTenant, resCrossTenant)

    console.log(`Cross-tenant delete status: ${resCrossTenant.statusCode}`)
    console.log(`Response message: ${resCrossTenant.jsonData?.message}`)
    if (resCrossTenant.statusCode === 404 || resCrossTenant.statusCode === 403) {
      console.log("PASS: Cross-tenant deletion prevented. Another tenant cannot delete this report.")
    } else {
      throw new Error(`FAIL: Cross-tenant deletion was not blocked! StatusCode: ${resCrossTenant.statusCode}`)
    }

    // Verify report is still active
    const checkStillActive = await AICallAnalysis.findOne({ _id: analysis1._id, deletedAt: null })
    if (checkStillActive) {
      console.log("PASS: AI Report remained active and unaffected by unauthorized cross-tenant attempt.")
    } else {
      throw new Error("FAIL: AI Report was deleted or corrupted by cross-tenant call!")
    }

    console.log("\n--- TEST 2: Tenant A deletes AI Report using Call ID ---")
    const reqDelete = {
      params: { callId: call1._id.toString() },
      user: { _id: userA._id, name: userA.name, role: "account_admin", tenantId: TENANT_A },
      tenantId: TENANT_A,
      headers: {},
      body: { reportId: analysis1._id.toString() },
    }
    const resDelete = createMockRes()
    await deleteCallAnalysis(reqDelete, resDelete)

    console.log(`Delete status: ${resDelete.statusCode}`)
    console.log(`Response message: ${resDelete.jsonData?.message}`)
    if (resDelete.statusCode === 200 && resDelete.jsonData?.success) {
      console.log("PASS: AI Report deleted successfully with HTTP 200.")
    } else {
      throw new Error(`FAIL: Deletion failed! Got: ${JSON.stringify(resDelete.jsonData)}`)
    }

    console.log("\n--- TEST 3: Verify backend record is marked deleted and excluded from listing ---")
    // Verify AICallAnalysis document has deletedAt timestamp
    const deletedAnalysisDoc = await AICallAnalysis.findById(analysis1._id).setOptions({ skipTenantFilter: true })
    if (deletedAnalysisDoc && deletedAnalysisDoc.deletedAt) {
      console.log(`PASS: AICallAnalysis document soft-deleted (deletedAt: ${deletedAnalysisDoc.deletedAt.toISOString()})`)
    } else {
      throw new Error("FAIL: AICallAnalysis document does not have deletedAt set!")
    }

    // Verify listAnalyzedCalls does NOT return this report (it disappeared from UI/API)
    const reqList = {
      user: { _id: userA._id, role: "account_admin", tenantId: TENANT_A },
      tenantId: TENANT_A,
      query: { status: "COMPLETED" },
    }
    const resList = createMockRes()
    await listAnalyzedCalls(reqList, resList)
    const returnedCalls = resList.jsonData?.data?.calls || []
    const matchingAnalyzedCall = returnedCalls.find((c) => c._id.toString() === call1._id.toString())
    if (!matchingAnalyzedCall || matchingAnalyzedCall.intelligenceStatus === "NOT_ANALYZED" || !matchingAnalyzedCall.aiAnalysis) {
      console.log("PASS: Report disappeared from active analyzed calls list.")
    } else {
      throw new Error("FAIL: Deleted report is still returned in active analyzed calls list!")
    }

    console.log("\n--- TEST 4: Verify Call, Recording, Transcript & Follow-Up are 100% PRESERVED ---")
    // 1. Call document
    const callAfter = await Call.findById(call1._id).setOptions({ skipTenantFilter: true })
    if (callAfter) {
      console.log("PASS: Original Call document preserved intact.")
    } else {
      throw new Error("FAIL: Original Call document was deleted!")
    }

    // 2. Call recording
    if (
      callAfter.recording &&
      callAfter.recording.fileId?.toString() === call1.recording.fileId.toString() &&
      callAfter.recording.mp3FileId?.toString() === call1.recording.mp3FileId.toString() &&
      callAfter.recording.status === "stored"
    ) {
      console.log("PASS: Original Call recording bytes and metadata preserved 100% intact.")
    } else {
      throw new Error("FAIL: Call recording was modified or cleared!")
    }

    // 3. Transcript
    const transcriptAfter = await AITranscript.findById(transcript1._id).setOptions({ skipTenantFilter: true })
    if (transcriptAfter && transcriptAfter.transcript === transcript1.transcript) {
      console.log("PASS: Original Call AITranscript preserved intact.")
    } else {
      throw new Error("FAIL: AITranscript was deleted or altered!")
    }

    // 4. Follow-up
    const followUpAfter = await FollowUp.findById(followUp1._id).setOptions({ skipTenantFilter: true })
    if (followUpAfter && followUpAfter.status === "pending") {
      console.log("PASS: Linked Follow-Up task preserved active and intact.")
    } else {
      throw new Error("FAIL: FollowUp task was deleted or altered!")
    }

    console.log("\n--- TEST 5: Delete by AI Report ID (analysisId) directly ---")
    // Create another synthetic analysis
    const analysis2 = await AICallAnalysis.create({
      tenantId: TENANT_A,
      workspaceId: workspaceA._id,
      callId: call1._id,
      transcriptId: transcript1._id,
      analysisVersion: 2,
      status: "COMPLETED",
      summary: "Followup call analysis report v2",
    })

    const reqDeleteByReportId = {
      params: { reportId: analysis2._id.toString() },
      user: { _id: userA._id, name: userA.name, role: "account_admin", tenantId: TENANT_A },
      tenantId: TENANT_A,
      headers: {},
      body: {},
    }
    const resDeleteByReportId = createMockRes()
    await deleteCallAnalysis(reqDeleteByReportId, resDeleteByReportId)

    console.log(`Delete by ReportId status: ${resDeleteByReportId.statusCode}`)
    if (resDeleteByReportId.statusCode === 200 && resDeleteByReportId.jsonData?.success) {
      console.log("PASS: Deletion directly by AI Report ID succeeded with HTTP 200.")
    } else {
      throw new Error(`FAIL: Deletion by ReportId failed! Got: ${JSON.stringify(resDeleteByReportId.jsonData)}`)
    }

    console.log("\n=======================================================")
    console.log("ALL 5 AI REPORT DELETION VERIFICATION TESTS PASSED!")
    console.log("=======================================================")
  } finally {
    console.log("\n[Cleanup] Cleaning up synthetic test records...")
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Workspace.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Call.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await AITranscript.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await AICallAnalysis.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await FollowUp.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await mongoose.disconnect()
    console.log("[Cleanup] Complete and disconnected.")
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
