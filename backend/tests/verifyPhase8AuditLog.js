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
const { RolePermission, DEFAULT_ACCOUNT_ADMIN_PERMISSIONS } = require("../models/RolePermission")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const AuditLog = require("../models/AuditLog")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const audit = require("../services/auditService")
const { sanitizeAuditDetails, computeAuditDiff } = require("../utils/auditSanitizer")
const { runWithTenantContext } = require("../middleware/tenantContext")
const { invalidateTenantRoleCache, invalidatePermissionCache } = require("../middleware/authMiddleware")
const app = require("../start")

/**
 * Automated Verification Suite for Roadmap Phase 8: Audit Log
 */

const TEST_TAG = `p8_${Date.now()}`
const TENANT_A = `tenant_p8_a_${Date.now()}`
const TENANT_B = `tenant_p8_b_${Date.now()}`

let adminAUser = null
let agentAUser = null
let adminBUser = null

let adminAToken = null
let agentAToken = null
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

    await AuditLog.collection.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })

    await User.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })

    await Role.collection.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })

    await Team.collection.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })

    await Lead.collection.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })

    await Account.deleteMany({
      accountId: { $in: [TENANT_A, TENANT_B] },
    })

    await LeadFeedConfig.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    })
  } catch (err) {
    console.error("Cleanup error:", err.message)
  }
}

let passedTests = 0
let failedTests = 0

const runTest = async (testName, fn) => {
  try {
    process.stdout.write(`  ⏳ ${testName} ... `)
    await fn()
    console.log("✅ PASSED")
    passedTests++
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`)
    console.error(error.stack)
    failedTests++
  }
}

async function runPhase8Verification() {
  console.log("\n========================================================")
  console.log("   PHASE 8: AUDIT LOG VERIFICATION SUITE")
  console.log("========================================================\n")

  await connectDB()
  await cleanupData()

  try {
    // ----------------------------------------------------
    // SETUP FIXTURES: Accounts, Roles, and Users
    // ----------------------------------------------------
    console.log("🔧 Setting up test tenants and user accounts...")

    const adminAUserId = new mongoose.Types.ObjectId()
    const adminBUserId = new mongoose.Types.ObjectId()

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: `Tenant A Company ${TEST_TAG}`,
        displayName: "Tenant Alpha",
        adminName: "Admin User Tenant A",
        adminEmail: `admin.a.${TEST_TAG}@test.com`,
        adminUserId: adminAUserId,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: `Tenant B Company ${TEST_TAG}`,
        displayName: "Tenant Beta",
        adminName: "Admin User Tenant B",
        adminEmail: `admin.b.${TEST_TAG}@test.com`,
        adminUserId: adminBUserId,
        status: "active",
      },
    ])

    // Seed system roles for both tenants
    await Role.ensureTenantRoles(TENANT_A)
    await Role.ensureTenantRoles(TENANT_B)

    const roleAdminA = await Role.findOne({ tenantId: TENANT_A, slug: "account_admin" }).lean()
    const roleAgentA = await Role.findOne({ tenantId: TENANT_A, slug: "agent" }).lean()
    const roleAdminB = await Role.findOne({ tenantId: TENANT_B, slug: "account_admin" }).lean()

    adminAUser = await User.create({
      _id: adminAUserId,
      name: "Admin User Tenant A",
      email: `admin.a.${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      roleId: roleAdminA?._id,
      tenantId: TENANT_A,
      isActive: true,
      status: "active",
    })

    agentAUser = await User.create({
      name: "Agent User Tenant A",
      email: `agent.a.${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      roleId: roleAgentA?._id,
      tenantId: TENANT_A,
      isActive: true,
      status: "active",
    })

    adminBUser = await User.create({
      _id: adminBUserId,
      name: "Admin User Tenant B",
      email: `admin.b.${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      roleId: roleAdminB?._id,
      tenantId: TENANT_B,
      isActive: true,
      status: "active",
    })

    // Authenticate users and acquire cookies
    const loginAdminA = await request(app)
      .post("/api/auth/login")
      .send({ email: adminAUser.email, password: "Password123!" })
    adminAToken = getClientCookie(loginAdminA)

    const loginAgentA = await request(app)
      .post("/api/auth/login")
      .send({ email: agentAUser.email, password: "Password123!" })
    agentAToken = getClientCookie(loginAgentA)

    const loginAdminB = await request(app)
      .post("/api/auth/login")
      .send({ email: adminBUser.email, password: "Password123!" })
    adminBToken = getClientCookie(loginAdminB)

    assert(adminAToken, "Admin A login failed to set client cookie")
    assert(agentAToken, "Agent A login failed to set client cookie")
    assert(adminBToken, "Admin B login failed to set client cookie")

    console.log("✅ Fixtures and authentication established.\n")

    // ----------------------------------------------------
    // SUITE 1: Direct Audit Logging & Context Derivation
    // ----------------------------------------------------
    console.log("▶ SUITE 1: Direct Audit Logging & Context Derivation")

    await runTest("audit.log() records entry with correct actor, action, and summary", async () => {
      const entry = await audit.log({
        tenantId: TENANT_A,
        actor: adminAUser,
        action: "test.action",
        entity: "test_entity",
        entityId: "12345",
        summary: "Manual test action recorded",
        details: { foo: "bar", count: 42 },
        ip: "192.168.1.100",
        userAgent: "TestAgent/1.0",
      })

      assert(entry, "Expected audit log document returned")
      assert.strictEqual(entry.tenantId, TENANT_A)
      assert.strictEqual(entry.action, "test.action")
      assert.strictEqual(entry.entity, "test_entity")
      assert.strictEqual(entry.actor.name, adminAUser.name)
      assert.strictEqual(entry.actor.email, adminAUser.email)
      assert.strictEqual(entry.actor.role, "account_admin")
      assert.strictEqual(entry.ip, "192.168.1.100")
      assert.strictEqual(entry.userAgent, "TestAgent/1.0")
      assert.strictEqual(entry.details.foo, "bar")
      assert.strictEqual(entry.details.count, 42)
    })

    await runTest("audit.log() derives context automatically from request object", async () => {
      const mockReq = {
        user: adminAUser,
        tenantId: TENANT_A,
        ip: "10.0.0.5",
        headers: { "user-agent": "AutomatedTestBrowser/2.0" },
      }

      const entry = await audit.log({
        action: "test.req_derived",
        entity: "system",
        summary: "Action with req-derived context",
        req: mockReq,
      })

      assert(entry, "Audit record should be saved")
      assert.strictEqual(entry.tenantId, TENANT_A)
      assert.strictEqual(entry.actor.email, adminAUser.email)
      assert.strictEqual(entry.ip, "10.0.0.5")
      assert.strictEqual(entry.userAgent, "AutomatedTestBrowser/2.0")
    })

    await runTest("audit.log() fails safely on invalid input without throwing", async () => {
      const result = await audit.log({
        // Missing action, entity, and summary
      })
      assert.strictEqual(result, null, "Should return null on invalid input without crashing")
    })

    // ----------------------------------------------------
    // SUITE 2: Sensitive Data Redaction
    // ----------------------------------------------------
    console.log("\n▶ SUITE 2: Sensitive Data Redaction")

    await runTest("Redacts passwords, tokens, secrets, cookies, and raw keys from details", async () => {
      const sensitivePayload = {
        user: "john_doe",
        password: "MySuperSecretPassword123!",
        userToken: "bearer_xyz_987654",
        apiSecretKey: "sec_abc12345",
        cookieHeader: "session_id=abcdef123456",
        rawApiKey: "lf_live_0123456789abcdef",
        apiKeyMasked: "lf_live_••••••••cdef", // Whitelisted
        ruleKey: "lead_rule_1", // Whitelisted
        nested: {
          clientPasswordHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          safeField: "this is completely safe",
        },
      }

      const sanitized = sanitizeAuditDetails(sensitivePayload)

      assert.strictEqual(sanitized.user, "john_doe")
      assert.strictEqual(sanitized.password, "[REDACTED]")
      assert.strictEqual(sanitized.userToken, "[REDACTED]")
      assert.strictEqual(sanitized.apiSecretKey, "[REDACTED]")
      assert.strictEqual(sanitized.cookieHeader, "[REDACTED]")
      assert.strictEqual(sanitized.rawApiKey, "[REDACTED]")
      assert.strictEqual(sanitized.apiKeyMasked, "lf_live_••••••••cdef", "Whitelisted masked key must be preserved")
      assert.strictEqual(sanitized.ruleKey, "lead_rule_1", "Whitelisted rule key must be preserved")
      assert.strictEqual(sanitized.nested.clientPasswordHash, "[REDACTED]")
      assert.strictEqual(sanitized.nested.safeField, "this is completely safe")
    })

    await runTest("Redacts JWT strings embedded inside objects", async () => {
      const sampleJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      const payload = {
        status: "success",
        accessToken: sampleJwt,
      }
      const sanitized = sanitizeAuditDetails(payload)
      assert.strictEqual(sanitized.accessToken, "[REDACTED]")
    })

    await runTest("computeAuditDiff captures changes and ignores internal fields", async () => {
      const before = { name: "Agent Role", permissions: ["leads.view.own"], updatedAt: new Date(), password: "secret" }
      const after = { name: "Agent Senior", permissions: ["leads.view.team"], updatedAt: new Date(), password: "new_secret" }

      const diff = computeAuditDiff(before, after)
      assert(diff, "Diff must be generated")
      assert(diff.changedFields.includes("name"))
      assert(diff.changedFields.includes("permissions"))
      assert(!diff.changedFields.includes("updatedAt"), "updatedAt must be ignored")
      assert(!diff.changedFields.includes("password"), "password must be ignored in diff")
      assert.strictEqual(diff.before.name, "Agent Role")
      assert.strictEqual(diff.after.name, "Agent Senior")
    })

    // ----------------------------------------------------
    // SUITE 3: Immutability and Anti-Tampering Enforcement
    // ----------------------------------------------------
    console.log("\n▶ SUITE 3: Immutability & Anti-Tampering Enforcement")

    await runTest("Mongoose update hooks block updating existing AuditLog records", async () => {
      const testLog = await runWithTenantContext(TENANT_A, async () => {
        return AuditLog.create({
          tenantId: TENANT_A,
          actor: { name: "Tester", email: "test@test.com", role: "admin" },
          action: "test.immutable",
          entity: "test",
          summary: "Original immutable entry",
        })
      })

      let updateThrew = false
      try {
        await AuditLog.updateOne({ _id: testLog._id }, { summary: "Tampered summary" })
      } catch (err) {
        updateThrew = true
        assert(err.message.includes("immutable"), "Error should indicate immutability")
      }
      assert.strictEqual(updateThrew, true, "Direct updateOne must be blocked")

      let findOneAndUpdateThrew = false
      try {
        await AuditLog.findOneAndUpdate({ _id: testLog._id }, { summary: "Tampered via findOneAndUpdate" })
      } catch (err) {
        findOneAndUpdateThrew = true
        assert(err.message.includes("immutable"))
      }
      assert.strictEqual(findOneAndUpdateThrew, true, "findOneAndUpdate must be blocked")
    })

    await runTest("Mongoose delete hooks block deleting AuditLog records", async () => {
      const testLog = await runWithTenantContext(TENANT_A, async () => {
        return AuditLog.create({
          tenantId: TENANT_A,
          actor: { name: "Tester", email: "test@test.com", role: "admin" },
          action: "test.undeletable",
          entity: "test",
          summary: "Entry that should not be deleted",
        })
      })

      let deleteThrew = false
      try {
        await AuditLog.deleteOne({ _id: testLog._id })
      } catch (err) {
        deleteThrew = true
        assert(err.message.includes("immutable"))
      }
      assert.strictEqual(deleteThrew, true, "Direct deleteOne must be blocked")

      let findOneAndDeleteThrew = false
      try {
        await AuditLog.findOneAndDelete({ _id: testLog._id })
      } catch (err) {
        findOneAndDeleteThrew = true
        assert(err.message.includes("immutable"))
      }
      assert.strictEqual(findOneAndDeleteThrew, true, "findOneAndDelete must be blocked")
    })

    // ----------------------------------------------------
    // SUITE 4: API Endpoint RBAC & Access Control
    // ----------------------------------------------------
    console.log("\n▶ SUITE 4: API Endpoint RBAC & Access Control")

    await runTest("GET /api/audit-logs returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/api/audit-logs")
      assert.strictEqual(res.status, 401)
      assert.strictEqual(res.body.success, false)
    })

    await runTest("GET /api/audit-logs returns 403 for Agent without audit.view permission", async () => {
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Cookie", agentAToken)
      assert.strictEqual(res.status, 403, "Agent lacking audit.view must receive 403 Forbidden")
      assert.strictEqual(res.body.success, false)
    })

    await runTest("GET /api/audit-logs returns 200 for Account Admin with audit.view", async () => {
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Cookie", adminAToken)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert(Array.isArray(res.body.data))
      assert(res.body.pagination, "Pagination info must be present")
    })

    await runTest("Mutation endpoints (PUT/PATCH/DELETE) do not exist on audit routes (404)", async () => {
      const resPut = await request(app).put("/api/audit-logs/12345").set("Cookie", adminAToken)
      assert.strictEqual(resPut.status, 404, "PUT /api/audit-logs/:id should not exist")

      const resDelete = await request(app).delete("/api/audit-logs/12345").set("Cookie", adminAToken)
      assert.strictEqual(resDelete.status, 404, "DELETE /api/audit-logs/:id should not exist")
    })

    // ----------------------------------------------------
    // SUITE 5: Strict Multi-Tenant Isolation
    // ----------------------------------------------------
    console.log("\n▶ SUITE 5: Strict Multi-Tenant Isolation")

    let logTenantB = null
    await runTest("Seed audit records in Tenant B", async () => {
      logTenantB = await audit.log({
        tenantId: TENANT_B,
        actor: adminBUser,
        action: "tenant_b.secret_action",
        entity: "confidential",
        summary: "Tenant B confidential audit entry",
      })
      assert(logTenantB)
    })

    await runTest("Tenant A Account Admin CANNOT see Tenant B audit logs in list query", async () => {
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      const foundTenantBLog = res.body.data.find(
        (entry) => entry._id === logTenantB._id.toString() || entry.tenantId === TENANT_B,
      )
      assert.strictEqual(foundTenantBLog, undefined, "Tenant A must NOT see Tenant B audit entries")
    })

    await runTest("Tenant A Account Admin CANNOT fetch Tenant B audit log by ID (returns 404)", async () => {
      const res = await request(app)
        .get(`/api/audit-logs/${logTenantB._id}`)
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 404, "Cross-tenant audit log fetch must return 404")
      assert.strictEqual(res.body.success, false)
    })

    await runTest("Tenant B Account Admin CAN fetch its own audit log by ID (returns 200)", async () => {
      const res = await request(app)
        .get(`/api/audit-logs/${logTenantB._id}`)
        .set("Cookie", adminBToken)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert.strictEqual(res.body.data.summary, "Tenant B confidential audit entry")
    })

    // ----------------------------------------------------
    // SUITE 6: Filtering, Search, and Pagination
    // ----------------------------------------------------
    console.log("\n▶ SUITE 6: Filtering, Search, and Pagination")

    await runTest("Filter by entity returns only matching records", async () => {
      await audit.log({
        tenantId: TENANT_A,
        actor: adminAUser,
        action: "custom.filter_test",
        entity: "unique_entity_xyz",
        summary: "Unique entity entry",
      })

      const res = await request(app)
        .get("/api/audit-logs?entity=unique_entity_xyz")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      assert(res.body.data.length > 0)
      res.body.data.forEach((entry) => {
        assert.strictEqual(entry.entity, "unique_entity_xyz")
      })
    })

    await runTest("Filter by action returns only matching records", async () => {
      const res = await request(app)
        .get("/api/audit-logs?action=custom.filter_test")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      assert(res.body.data.length > 0)
      res.body.data.forEach((entry) => {
        assert.strictEqual(entry.action, "custom.filter_test")
      })
    })

    await runTest("Search query filters by summary text", async () => {
      const res = await request(app)
        .get("/api/audit-logs?search=Unique%20entity%20entry")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      assert(res.body.data.length >= 1)
      assert(res.body.data[0].summary.includes("Unique entity entry"))
    })

    await runTest("Pagination limit and page navigation work correctly", async () => {
      // Seed 5 records
      for (let i = 1; i <= 5; i++) {
        await audit.log({
          tenantId: TENANT_A,
          actor: adminAUser,
          action: "pagination.test",
          entity: "page_entity",
          summary: `Pagination item ${i}`,
        })
      }

      const resPage1 = await request(app)
        .get("/api/audit-logs?action=pagination.test&limit=2&page=1")
        .set("Cookie", adminAToken)

      assert.strictEqual(resPage1.status, 200)
      assert.strictEqual(resPage1.body.data.length, 2)
      assert.strictEqual(resPage1.body.pagination.page, 1)
      assert.strictEqual(resPage1.body.pagination.limit, 2)
      assert(resPage1.body.pagination.total >= 5)

      const resPage2 = await request(app)
        .get("/api/audit-logs?action=pagination.test&limit=2&page=2")
        .set("Cookie", adminAToken)

      assert.strictEqual(resPage2.status, 200)
      assert.strictEqual(resPage2.body.data.length, 2)
      assert.strictEqual(resPage2.body.pagination.page, 2)
      assert.notStrictEqual(resPage1.body.data[0]._id, resPage2.body.data[0]._id, "Page 2 must have distinct entries")
    })

    await runTest("GET /api/audit-logs/filters returns distinct actions and entities", async () => {
      const res = await request(app)
        .get("/api/audit-logs/filters")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      assert(Array.isArray(res.body.data.actions))
      assert(Array.isArray(res.body.data.entities))
      assert(res.body.data.actions.includes("pagination.test"))
      assert(res.body.data.entities.includes("page_entity"))
    })

    // ----------------------------------------------------
    // SUITE 7: Real Business Event Trigger Verifications
    // ----------------------------------------------------
    console.log("\n▶ SUITE 7: Real Business Event Trigger Verifications")

    await runTest("User login writes auth.login audit log", async () => {
      // Login admin A
      await request(app)
        .post("/api/auth/login")
        .send({ email: adminAUser.email, password: "Password123!" })

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "auth.login", "actor.email": adminAUser.email }).sort({ timestamp: -1 }),
      )

      assert(logs.length > 0, "auth.login log must be created on login")
      assert.strictEqual(logs[0].actor.email, adminAUser.email)
      assert(logs[0].summary.includes("logged in successfully"))
    })

    let createdStaffId = null
    await runTest("Staff creation writes staff.create audit log", async () => {
      const res = await request(app)
        .post("/api/staff")
        .set("Cookie", adminAToken)
        .send({
          name: "Audited Staff Agent",
          email: `audited.staff.${TEST_TAG}@test.com`,
          role: "agent",
        })

      assert.strictEqual(res.status, 201)
      createdStaffId = res.body.data.staff.id

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "staff.create", entityId: createdStaffId }),
      )

      assert(logs.length > 0, "staff.create log must be created")
      assert(logs[0].summary.includes("Audited Staff Agent"))
    })

    await runTest("Staff deactivation writes staff.deactivate audit log", async () => {
      const res = await request(app)
        .patch(`/api/staff/${createdStaffId}/deactivate`)
        .set("Cookie", adminAToken)
        .send({})

      assert.strictEqual(res.status, 200)

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "staff.deactivate", entityId: createdStaffId }),
      )

      assert(logs.length > 0, "staff.deactivate log must be created")
      assert(logs[0].summary.includes("Deactivated staff member"))
    })

    let createdRoleId = null
    await runTest("Custom role creation writes role.create audit log", async () => {
      const res = await request(app)
        .post("/api/roles")
        .set("Cookie", adminAToken)
        .send({
          name: `Custom Role ${TEST_TAG}`,
          slug: `custom_role_${Date.now()}`,
          description: "Role for audit verification",
          permissions: ["leads.view.own", "leads.create"],
        })

      assert.strictEqual(res.status, 201)
      createdRoleId = res.body.data.id || res.body.data._id

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "role.create", entityId: createdRoleId }),
      )

      assert(logs.length > 0, "role.create log must be created")
      assert(logs[0].summary.includes("Created custom role"))
    })

    await runTest("Role update writes role.update audit log with permissions diff", async () => {
      const res = await request(app)
        .put(`/api/roles/${createdRoleId}`)
        .set("Cookie", adminAToken)
        .send({
          description: "Updated description for role",
          permissions: ["leads.view.own", "leads.create", "leads.edit.own"],
        })

      assert.strictEqual(res.status, 200)

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "role.update", entityId: createdRoleId }),
      )

      assert(logs.length > 0, "role.update log must be created")
      assert(logs[0].summary.includes("Updated role"))
      assert(logs[0].details, "Details should include change info")
    })

    let testLead1 = null
    let testLead2 = null
    await runTest("Lead single assign writes lead.assign audit log", async () => {
      testLead1 = await runWithTenantContext(TENANT_A, () =>
        Lead.create({
          tenantId: TENANT_A,
          name: "Lead Alpha",
          email: `lead.alpha.${TEST_TAG}@test.com`,
          phone: "9876543210",
          status: "New",
          source: "Website",
        }),
      )

      const res = await request(app)
        .patch(`/api/leads/${testLead1._id}/assign`)
        .set("Cookie", adminAToken)
        .send({
          targetOwnerId: agentAUser._id.toString(),
          reason: "Assignment verification test",
        })

      assert.strictEqual(res.status, 200)

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "lead.assign", entityId: testLead1._id.toString() }),
      )

      assert(logs.length > 0, "lead.assign log must be created")
      assert(logs[0].summary.includes(agentAUser.name))
    })

    await runTest("Bulk lead assign writes lead.bulk_assign audit log", async () => {
      testLead2 = await runWithTenantContext(TENANT_A, () =>
        Lead.create({
          tenantId: TENANT_A,
          name: "Lead Beta",
          email: `lead.beta.${TEST_TAG}@test.com`,
          phone: "9876543211",
          status: "New",
          source: "Website",
        }),
      )

      const res = await request(app)
        .post("/api/leads/bulk-assign")
        .set("Cookie", adminAToken)
        .send({
          leadIds: [testLead1._id.toString(), testLead2._id.toString()],
          targetOwnerId: adminAUser._id.toString(),
          reason: "Bulk assignment test",
        })

      assert.strictEqual(res.status, 200)

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "lead.bulk_assign" }).sort({ timestamp: -1 }),
      )

      assert(logs.length > 0, "lead.bulk_assign log must be created")
      assert(logs[0].summary.includes("Bulk reassigned"))
      assert.strictEqual(logs[0].details.updatedCount, 2)
    })
    await runTest("Lead deletion writes lead.delete audit log", async () => {
      // Grant leads.delete permission to Admin A role and ceiling for deletion test
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, "leads.delete"] },
      )
      await Role.updateOne({ _id: roleAdminA._id }, { $addToSet: { permissions: "leads.delete" } })
      invalidateTenantRoleCache(TENANT_A)
      invalidatePermissionCache()

      const res = await request(app)
        .delete(`/api/leads/${testLead2._id}`)
        .set("Cookie", adminAToken)

      // Restore RolePermission ceiling back to default
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS },
      )
      invalidatePermissionCache()

      assert.strictEqual(res.status, 200)

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "lead.delete", entityId: testLead2._id.toString() }),
      )

      assert(logs.length > 0, "lead.delete log must be created")
      assert(logs[0].summary.includes("Lead Beta"))
    })

    await runTest("Integration API key rotation writes integration.key_rotate log with masked key only", async () => {
      // Create feed config
      await LeadFeedConfig.create({
        tenantId: TENANT_A,
        websiteSource: {
          enabled: true,
          apiKeyHash: "hash_initial",
          apiKeyMasked: "lf_live_••••••••0000",
        },
      })

      const res = await request(app)
        .post("/api/integrations/settings/website/rotate-key")
        .set("Cookie", adminAToken)

      assert.strictEqual(res.status, 200)
      const maskedKey = res.body.data.apiKeyMasked

      const logs = await runWithTenantContext(TENANT_A, () =>
        AuditLog.find({ tenantId: TENANT_A, action: "integration.key_rotate" }),
      )

      assert(logs.length > 0, "integration.key_rotate log must be created")
      assert(logs[0].summary.includes("Rotated website lead feed API key"))
      assert(logs[0].details.maskedKey, "Masked key must be in details")
      // Assert that raw key is NOT stored in audit log details
      assert.strictEqual(logs[0].details.rawApiKey, undefined, "rawApiKey must NEVER be stored in audit log")
      assert.strictEqual(logs[0].details.rawKey, undefined, "rawKey must NEVER be stored in audit log")
    })

    // ----------------------------------------------------
    // SUITE 8: Retention Policy Cleanup
    // ----------------------------------------------------
    console.log("\n▶ SUITE 8: Retention Policy Cleanup")

    await runTest("cleanupExpiredLogs deletes entries older than retention window without crossing tenants", async () => {
      const now = Date.now()
      const oldTimestamp = new Date(now - 100 * 24 * 60 * 60 * 1000) // 100 days old

      // Insert directly into collection bypassing immutability pre-save hook for historical test
      await AuditLog.collection.insertMany([
        {
          tenantId: TENANT_A,
          actor: { name: "Ancient Actor", email: "ancient@test.com", role: "admin" },
          action: "ancient.entry",
          entity: "system",
          summary: "Entry from 100 days ago in Tenant A",
          timestamp: oldTimestamp,
        },
        {
          tenantId: TENANT_B,
          actor: { name: "Ancient Actor B", email: "ancientB@test.com", role: "admin" },
          action: "ancient.entry_b",
          entity: "system",
          summary: "Entry from 100 days ago in Tenant B",
          timestamp: oldTimestamp,
        },
      ])

      const cleanupResult = await audit.cleanupExpiredLogs(TENANT_A, 90)
      assert(cleanupResult.deletedCount >= 1, "Should delete expired Tenant A logs")

      // Verify Tenant A old log is deleted
      const ancientA = await AuditLog.collection.findOne({ tenantId: TENANT_A, action: "ancient.entry" })
      assert.strictEqual(ancientA, null, "Tenant A ancient log must be deleted")

      // Verify Tenant B old log is NOT deleted (tenant isolation preserved)
      const ancientB = await AuditLog.collection.findOne({ tenantId: TENANT_B, action: "ancient.entry_b" })
      assert(ancientB, "Tenant B ancient log must NOT be touched by Tenant A cleanup")
    })

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log("\n========================================================")
    console.log(`  PHASE 8 TESTS COMPLETED: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log("========================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  } finally {
    await cleanupData()
    await mongoose.connection.close()
  }
}

if (require.main === module) {
  runPhase8Verification().catch((err) => {
    console.error("Verification error:", err)
    process.exit(1)
  })
}

module.exports = runPhase8Verification
