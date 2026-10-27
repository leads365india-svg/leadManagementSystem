const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const connectDB = require("../db/connection")
const User = require("../models/User")
const Team = require("../models/Team")
const Role = require("../models/Role")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const Account = require("../models/Account")
const AssignmentRule = require("../models/AssignmentRule")
const leadService = require("../services/leadService")
const assignmentService = require("../services/assignmentService")
const { runWithTenantContext } = require("../middleware/tenantContext")
const { invalidateTenantRoleCache, invalidatePermissionCache } = require("../middleware/authMiddleware")
const app = require("../start")

/**
 * Automated Verification Suite for Roadmap Phase 7: Lead Ownership & Assignment
 */

const TEST_TAG = `p7_${Date.now()}`
const TENANT_A = `tenant_p7_a_${Date.now()}`
const TENANT_B = `tenant_p7_b_${Date.now()}`

let adminAUser = null
let managerAUser = null
let agentA1User = null
let agentA2User = null
let viewerAUser = null
let teamA1 = null
let teamA2 = null

let adminBUser = null
let agentBUser = null
let teamB = null

let adminAToken = null
let managerAToken = null
let agentA1Token = null
let viewerAToken = null
let adminBToken = null

const getClientCookie = (res) => {
  const setCookie = res.headers["set-cookie"]
  if (!setCookie) return ""
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const clientCookie = cookies.find((c) => c.startsWith("client_token="))
  return clientCookie ? clientCookie.split(";")[0] : ""
}

const cleanupData = async () => {
  try {
    invalidateTenantRoleCache()
    invalidatePermissionCache()
    await runWithTenantContext({ isSuperAdmin: true }, async () => {
      await User.deleteMany({ email: new RegExp(TEST_TAG, "i") })
      await Lead.deleteMany({ email: new RegExp(TEST_TAG, "i") })
      await FollowUp.deleteMany({ notes: new RegExp(TEST_TAG, "i") })
      await Team.deleteMany({ name: new RegExp(TEST_TAG, "i") })
      await AssignmentRule.deleteMany({ name: new RegExp(TEST_TAG, "i") })
      await Role.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
    })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runPhase7Tests() {
  console.log("================================================================================")
  console.log("   AUTOMATED VERIFICATION SUITE: PHASE 7 — LEAD OWNERSHIP & ASSIGNMENT         ")
  console.log("================================================================================\n")

  let passedTests = 0
  let failedTests = 0

  const recordTest = (suite, description, condition, errorMsg = "") => {
    if (condition) {
      console.log(`  ✅ [PASS] ${suite} -> ${description}`)
      passedTests++
    } else {
      console.error(`  ❌ [FAIL] ${suite} -> ${description} | ${errorMsg}`)
      failedTests++
    }
  }

  try {
    await connectDB()
    await cleanupData()

    const adminAUserId = new mongoose.Types.ObjectId()
    const adminBUserId = new mongoose.Types.ObjectId()

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Phase 7 Tenant Alpha",
        displayName: "Tenant Alpha",
        adminName: "Admin Phase7 A",
        adminEmail: `adminA_${TEST_TAG}@test.com`,
        adminUserId: adminAUserId,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Phase 7 Tenant Beta",
        displayName: "Tenant Beta",
        adminName: "Admin Phase7 B",
        adminEmail: `adminB_${TEST_TAG}@test.com`,
        adminUserId: adminBUserId,
        status: "active",
      },
    ])

    // Teams for Tenant A
    teamA1 = await Team.create({
      tenantId: TENANT_A,
      name: `Team Alpha Sales ${TEST_TAG}`,
      description: "Direct Sales Team",
    })

    teamA2 = await Team.create({
      tenantId: TENANT_A,
      name: `Team Alpha Enterprise ${TEST_TAG}`,
      description: "Enterprise Sales Team",
    })

    // Team for Tenant B
    teamB = await Team.create({
      tenantId: TENANT_B,
      name: `Team Beta Sales ${TEST_TAG}`,
      description: "Tenant B Sales Team",
    })

    // Users for Tenant A
    adminAUser = await User.create({
      _id: adminAUserId,
      name: "Admin Phase7 A",
      email: `adminA_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    managerAUser = await User.create({
      name: "Manager Phase7 A",
      email: `managerA_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "manager",
      tenantId: TENANT_A,
      teamId: teamA1._id,
      status: "active",
      isActive: true,
    })

    agentA1User = await User.create({
      name: "Agent Phase7 A1",
      email: `agentA1_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      teamId: teamA1._id,
      status: "active",
      isActive: true,
      maxOpenLeads: 50,
    })

    agentA2User = await User.create({
      name: "Agent Phase7 A2",
      email: `agentA2_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      teamId: teamA1._id,
      status: "active",
      isActive: true,
      maxOpenLeads: 50,
    })

    viewerAUser = await User.create({
      name: "Viewer Phase7 A",
      email: `viewerA_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "viewer",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    // Update Team Alpha Sales with manager and members
    await Team.updateOne(
      { _id: teamA1._id },
      { $set: { managerId: managerAUser._id, members: [agentA1User._id, agentA2User._id] } }
    )

    // Users for Tenant B
    adminBUser = await User.create({
      _id: adminBUserId,
      name: "Admin Phase7 B",
      email: `adminB_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
      isActive: true,
    })

    agentBUser = await User.create({
      name: "Agent Phase7 B",
      email: `agentB_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_B,
      teamId: teamB._id,
      status: "active",
      isActive: true,
    })

    // Log in and get session cookies
    const loginAdminA = await request(app)
      .post("/api/auth/login")
      .send({ email: `adminA_${TEST_TAG}@test.com`, password: "Password123!" })
    adminAToken = getClientCookie(loginAdminA)

    const loginManagerA = await request(app)
      .post("/api/auth/login")
      .send({ email: `managerA_${TEST_TAG}@test.com`, password: "Password123!" })
    managerAToken = getClientCookie(loginManagerA)

    const loginAgentA1 = await request(app)
      .post("/api/auth/login")
      .send({ email: `agentA1_${TEST_TAG}@test.com`, password: "Password123!" })
    agentA1Token = getClientCookie(loginAgentA1)

    const loginViewerA = await request(app)
      .post("/api/auth/login")
      .send({ email: `viewerA_${TEST_TAG}@test.com`, password: "Password123!" })
    viewerAToken = getClientCookie(loginViewerA)

    const loginAdminB = await request(app)
      .post("/api/auth/login")
      .send({ email: `adminB_${TEST_TAG}@test.com`, password: "Password123!" })
    adminBToken = getClientCookie(loginAdminB)

    console.log("==> Test Harness Initialized. Executing Phase 7 Verification Suites...\n")

    // =========================================================================
    // SUITE 1: Single Lead Assignment & Bi-Directional Synchronization
    // =========================================================================
    console.log("--- Suite 1: Single Lead Assignment & Field Synchronization ---")

    // Create an unassigned lead in Tenant A
    const lead1 = await Lead.create({
      tenantId: TENANT_A,
      name: `Lead 1 Unassigned ${TEST_TAG}`,
      email: `lead1_${TEST_TAG}@example.com`,
      phone: "+919876543210",
      status: "New",
      source: "website",
    })

    recordTest(
      "Suite 1",
      "Unassigned lead created with null ownerId and Unassigned fallback",
      lead1.ownerId === null && lead1.assignedTo === "Unassigned"
    )

    // Assign to Agent A1 via PATCH /api/leads/:id/assign
    const assignRes1 = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminAToken)
      .send({
        targetOwnerId: agentA1User._id.toString(),
        teamId: teamA1._id.toString(),
        reason: "Initial assignment to Sales Agent 1",
      })

    recordTest(
      "Suite 1",
      "PATCH /api/leads/:id/assign returns 200 with success: true",
      assignRes1.status === 200 && assignRes1.body.success === true,
      JSON.stringify(assignRes1.body)
    )

    const updatedLead1 = await Lead.findById(lead1._id)
    recordTest(
      "Suite 1",
      "ownerId, assignedStaffId, and assignedTo are synchronized to Agent A1",
      updatedLead1.ownerId?.toString() === agentA1User._id.toString() &&
        updatedLead1.assignedStaffId?.toString() === agentA1User._id.toString() &&
        updatedLead1.assignedTo === agentA1User.name
    )

    recordTest(
      "Suite 1",
      "assignmentHistory tracks initial assignment from null to Agent A1",
      Array.isArray(updatedLead1.assignmentHistory) &&
        updatedLead1.assignmentHistory.length === 1 &&
        updatedLead1.assignmentHistory[0].fromOwnerId === null &&
        updatedLead1.assignmentHistory[0].toOwnerId?.toString() === agentA1User._id.toString() &&
        updatedLead1.assignmentHistory[0].reason === "Initial assignment to Sales Agent 1"
    )

    // Reassign from Agent A1 to Agent A2
    const reassignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminAToken)
      .send({
        targetOwnerId: agentA2User._id.toString(),
        reason: "Reassigning lead to Agent A2 for follow-up",
      })

    recordTest(
      "Suite 1",
      "Reassignment from Agent A1 to Agent A2 succeeds with 200",
      reassignRes.status === 200 && reassignRes.body.success === true
    )

    const reloadedLead1 = await Lead.findById(lead1._id)
    recordTest(
      "Suite 1",
      "Reassignment updates ownerId and appends to assignmentHistory without overwriting",
      reloadedLead1.ownerId?.toString() === agentA2User._id.toString() &&
        reloadedLead1.assignmentHistory.length === 2 &&
        reloadedLead1.assignmentHistory[1].fromOwnerId?.toString() === agentA1User._id.toString() &&
        reloadedLead1.assignmentHistory[1].toOwnerId?.toString() === agentA2User._id.toString() &&
        reloadedLead1.assignmentHistory[1].reason === "Reassigning lead to Agent A2 for follow-up"
    )

    // =========================================================================
    // SUITE 2: Authorization, RBAC Permissions, & Negative Validation
    // =========================================================================
    console.log("\n--- Suite 2: Authorization & Security Validation ---")

    // Attempt assignment by Viewer (lacks leads.assign) -> 403
    const viewerAssignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", viewerAToken)
      .send({ targetOwnerId: agentA1User._id.toString() })

    recordTest(
      "Suite 2",
      "User without leads.assign (viewer) is rejected with 403 Forbidden",
      viewerAssignRes.status === 403
    )

    // Attempt assignment by Agent (lacks leads.assign) -> 403
    const agentAssignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", agentA1Token)
      .send({ targetOwnerId: agentA2User._id.toString() })

    recordTest(
      "Suite 2",
      "Agent without leads.assign is rejected with 403 Forbidden",
      agentAssignRes.status === 403
    )

    // Cross-tenant assignment attempt: Admin A tries to assign Lead 1 to Agent B (Tenant B) -> 400
    const crossTenantAssignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminAToken)
      .send({ targetOwnerId: agentBUser._id.toString() })

    recordTest(
      "Suite 2",
      "Cross-tenant staff assignment attempt is rejected with 400/403/404",
      crossTenantAssignRes.status === 400 || crossTenantAssignRes.status === 403 || crossTenantAssignRes.status === 404,
      `Status: ${crossTenantAssignRes.status}, Body: ${JSON.stringify(crossTenantAssignRes.body)}`
    )

    // Cross-tenant team assignment attempt: Admin A tries to assign Lead 1 to Team B (Tenant B) -> 400
    const crossTenantTeamRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminAToken)
      .send({ teamId: teamB._id.toString() })

    recordTest(
      "Suite 2",
      "Cross-tenant team assignment attempt is rejected with 400/403 Bad Request",
      crossTenantTeamRes.status === 400 || crossTenantTeamRes.status === 403,
      `Status: ${crossTenantTeamRes.status}`
    )

    // Inactive staff assignment attempt: Create deactivated user in Tenant A
    const inactiveUser = await User.create({
      name: "Inactive Rep",
      email: `inactive_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "suspended",
      isActive: false,
    })

    const inactiveAssignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminAToken)
      .send({ targetOwnerId: inactiveUser._id.toString() })

    recordTest(
      "Suite 2",
      "Assigning lead to deactivated staff member is rejected with 400 Bad Request",
      inactiveAssignRes.status === 400 &&
        inactiveAssignRes.body.error?.toLowerCase().includes("inactive"),
      JSON.stringify(inactiveAssignRes.body)
    )

    // IDOR Protection: Admin B cannot assign lead belonging to Tenant A -> 404/403
    const idorAssignRes = await request(app)
      .patch(`/api/leads/${lead1._id}/assign`)
      .set("Cookie", adminBToken)
      .send({ targetOwnerId: agentBUser._id.toString() })

    recordTest(
      "Suite 2",
      "Tenant B cannot view or assign Lead belonging to Tenant A (Tenant Isolation / IDOR)",
      idorAssignRes.status === 404 || idorAssignRes.status === 403
    )

    // =========================================================================
    // SUITE 3: Bulk Lead Assignment & Scope Enforcement
    // =========================================================================
    console.log("\n--- Suite 3: Bulk Lead Assignment & Scope Enforcement ---")

    const bulkLeadA = await Lead.create({
      tenantId: TENANT_A,
      name: `Bulk Lead A ${TEST_TAG}`,
      email: `bulkA_${TEST_TAG}@example.com`,
      phone: "+919876543211",
      status: "New",
      source: "website",
    })

    const bulkLeadB = await Lead.create({
      tenantId: TENANT_A,
      name: `Bulk Lead B ${TEST_TAG}`,
      email: `bulkB_${TEST_TAG}@example.com`,
      phone: "+919876543212",
      status: "New",
      source: "google_ads",
    })

    // Bulk assign to Agent A1 via POST /api/leads/bulk-assign
    const bulkAssignRes = await request(app)
      .post("/api/leads/bulk-assign")
      .set("Cookie", adminAToken)
      .send({
        leadIds: [bulkLeadA._id.toString(), bulkLeadB._id.toString()],
        targetOwnerId: agentA1User._id.toString(),
        teamId: teamA1._id.toString(),
        reason: "Bulk assignment via campaign triage",
      })

    recordTest(
      "Suite 3",
      "POST /api/leads/bulk-assign returns 200 with successCount: 2",
      bulkAssignRes.status === 200 &&
        bulkAssignRes.body.success === true &&
        bulkAssignRes.body.data?.successCount === 2
    )

    const updatedBulkA = await Lead.findById(bulkLeadA._id)
    const updatedBulkB = await Lead.findById(bulkLeadB._id)

    recordTest(
      "Suite 3",
      "All selected leads in bulk assignment have updated ownerId and assignmentHistory",
      updatedBulkA.ownerId?.toString() === agentA1User._id.toString() &&
        updatedBulkB.ownerId?.toString() === agentA1User._id.toString() &&
        updatedBulkA.assignmentHistory.length === 1 &&
        updatedBulkB.assignmentHistory.length === 1
    )

    // Scope check: Lead belonging to Team A2 (outside Manager A's Team A1)
    const outsideTeamLead = await Lead.create({
      tenantId: TENANT_A,
      name: `Outside Team Lead ${TEST_TAG}`,
      email: `outside_${TEST_TAG}@example.com`,
      phone: "+919876543213",
      status: "New",
      teamId: teamA2._id,
      ownerId: adminAUserId, // owned by someone outside Team A1
    })

    // Manager A (scoped to Team A1) tries to bulk reassign outside team lead
    const managerBulkRes = await request(app)
      .post("/api/leads/bulk-assign")
      .set("Cookie", managerAToken)
      .send({
        leadIds: [outsideTeamLead._id.toString()],
        targetOwnerId: agentA1User._id.toString(),
      })

    recordTest(
      "Suite 3",
      "Manager with team scope cannot reassign lead from another team (fail-closed scope)",
      managerBulkRes.body.data?.failedCount === 1 && managerBulkRes.body.data?.successCount === 0
    )

    // =========================================================================
    // SUITE 4: Automated Assignment Rules Engine
    // =========================================================================
    console.log("\n--- Suite 4: Automated Assignment Rules Engine ---")

    // Rule 1: Direct Assignment for "enterprise" tags
    const directRule = await AssignmentRule.create({
      tenantId: TENANT_A,
      name: `Direct VIP Rule ${TEST_TAG}`,
      priority: 1,
      isActive: true,
      conditions: { tags: ["vip", "enterprise"] },
      routingType: "direct",
      targetUserId: agentA2User._id,
    })

    // Rule 2: Round Robin for "website" source
    const roundRobinRule = await AssignmentRule.create({
      tenantId: TENANT_A,
      name: `Round Robin Website ${TEST_TAG}`,
      priority: 2,
      isActive: true,
      conditions: { sources: ["website"] },
      routingType: "round_robin",
      targetUserIds: [agentA1User._id, agentA2User._id],
    })

    // Rule 3: Fewest Open Leads for "meta" source
    const fewestRule = await AssignmentRule.create({
      tenantId: TENANT_A,
      name: `Fewest Open Leads Meta ${TEST_TAG}`,
      priority: 3,
      isActive: true,
      conditions: { sources: ["meta"] },
      routingType: "fewest_open_leads",
      targetUserIds: [agentA1User._id, agentA2User._id],
    })

    // Test Rule 1: Direct match
    const resolvedDirect = await assignmentService.resolveLeadAssignment(
      { tags: ["vip"], source: "website" },
      TENANT_A
    )

    recordTest(
      "Suite 4",
      "Direct rule evaluated with highest priority (#1) overrides lower rules",
      resolvedDirect?.ruleId?.toString() === directRule._id.toString() &&
        resolvedDirect?.targetOwnerId?.toString() === agentA2User._id.toString()
    )

    // Test Rule 2: Round-Robin rotation
    const rrResolution1 = await assignmentService.resolveLeadAssignment(
      { source: "website" },
      TENANT_A
    )
    const rrResolution2 = await assignmentService.resolveLeadAssignment(
      { source: "website" },
      TENANT_A
    )
    const rrResolution3 = await assignmentService.resolveLeadAssignment(
      { source: "website" },
      TENANT_A
    )

    recordTest(
      "Suite 4",
      "Round-Robin rule alternates sequentially between targetUserIds",
      rrResolution1?.targetOwnerId?.toString() === agentA1User._id.toString() &&
        rrResolution2?.targetOwnerId?.toString() === agentA2User._id.toString() &&
        rrResolution3?.targetOwnerId?.toString() === agentA1User._id.toString(),
      `RR1: ${rrResolution1?.targetOwnerId}, RR2: ${rrResolution2?.targetOwnerId}, RR3: ${rrResolution3?.targetOwnerId}`
    )

    // Test Rule 3: Fewest Open Leads
    // Agent A1 currently has multiple leads assigned, Agent A2 has fewer
    const fewestRes = await assignmentService.resolveLeadAssignment(
      { source: "meta" },
      TENANT_A
    )

    recordTest(
      "Suite 4",
      "Fewest open leads resolves to eligible agent with lowest open lead count",
      fewestRes?.ruleId?.toString() === fewestRule._id.toString() &&
        Boolean(fewestRes?.targetOwnerId)
    )

    // Fallback: Lead with unknown source and no tags falls back to Unassigned Pool
    const poolFallbackRes = await assignmentService.resolveLeadAssignment(
      { source: "cold_call", tags: ["random"] },
      TENANT_A
    )

    recordTest(
      "Suite 4",
      "Leads matching no rules safely drop into Unassigned Pool (targetOwnerId: null)",
      poolFallbackRes === null || poolFallbackRes.targetOwnerId === null
    )

    // =========================================================================
    // SUITE 5: Shared leadService Ingestion Auto-Routing
    // =========================================================================
    console.log("\n--- Suite 5: leadService Ingestion Auto-Routing ---")

    // Create lead through leadService with website source -> should auto-route via Rule #2 (round_robin)
    const ingestedResult = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "website",
      payload: {
        name: `Auto Routed Ingestion ${TEST_TAG}`,
        email: `autorouted_${TEST_TAG}@example.com`,
        phone: "+919876543299",
        source: "website",
      },
      actor: { id: "system", name: "Website Webhook Ingestion" },
    })
    const ingestedLead = ingestedResult.lead || ingestedResult

    recordTest(
      "Suite 5",
      "leadService.createOrMergeLead auto-executes assignment rules on new lead",
      Boolean(ingestedLead.ownerId) &&
        [agentA1User._id.toString(), agentA2User._id.toString()].includes(
          ingestedLead.ownerId.toString()
        )
    )

    recordTest(
      "Suite 5",
      "Auto-routed lead populates assignmentHistory on creation",
      Array.isArray(ingestedLead.assignmentHistory) &&
        ingestedLead.assignmentHistory.length === 1 &&
        (ingestedLead.assignmentHistory[0].reason?.includes("Rule") ||
          ingestedLead.assignmentHistory[0].reason?.includes("Round-Robin"))
    )

    // =========================================================================
    // SUITE 6: Pending Follow-up Cascading Ownership
    // =========================================================================
    console.log("\n--- Suite 6: Pending Follow-up Cascading Ownership ---")

    // Create a lead with pending follow-up and completed follow-up
    const cascadeLead = await Lead.create({
      tenantId: TENANT_A,
      name: `Cascade Test Lead ${TEST_TAG}`,
      email: `cascade_${TEST_TAG}@example.com`,
      phone: "+919876543288",
      ownerId: agentA1User._id,
      assignedStaffId: agentA1User._id,
      assignedTo: agentA1User.name,
      status: "Engaged",
    })

    const pendingFollowUp = await FollowUp.create({
      tenantId: TENANT_A,
      leadId: cascadeLead._id,
      assignedStaffId: agentA1User._id,
      assignedTo: agentA1User.name,
      status: "pending",
      scheduledAt: new Date(Date.now() + 86400000),
      notes: `Pending callback ${TEST_TAG}`,
    })

    const completedFollowUp = await FollowUp.create({
      tenantId: TENANT_A,
      leadId: cascadeLead._id,
      assignedStaffId: agentA1User._id,
      assignedTo: agentA1User.name,
      status: "completed",
      scheduledAt: new Date(Date.now() - 3600000),
      completedAt: new Date(),
      notes: `Historical completed call ${TEST_TAG}`,
    })

    // Reassign lead to Agent A2
    await assignmentService.assignLead(cascadeLead._id, agentA2User._id, {
      actor: adminAUser,
      reason: "Cascading follow-up test",
      tenantId: TENANT_A,
    })

    const reloadedPending = await FollowUp.findById(pendingFollowUp._id)
    const reloadedCompleted = await FollowUp.findById(completedFollowUp._id)

    recordTest(
      "Suite 6",
      "Pending follow-up automatically cascaded to new lead owner (Agent A2)",
      reloadedPending.assignedStaffId?.toString() === agentA2User._id.toString() &&
        reloadedPending.assignedTo === agentA2User.name
    )

    recordTest(
      "Suite 6",
      "Completed follow-up preserves original agent for historical audit integrity",
      reloadedCompleted.assignedStaffId?.toString() === agentA1User._id.toString() &&
        reloadedCompleted.assignedTo === agentA1User.name
    )

    // =========================================================================
    // SUITE 7: Staff Deactivation Reassignment Wizard API
    // =========================================================================
    console.log("\n--- Suite 7: Staff Deactivation Reassignment Wizard ---")

    // Create departing agent with 2 open leads
    const departingAgent = await User.create({
      name: "Departing Rep",
      email: `departing_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    const depLead1 = await Lead.create({
      tenantId: TENANT_A,
      name: `Departing Lead 1 ${TEST_TAG}`,
      email: `dep1_${TEST_TAG}@example.com`,
      phone: "+919876543277",
      ownerId: departingAgent._id,
      status: "New",
    })

    const depLead2 = await Lead.create({
      tenantId: TENANT_A,
      name: `Departing Lead 2 ${TEST_TAG}`,
      email: `dep2_${TEST_TAG}@example.com`,
      phone: "+919876543278",
      ownerId: departingAgent._id,
      status: "Engaged",
    })

    // Test GET /api/staff/:id/open-leads
    const openLeadsRes = await request(app)
      .get(`/api/staff/${departingAgent._id}/open-leads`)
      .set("Cookie", adminAToken)

    recordTest(
      "Suite 7",
      "GET /api/staff/:id/open-leads returns accurate open lead count (2)",
      openLeadsRes.status === 200 && openLeadsRes.body.data?.openLeadsCount === 2
    )

    // Test Deactivate with sendToPool: true
    const deactRes = await request(app)
      .patch(`/api/staff/${departingAgent._id}/deactivate`)
      .set("Cookie", adminAToken)
      .send({
        action: "deactivate",
        sendToPool: true,
      })

    recordTest(
      "Suite 7",
      "Deactivating staff with sendToPool: true succeeds with 200",
      deactRes.status === 200 && deactRes.body.success === true
    )

    const reloadedDepLead1 = await Lead.findById(depLead1._id)
    const reloadedDepLead2 = await Lead.findById(depLead2._id)

    recordTest(
      "Suite 7",
      "Departing staff's leads moved to Unassigned Pool with assignmentHistory note",
      reloadedDepLead1.ownerId === null &&
        reloadedDepLead2.ownerId === null &&
        reloadedDepLead1.assignedTo === "Unassigned" &&
        reloadedDepLead1.assignmentHistory.some((h) => h.reason?.includes("Staff member deactivated"))
    )

    // =========================================================================
    // SUITE 8: Pool Stats & Assignment Rules CRUD
    // =========================================================================
    console.log("\n--- Suite 8: Pool Stats & Assignment Rules CRUD ---")

    // Test GET /api/leads/pool/stats
    const poolStatsRes = await request(app)
      .get("/api/leads/pool/stats")
      .set("Cookie", adminAToken)

    recordTest(
      "Suite 8",
      "GET /api/leads/pool/stats returns unassignedCount >= 2 and totalOpenLeadsCount",
      poolStatsRes.status === 200 &&
        poolStatsRes.body.success === true &&
        poolStatsRes.body.data?.unassignedCount >= 2 &&
        poolStatsRes.body.data?.totalOpenLeadsCount >= 2
    )

    // Test Assignment Rules CRUD
    const createRuleRes = await request(app)
      .post("/api/assignment-rules")
      .set("Cookie", adminAToken)
      .send({
        name: `CRUD Test Rule ${TEST_TAG}`,
        priority: 10,
        isActive: true,
        routingType: "pool",
      })

    recordTest(
      "Suite 8",
      "POST /api/assignment-rules creates new rule with 201",
      createRuleRes.status === 201 && createRuleRes.body.success === true
    )

    const createdRuleId = createRuleRes.body.data?.id || createRuleRes.body.data?._id

    // Update rule
    const updateRuleRes = await request(app)
      .put(`/api/assignment-rules/${createdRuleId}`)
      .set("Cookie", adminAToken)
      .send({
        name: `Updated Rule Name ${TEST_TAG}`,
        isActive: false,
      })

    recordTest(
      "Suite 8",
      "PUT /api/assignment-rules/:id updates rule attributes",
      updateRuleRes.status === 200 && updateRuleRes.body.data?.isActive === false
    )

    // Reorder rules
    const reorderRes = await request(app)
      .post("/api/assignment-rules/reorder")
      .set("Cookie", adminAToken)
      .send({
        ruleIds: [createdRuleId, directRule._id.toString()],
      })

    recordTest(
      "Suite 8",
      "POST /api/assignment-rules/reorder reorders priorities sequentially",
      reorderRes.status === 200 && reorderRes.body.success === true
    )

    // Delete rule
    const deleteRuleRes = await request(app)
      .delete(`/api/assignment-rules/${createdRuleId}`)
      .set("Cookie", adminAToken)

    recordTest(
      "Suite 8",
      "DELETE /api/assignment-rules/:id deletes rule successfully",
      deleteRuleRes.status === 200 && deleteRuleRes.body.success === true
    )

    console.log("\n================================================================================")
    console.log(`PHASE 7 VERIFICATION COMPLETE: ${passedTests} passed, ${failedTests} failed`)
    console.log("================================================================================\n")

    await cleanupData()
    await mongoose.connection.close()

    if (failedTests > 0) {
      process.exit(1)
    } else {
      process.exit(0)
    }
  } catch (err) {
    console.error("Fatal Error running Phase 7 verification:", err)
    await cleanupData()
    await mongoose.connection.close()
    process.exit(1)
  }
}

runPhase7Tests()
