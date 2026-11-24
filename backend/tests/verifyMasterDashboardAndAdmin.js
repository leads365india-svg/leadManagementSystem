/**
 * Verification Test: Wave 3 — Master Dashboard & Workspace Administration
 *
 * Verifies:
 * 1. Mode A Standalone account compatibility (no forced workspace, zero regression)
 * 2. Multi-workspace toggle & Workspace CRUD
 * 3. Master Dashboard aggregation for Org Admin across multiple projects
 * 4. Regular staff 403 restriction from Master Dashboard & foreign workspaces
 * 5. Single identity employee membership & immediate revocation
 * 6. Review queue retrieval and unassigned lead/call reassignment
 * 7. Workspace activation / inactivation status handling
 * 8. Complete synthetic data cleanup
 */

const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

process.env.NODE_ENV = "test"
const app = require("../start")
const request = require("supertest")(app)

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/leadflow"
const JWT_SECRET = process.env.JWT_SECRET || "leadflow_secret_key"

// Models
const Account = require("../models/Account")
const User = require("../models/User")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")

let createdTenantIds = []
let createdUserIds = []
let createdWorkspaceIds = []
let createdLeadIds = []
let createdCallIds = []

const makeToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      userId: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )
}

async function runTests() {
  console.log("=== WAVE 3: MASTER DASHBOARD & WORKSPACE ADMINISTRATION VERIFICATION ===")

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI)
  }

  const prefix = `SYNTH_W3_${Date.now()}`
  const standaloneTenantId = `${prefix}_STANDALONE`
  const multiWsTenantId = `${prefix}_MULTI`
  createdTenantIds.push(standaloneTenantId, multiWsTenantId)

  let passed = 0
  let failed = 0

  const assert = (condition, msg) => {
    if (condition) {
      console.log(`  [PASS] ${msg}`)
      passed++
    } else {
      console.error(`  [FAIL] ${msg}`)
      failed++
    }
  }

  try {
    // -------------------------------------------------------------
    // 1. SETUP STANDALONE ACCOUNT (MODE A)
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 1: MODE A STANDALONE ACCOUNT COMPATIBILITY ---")
    const standaloneAdmin = await User.create({
      tenantId: standaloneTenantId,
      name: "Standalone Admin",
      email: `${prefix}_admin@standalone.com`,
      role: "account_admin",
      status: "active",
      password: "hashedpassword123",
    })
    createdUserIds.push(standaloneAdmin._id)

    const standaloneAccount = await Account.create({
      accountId: standaloneTenantId,
      companyName: "Standalone Corp",
      displayName: "Standalone Corp",
      adminName: "Standalone Admin",
      adminEmail: `${prefix}_admin@standalone.com`,
      adminUserId: standaloneAdmin._id,
      workspaceModeEnabled: false,
      status: "active",
    })

    const standaloneAdminToken = makeToken(standaloneAdmin)

    // Test 1.1: Listing workspaces returns workspaceModeEnabled: false
    const listRes = await request
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${standaloneAdminToken}`)

    assert(listRes.status === 200, "Standalone account can list workspaces (returns 200)")
    assert(listRes.body.workspaceModeEnabled === false, "workspaceModeEnabled is false for Standalone Mode A")
    assert(listRes.body.count === 0, "No workspaces returned for Standalone Mode A")

    // Test 1.2: Mode A CRM Lead operations function without workspace headers
    const leadA = await Lead.create({
      tenantId: standaloneTenantId,
      name: "Standalone Lead",
      phone: "+1555000001",
      email: "lead@standalone.com",
      status: "New",
      source: "Manual",
    })
    createdLeadIds.push(leadA._id)

    const leadListRes = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${standaloneAdminToken}`)

    assert(leadListRes.status === 200, "Standalone Mode A lead listing succeeds without workspace header")
    assert(
      (leadListRes.body.data?.leads || leadListRes.body.leads || []).some((l) => l.name === "Standalone Lead"),
      "Mode A lead is returned correctly in standalone context"
    )

    // -------------------------------------------------------------
    // 2. SETUP MULTI-WORKSPACE ACCOUNT (MODE B)
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 2: MULTI-WORKSPACE TOGGLE & CRUD ---")
    const orgAdmin = await User.create({
      tenantId: multiWsTenantId,
      name: "Org Administrator",
      email: `${prefix}_orgadmin@multi.com`,
      role: "account_admin",
      status: "active",
      password: "hashedpassword123",
    })
    createdUserIds.push(orgAdmin._id)
    const orgAdminToken = makeToken(orgAdmin)

    const multiAccount = await Account.create({
      accountId: multiWsTenantId,
      companyName: "Multi Projects Group",
      displayName: "Multi Projects Group",
      adminName: "Org Administrator",
      adminEmail: `${prefix}_orgadmin@multi.com`,
      adminUserId: orgAdmin._id,
      workspaceModeEnabled: false, // Initially false, will toggle
      status: "active",
    })

    // Regular employee
    const staffUser = await User.create({
      tenantId: multiWsTenantId,
      name: "Field Agent",
      email: `${prefix}_agent@multi.com`,
      role: "agent",
      status: "active",
      password: "hashedpassword123",
    })
    createdUserIds.push(staffUser._id)
    const staffToken = makeToken(staffUser)

    // Test 2.1: Org Admin enables multi-workspace mode
    const toggleRes = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ enabled: true })

    assert(toggleRes.status === 200, "Org Admin successfully toggles multi-workspace mode")
    assert(toggleRes.body.workspaceModeEnabled === true, "workspaceModeEnabled is now true")

    // Test 2.2: Org Admin creates Workspace Alpha & Workspace Beta
    const createWs1Res = await request
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        name: "Commercial Real Estate",
        slug: "commercial-re",
        description: "Commercial properties division",
        isDefault: true,
        branding: { primaryColor: "#4f46e5" },
      })

    assert(createWs1Res.status === 201, "Created Workspace Alpha (Commercial Real Estate)")
    const wsAlphaId = createWs1Res.body.data?._id || createWs1Res.body.data?.id
    createdWorkspaceIds.push(wsAlphaId)

    const createWs2Res = await request
      .post("/api/workspaces")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        name: "Residential Homes",
        slug: "residential-homes",
        description: "Residential properties division",
        isDefault: false,
        branding: { primaryColor: "#059669" },
      })

    assert(createWs2Res.status === 201, "Created Workspace Beta (Residential Homes)")
    const wsBetaId = createWs2Res.body.data?._id || createWs2Res.body.data?.id
    createdWorkspaceIds.push(wsBetaId)

    // -------------------------------------------------------------
    // 3. MASTER DASHBOARD AGGREGATION & RBAC RESTRICTION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 3: MASTER DASHBOARD AGGREGATION & RBAC ---")

    // Seed leads and followups across both workspaces
    const lead1 = await Lead.create({
      tenantId: multiWsTenantId,
      workspaceId: wsAlphaId,
      name: "Alpha Lead 1",
      phone: "+1555111001",
      status: "Closed-Won",
      source: "Website",
    })
    const lead2 = await Lead.create({
      tenantId: multiWsTenantId,
      workspaceId: wsBetaId,
      name: "Beta Lead 1",
      phone: "+1555222001",
      status: "New",
      source: "Referral",
    })
    createdLeadIds.push(lead1._id, lead2._id)

    const fu1 = await FollowUp.create({
      tenantId: multiWsTenantId,
      workspaceId: wsAlphaId,
      leadId: lead1._id,
      title: "Contract review",
      status: "pending",
      type: "meeting",
      scheduledAt: new Date(),
    })

    const call1 = await Call.create({
      tenantId: multiWsTenantId,
      workspaceId: wsAlphaId,
      agentId: orgAdmin._id,
      agentName: orgAdmin.name,
      callerNumber: "+1555111001",
      agentNumber: "+1555999000",
      number: "+1555111001",
      duration: 120,
      direction: "outbound",
    })
    createdCallIds.push(call1._id)

    // Test 3.1: Org Admin calls /api/workspaces/dashboard/master
    const masterRes = await request
      .get("/api/workspaces/dashboard/master")
      .set("Authorization", `Bearer ${orgAdminToken}`)

    console.log("Master Dashboard Response:", JSON.stringify(masterRes.body, null, 2))

    assert(masterRes.status === 200, "Org Admin successfully accesses Master Dashboard (200 OK)")
    assert(masterRes.body.data?.kpis?.totalLeads >= 2, `Master KPI aggregates leads (${masterRes.body.data?.kpis?.totalLeads})`)
    assert(masterRes.body.data?.kpis?.wonLeads >= 1, "Master KPI counts won leads")
    assert(masterRes.body.data?.projects?.length >= 2, `Master Dashboard lists project breakdown (${masterRes.body.data?.projects?.length} projects)`)

    const projAlpha = masterRes.body.data?.projects?.find((p) => p.slug === "commercial-re")
    assert(projAlpha && projAlpha.totalLeads >= 1, "Commercial Real Estate project shows lead volume")
    assert(projAlpha && projAlpha.wonLeads >= 1, "Commercial Real Estate project shows won deal")

    // Test 3.2: Regular staff accessing Master Dashboard is rejected with 403
    const staffMasterRes = await request
      .get("/api/workspaces/dashboard/master")
      .set("Authorization", `Bearer ${staffToken}`)

    assert(staffMasterRes.status === 403, "Regular staff accessing Master Dashboard is strictly rejected with HTTP 403")

    // -------------------------------------------------------------
    // 4. EMPLOYEE SINGLE IDENTITY & IMMEDIATE ACCESS REVOCATION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 4: MEMBERSHIP & IMMEDIATE REVOCATION ---")

    // Test 4.1: Assign staff user to Workspace Alpha
    const addMemberRes = await request
      .post(`/api/workspaces/${wsAlphaId}/members`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        userId: staffUser._id,
        role: "agent",
      })

    console.log("Add Member Response:", addMemberRes.status, JSON.stringify(addMemberRes.body, null, 2))

    assert(addMemberRes.status === 201, "Staff assigned to Workspace Alpha")

    // Test 4.2: Staff user lists accessible workspaces -> sees ONLY Alpha
    const staffWsRes = await request
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${staffToken}`)

    assert(staffWsRes.status === 200, "Staff lists workspaces")
    const staffAccessibleIds = (staffWsRes.body.data || []).map((w) => (w._id || w.id)?.toString())
    assert(staffAccessibleIds.includes(wsAlphaId.toString()), "Staff has access to Workspace Alpha")
    assert(!staffAccessibleIds.includes(wsBetaId.toString()), "Staff does NOT have access to foreign Workspace Beta")

    // Test 4.3: Staff user accessing foreign Workspace Beta via header is rejected
    const foreignAccessRes = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${staffToken}`)
      .set("x-workspace-id", wsBetaId.toString())

    assert(
      foreignAccessRes.status === 403,
      "Staff accessing foreign workspace via x-workspace-id header is rejected with HTTP 403"
    )

    // Test 4.4: Immediate revocation upon membership removal
    const revokeRes = await request
      .delete(`/api/workspaces/${wsAlphaId}/members/${staffUser._id}`)
      .set("Authorization", `Bearer ${orgAdminToken}`)

    assert(revokeRes.status === 200, "Membership revoked from Workspace Alpha")

    // Verify staff user is immediately rejected from Alpha now
    const revokedAccessRes = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${staffToken}`)
      .set("x-workspace-id", wsAlphaId.toString())

    assert(
      revokedAccessRes.status === 403,
      "Staff is immediately rejected (403) from workspace after membership revocation"
    )

    // -------------------------------------------------------------
    // 5. REVIEW QUEUE & UNASSIGNED ITEM REASSIGNMENT
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 5: REVIEW QUEUE & ITEM REASSIGNMENT ---")

    // Create an unassigned lead and a conflict call
    const unassignedLead = await Lead.create({
      tenantId: multiWsTenantId,
      workspaceId: null,
      name: "Unassigned Inquirer",
      phone: "+1555333001",
      email: "unassigned@multi.com",
      status: "New",
      source: "Website Direct",
    })
    createdLeadIds.push(unassignedLead._id)

    const unassignedFollowUp = await FollowUp.create({
      tenantId: multiWsTenantId,
      workspaceId: null,
      leadId: unassignedLead._id,
      title: "Initial Outreach",
      status: "pending",
      type: "call",
      scheduledAt: new Date(),
    })

    const conflictCall = await Call.create({
      tenantId: multiWsTenantId,
      workspaceId: null,
      agentId: orgAdmin._id,
      agentName: orgAdmin.name,
      callerNumber: "+1555444001",
      agentNumber: "+1555999000",
      number: "+1555444001",
      duration: 45,
      direction: "inbound",
      metadata: {
        workspaceConflict: true,
        conflictReason: "Multiple workspace routing match",
      },
    })
    createdCallIds.push(conflictCall._id)

    // Test 5.1: Org Admin fetches unassigned review queue
    const queueRes = await request
      .get("/api/workspaces/unassigned/queue")
      .set("Authorization", `Bearer ${orgAdminToken}`)

    assert(queueRes.status === 200, "Org Admin fetches review queue (200 OK)")
    const foundUnassignedLead = queueRes.body.data?.unassignedLeads?.some(
      (l) => l._id.toString() === unassignedLead._id.toString()
    )
    const foundConflictCall = queueRes.body.data?.conflictCalls?.some(
      (c) => c._id.toString() === conflictCall._id.toString()
    )
    assert(foundUnassignedLead, "Review queue contains unassigned lead")
    assert(foundConflictCall, "Review queue contains conflict call")

    // Test 5.2: Reassign unassigned lead to Workspace Beta
    const assignLeadRes = await request
      .post("/api/workspaces/unassigned/assign")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        itemType: "lead",
        itemId: unassignedLead._id,
        targetWorkspaceId: wsBetaId,
      })

    assert(assignLeadRes.status === 200, "Successfully assigned unassigned lead to Workspace Beta")

    // Verify in database: lead and its follow-up now have workspaceId == wsBetaId
    const updatedLeadDoc = await Lead.findById(unassignedLead._id).lean()
    const updatedFuDoc = await FollowUp.findById(unassignedFollowUp._id).lean()
    assert(
      updatedLeadDoc.workspaceId?.toString() === wsBetaId.toString(),
      "Lead document workspaceId updated to Workspace Beta"
    )
    assert(
      updatedFuDoc.workspaceId?.toString() === wsBetaId.toString(),
      "Linked follow-up workspaceId updated to Workspace Beta"
    )

    // Test 5.3: Reassign conflict call to Workspace Alpha
    const assignCallRes = await request
      .post("/api/workspaces/unassigned/assign")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({
        itemType: "call",
        itemId: conflictCall._id,
        targetWorkspaceId: wsAlphaId,
      })

    assert(assignCallRes.status === 200, "Successfully attributed conflict call to Workspace Alpha")

    const updatedCallDoc = await Call.findById(conflictCall._id).lean()
    assert(
      updatedCallDoc.workspaceId?.toString() === wsAlphaId.toString(),
      "Call workspaceId updated to Workspace Alpha"
    )
    assert(
      updatedCallDoc.metadata?.workspaceConflict === false,
      "Call workspaceConflict flag cleared"
    )

    // -------------------------------------------------------------
    // 6. WORKSPACE STATUS & INACTIVATION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 6: WORKSPACE STATUS UPDATES ---")
    const updateStatusRes = await request
      .put(`/api/workspaces/${wsBetaId}`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ status: "inactive" })

    assert(updateStatusRes.status === 200, "Org Admin successfully updated workspace status to inactive")
    const betaWsDoc = await Workspace.findById(wsBetaId).lean()
    assert(betaWsDoc.status === "inactive", "Workspace Beta status verified as 'inactive' in database")

  } catch (err) {
    console.error("Test execution exception:", err)
    failed++
  } finally {
    // -------------------------------------------------------------
    // 7. CLEANUP SYNTHETIC TEST DATA
    // -------------------------------------------------------------
    console.log("\n--- CLEANUP SYNTHETIC FIXTURES ---")
    await Promise.all([
      Account.deleteMany({ accountId: { $in: createdTenantIds } }),
      User.deleteMany({ tenantId: { $in: createdTenantIds } }),
      Workspace.deleteMany({ tenantId: { $in: createdTenantIds } }),
      WorkspaceMembership.deleteMany({ tenantId: { $in: createdTenantIds } }),
      Lead.deleteMany({ tenantId: { $in: createdTenantIds } }),
      Call.deleteMany({ tenantId: { $in: createdTenantIds } }),
      FollowUp.deleteMany({ tenantId: { $in: createdTenantIds } }),
    ])
    console.log("Synthetic fixtures cleanly removed.")

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`)
    process.exit(failed > 0 ? 1 : 0)
  }
}

runTests()
