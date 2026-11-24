/**
 * Automated Verification: Website Routing Security & Call Conflict Handling
 * 
 * Verifies:
 * 1. siteKey resolves to the correct parent tenant (cross-tenant header spoofing rejected).
 * 2. Selected routingCode must belong to that tenant (cross-tenant routingCode rejected with 400 INVALID_SERVICE_SELECTION).
 * 3. Inactive or invalid services rejected with 400 (INVALID_SERVICE_SELECTION).
 * 4. Public discovery never leaks private products or sensitive credentials.
 * 5. Standalone website forms work seamlessly without workspace configuration.
 * 6. SIM vs Lead workspace call conflict is preserved explicitly (metadata.workspaceConflict) for authorized review.
 * 7. AI processing and timeline activities inherit and preserve workspace identity.
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
const { Activity } = require("../models/Activity")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const integrationService = require("../services/integrationService")
const { getPublicServices } = require("../controllers/workspaceController")
const { reportMobileCall } = require("../controllers/mobileController")
const { syncLeadPipelineStatusFromAiCall } = require("../services/leadPipelineSync.service")

const TEST_PREFIX = `SYNTH_ROUTING_SEC_${Date.now()}`
const TENANT_A = `${TEST_PREFIX}_TENANT_A`
const TENANT_B = `${TEST_PREFIX}_TENANT_B`
const TENANT_STANDALONE = `${TEST_PREFIX}_STANDALONE`

async function runTests() {
  console.log("=== WEBSITE ROUTING SECURITY & CALL CONFLICT TEST SUITE ===")
  await connectDB()

  let passed = 0
  let failed = 0

  function pass(desc) {
    passed++
    console.log(`  [PASS] Test ${passed}: ${desc}`)
  }

  function fail(desc, err) {
    failed++
    console.error(`  [FAIL] Test ${passed + failed}: ${desc}`)
    console.error(err)
  }

  try {
    // -------------------------------------------------------------
    // FIXTURE SETUP
    // -------------------------------------------------------------
    // Accounts
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Tenant Alpha Hospital",
        displayName: "Tenant Alpha Hospital",
        adminEmail: `${TENANT_A}@test.local`,
        adminName: "Admin Alpha",
        adminUserId: new mongoose.Types.ObjectId(),
        status: "active",
        workspaceModeEnabled: true,
      },
      {
        accountId: TENANT_B,
        companyName: "Tenant Beta Clinic",
        displayName: "Tenant Beta Clinic",
        adminEmail: `${TENANT_B}@test.local`,
        adminName: "Admin Beta",
        adminUserId: new mongoose.Types.ObjectId(),
        status: "active",
        workspaceModeEnabled: true,
      },
      {
        accountId: TENANT_STANDALONE,
        companyName: "Tenant Standalone Agency",
        displayName: "Tenant Standalone Agency",
        adminEmail: `${TENANT_STANDALONE}@test.local`,
        adminName: "Admin Standalone",
        adminUserId: new mongoose.Types.ObjectId(),
        status: "active",
        workspaceModeEnabled: false,
      },
    ])

    // Workspaces
    const wsA1 = await Workspace.create({
      tenantId: TENANT_A,
      name: "Alpha Cardiology",
      slug: "alpha-cardio",
      status: "active",
      isDefault: true,
    })

    const wsA2 = await Workspace.create({
      tenantId: TENANT_A,
      name: "Alpha Neurology",
      slug: "alpha-neuro",
      status: "active",
      isDefault: false,
    })

    const wsB1 = await Workspace.create({
      tenantId: TENANT_B,
      name: "Beta Orthopedics",
      slug: "beta-ortho",
      status: "active",
      isDefault: true,
    })

    // Staff Users & Memberships
    const agentAlpha = await User.create({
      tenantId: TENANT_A,
      email: `${TEST_PREFIX}_agent_alpha@test.local`,
      name: "Alpha Staff",
      password: "SynthPass123!",
      role: "staff",
      status: "active",
    })

    await WorkspaceMembership.create({
      tenantId: TENANT_A,
      workspaceId: wsA1._id,
      userId: agentAlpha._id,
      role: "agent",
      status: "active",
    })

    // Products / Service Catalog
    // Public service in Tenant A
    const prodCardio = await BusinessProduct.create({
      tenantId: TENANT_A,
      name: "Cardiology Consultation",
      sku: "SRV-CARDIO",
      routingCode: "CARDIO",
      isPublicService: true,
      targetWorkspaceId: wsA1._id,
      status: "active",
      price: 1500,
    })

    // Inactive service in Tenant A
    const prodDermaInactive = await BusinessProduct.create({
      tenantId: TENANT_A,
      name: "Dermatology Screening",
      sku: "SRV-DERMA",
      routingCode: "DERMA",
      isPublicService: true,
      targetWorkspaceId: wsA2._id,
      status: "inactive",
      price: 1200,
    })

    // Confidential private product in Tenant A (NEVER for public discovery)
    const prodPrivateVip = await BusinessProduct.create({
      tenantId: TENANT_A,
      name: "VIP Executive Health Plan",
      sku: "VIP-PLAN",
      routingCode: "VIP_EXEC",
      isPublicService: false,
      targetWorkspaceId: wsA1._id,
      status: "active",
      price: 50000,
      metadata: { secretApiKey: "sk_live_secret_alpha_9988" },
    })

    // Public service in Tenant B
    const prodOrtho = await BusinessProduct.create({
      tenantId: TENANT_B,
      name: "Orthopedic Assessment",
      sku: "SRV-ORTHO",
      routingCode: "ORTHO",
      isPublicService: true,
      targetWorkspaceId: wsB1._id,
      status: "active",
      price: 2000,
    })

    // Integrations (Site Keys)
    const siteKeyAlpha = `sk_${TEST_PREFIX}_alpha_live`
    const siteKeyBeta = `sk_${TEST_PREFIX}_beta_live`
    const siteKeyStandalone = `sk_${TEST_PREFIX}_standalone_live`

    const integAlpha = await Integration.create({
      tenantId: TENANT_A,
      type: "website",
      name: "Alpha Hospital Main Website",
      siteKey: siteKeyAlpha,
      status: "active",
      settings: {
        allowedOrigins: ["https://alpha-hospital.local"],
      },
      workspaceId: wsA1._id,
    })

    const integBeta = await Integration.create({
      tenantId: TENANT_B,
      type: "website",
      name: "Beta Clinic Website",
      siteKey: siteKeyBeta,
      status: "active",
      settings: {
        allowedOrigins: ["https://beta-clinic.local"],
      },
      workspaceId: wsB1._id,
    })

    const integStandalone = await Integration.create({
      tenantId: TENANT_STANDALONE,
      type: "website",
      name: "Standalone Agency Website",
      siteKey: siteKeyStandalone,
      status: "active",
      settings: {
        allowedOrigins: ["https://standalone.local"],
      },
    })

    // -------------------------------------------------------------
    // TEST 1: siteKey resolves to parent tenant & prevents tenant spoofing
    // -------------------------------------------------------------
    try {
      const result = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyAlpha,
        incomingOrigin: "https://alpha-hospital.local",
        headers: {
          "x-tenant-id": TENANT_B, // Malicious spoofing attempt
        },
        body: {
          name: "Amit Kumar",
          email: `${TEST_PREFIX}_amit@test.local`,
          phone: "+919876500111",
          service_code: "CARDIO",
        },
      })

      assert.strictEqual(result.success, true, "Submission must succeed")
      const createdLead = await Lead.findById(result.data.id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(createdLead.tenantId, TENANT_A, "Lead must be assigned to Tenant A resolved from siteKey")
      assert.notStrictEqual(createdLead.tenantId, TENANT_B, "Spoofed x-tenant-id header must be ignored")
      assert.strictEqual(createdLead.workspaceId.toString(), wsA1._id.toString(), "Lead must route to Cardio workspace")
      pass("siteKey resolves to parent tenant and ignores cross-tenant header spoofing")
    } catch (e) {
      fail("siteKey resolves to parent tenant and ignores cross-tenant header spoofing", e)
    }

    // -------------------------------------------------------------
    // TEST 2: Selected routingCode must belong to target tenant
    // -------------------------------------------------------------
    try {
      // Attempt to submit Tenant B's routing code "ORTHO" with Tenant A's siteKey
      const result = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyAlpha,
        incomingOrigin: "https://alpha-hospital.local",
        headers: {},
        body: {
          name: "Cross Tenant Attacker",
          email: `${TEST_PREFIX}_attacker@test.local`,
          phone: "+919876500112",
          service_code: "ORTHO", // Belongs to Tenant B!
        },
      })

      assert.strictEqual(result.success, false, "Must reject cross-tenant routingCode")
      assert.strictEqual(result.status, 400, "Must return HTTP 400")
      assert.strictEqual(result.code, "INVALID_SERVICE_SELECTION", "Must return INVALID_SERVICE_SELECTION code")
      pass("Selected routingCode from foreign tenant is rejected with 400 INVALID_SERVICE_SELECTION")
    } catch (e) {
      fail("Selected routingCode from foreign tenant is rejected with 400 INVALID_SERVICE_SELECTION", e)
    }

    // -------------------------------------------------------------
    // TEST 3: Inactive services rejected with 400 INVALID_SERVICE_SELECTION
    // -------------------------------------------------------------
    try {
      const result = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyAlpha,
        incomingOrigin: "https://alpha-hospital.local",
        headers: {},
        body: {
          name: "Skin Patient",
          email: `${TEST_PREFIX}_skin@test.local`,
          phone: "+919876500113",
          service_code: "DERMA", // Inactive in Tenant A
        },
      })

      assert.strictEqual(result.success, false, "Must reject inactive service")
      assert.strictEqual(result.status, 400, "Must return HTTP 400")
      assert.strictEqual(result.code, "INVALID_SERVICE_SELECTION", "Must return INVALID_SERVICE_SELECTION")
      pass("Inactive service is rejected with 400 INVALID_SERVICE_SELECTION")
    } catch (e) {
      fail("Inactive service is rejected with 400 INVALID_SERVICE_SELECTION", e)
    }

    // -------------------------------------------------------------
    // TEST 4: Unknown / nonexistent service code rejected with 400
    // -------------------------------------------------------------
    try {
      const result = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyAlpha,
        incomingOrigin: "https://alpha-hospital.local",
        headers: {},
        body: {
          name: "Random Caller",
          email: `${TEST_PREFIX}_random@test.local`,
          phone: "+919876500114",
          service_code: "SPACE_TOURISM_999",
        },
      })

      assert.strictEqual(result.success, false, "Must reject unknown service code")
      assert.strictEqual(result.status, 400, "Must return HTTP 400")
      assert.strictEqual(result.code, "INVALID_SERVICE_SELECTION", "Must return INVALID_SERVICE_SELECTION")
      pass("Nonexistent service code is rejected with 400 INVALID_SERVICE_SELECTION")
    } catch (e) {
      fail("Nonexistent service code is rejected with 400 INVALID_SERVICE_SELECTION", e)
    }

    // -------------------------------------------------------------
    // TEST 5: Public discovery never leaks private products or credentials
    // -------------------------------------------------------------
    try {
      const req = {
        query: { siteKey: siteKeyAlpha },
        header: () => "https://alpha-hospital.local",
      }
      let resData = null
      let statusCode = 200
      const res = {
        status: (code) => {
          statusCode = code
          return res
        },
        json: (data) => {
          resData = data
          return res
        },
      }

      await getPublicServices(req, res)

      assert.strictEqual(statusCode, 200, "Public discovery returns 200")
      assert.strictEqual(resData.success, true, "Success true")
      const services = resData.data

      // Must include active public Cardiology service
      const cardio = services.find((s) => s.code === "CARDIO")
      assert.ok(cardio, "Active public service CARDIO must be returned")

      // Must NOT include inactive service
      const derma = services.find((s) => s.code === "DERMA")
      assert.strictEqual(derma, undefined, "Inactive service DERMA must not be returned")

      // Must NOT include private VIP product
      const vip = services.find((s) => s.code === "VIP_EXEC")
      assert.strictEqual(vip, undefined, "Private product VIP_EXEC must not be returned in public discovery")

      // Check for zero leakage of credentials/secret keys
      const serializedJson = JSON.stringify(resData)
      assert.strictEqual(serializedJson.includes("sk_live_secret"), false, "Credentials must never leak")
      assert.strictEqual(serializedJson.includes("secretApiKey"), false, "Internal metadata must never leak")
      pass("Public discovery never leaks private products or internal credentials")
    } catch (e) {
      fail("Public discovery never leaks private products or internal credentials", e)
    }

    // -------------------------------------------------------------
    // TEST 6: Standalone website forms work without workspace configuration
    // -------------------------------------------------------------
    try {
      const result = await integrationService.intakeWebhookPayload({
        rawSiteKey: siteKeyStandalone,
        incomingOrigin: "https://standalone.local",
        headers: {},
        body: {
          name: "Standalone Client",
          email: `${TEST_PREFIX}_standalone@test.local`,
          phone: "+919876500115",
          message: "Standard inquiry without any workspace",
        },
      })

      assert.strictEqual(result.success, true, "Standalone lead submission must succeed")
      assert.ok(result.status === 200 || result.status === 201, "Returns 200 OK or 201 Created")
      const lead = await Lead.findById(result.data.id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(lead.tenantId, TENANT_STANDALONE, "Matches standalone tenant")
      assert.strictEqual(lead.workspaceId, null, "Standalone lead has workspaceId: null")
      pass("Standalone website forms work without workspace configuration (Mode A)")
    } catch (e) {
      fail("Standalone website forms work without workspace configuration (Mode A)", e)
    }

    // -------------------------------------------------------------
    // TEST 7: Call Conflict Handling: SIM vs Lead Workspace conflict preserved
    // -------------------------------------------------------------
    try {
      // Create a Lead belonging to Alpha Neurology (wsA2)
      const leadInNeuro = await Lead.create({
        tenantId: TENANT_A,
        workspaceId: wsA2._id,
        name: "Vikram Malhotra",
        phone: "+919876500116",
        phoneNormalized: "+919876500116",
        status: "Engaged",
      })

      // Admin user reporting call
      const adminUserId = new mongoose.Types.ObjectId()
      const adminUser = {
        id: adminUserId,
        _id: adminUserId,
        tenantId: TENANT_A,
        role: "account_admin",
        name: "Admin Alpha",
      }

      // Incoming call on SIM mapped to wsA1 (Cardiology), but lead is in wsA2 (Neurology)
      const req = {
        body: {
          client_call_id: `call_${TEST_PREFIX}_conflict_1`,
          lead_id: leadInNeuro._id.toString(),
          phone_number: "+919876500116",
          call_direction: "INCOMING",
          start_time_ms: Date.now() - 60000,
          duration_seconds: 45,
          call_outcome: "Connected",
          sim_workspace_id: wsA1._id.toString(), // SIM mapped to wsA1
        },
        headers: {},
        user: adminUser,
      }

      let resData = null
      let statusCode = 200
      const res = {
        status: (code) => {
          statusCode = code
          return res
        },
        json: (data) => {
          resData = data
          return res
        },
      }

      await reportMobileCall(req, res)

      assert.strictEqual(statusCode, 201, "Call report must succeed")
      assert.strictEqual(resData.success, true, "Success true")

      // Verify the recorded Call document
      const recordedCall = await Call.findOne({ clientCallId: `call_${TEST_PREFIX}_conflict_1` })
        .setOptions({ skipTenantFilter: true })
        .lean()

      assert.ok(recordedCall, "Call document must exist")
      // Resolves to lead's workspace wsA2
      assert.strictEqual(recordedCall.workspaceId.toString(), wsA2._id.toString(), "Attributed to lead workspace wsA2")

      // Explicitly preserved in metadata.workspaceConflict
      assert.ok(recordedCall.metadata?.workspaceConflict, "Conflict must be preserved in metadata.workspaceConflict")
      assert.strictEqual(
        recordedCall.metadata.workspaceConflict.simWorkspace.toString(),
        wsA1._id.toString(),
        "Preserves simWorkspace wsA1"
      )
      assert.strictEqual(
        recordedCall.metadata.workspaceConflict.leadWorkspace.toString(),
        wsA2._id.toString(),
        "Preserves leadWorkspace wsA2"
      )

      // Verify queryability for administrative conflict review
      const reviewableConflicts = await Call.find({
        tenantId: TENANT_A,
        "metadata.workspaceConflict": { $exists: true },
      })
        .setOptions({ skipTenantFilter: true })
        .lean()

      assert.strictEqual(reviewableConflicts.length, 1, "Conflict is queryable for authorized administrative review")
      pass("Call conflict (SIM vs Lead workspace) is explicitly preserved in metadata.workspaceConflict for administrative review")
    } catch (e) {
      fail("Call conflict (SIM vs Lead workspace) is explicitly preserved in metadata.workspaceConflict for administrative review", e)
    }

    // -------------------------------------------------------------
    // TEST 8: AI & CRM Activity Propagation preserves workspace identity
    // -------------------------------------------------------------
    try {
      const leadForAi = await Lead.create({
        tenantId: TENANT_A,
        workspaceId: wsA1._id,
        name: "Pooja Hegde",
        phone: "+919876500117",
        phoneNormalized: "+919876500117",
        status: "New",
      })

      const callForAi = await Call.create({
        tenantId: TENANT_A,
        workspaceId: wsA1._id,
        agentId: new mongoose.Types.ObjectId(),
        clientCallId: `call_${TEST_PREFIX}_ai_prop_1`,
        leadId: leadForAi._id,
        phoneNumber: "+919876500117",
        callDirection: "OUTGOING",
        startTimeMs: Date.now() - 120000,
        durationSeconds: 90,
      })

      const analysis = {
        status: "COMPLETED",
        callOutcome: "INTERESTED",
        sentiment: "positive",
        callSentimentScore: 0.85,
        qualificationStatus: "QUALIFIED",
        qualificationReason: "High purchase intent",
        productRelevanceScore: 0.9,
      }

      await syncLeadPipelineStatusFromAiCall({
        tenantId: TENANT_A,
        call: callForAi,
        analysis,
        actor: { name: "AI Sync Test", role: "system" },
      })

      // Check updated Lead
      const updatedLead = await Lead.findById(leadForAi._id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(updatedLead.status, "Engaged", "Lead status updated to Engaged")
      assert.strictEqual(updatedLead.workspaceId.toString(), wsA1._id.toString(), "Lead workspaceId preserved")

      // Check Activity Timeline event
      const recordedActivity = await Activity.findOne({
        leadId: leadForAi._id,
        type: "lead.status_changed",
      })
        .setOptions({ skipTenantFilter: true })
        .lean()

      assert.ok(recordedActivity, "Activity record must be created")
      assert.strictEqual(
        recordedActivity.workspaceId.toString(),
        wsA1._id.toString(),
        "Activity document inherits and preserves workspaceId"
      )
      pass("AI & CRM Activity Timeline propagation preserves workspace identity")
    } catch (e) {
      fail("AI & CRM Activity Timeline propagation preserves workspace identity", e)
    }
  } finally {
    // -------------------------------------------------------------
    // CLEANUP SYNTHETIC FIXTURES
    // -------------------------------------------------------------
    console.log("Cleaning up synthetic fixtures...")
    const tenantRegex = new RegExp(`^${TEST_PREFIX}`)
    await Account.deleteMany({ accountId: tenantRegex })
    await User.deleteMany({ email: tenantRegex })
    await Workspace.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await WorkspaceMembership.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await BusinessProduct.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await Integration.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await Call.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await Activity.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } })
    await mongoose.connection.close()
  }

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`)
  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err)
  process.exit(1)
})
