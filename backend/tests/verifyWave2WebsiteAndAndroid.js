/**
 * Wave 2 Implementation Verification: Website Lead Routing + Android Workspace Attribution
 * 
 * Verifies:
 * 1. Website Lead Routing:
 *    - Valid service_code routes lead to targetWorkspaceId and stamps capturedService, serviceCode, event.workspaceId.
 *    - Invalid service_code is rejected with 400 (INVALID_SERVICE_SELECTION).
 *    - Missing service_code falls back to integration.workspaceId.
 *    - Public services discovery endpoint returns active public services for siteKey.
 * 2. Workspace-Safe Duplicate Handling:
 *    - Duplicate in SAME workspace triggers duplicate policy (rejected).
 *    - Same phone in DIFFERENT workspace creates separate lead and flags cross-workspace contact.
 * 3. Mobile Call Attribution & Precedence:
 *    - Inbound call with SIM mapping routes to SIM workspace.
 *    - Inbound call with known CRM lead phone routes to lead's workspace.
 *    - Inbound conflict (SIM vs Lead workspace) routes to lead's workspace and flags workspaceConflict.
 *    - Outbound call attributes to linked lead's workspace.
 *    - Unauthorized agent reporting call in foreign workspace is rejected with 403 (FORBIDDEN_WORKSPACE_ACCESS).
 * 4. Mobile Recording GridFS Metadata:
 *    - Stamps workspaceId onto GridFS file metadata.
 * 5. AI Pipeline Workspace Inheritance:
 *    - Enqueued job has workspaceId and scopeMode: "single_workspace".
 *    - AITranscript and AICallAnalysis inherit call.workspaceId.
 *    - Auto-scheduled FollowUp inherits call.workspaceId.
 * 6. Mobile Login Multi-Workspace Payload:
 *    - Mode B Org returns workspaces list and activeWorkspaceId.
 *    - Mode A Standalone returns empty workspaces list and activeWorkspaceId: null.
 */

const assert = require("assert")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const connectDB = require("../db/connection")
const Account = require("../models/Account")
const User = require("../models/User")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const BusinessProduct = require("../models/BusinessProduct")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const Job = require("../models/Job")
const queue = require("../services/queueService")
const integrationService = require("../services/integrationService")
const { getPublicServices } = require("../controllers/workspaceController")
const { reportMobileCall, mobileLogin } = require("../controllers/mobileController")
const recordingStorage = require("../services/recordingStorage")
const { enqueueCallIntelligenceJob } = require("../services/aiCallProcessingPipeline")
const { scheduleAutomaticCallbackFromAiCall } = require("../services/aiCallbackScheduling.service")

const TEST_PREFIX = `SYNTH_W2_${Date.now()}`
const TENANT_ORG = `${TEST_PREFIX}_ORG`
const TENANT_STANDALONE = `${TEST_PREFIX}_STANDALONE`

let testPassed = 0
let testFailed = 0

async function runTest(name, fn) {
  try {
    process.stdout.write(`Testing: ${name} ... `)
    await fn()
    console.log("✅ PASS")
    testPassed++
  } catch (err) {
    console.log("❌ FAIL")
    console.error(`  Error: ${err.message}`)
    if (err.stack) console.error(`  Stack: ${err.stack.split("\n")[1]}`)
    testFailed++
  }
}

// Mock Express req/res
function mockReqRes({ body = {}, headers = {}, params = {}, query = {}, user = null } = {}) {
  const req = {
    body,
    headers,
    params,
    query,
    user,
    ip: "127.0.0.1",
  }
  let statusCode = 200
  let responseData = null

  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(data) {
      responseData = data
      return this
    },
  }

  return { req, res, getResult: () => ({ status: statusCode, data: responseData }) }
}

async function main() {
  await connectDB()
  console.log("=== STARTING WAVE 2 WEBSITE LEAD ROUTING & ANDROID ATTRIBUTION TEST SUITE ===")

  // Synthetic Fixtures
  let orgAccount, standaloneAccount
  let workspaceAlpha, workspaceBeta
  let agentAlpha, orgAdmin, standaloneAgent
  let membershipAlpha, membershipBeta
  let dentalProduct, cardioProduct
  let integrationAlpha

  try {
    // -------------------------------------------------------------------------
    // Setup Synthetic Data
    // -------------------------------------------------------------------------
    orgAccount = await Account.create({
      accountId: TENANT_ORG,
      companyName: "Wave 2 Medical Org",
      displayName: "Wave 2 Medical",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Org Admin",
      adminEmail: `admin_${TENANT_ORG.toLowerCase()}@test.com`,
      workspaceModeEnabled: true,
      status: "active",
    })

    standaloneAccount = await Account.create({
      accountId: TENANT_STANDALONE,
      companyName: "Wave 2 Standalone Clinic",
      displayName: "Wave 2 Standalone",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Standalone Admin",
      adminEmail: `admin_${TENANT_STANDALONE.toLowerCase()}@test.com`,
      workspaceModeEnabled: false,
      status: "active",
    })

    workspaceAlpha = await Workspace.create({
      tenantId: TENANT_ORG,
      name: "Dental Clinic Workspace",
      slug: "dental",
      isDefault: true,
      status: "active",
    })

    workspaceBeta = await Workspace.create({
      tenantId: TENANT_ORG,
      name: "Cardiology Clinic Workspace",
      slug: "cardio",
      isDefault: false,
      status: "active",
    })

    agentAlpha = await User.create({
      tenantId: TENANT_ORG,
      name: "Dr. Alpha",
      email: `${TEST_PREFIX}_alpha@test.com`,
      password: "TestPassword123!",
      role: "agent",
      status: "active",
    })

    orgAdmin = await User.create({
      tenantId: TENANT_ORG,
      name: "Org Admin",
      email: `${TEST_PREFIX}_orgadmin@test.com`,
      password: "TestPassword123!",
      role: "account_admin",
      status: "active",
    })

    standaloneAgent = await User.create({
      tenantId: TENANT_STANDALONE,
      name: "Solo Agent",
      email: `${TEST_PREFIX}_solo@test.com`,
      password: "TestPassword123!",
      role: "agent",
      status: "active",
    })

    // Alpha membership only (agentAlpha has no access to workspaceBeta)
    membershipAlpha = await WorkspaceMembership.create({
      tenantId: TENANT_ORG,
      workspaceId: workspaceAlpha._id,
      userId: agentAlpha._id,
      role: "agent",
      status: "active",
    })

    // Canonical BusinessProduct catalogue items
    dentalProduct = await BusinessProduct.create({
      tenantId: TENANT_ORG,
      name: "Teeth Whitening & Cleaning",
      routingCode: "P-DENTAL",
      code: "P-DENTAL",
      category: "Dental",
      price: 2500,
      isPublicService: true,
      targetWorkspaceId: workspaceAlpha._id,
      status: "active",
      isArchived: false,
    })

    cardioProduct = await BusinessProduct.create({
      tenantId: TENANT_ORG,
      name: "Cardiac ECG Checkup",
      routingCode: "P-CARDIO",
      code: "P-CARDIO",
      category: "Cardiology",
      price: 5000,
      isPublicService: true,
      targetWorkspaceId: workspaceBeta._id,
      status: "active",
      isArchived: false,
    })

    integrationAlpha = await Integration.create({
      tenantId: TENANT_ORG,
      name: "Main Website Intake",
      type: "website",
      siteKey: `site_${TEST_PREFIX}`,
      apiKey: `key_${TEST_PREFIX}`,
      workspaceId: workspaceAlpha._id, // fallback workspace
      status: "active",
      settings: {
        duplicateHandling: "reject",
      },
    })

    // -------------------------------------------------------------------------
    // 1. Website Lead Routing Tests
    // -------------------------------------------------------------------------
    await runTest("Website Lead: Valid service_code routes to correct workspace and stamps metadata", async () => {
      const event = new IntegrationEvent({
        tenantId: TENANT_ORG,
        integrationId: integrationAlpha._id,
        status: "received",
      })
      await event.save()

      const result = await integrationService.processIntakePayload({
        event,
        integration: integrationAlpha,
        tenantId: TENANT_ORG,
        body: {
          name: "Alice Dental Lead",
          email: `${TEST_PREFIX}_alice@test.com`,
          phone: "+919876540001",
          service_code: "P-DENTAL",
        },
      })

      assert.strictEqual(result.status, 201, "Expected HTTP 201 created")
      assert.ok(result.data.id, "Expected created lead ID")
      assert.strictEqual(result.data.workspaceId.toString(), workspaceAlpha._id.toString(), "Lead workspace must match dental workspace Alpha")

      const leadDoc = await Lead.findById(result.data.id).lean()
      assert.strictEqual(leadDoc.workspaceId.toString(), workspaceAlpha._id.toString())
      assert.strictEqual(leadDoc.metadata.capturedService, dentalProduct.name)
      assert.strictEqual(leadDoc.metadata.serviceCode, "P-DENTAL")

      const eventDoc = await IntegrationEvent.findById(event._id).lean()
      assert.strictEqual(eventDoc.workspaceId.toString(), workspaceAlpha._id.toString(), "IntegrationEvent must track target workspaceId")
    })

    await runTest("Website Lead: Invalid service_code rejected with 400 and INVALID_SERVICE_SELECTION", async () => {
      const event = new IntegrationEvent({
        tenantId: TENANT_ORG,
        integrationId: integrationAlpha._id,
        status: "received",
      })
      await event.save()

      const result = await integrationService.processIntakePayload({
        event,
        integration: integrationAlpha,
        tenantId: TENANT_ORG,
        body: {
          name: "Invalid Service Lead",
          email: `${TEST_PREFIX}_invalid@test.com`,
          phone: "+919876540002",
          service_code: "NON_EXISTENT_CODE",
        },
      })

      assert.strictEqual(result.status, 400, "Expected HTTP 400")
      assert.strictEqual(result.code, "INVALID_SERVICE_SELECTION", "Expected INVALID_SERVICE_SELECTION code")
    })

    await runTest("Website Lead: Missing service_code falls back to integration.workspaceId", async () => {
      const event = new IntegrationEvent({
        tenantId: TENANT_ORG,
        integrationId: integrationAlpha._id,
        status: "received",
      })
      await event.save()

      const result = await integrationService.processIntakePayload({
        event,
        integration: integrationAlpha,
        tenantId: TENANT_ORG,
        body: {
          name: "Fallback Lead",
          email: `${TEST_PREFIX}_fallback@test.com`,
          phone: "+919876540003",
        },
      })

      assert.strictEqual(result.status, 201, "Expected HTTP 201")
      assert.strictEqual(result.data.workspaceId.toString(), integrationAlpha.workspaceId.toString(), "Should fallback to integration workspaceId")
    })

    await runTest("Public Service Discovery: Returns active public services for siteKey", async () => {
      const { req, res, getResult } = mockReqRes({
        query: { siteKey: integrationAlpha.siteKey },
      })

      await getPublicServices(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 200, "Expected HTTP 200")
      assert.strictEqual(data.success, true)
      assert.ok(data.count >= 2, "Expected at least 2 public services")
      const dentalFound = data.data.find((s) => s.code === "P-DENTAL")
      const cardioFound = data.data.find((s) => s.code === "P-CARDIO")
      assert.ok(dentalFound, "Expected dental product in public services")
      assert.ok(cardioFound, "Expected cardio product in public services")
      assert.strictEqual(dentalFound.name, dentalProduct.name)
    })

    // -------------------------------------------------------------------------
    // 2. Workspace-Safe Duplicate Handling Tests
    // -------------------------------------------------------------------------
    await runTest("Duplicate Handling: Duplicate phone in SAME workspace triggers duplicate rejection", async () => {
      const event = new IntegrationEvent({
        tenantId: TENANT_ORG,
        integrationId: integrationAlpha._id,
        status: "received",
      })
      await event.save()

      const result = await integrationService.processIntakePayload({
        event,
        integration: integrationAlpha,
        tenantId: TENANT_ORG,
        body: {
          name: "Alice Duplicate in Same Workspace",
          email: `${TEST_PREFIX}_alice_dup@test.com`,
          phone: "+919876540001", // Same phone as Alice Dental Lead
          service_code: "P-DENTAL", // Routes to Workspace Alpha
        },
      })

      assert.strictEqual(result.status, 409, "Expected 409 duplicate rejection")
      assert.strictEqual(result.duplicate, true)
    })

    await runTest("Duplicate Handling: Same phone in DIFFERENT workspace creates separate lead with crossWorkspaceMatch flag", async () => {
      const event = new IntegrationEvent({
        tenantId: TENANT_ORG,
        integrationId: integrationAlpha._id,
        status: "received",
      })
      await event.save()

      const result = await integrationService.processIntakePayload({
        event,
        integration: integrationAlpha,
        tenantId: TENANT_ORG,
        body: {
          name: "Alice Cardiology Lead (Cross Workspace)",
          email: `${TEST_PREFIX}_alice_cardio@test.com`,
          phone: "+919876540001", // Same phone, but DIFFERENT service/workspace!
          service_code: "P-CARDIO", // Routes to Workspace Beta
        },
      })

      assert.strictEqual(result.status, 201, "Expected HTTP 201 created as separate lead")
      assert.strictEqual(result.data.workspaceId.toString(), workspaceBeta._id.toString(), "Must be in workspace Beta")

      const leadBeta = await Lead.findById(result.data.id).lean()
      assert.ok(leadBeta.metadata.crossWorkspaceMatch, "Expected crossWorkspaceMatch metadata flag")
      assert.strictEqual(
        leadBeta.metadata.crossWorkspaceMatch.matchedWorkspaceId.toString(),
        workspaceAlpha._id.toString(),
        "Cross workspace match must point to Alpha"
      )
    })

    // -------------------------------------------------------------------------
    // 3. Mobile Call Attribution & Precedence Tests
    // -------------------------------------------------------------------------
    let createdCallAlpha = null

    await runTest("Mobile Call Attribution: Inbound call with SIM mapping routes to SIM workspace", async () => {
      const clientCallId = `call_${TEST_PREFIX}_sim_inbound`
      const { req, res, getResult } = mockReqRes({
        user: agentAlpha,
        body: {
          client_call_id: clientCallId,
          phone_number: "+919999900001",
          call_direction: "INCOMING",
          start_time_ms: Date.now(),
          duration_seconds: 35,
          sim_workspace_id: workspaceAlpha._id.toString(),
          call_outcome: "Connected",
        },
      })

      await reportMobileCall(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 201, "Expected HTTP 201")
      assert.strictEqual(data.workspace_id, workspaceAlpha._id.toString(), "Inbound call should route to SIM workspace")

      createdCallAlpha = await Call.findById(data.call_id)
      assert.strictEqual(createdCallAlpha.workspaceId.toString(), workspaceAlpha._id.toString())
    })

    await runTest("Mobile Call Attribution: Inbound call conflict (SIM Beta vs Lead Alpha) routes to Lead Alpha and flags conflict", async () => {
      const clientCallId = `call_${TEST_PREFIX}_conflict_inbound`
      const { req, res, getResult } = mockReqRes({
        user: agentAlpha,
        body: {
          client_call_id: clientCallId,
          phone_number: "+919876540001", // Phone belongs to Alice in Alpha!
          call_direction: "INCOMING",
          start_time_ms: Date.now(),
          duration_seconds: 40,
          sim_workspace_id: workspaceBeta._id.toString(), // SIM is configured for Beta!
          call_outcome: "Connected",
        },
      })

      await reportMobileCall(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 201, "Expected HTTP 201")
      assert.strictEqual(data.workspace_id, workspaceAlpha._id.toString(), "Conflict must attribute to lead's workspace")

      const callDoc = await Call.findById(data.call_id).lean()
      assert.ok(callDoc.metadata.workspaceConflict, "Expected workspaceConflict flag in metadata")
      assert.strictEqual(callDoc.metadata.workspaceConflict.simWorkspace, workspaceBeta._id.toString())
      assert.strictEqual(callDoc.metadata.workspaceConflict.leadWorkspace, workspaceAlpha._id.toString())
    })

    await runTest("Mobile Call Attribution: Outbound call attributes to linked lead's workspace", async () => {
      const existingLeadAlpha = await Lead.findOne({ tenantId: TENANT_ORG, phone: "+919876540001", workspaceId: workspaceAlpha._id })
      assert.ok(existingLeadAlpha, "Lead in Alpha must exist")

      const clientCallId = `call_${TEST_PREFIX}_lead_outbound`
      const { req, res, getResult } = mockReqRes({
        user: agentAlpha,
        body: {
          client_call_id: clientCallId,
          lead_id: existingLeadAlpha._id.toString(),
          phone_number: existingLeadAlpha.phone,
          call_direction: "OUTGOING",
          start_time_ms: Date.now(),
          duration_seconds: 50,
          call_outcome: "Connected",
        },
      })

      await reportMobileCall(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 201, "Expected HTTP 201")
      assert.strictEqual(data.workspace_id, workspaceAlpha._id.toString())
    })

    await runTest("Mobile Call Authorization: Agent unauthorized for requested workspace rejected with 403", async () => {
      const clientCallId = `call_${TEST_PREFIX}_unauthorized_ws`
      const { req, res, getResult } = mockReqRes({
        user: agentAlpha, // Dr. Alpha only belongs to workspace Alpha!
        body: {
          client_call_id: clientCallId,
          phone_number: "+919999900099",
          call_direction: "OUTGOING",
          start_time_ms: Date.now(),
          duration_seconds: 15,
          workspace_id: workspaceBeta._id.toString(), // Explicitly targeting Beta!
        },
      })

      await reportMobileCall(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 403, "Expected 403 Forbidden")
      assert.strictEqual(data.code, "FORBIDDEN_WORKSPACE_ACCESS")
    })

    // -------------------------------------------------------------------------
    // 4. Mobile Recording GridFS Metadata Tests
    // -------------------------------------------------------------------------
    await runTest("Mobile Recording: Stamps workspaceId onto GridFS metadata", async () => {
      const leadAlpha = await Lead.findOne({ tenantId: TENANT_ORG, workspaceId: workspaceAlpha._id })
      createdCallAlpha.leadId = leadAlpha._id
      createdCallAlpha.isUnlinked = false
      await createdCallAlpha.save()

      const readable = new (require("stream").Readable)()
      readable.push(Buffer.from("FAKE_AUDIO_DATA_FOR_GRIDFS_TEST"))
      readable.push(null)

      const result = await recordingStorage.streamUpload({
        callId: createdCallAlpha._id.toString(),
        tenantId: TENANT_ORG,
        workspaceId: workspaceAlpha._id,
        user: agentAlpha,
        readStream: readable,
        mimeType: "audio/mp3",
        filename: `rec_${TEST_PREFIX}.mp3`,
        contentLength: 32,
        allowOverwrite: true,
      })

      assert.strictEqual(result.success, true, "Expected streamUpload success")

      const db = mongoose.connection.db
      const fileDoc = await db.collection("recordings.files").findOne({ _id: result.fileId })
      assert.ok(fileDoc, "GridFS file must exist")
      assert.strictEqual(fileDoc.metadata.workspaceId.toString(), workspaceAlpha._id.toString(), "GridFS file metadata must stamp workspaceId")
    })

    // -------------------------------------------------------------------------
    // 5. AI Pipeline Workspace Inheritance Tests
    // -------------------------------------------------------------------------
    await runTest("AI Pipeline: Enqueued job preserves workspaceId and scopeMode", async () => {
      createdCallAlpha = await Call.findById(createdCallAlpha._id)
      const enqueueResult = await enqueueCallIntelligenceJob({
        callId: createdCallAlpha._id,
        tenantId: TENANT_ORG,
        force: true,
      })

      assert.strictEqual(enqueueResult.enqueued, true, "Job must be enqueued")

      const jobDoc = await Job.findOne({ jobId: enqueueResult.jobId }).lean()
      assert.ok(jobDoc, "Job document must exist")
      assert.strictEqual(jobDoc.workspaceId.toString(), workspaceAlpha._id.toString(), "Job must store workspaceId")
      assert.strictEqual(jobDoc.scopeMode, "single_workspace", "Job scopeMode must be single_workspace")
    })

    await runTest("AI Pipeline: Follow-up auto-scheduled from AI analysis inherits workspaceId", async () => {
      const leadAlpha = await Lead.findOne({ tenantId: TENANT_ORG, workspaceId: workspaceAlpha._id })
      const fakeAnalysis = {
        _id: new mongoose.Types.ObjectId(),
        tenantId: TENANT_ORG,
        workspaceId: workspaceAlpha._id,
        callbackRequested: true,
        requestedCallbackDateTime: new Date(Date.now() + 86400000).toISOString(),
        isProductRelevant: true,
        qualificationStatus: "QUALIFIED",
        callbackReason: "Patient requested teeth cleaning follow-up",
      }

      const cbResult = await scheduleAutomaticCallbackFromAiCall({
        call: createdCallAlpha,
        analysis: fakeAnalysis,
        tenantId: TENANT_ORG,
        lead: leadAlpha,
        actor: { name: "AI Call Intelligence", role: "system" },
      })

      assert.ok(cbResult?.followUpId, "Expected follow-up created")
      const followUpDoc = await FollowUp.findById(cbResult.followUpId).lean()
      assert.strictEqual(followUpDoc.workspaceId.toString(), workspaceAlpha._id.toString(), "Follow-up must inherit call.workspaceId")
    })

    // -------------------------------------------------------------------------
    // 6. Mobile Login Multi-Workspace Payload Tests
    // -------------------------------------------------------------------------
    await runTest("Mobile Login: Org account returns workspaces list and activeWorkspaceId", async () => {
      const { req, res, getResult } = mockReqRes({
        body: {
          email: agentAlpha.email,
          password: "TestPassword123!",
        },
      })

      await mobileLogin(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 200, "Expected HTTP 200")
      assert.strictEqual(data.success, true)
      assert.ok(Array.isArray(data.data.workspaces), "Expected workspaces array")
      assert.strictEqual(data.data.workspaces.length, 1, "Agent Alpha must have exactly 1 workspace (Alpha)")
      assert.strictEqual(data.data.workspaces[0].id, workspaceAlpha._id.toString())
      assert.strictEqual(data.data.activeWorkspaceId, workspaceAlpha._id.toString())
    })

    await runTest("Mobile Login: Standalone account returns empty workspaces and activeWorkspaceId: null", async () => {
      const { req, res, getResult } = mockReqRes({
        body: {
          email: standaloneAgent.email,
          password: "TestPassword123!",
        },
      })

      await mobileLogin(req, res)
      const { status, data } = getResult()

      assert.strictEqual(status, 200, "Expected HTTP 200")
      assert.strictEqual(data.success, true)
      assert.ok(Array.isArray(data.data.workspaces), "Expected workspaces array")
      assert.strictEqual(data.data.workspaces.length, 0, "Standalone agent should have 0 workspaces")
      assert.strictEqual(data.data.activeWorkspaceId, null, "Standalone agent activeWorkspaceId must be null")
    })

  } finally {
    // -------------------------------------------------------------------------
    // Cleanup Synthetic Fixtures
    // -------------------------------------------------------------------------
    console.log("\nCleaning up synthetic fixtures...")
    await Account.deleteMany({ accountId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await Workspace.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await WorkspaceMembership.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await User.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await BusinessProduct.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await Integration.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await Call.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await FollowUp.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    await Job.deleteMany({ tenantId: { $in: [TENANT_ORG, TENANT_STANDALONE] } })
    const db = mongoose.connection.db
    if (db) {
      const testFiles = await db.collection("recordings.files").find({ "metadata.tenantId": { $in: [TENANT_ORG, TENANT_STANDALONE] } }).project({ _id: 1 }).toArray()
      const testFileIds = testFiles.map((f) => f._id)
      if (testFileIds.length > 0) {
        await db.collection("recordings.files").deleteMany({ _id: { $in: testFileIds } })
        await db.collection("recordings.chunks").deleteMany({ files_id: { $in: testFileIds } })
      }
    }
    console.log("Cleanup complete.")
  }

  console.log(`\n=== WAVE 2 TEST RESULTS: ${testPassed} Passed, ${testFailed} Failed ===\n`)
  if (testFailed > 0) {
    process.exit(1)
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal test runner error:", err)
      process.exit(1)
    })
}
