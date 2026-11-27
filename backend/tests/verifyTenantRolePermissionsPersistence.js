const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const connectDB = require("../db/connection")
const app = require("../start")
const User = require("../models/User")
const Account = require("../models/Account")
const Role = require("../models/Role")
const { ensureTenantRoles } = require("../models/Role")
const RolePermission = require("../models/RolePermission")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS } = RolePermission
const Lead = require("../models/Lead")
const AuditLog = require("../models/AuditLog")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  getJwtSecret,
  invalidateTenantRoleCache,
  invalidatePermissionCache,
} = require("../middleware/authMiddleware")

const TEST_TAG = `role_persist_${Date.now()}`
const TENANT_A = `ACC-RPT-A-${Date.now()}`
const TENANT_B = `ACC-RPT-B-${Date.now()}`
const TENANT_MW = `ACC-RPT-MW-${Date.now()}`

const cleanupData = async (originalCeiling) => {
  try {
    if (originalCeiling) {
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: originalCeiling.permissions, updatedBy: originalCeiling.updatedBy || "system" },
        { upsert: true },
      )
      invalidatePermissionCache()
      invalidateTenantRoleCache()
    }

    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_MW] } }).setOptions({ skipTenantFilter: true })
    await AuditLog.collection.deleteMany({ tenantId: { $regex: /^ACC-RPT-/ } })
    await Role.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_MW] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({
      $or: [
        { tenantId: { $in: [TENANT_A, TENANT_B, TENANT_MW] } },
        { email: { $regex: TEST_TAG } },
      ],
    })
    await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B, TENANT_MW] } })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

const runTests = async () => {
  console.log("\n=====================================================================")
  console.log("🚀 VERIFYING TENANT ROLE PERMISSIONS DB PERSISTENCE & ISOLATION")
  console.log("=====================================================================\n")

  let passed = 0
  let failed = 0
  let originalCeiling = null

  const check = async (name, fn) => {
    try {
      await fn()
      console.log(`  ✅ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} -> ${err.message}`)
      failed++
    }
  }

  try {
    await connectDB()

    // Ensure baseline RolePermission ceiling exists and snapshot it cleanly
    let ceilingDoc = await RolePermission.findOne({ targetRole: "account_admin" }).lean()
    if (!ceilingDoc) {
      ceilingDoc = await RolePermission.create({
        targetRole: "account_admin",
        permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
        updatedBy: "test_seed",
      })
    }
    originalCeiling = {
      permissions: [...ceilingDoc.permissions],
      updatedBy: ceilingDoc.updatedBy,
    }

    // Make sure test ceiling includes core permissions needed for scenarios
    const testBaselineCeiling = Array.from(
      new Set([
        ...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
        "dashboard.view",
        "leads.view.all",
        "leads.view.own",
        "leads.create",
        "leads.edit.own",
        "leads.export",
        "reports.view",
        "teams.manage",
        "roles.manage",
        "staff.view",
        "staff.manage",
      ]),
    )
    await RolePermission.findOneAndUpdate(
      { targetRole: "account_admin" },
      { permissions: testBaselineCeiling, updatedBy: "test_setup" },
    )
    invalidatePermissionCache()
    invalidateTenantRoleCache()

    // Create Super Admin + two isolated Tenant Accounts + users
    const superAdminUser = await User.create({
      name: "Test Super Admin",
      email: `super_${TEST_TAG}@test.local`,
      password: "Password123!",
      role: "super_admin",
      tenantId: null,
      status: "active",
      isActive: true,
    })

    const adminAId = new mongoose.Types.ObjectId()
    const adminBId = new mongoose.Types.ObjectId()

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: `Tenant A ${TEST_TAG}`,
        displayName: "Tenant A",
        adminName: "Admin A",
        adminEmail: `admin_a_${TEST_TAG}@test.local`,
        adminUserId: adminAId,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: `Tenant B ${TEST_TAG}`,
        displayName: "Tenant B",
        adminName: "Admin B",
        adminEmail: `admin_b_${TEST_TAG}@test.local`,
        adminUserId: adminBId,
        status: "active",
      },
    ])

    const [adminA, adminB, managerA, agentA] = await User.create([
      {
        _id: adminAId,
        name: "Admin A",
        email: `admin_a_${TEST_TAG}@test.local`,
        password: "Password123!",
        role: "account_admin",
        tenantId: TENANT_A,
        status: "active",
        isActive: true,
      },
      {
        _id: adminBId,
        name: "Admin B",
        email: `admin_b_${TEST_TAG}@test.local`,
        password: "Password123!",
        role: "account_admin",
        tenantId: TENANT_B,
        status: "active",
        isActive: true,
      },
      {
        name: "Manager A",
        email: `manager_a_${TEST_TAG}@test.local`,
        password: "Password123!",
        role: "manager",
        tenantId: TENANT_A,
        status: "active",
        isActive: true,
      },
      {
        name: "Agent A",
        email: `agent_a_${TEST_TAG}@test.local`,
        password: "Password123!",
        role: "agent",
        tenantId: TENANT_A,
        status: "active",
        isActive: true,
      },
    ])

    const secret = getJwtSecret()
    const signToken = (u) =>
      jwt.sign(
        { id: u._id.toString(), email: u.email, role: u.role, tenantId: u.tenantId || null, tokenVersion: u.tokenVersion || 1 },
        secret,
        { expiresIn: "1h" },
      )

    const superToken = signToken(superAdminUser)
    const adminAToken = signToken(adminA)
    const adminBToken = signToken(adminB)
    const managerAToken = signToken(managerA)
    const agentAToken = signToken(agentA)

    let roleAdminA
    let roleManagerA
    let roleCustomA
    let roleManagerB
    let roleCustomB

    // Seed initial roles for Tenant A & Tenant B via API
    await check("Scenario 1 & Setup: Load roles for Tenant A and create Custom Role", async () => {
      const listRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(listRes.status, 200)
      const rolesA = listRes.body.data.roles
      roleAdminA = rolesA.find((r) => r.slug === "account_admin")
      roleManagerA = rolesA.find((r) => r.slug === "manager")
      assert(roleAdminA && roleManagerA, "System roles seeded for Tenant A")

      const createRes = await request(app)
        .post("/api/roles")
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          name: "Senior Executive",
          description: "Custom test role A",
          permissions: ["dashboard.view", "leads.view.own"],
        })
      assert.strictEqual(createRes.status, 201)
      roleCustomA = createRes.body.data

      // Add permission to custom role and verify DB + reload
      const updatedPerms = ["dashboard.view", "leads.view.own", "leads.create", "leads.export"]
      const updateRes = await request(app)
        .put(`/api/roles/${roleCustomA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          name: "Senior Executive",
          description: "Custom test role A updated",
          permissions: updatedPerms,
        })
      assert.strictEqual(updateRes.status, 200)
      assert.deepStrictEqual(updateRes.body.data.permissions.sort(), [...updatedPerms].sort())

      const dbDoc = await Role.findById(roleCustomA.id).setOptions({ skipTenantFilter: true }).lean()
      assert.deepStrictEqual(dbDoc.permissions.sort(), [...updatedPerms].sort())

      invalidateTenantRoleCache(TENANT_A)
      const reloadRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(reloadRes.status, 200)
      const reloadedCustom = reloadRes.body.data.roles.find((r) => r.id === roleCustomA.id)
      assert.deepStrictEqual(reloadedCustom.permissions.sort(), [...updatedPerms].sort())
    })

    await check("Scenario 2: Remove permissions from System Role (Manager) and verify ensureTenantRoles NEVER overwrites on reload", async () => {
      // Deselect leads.export and reports.view from Manager system role in Tenant A
      const targetPerms = roleManagerA.permissions.filter((p) => p !== "leads.export" && p !== "reports.view")
      assert(targetPerms.length < roleManagerA.permissions.length, "At least one permission deselected")

      const updateRes = await request(app)
        .put(`/api/roles/${roleManagerA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          description: "Customized manager perms for Tenant A",
          permissions: targetPerms,
        })
      assert.strictEqual(updateRes.status, 200)
      assert.strictEqual(updateRes.body.data.isCustomized, true)

      // Explicitly invoke ensureTenantRoles and clear caches multiple times (simulating hard refresh)
      await ensureTenantRoles(TENANT_A)
      invalidateTenantRoleCache(TENANT_A)

      const reload1 = await request(app)
        .get(`/api/roles?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(reload1.status, 200)
      const reloadedManager = reload1.body.data.roles.find((r) => r.slug === "manager")
      assert(!reloadedManager.permissions.includes("leads.export"), "leads.export must remain unchecked after reload")
      assert(!reloadedManager.permissions.includes("reports.view"), "reports.view must remain unchecked after reload")
      assert.deepStrictEqual(reloadedManager.permissions.sort(), [...targetPerms].sort())

      const dbManager = await Role.findById(roleManagerA.id).setOptions({ skipTenantFilter: true }).lean()
      assert.deepStrictEqual(dbManager.permissions.sort(), [...targetPerms].sort())
    })

    await check("Scenario 3 & 4: Multi-tenant independence even with stale x-tenant-id header / active_tenant_id cookie", async () => {
      // Seed Tenant B roles while sending stale Tenant A header + cookie!
      const listBRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_B}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .set("Cookie", `active_tenant_id=${TENANT_A}`)
      assert.strictEqual(listBRes.status, 200)
      assert.strictEqual(listBRes.body.data.tenantId, TENANT_B, "Explicit tenantId query must beat stale header/cookie")

      roleManagerB = listBRes.body.data.roles.find((r) => r.slug === "manager")
      assert(roleManagerB && roleManagerB.tenantId === TENANT_B)
      assert(roleManagerB.permissions.includes("leads.export"), "Tenant B Manager must retain original default permissions")

      // Create custom role in Tenant B while stale cookie/header point to Tenant A
      const createBRes = await request(app)
        .post("/api/roles")
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .set("Cookie", `active_tenant_id=${TENANT_A}`)
        .send({
          tenantId: TENANT_B,
          name: "Tenant B Specialist",
          permissions: ["dashboard.view", "leads.view.team"],
        })
      assert.strictEqual(createBRes.status, 201)
      roleCustomB = createBRes.body.data
      assert.strictEqual(roleCustomB.tenantId, TENANT_B)

      // Update Tenant B custom role while stale Tenant A cookie/header exist
      const updateBRes = await request(app)
        .put(`/api/roles/${roleCustomB.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .set("Cookie", `active_tenant_id=${TENANT_A}`)
        .send({
          tenantId: TENANT_B,
          name: "Tenant B Specialist",
          permissions: ["dashboard.view", "leads.view.all", "leads.create"],
        })
      assert.strictEqual(updateBRes.status, 200)
      assert.strictEqual(updateBRes.body.data.tenantId, TENANT_B)

      // Reload Tenant B roles and verify persisted
      invalidateTenantRoleCache(TENANT_B)
      const reloadB = await request(app)
        .get(`/api/roles?tenantId=${TENANT_B}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .set("Cookie", `active_tenant_id=${TENANT_A}`)
      assert.strictEqual(reloadB.status, 200)
      const reloadedCustomB = reloadB.body.data.roles.find((r) => r.id === roleCustomB.id)
      assert.deepStrictEqual(
        reloadedCustomB.permissions.sort(),
        ["dashboard.view", "leads.create", "leads.view.all"],
      )

      // Ensure Tenant A custom role and Tenant A Manager were NOT mutated
      const dbCustomA = await Role.findById(roleCustomA.id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(dbCustomA.name, "Senior Executive")
      assert(!dbCustomA.permissions.includes("leads.view.all"))

      // Ensure updating Tenant A's role ID while targeting Tenant B is rejected (404 strict tenant isolation)
      const crossTargetRes = await request(app)
        .put(`/api/roles/${roleCustomA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_B,
          permissions: ["dashboard.view"],
        })
      assert.strictEqual(crossTargetRes.status, 404)
    })

    await check("Scenario 5 & 6a: Customizing Account Admin role for Tenant A updates DB & live runtime permissions without affecting Tenant B", async () => {
      const reducedAdminPerms = roleAdminA.permissions.filter((p) => p !== "leads.create" && p !== "teams.manage")
      const updateAdminRes = await request(app)
        .put(`/api/roles/${roleAdminA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          permissions: reducedAdminPerms,
        })
      assert.strictEqual(updateAdminRes.status, 200)
      assert.strictEqual(updateAdminRes.body.data.isCustomized, true)

      // Reload Account Admin role for Tenant A after clearing cache
      invalidateTenantRoleCache(TENANT_A)
      const getSingleRes = await request(app)
        .get(`/api/roles/${roleAdminA.id}?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(getSingleRes.status, 200)
      assert(!getSingleRes.body.data.permissions.includes("leads.create"))
      assert(!getSingleRes.body.data.permissions.includes("teams.manage"))

      // Check Tenant A Account Admin runtime /api/auth/me + protected endpoint
      const meARes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(meARes.status, 200)
      assert(!meARes.body.data.user.permissions.includes("leads.create"), "Admin A should lose leads.create immediately")

      const createLeadARes = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ name: "Blocked Lead A", email: `blocked_a_${TEST_TAG}@test.local` })
      assert.strictEqual(createLeadARes.status, 403, "Admin A must get 403 when leads.create is removed from Tenant A Account Admin role")

      // Meanwhile Tenant B Account Admin still retains leads.create!
      const createLeadBRes = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${adminBToken}`)
        .send({ name: "Allowed Lead B", email: `allowed_b_${TEST_TAG}@test.local` })
      assert.strictEqual(createLeadBRes.status, 201, "Admin B must retain leads.create independently")
    })

    await check("Scenario 6b: Non-admin staff member sees live updated Manager role permissions without logout", async () => {
      // Manager A tries to create a team -> teams.manage removed from Manager A earlier or not present: verify
      const meManagerRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${managerAToken}`)
      assert.strictEqual(meManagerRes.status, 200)
      assert(!meManagerRes.body.data.user.permissions.includes("reports.view"))
      assert(!meManagerRes.body.data.user.permissions.includes("leads.export"))

      // Re-grant reports.view to Manager A via Super Admin and verify immediate runtime update
      const updatedManagerPerms = [...meManagerRes.body.data.user.permissions, "reports.view"]
      const regrantRes = await request(app)
        .put(`/api/roles/${roleManagerA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({ tenantId: TENANT_A, permissions: updatedManagerPerms })
      assert.strictEqual(regrantRes.status, 200)

      const meManagerAfter = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${managerAToken}`)
      assert.strictEqual(meManagerAfter.status, 200)
      assert(meManagerAfter.body.data.user.permissions.includes("reports.view"))
    })

    await check("Scenario 7: Super Admin ceiling enforcement blocks escalation and caps effective permissions", async () => {
      // Remove leads.export from global ceiling
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: testBaselineCeiling.filter((p) => p !== "leads.export") },
      )
      invalidatePermissionCache()
      invalidateTenantRoleCache()

      // Trying to grant leads.export to Tenant A custom role must fail 403 and preserve existing DB perms
      const escalatedRes = await request(app)
        .put(`/api/roles/${roleCustomA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          permissions: ["dashboard.view", "leads.export"],
        })
      assert.strictEqual(escalatedRes.status, 403)
      assert(escalatedRes.body.error.includes("Privilege escalation blocked"))

      // Custom role in DB kept its previous leads.view.own
      const dbCustomAfterFail = await Role.findById(roleCustomA.id).setOptions({ skipTenantFilter: true }).lean()
      assert(dbCustomAfterFail.permissions.includes("leads.create"))
    })

    await check("Scenario 8 & 10: System role rename blocked (400), invalid permissions rejected (400), and AuditLog written cleanly", async () => {
      const renameRes = await request(app)
        .put(`/api/roles/${roleManagerA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({ tenantId: TENANT_A, name: "Renamed Manager" })
      assert.strictEqual(renameRes.status, 400)

      const invalidPermRes = await request(app)
        .put(`/api/roles/${roleCustomA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({ tenantId: TENANT_A, permissions: ["dashboard.view", ""] })
      assert.strictEqual(invalidPermRes.status, 400)

      const logsManagerA = await AuditLog.find({
        tenantId: TENANT_A,
        action: "role.update",
        entityId: roleManagerA.id,
      })
        .setOptions({ skipTenantFilter: true })
        .lean()
      assert(logsManagerA.length >= 2, "Audit log entries must be persisted in Tenant A")
    })

    await check("Scenario 9: Authorization & non-Super-Admin cross-tenant enforcement", async () => {
      const anonRes = await request(app).put(`/api/roles/${roleCustomA.id}`).send({ permissions: ["dashboard.view"] })
      assert.strictEqual(anonRes.status, 401)

      const agentUpdateRes = await request(app)
        .put(`/api/roles/${roleCustomA.id}`)
        .set("Authorization", `Bearer ${agentAToken}`)
        .send({ permissions: ["dashboard.view"] })
      assert.strictEqual(agentUpdateRes.status, 403)

      // Tenant A Account Admin cannot pass Tenant B tenantId or mutate Tenant B role
      const adminACrossRes = await request(app)
        .put(`/api/roles/${roleCustomB.id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ tenantId: TENANT_B, permissions: ["dashboard.view"] })
      assert.strictEqual(adminACrossRes.status, 403)

      // Even without explicit tenantId in body, Tenant A Account Admin cannot find/update Tenant B's role ID (404)
      const adminACrossIdRes = await request(app)
        .put(`/api/roles/${roleCustomB.id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
        .send({ permissions: ["dashboard.view"] })
      assert.strictEqual(adminACrossIdRes.status, 404)
    })

    await check("Scenario 11: Multi-workspace tenant enforces Read-Only Support Mode when active_tenant_id cookie present, and permits Role updates after Exit Support Mode", async () => {
      const mwAdminId = new mongoose.Types.ObjectId()
      await Account.create({
        accountId: TENANT_MW,
        companyName: `MultiWorkspace ${TEST_TAG}`,
        displayName: "MultiWorkspace Tenant",
        adminName: "Admin MW",
        adminEmail: `admin_mw_${TEST_TAG}@test.local`,
        adminUserId: mwAdminId,
        status: "active",
        workspaceModeEnabled: true,
      })

      const mwRolesRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_MW}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(mwRolesRes.status, 200)
      const mwManagerRole = mwRolesRes.body.data.roles.find((r) => r.slug === "manager")
      assert(mwManagerRole, "Manager role seeded for multi-workspace tenant")
      const originalMwManagerPerms = [...mwManagerRole.permissions]

      // 1. Enter support mode via switch-tenant
      const enterSupportRes = await request(app)
        .post("/api/super-admin/switch-tenant")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ tenantId: TENANT_MW })
      assert.strictEqual(enterSupportRes.status, 200)

      // 2. While active_tenant_id cookie is set, mutating role is strictly blocked (403 SUPERADMIN_READONLY_SUPPORT_MODE)
      const blockedRoleUpdateRes = await request(app)
        .put(`/api/roles/${mwManagerRole.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("Cookie", `active_tenant_id=${TENANT_MW}`)
        .send({
          tenantId: TENANT_MW,
          permissions: originalMwManagerPerms.filter((p) => p !== "reports.view"),
        })
      assert.strictEqual(blockedRoleUpdateRes.status, 403)
      assert.strictEqual(blockedRoleUpdateRes.body.code, "SUPERADMIN_READONLY_SUPPORT_MODE")

      // 3. Exit support mode via switch-tenant { tenantId: null }
      const exitSupportRes = await request(app)
        .post("/api/super-admin/switch-tenant")
        .set("Authorization", `Bearer ${superToken}`)
        .set("Cookie", `active_tenant_id=${TENANT_MW}`)
        .send({ tenantId: null })
      assert.strictEqual(exitSupportRes.status, 200)
      const clearedCookieHeader = (exitSupportRes.headers["set-cookie"] || []).join("; ")
      assert(clearedCookieHeader.includes("active_tenant_id=;"), "switch-tenant(null) must clear active_tenant_id cookie")

      // 4. Outside support mode, authorized Super Admin updates multi-workspace role -> 200 OK & persisted
      const targetMwPerms = originalMwManagerPerms.filter((p) => p !== "reports.view")
      const allowedRoleUpdateRes = await request(app)
        .put(`/api/roles/${mwManagerRole.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_MW,
          permissions: targetMwPerms,
        })
      assert.strictEqual(allowedRoleUpdateRes.status, 200)
      assert.deepStrictEqual(allowedRoleUpdateRes.body.data.permissions.sort(), [...targetMwPerms].sort())

      // 5. Verify DB & reload persistence
      const dbMwManager = await Role.findById(mwManagerRole.id).setOptions({ skipTenantFilter: true }).lean()
      assert.deepStrictEqual(dbMwManager.permissions.sort(), [...targetMwPerms].sort())

      invalidateTenantRoleCache(TENANT_MW)
      await ensureTenantRoles(TENANT_MW)
      const reloadMwRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_MW}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(reloadMwRes.status, 200)
      const reloadedMwManager = reloadMwRes.body.data.roles.find((r) => r.slug === "manager")
      assert.deepStrictEqual(reloadedMwManager.permissions.sort(), [...targetMwPerms].sort())

      // 6. Read-only guard remains strictly enforced on other organization mutations even outside support mode
      const leadCreateBlockedRes = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_MW)
        .send({ name: "Forbidden SuperAdmin Lead", email: `forbidden_sa_${TEST_TAG}@test.local` })
      assert.strictEqual(leadCreateBlockedRes.status, 403)
      assert.strictEqual(leadCreateBlockedRes.body.code, "SUPERADMIN_READONLY_SUPPORT_MODE")
    })

    console.log("\n=====================================================================")
    console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("=====================================================================\n")
  } catch (err) {
    console.error("\n❌ Fatal verification error:", err)
    failed++
  } finally {
    await cleanupData(originalCeiling)
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
    process.exit(failed > 0 ? 1 : 0)
  }
}

runTests()
