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
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS } = require("../models/RolePermission")
const app = require("../start")

/**
 * Automated Verification Suite for Roadmap Phase 5: RBAC v2 — Roles & Scoped Permissions
 */

const TEST_TAG = `p5_${Date.now()}`
const TENANT_A = `tenant_p5_a_${Date.now()}`
const TENANT_B = `tenant_p5_b_${Date.now()}`

let adminAUser = null
let managerAUser = null
let agentAUser = null
let agentBUser = null
let viewerAUser = null

let adminBUser = null

let adminAToken = null
let managerAToken = null
let agentAToken = null
let agentBToken = null
let viewerAToken = null
let adminBToken = null

let team1 = null
let team2 = null

let leadAgentA = null
let leadAgentB = null
let followUpAgentA = null

const getClientCookie = (res) => {
  const setCookie = res.headers["set-cookie"]
  if (!setCookie) return ""
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const clientCookie = cookies.find((c) => c.startsWith("client_token="))
  return clientCookie ? clientCookie.split(";")[0] : ""
}

const cleanupData = async () => {
  try {
    await User.deleteMany({
      $or: [
        { tenantId: { $in: [TENANT_A, TENANT_B] } },
        { email: { $regex: TEST_TAG } },
      ],
    })

    await Team.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    }).setOptions({ skipTenantFilter: true })

    await Role.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    }).setOptions({ skipTenantFilter: true })

    await Lead.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    }).setOptions({ skipTenantFilter: true })

    await FollowUp.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    }).setOptions({ skipTenantFilter: true })

    await Account.deleteMany({
      accountId: { $in: [TENANT_A, TENANT_B] },
    })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

const runTests = async () => {
  console.log("\n=======================================================")
  console.log("🚀 STARTING PHASE 5 VERIFICATION: RBAC V2 & SCOPED ROLES")
  console.log("=======================================================\n")

  let passed = 0
  let failed = 0

  try {
    await connectDB()

    // 1. Setup Tenant A & Tenant B accounts
    const adminAUserId = new mongoose.Types.ObjectId()
    const adminBUserId = new mongoose.Types.ObjectId()

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: `Tenant A RBAC ${TEST_TAG}`,
        displayName: "Tenant A RBAC",
        adminName: "Admin Alice",
        adminEmail: `admin_a_${TEST_TAG}@test.com`,
        adminUserId: adminAUserId,
        status: "active",
        maxUsers: 50,
      },
      {
        accountId: TENANT_B,
        companyName: `Tenant B RBAC ${TEST_TAG}`,
        displayName: "Tenant B RBAC",
        adminName: "Admin Brenda",
        adminEmail: `admin_b_${TEST_TAG}@test.com`,
        adminUserId: adminBUserId,
        status: "active",
        maxUsers: 50,
      },
    ])

    // 2. Setup Users for Tenant A
    adminAUser = new User({
      _id: adminAUserId,
      name: "Admin Alice",
      email: `admin_a_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
    })
    await adminAUser.save()

    managerAUser = new User({
      name: "Manager Mike",
      email: `manager_a_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "manager",
      tenantId: TENANT_A,
      status: "active",
    })
    await managerAUser.save()

    agentAUser = new User({
      name: "Agent Arthur",
      email: `agent_a_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })
    await agentAUser.save()

    agentBUser = new User({
      name: "Agent Bob",
      email: `agent_b_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })
    await agentBUser.save()

    viewerAUser = new User({
      name: "Viewer Victor",
      email: `viewer_a_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "viewer",
      tenantId: TENANT_A,
      status: "active",
    })
    await viewerAUser.save()

    // 3. Setup User for Tenant B
    adminBUser = new User({
      _id: adminBUserId,
      name: "Admin Brenda",
      email: `admin_b_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
    })
    await adminBUser.save()

    // 4. Setup Teams:
    // Team 1: Manager Mike, Agent Arthur
    // Team 2: Agent Bob
    team1 = await Team.create({
      tenantId: TENANT_A,
      name: "Alpha Squad",
      managerId: managerAUser._id,
      members: [managerAUser._id, agentAUser._id],
    })

    team2 = await Team.create({
      tenantId: TENANT_A,
      name: "Beta Squad",
      members: [agentBUser._id],
    })

    // Update users with their teamId
    await User.findByIdAndUpdate(managerAUser._id, { teamId: team1._id })
    await User.findByIdAndUpdate(agentAUser._id, { teamId: team1._id, managerId: managerAUser._id })
    await User.findByIdAndUpdate(agentBUser._id, { teamId: team2._id })

    // 5. Create Leads:
    // Lead 1: assigned to Agent Arthur (Team 1)
    // Lead 2: assigned to Agent Bob (Team 2)
    leadAgentA = await Lead.create({
      tenantId: TENANT_A,
      name: "Lead For Arthur",
      email: `lead_arthur_${TEST_TAG}@test.com`,
      phone: "+919876500001",
      assignedTo: agentAUser.name,
      assignedStaffId: agentAUser._id.toString(),
      ownerId: agentAUser._id,
      status: "New",
      source: "Website Form",
    })

    leadAgentB = await Lead.create({
      tenantId: TENANT_A,
      name: "Lead For Bob",
      email: `lead_bob_${TEST_TAG}@test.com`,
      phone: "+919876500002",
      assignedTo: agentBUser.name,
      assignedStaffId: agentBUser._id.toString(),
      ownerId: agentBUser._id,
      status: "Engaged",
      source: "Manual Entry",
    })

    // 6. Create Follow-up for Arthur's lead
    followUpAgentA = await FollowUp.create({
      tenantId: TENANT_A,
      leadId: leadAgentA._id,
      title: "Call with Arthur's lead",
      type: "call",
      scheduledAt: new Date(Date.now() + 86400000),
      assignedTo: agentAUser.name,
      assignedStaffId: agentAUser._id.toString(),
      status: "pending",
      priority: "high",
    })

    // 7. Perform Logins to collect cookies
    const loginUser = async (email, password) => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password })
      assert.strictEqual(res.status, 200)
      return {
        cookie: getClientCookie(res),
        token: res.body.data.token,
        user: res.body.data.user,
      }
    }

    const resAdminA = await loginUser(adminAUser.email, "Password123!")
    adminAToken = resAdminA.cookie

    const resManagerA = await loginUser(managerAUser.email, "Password123!")
    managerAToken = resManagerA.cookie

    const resAgentA = await loginUser(agentAUser.email, "Password123!")
    agentAToken = resAgentA.cookie

    const resAgentB = await loginUser(agentBUser.email, "Password123!")
    agentBToken = resAgentB.cookie

    const resViewerA = await loginUser(viewerAUser.email, "Password123!")
    viewerAToken = resViewerA.cookie

    const resAdminB = await loginUser(adminBUser.email, "Password123!")
    adminBToken = resAdminB.cookie

    // =========================================================
    // SUITE 1: System Roles & Permissions Seeding
    // =========================================================
    console.log("--- Suite 1: System Roles Seeding & Auto-Initialization ---")

    // Test 1: Account Admin gets all system roles seeded
    const resRoles = await request(app)
      .get("/api/roles")
      .set("Cookie", adminAToken)

    assert.strictEqual(resRoles.status, 200)
    assert(Array.isArray(resRoles.body.data.roles))
    const roleSlugs = resRoles.body.data.roles.map((r) => r.slug)
    assert(roleSlugs.includes("account_admin"), "Account Admin role exists")
    assert(roleSlugs.includes("manager"), "Manager role exists")
    assert(roleSlugs.includes("agent"), "Agent role exists")
    assert(roleSlugs.includes("viewer"), "Viewer role exists")
    console.log("  ✅ PASS: Default system roles (Account Admin, Manager, Agent, Viewer) seeded properly")
    passed++

    // Test 2: Role listing includes assigned staff counts
    const agentRoleDoc = resRoles.body.data.roles.find((r) => r.slug === "agent")
    assert(agentRoleDoc.assignedStaffCount >= 2, "Agent role has correct staff count")
    console.log("  ✅ PASS: Role listing aggregates active assigned staff counts")
    passed++

    // =========================================================
    // SUITE 2: Own / Team / All Scope Enforcement
    // =========================================================
    console.log("\n--- Suite 2: Own / Team / All Scope Enforcement ---")

    // Test 3: Agent A (own scope) queries list: sees Arthur's lead, but not Bob's lead
    const resAgentALeads = await request(app)
      .get("/api/leads")
      .set("Cookie", agentAToken)

    assert.strictEqual(resAgentALeads.status, 200)
    const agentALeadIds = resAgentALeads.body.data.leads.map((l) => l.id)
    assert(agentALeadIds.includes(leadAgentA._id.toString()), "Agent A sees own lead")
    assert(!agentALeadIds.includes(leadAgentB._id.toString()), "Agent A CANNOT see Agent B lead")
    console.log("  ✅ PASS: Agent with 'own' scope sees only leads assigned to themselves")
    passed++

    // Test 4: Agent B (own scope) queries list: sees Bob's lead, but not Arthur's lead
    const resAgentBLeads = await request(app)
      .get("/api/leads")
      .set("Cookie", agentBToken)

    assert.strictEqual(resAgentBLeads.status, 200)
    const agentBLeadIds = resAgentBLeads.body.data.leads.map((l) => l.id)
    assert(agentBLeadIds.includes(leadAgentB._id.toString()), "Agent B sees own lead")
    assert(!agentBLeadIds.includes(leadAgentA._id.toString()), "Agent B CANNOT see Agent A lead")
    console.log("  ✅ PASS: Agent B with 'own' scope sees only Bob's lead")
    passed++

    // Test 5: Manager Mike (team scope for Team 1) queries list: sees Arthur's lead, but NOT Bob's lead (Team 2)
    const resManagerLeads = await request(app)
      .get("/api/leads")
      .set("Cookie", managerAToken)

    assert.strictEqual(resManagerLeads.status, 200)
    const managerLeadIds = resManagerLeads.body.data.leads.map((l) => l.id)
    assert(managerLeadIds.includes(leadAgentA._id.toString()), "Manager sees Team 1 member lead")
    assert(!managerLeadIds.includes(leadAgentB._id.toString()), "Manager CANNOT see Team 2 lead")
    console.log("  ✅ PASS: Manager with 'team' scope sees only leads belonging to their team")
    passed++

    // Test 6: Account Admin (all scope) queries list: sees both Arthur's and Bob's leads
    const resAdminLeads = await request(app)
      .get("/api/leads")
      .set("Cookie", adminAToken)

    assert.strictEqual(resAdminLeads.status, 200)
    const adminLeadIds = resAdminLeads.body.data.leads.map((l) => l.id)
    assert(adminLeadIds.includes(leadAgentA._id.toString()), "Admin sees Agent A lead")
    assert(adminLeadIds.includes(leadAgentB._id.toString()), "Admin sees Agent B lead")
    console.log("  ✅ PASS: Account Admin with 'all' scope sees all leads across the tenant")
    passed++

    // =========================================================
    // SUITE 3: Direct Object Authorization & Anti-IDOR
    // =========================================================
    console.log("\n--- Suite 3: Direct Object Authorization (IDOR Protection) ---")

    // Test 7: Agent A accesses own lead detail -> 200 OK
    const resDetailOwn = await request(app)
      .get(`/api/leads/${leadAgentA._id}`)
      .set("Cookie", agentAToken)

    assert.strictEqual(resDetailOwn.status, 200)
    console.log("  ✅ PASS: Agent accesses own lead detail (200 OK)")
    passed++

    // Test 8: Agent B attempts to access Agent A's lead detail directly -> 403 Forbidden
    const resDetailOther = await request(app)
      .get(`/api/leads/${leadAgentA._id}`)
      .set("Cookie", agentBToken)

    assert.strictEqual(resDetailOther.status, 403)
    assert(resDetailOther.body.error.includes("scope"), "Error mentions scope restriction")
    console.log("  ✅ PASS: Direct object access to out-of-scope lead blocked (403 Forbidden)")
    passed++

    // Test 9: Agent B attempts to update Agent A's lead -> 403 Forbidden
    const resUpdateOther = await request(app)
      .put(`/api/leads/${leadAgentA._id}`)
      .set("Cookie", agentBToken)
      .send({ status: "Closed-Won" })

    assert.strictEqual(resUpdateOther.status, 403)
    console.log("  ✅ PASS: Updating out-of-scope lead blocked (403 Forbidden)")
    passed++

    // Test 10: Agent B attempts to delete Agent A's lead -> 403 Forbidden
    const resDeleteOther = await request(app)
      .delete(`/api/leads/${leadAgentA._id}`)
      .set("Cookie", agentBToken)

    assert.strictEqual(resDeleteOther.status, 403)
    console.log("  ✅ PASS: Deleting out-of-scope lead blocked (403 Forbidden)")
    passed++

    // =========================================================
    // SUITE 4: Follow-ups Scoping & Mutation Protection
    // =========================================================
    console.log("\n--- Suite 4: Follow-ups Scoping & Mutation Protection ---")

    // Test 11: Agent A can view and complete own follow-up
    const resFollowUpOwn = await request(app)
      .get(`/api/follow-ups/${followUpAgentA._id}`)
      .set("Cookie", agentAToken)

    assert.strictEqual(resFollowUpOwn.status, 200)
    console.log("  ✅ PASS: Agent accesses own scheduled follow-up (200 OK)")
    passed++

    // Test 12: Agent B attempting to complete Agent A's follow-up is blocked (403 Forbidden)
    const resCompleteOther = await request(app)
      .patch(`/api/follow-ups/${followUpAgentA._id}/complete`)
      .set("Cookie", agentBToken)
      .send({ completionNotes: "Unauthorized complete attempt" })

    assert.strictEqual(resCompleteOther.status, 403)
    console.log("  ✅ PASS: Completing out-of-scope follow-up blocked (403 Forbidden)")
    passed++

    // =========================================================
    // SUITE 5: Viewer Role Permissions Enforcement
    // =========================================================
    console.log("\n--- Suite 5: Viewer Role Enforcement ---")

    // Test 13: Viewer can view leads list
    const resViewerList = await request(app)
      .get("/api/leads")
      .set("Cookie", viewerAToken)

    assert.strictEqual(resViewerList.status, 200)
    console.log("  ✅ PASS: Viewer role can read leads list (200 OK)")
    passed++

    // Test 14: Viewer attempting to create lead is denied (403 Forbidden)
    const resViewerCreate = await request(app)
      .post("/api/leads")
      .set("Cookie", viewerAToken)
      .send({
        name: "Viewer Test Lead",
        email: `viewer_lead_${TEST_TAG}@test.com`,
      })

    assert.strictEqual(resViewerCreate.status, 403)
    console.log("  ✅ PASS: Viewer role forbidden from creating leads (403 Forbidden)")
    passed++

    // Test 15: Viewer attempting to delete lead is denied (403 Forbidden)
    const resViewerDelete = await request(app)
      .delete(`/api/leads/${leadAgentA._id}`)
      .set("Cookie", viewerAToken)

    assert.strictEqual(resViewerDelete.status, 403)
    console.log("  ✅ PASS: Viewer role forbidden from deleting leads (403 Forbidden)")
    passed++

    // =========================================================
    // SUITE 6: Multi-Tenant Role Isolation & Privilege Escalation
    // =========================================================
    console.log("\n--- Suite 6: Multi-Tenant Role Isolation & Privilege Escalation ---")

    // Test 16: Non-admin (Agent) cannot access Role Management
    const resAgentRoles = await request(app)
      .get("/api/roles")
      .set("Cookie", agentAToken)

    assert.strictEqual(resAgentRoles.status, 403)
    console.log("  ✅ PASS: Non-admin (Agent) cannot access role management (403 Forbidden)")
    passed++

    // Test 17: Account Admin creates custom role with allowed permissions
    const resCreateRole = await request(app)
      .post("/api/roles")
      .set("Cookie", adminAToken)
      .send({
        name: "Senior Sales Rep",
        slug: "senior_sales_rep",
        description: "Custom role for senior agents",
        permissions: [
          "dashboard.view",
          "leads.view.own",
          "leads.create",
          "leads.edit.own",
          "followups.view.own",
        ],
      })

    assert.strictEqual(resCreateRole.status, 201)
    const customRoleId = resCreateRole.body.data.id
    console.log("  ✅ PASS: Account Admin successfully creates a custom role")
    passed++

    // Test 18: Privilege escalation attempt — Granting permission outside Super Admin ceiling is blocked
    const resEscalation = await request(app)
      .post("/api/roles")
      .set("Cookie", adminAToken)
      .send({
        name: "Hacker Role",
        slug: "hacker_role",
        permissions: ["super_admin.unrestricted", "billing.bypass_charges"],
      })

    assert.strictEqual(resEscalation.status, 403)
    assert(resEscalation.body.error.includes("Privilege escalation blocked"), "Privilege escalation error returned")
    console.log("  ✅ PASS: Privilege escalation attempt exceeding system ceiling blocked (403 Forbidden)")
    passed++

    // Test 19: Cross-tenant role protection — Tenant B Admin cannot view Tenant A's custom role
    const resCrossTenantRole = await request(app)
      .get(`/api/roles/${customRoleId}`)
      .set("Cookie", adminBToken)

    assert.strictEqual(resCrossTenantRole.status, 404)
    console.log("  ✅ PASS: Tenant B Admin cannot access Tenant A custom role (404 Not Found)")
    passed++

    // Test 20: Cannot delete system roles (Account Admin, Manager, Agent, Viewer)
    const adminRoleInTenant = resRoles.body.data.roles.find((r) => r.slug === "account_admin")
    const resDeleteSystem = await request(app)
      .delete(`/api/roles/${adminRoleInTenant.id}`)
      .set("Cookie", adminAToken)

    assert.strictEqual(resDeleteSystem.status, 400)
    assert(resDeleteSystem.body.error.includes("System roles"), "Error mentions system role protection")
    console.log("  ✅ PASS: System roles cannot be deleted (400 Bad Request)")
    passed++

    // Test 21: Successfully delete custom role when no staff assigned
    const resDeleteCustom = await request(app)
      .delete(`/api/roles/${customRoleId}`)
      .set("Cookie", adminAToken)

    assert.strictEqual(resDeleteCustom.status, 200)
    console.log("  ✅ PASS: Unassigned custom role deleted successfully (200 OK)")
    passed++

    // =========================================================
    // SUITE 7: Session & Role Invalidation
    // =========================================================
    console.log("\n--- Suite 7: Session Invalidation on Role Changes ---")

    // Test 22: Changing a staff member's role invalidates their old token immediately
    // Promote Agent Arthur to Manager
    const resPromote = await request(app)
      .put(`/api/staff/${agentAUser._id}`)
      .set("Cookie", adminAToken)
      .send({ role: "manager" })

    assert.strictEqual(resPromote.status, 200)

    // Old token should now be rejected because tokenVersion incremented
    const resOldToken = await request(app)
      .get("/api/leads")
      .set("Cookie", agentAToken)

    assert.strictEqual(resOldToken.status, 401)
    assert(resOldToken.body.error.includes("invalidated"), "Error indicates session invalidation")
    console.log("  ✅ PASS: Staff role modification increments tokenVersion and invalidates old sessions immediately (401)")
    passed++

    // Test 23: Agent Arthur logs in again and now has Manager permissions
    const resArthurNewLogin = await loginUser(agentAUser.email, "Password123!")
    const resArthurManagerLeads = await request(app)
      .get("/api/leads")
      .set("Cookie", resArthurNewLogin.cookie)

    assert.strictEqual(resArthurManagerLeads.status, 200)
    console.log("  ✅ PASS: User logs in after role change and operates with new permissions")
    passed++

    // =========================================================
    // SUITE 8: Negative Security Audit — Cross-Tenant, Out-of-Scope & Anonymous Access
    // =========================================================
    console.log("\n--- Suite 8: Negative Security Audit — Cross-Tenant & Out-of-Scope Protection ---")

    // Test 24: Anonymous callers requesting role endpoints are blocked with 401 Unauthorized
    const resAnonRoles = await request(app).get("/api/roles")
    assert.strictEqual(resAnonRoles.status, 401)
    const resAnonCreateRole = await request(app).post("/api/roles").send({ name: "Rogue Role", slug: "rogue_role" })
    assert.strictEqual(resAnonCreateRole.status, 401)
    console.log("  ✅ PASS: Anonymous requests to /api/roles are blocked with 401 Unauthorized")
    passed++

    // Create a new custom role in Tenant A for testing cross-tenant isolation and deletion guards
    const resNewCustomRole = await request(app)
      .post("/api/roles")
      .set("Cookie", adminAToken)
      .send({
        name: "Closer Role",
        slug: "closer_role",
        description: "Closer specialist",
        permissions: ["dashboard.view", "leads.view.own", "leads.edit.own"],
      })
    assert.strictEqual(resNewCustomRole.status, 201)
    const closerRoleId = resNewCustomRole.body.data._id || resNewCustomRole.body.data.id

    // Test 25: Tenant B Admin cannot mutate Tenant A's custom role (404 Not Found)
    const resCrossMutate = await request(app)
      .put(`/api/roles/${closerRoleId}`)
      .set("Cookie", adminBToken)
      .send({ name: "Hacked Closer Role" })
    assert.strictEqual(resCrossMutate.status, 404)
    console.log("  ✅ PASS: Tenant B Admin cannot modify Tenant A custom role (404 Not Found)")
    passed++

    // Test 26: Tenant B Admin cannot delete Tenant A's custom role (404 Not Found)
    const resCrossDelete = await request(app)
      .delete(`/api/roles/${closerRoleId}`)
      .set("Cookie", adminBToken)
    assert.strictEqual(resCrossDelete.status, 404)
    console.log("  ✅ PASS: Tenant B Admin cannot delete Tenant A custom role (404 Not Found)")
    passed++

    // Test 27: Agent Bob (own scope) cannot create a follow-up for Agent Arthur's lead (403 Forbidden)
    const resBobCrossLeadFollowup = await request(app)
      .post("/api/follow-ups")
      .set("Cookie", agentBToken)
      .send({
        leadId: leadAgentA._id.toString(),
        title: "Unauthorized follow-up attempt",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      })
    assert.strictEqual(resBobCrossLeadFollowup.status, 403)
    console.log("  ✅ PASS: Agent cannot create follow-up for out-of-scope lead (403 Forbidden)")
    passed++

    // Create a follow-up assigned to Bob
    const resBobFollowUp = await request(app)
      .post("/api/follow-ups")
      .set("Cookie", agentBToken)
      .send({
        leadId: leadAgentB._id.toString(),
        title: "Bob's Scheduled Follow-up",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      })
    assert.strictEqual(resBobFollowUp.status, 201)
    const bobFollowUpId = resBobFollowUp.body.data.id

    // Test 28: Charlie (Agent in Team 1) cannot delete Bob's follow-up (403 Forbidden)
    const charlieUser = new User({
      name: "Agent Charlie",
      email: `charlie_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      teamId: team1._id,
      status: "active",
      isActive: true,
    })
    await charlieUser.save()
    const charlieLogin = await loginUser(charlieUser.email, "Password123!")
    const charlieToken = charlieLogin.cookie

    const resCharlieDeleteBobFollowUp = await request(app)
      .delete(`/api/follow-ups/${bobFollowUpId}`)
      .set("Cookie", charlieToken)
    assert.strictEqual(resCharlieDeleteBobFollowUp.status, 403)
    console.log("  ✅ PASS: Agent cannot delete another agent's follow-up (403 Forbidden)")
    passed++

    // Test 29: Agent Charlie cannot update Bob's lead details (403 Forbidden)
    const resCharlieUpdateBobLead = await request(app)
      .put(`/api/leads/${leadAgentB._id}`)
      .set("Cookie", charlieToken)
      .send({ name: "Tampered by Charlie" })
    assert.strictEqual(resCharlieUpdateBobLead.status, 403)
    console.log("  ✅ PASS: Agent cannot update another agent's lead (403 Forbidden)")
    passed++

    // =========================================================
    // SUITE 9: Negative Security Audit — Privilege Escalation, Deletion Guards & Cache Invalidation
    // =========================================================
    console.log("\n--- Suite 9: Deletion Guards, Stale Sessions & Role Cache Invalidation ---")

    // Test 30: System role rename attempt is blocked (400 Bad Request)
    const managerRoleDoc = resRoles.body.data.roles.find((r) => r.slug === "manager")
    const resRenameSystemRole = await request(app)
      .put(`/api/roles/${managerRoleDoc.id}`)
      .set("Cookie", adminAToken)
      .send({ name: "Executive Super Manager" })
    assert.strictEqual(resRenameSystemRole.status, 400)
    assert(resRenameSystemRole.body.error.includes("System role"), "Error mentions system role name cannot be modified")
    console.log("  ✅ PASS: System role rename attempt is blocked (400 Bad Request)")
    passed++

    // Test 31: Deleting a custom role with active staff assigned is blocked (400 Bad Request)
    await request(app)
      .put(`/api/staff/${charlieUser._id}`)
      .set("Cookie", adminAToken)
      .send({ role: "closer_role", roleId: closerRoleId })

    const resDeleteAssignedRole = await request(app)
      .delete(`/api/roles/${closerRoleId}`)
      .set("Cookie", adminAToken)
    assert.strictEqual(resDeleteAssignedRole.status, 400)
    assert(resDeleteAssignedRole.body.error.includes("assigned to this role"), "Error mentions active staff assigned")
    console.log("  ✅ PASS: Deleting custom role with active staff assigned is blocked (400 Bad Request)")
    passed++

    // Test 32: Immediate role cache invalidation: Revoking permission takes effect immediately on active session
    const charlieCloserLogin = await loginUser(charlieUser.email, "Password123!")
    const charlieCloserToken = charlieCloserLogin.cookie

    const leadCharlie = new Lead({
      name: "Charlie's Deal",
      email: `charlie_deal_${TEST_TAG}@test.com`,
      phone: "+1 555-0199",
      status: "New",
      tenantId: TENANT_A,
      assignedStaffId: charlieUser._id.toString(),
      assignedTo: charlieUser.email,
    })
    await leadCharlie.save()

    // Charlie can currently update their own lead
    const resCharlieEdit1 = await request(app)
      .put(`/api/leads/${leadCharlie._id}`)
      .set("Cookie", charlieCloserToken)
      .send({ name: "Charlie's Deal Updated" })
    assert.strictEqual(resCharlieEdit1.status, 200)

    // Account Admin modifies Closer Role to revoke leads.edit.own
    const resRevokeEdit = await request(app)
      .put(`/api/roles/${closerRoleId}`)
      .set("Cookie", adminAToken)
      .send({ permissions: ["dashboard.view", "leads.view.own"] })
    assert.strictEqual(resRevokeEdit.status, 200)

    // On the VERY NEXT request with Charlie's existing token, edit must be immediately rejected with 403
    const resCharlieEditAfterRevoke = await request(app)
      .put(`/api/leads/${leadCharlie._id}`)
      .set("Cookie", charlieCloserToken)
      .send({ name: "Charlie's Forbidden Edit" })
    assert.strictEqual(resCharlieEditAfterRevoke.status, 403)
    console.log("  ✅ PASS: Revoking permission in role immediately blocks active session on next request (403 Forbidden)")
    passed++

    // Test 33: Deactivated user session is rejected immediately on next request (403 Forbidden)
    await request(app)
      .patch(`/api/staff/${charlieUser._id}/deactivate`)
      .set("Cookie", adminAToken)

    const resCharlieDeactivated = await request(app)
      .get("/api/leads")
      .set("Cookie", charlieCloserToken)
    assert.strictEqual(resCharlieDeactivated.status, 403)
    assert(resCharlieDeactivated.body.error.includes("deactivated"), "Error indicates deactivated account")
    console.log("  ✅ PASS: Deactivated user session is rejected immediately on next request (403 Forbidden)")
    passed++

    // Test 34: Non-admin (Agent) attempting unauthorized role modification is blocked (403 Forbidden)
    const resAgentRoleMod = await request(app)
      .put(`/api/roles/${closerRoleId}`)
      .set("Cookie", agentBToken)
      .send({ permissions: ["dashboard.view", "leads.view.all", "leads.edit.all"] })
    assert.strictEqual(resAgentRoleMod.status, 403)
    console.log("  ✅ PASS: Non-admin agent attempting unauthorized role modification is blocked (403 Forbidden)")
    passed++

    console.log("\n=======================================================")
    console.log(`PHASE 5 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("=======================================================\n")
  } catch (error) {
    console.error("\n❌ Fatal error during Phase 5 verification:", error)
    failed++
  } finally {
    await cleanupData()
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
    process.exit(failed > 0 ? 1 : 0)
  }
}

runTests()
