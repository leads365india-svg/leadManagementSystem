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
const { bootstrapSuperAdmin } = require("../db/seedSuperAdmin")
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
const createdExtraTenantIds = []

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

    const allTestTenants = Array.from(new Set([TENANT_A, TENANT_B, TENANT_MW, ...createdExtraTenantIds]))
    await Lead.deleteMany({ tenantId: { $in: allTestTenants } }).setOptions({ skipTenantFilter: true })
    await AuditLog.collection.deleteMany({
      $or: [{ tenantId: { $regex: /^ACC-RPT-/ } }, { tenantId: { $in: createdExtraTenantIds } }],
    })
    await Role.deleteMany({ tenantId: { $in: allTestTenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({
      $or: [
        { tenantId: { $in: allTestTenants } },
        { email: { $regex: TEST_TAG } },
      ],
    })
    await Account.deleteMany({ accountId: { $in: allTestTenants } })
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

    await check("Scenario 12: Removing audit.view, reports.view & leads.view.all from Account Admin survives bootstrapSuperAdmin() restart hook and getAvailablePermissions honors un-scoped ceiling", async () => {
      // Simulate production ceiling holding un-scoped legacy keys (DEFAULT_ACCOUNT_ADMIN_PERMISSIONS)
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS], updatedBy: originalCeiling.updatedBy || "system_bootstrap" },
      )
      invalidatePermissionCache()

      // Available permissions API must expose scoped leads/followups/calls keys when ceiling holds un-scoped keys
      const availRes = await request(app)
        .get("/api/roles/permissions/available")
        .set("Authorization", `Bearer ${adminBToken}`)
      assert.strictEqual(availRes.status, 200)
      const availKeys = availRes.body.data.allowedKeys || []
      assert(availKeys.includes("leads.view.all"), "Available keys must include leads.view.all under un-scoped ceiling")
      assert(availKeys.includes("leads.view.team"), "Available keys must include leads.view.team under un-scoped ceiling")
      assert(availKeys.includes("leads.view.own"), "Available keys must include leads.view.own under un-scoped ceiling")

      // Remove audit.view, reports.view, and replace leads.view with leads.view.own for Tenant A Account Admin
      const restrictedAdminPerms = ["dashboard.view", "leads.view.own", "leads.edit.own", "calls.log"]
      const restrictRes = await request(app)
        .put(`/api/roles/${roleAdminA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({
          tenantId: TENANT_A,
          permissions: restrictedAdminPerms,
        })
      assert.strictEqual(restrictRes.status, 200)
      assert.strictEqual(restrictRes.body.data.isCustomized, true)
      assert.deepStrictEqual(restrictRes.body.data.permissions.sort(), [...restrictedAdminPerms].sort())

      // Simulate server restart + reload hooks
      await bootstrapSuperAdmin()
      await ensureTenantRoles(TENANT_A)
      invalidateTenantRoleCache(TENANT_A)
      invalidatePermissionCache()

      // Customized Account Admin must NOT have audit.view or leads.view restored
      const dbAdminAfterRestart = await Role.findById(roleAdminA.id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(dbAdminAfterRestart.isCustomized, true)
      assert(!dbAdminAfterRestart.permissions.includes("audit.view"), "audit.view must NOT be re-added on restart")
      assert(!dbAdminAfterRestart.permissions.includes("reports.view"), "reports.view must remain removed")
      assert.deepStrictEqual(dbAdminAfterRestart.permissions.sort(), [...restrictedAdminPerms].sort())

      const reloadAdminListRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(reloadAdminListRes.status, 200)
      const reloadedAdminA = reloadAdminListRes.body.data.roles.find((r) => r.slug === "account_admin")
      assert.deepStrictEqual(reloadedAdminA.permissions.sort(), [...restrictedAdminPerms].sort())

      const reloadAdminSingleRes = await request(app)
        .get(`/api/roles/${roleAdminA.id}?tenantId=${TENANT_A}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(reloadAdminSingleRes.status, 200)
      assert.deepStrictEqual(reloadAdminSingleRes.body.data.permissions.sort(), [...restrictedAdminPerms].sort())

      // Also verify Admin A now gets 403 on audit logs, while Tenant B Admin still has 200
      const auditARes = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(auditARes.status, 403, "Restricted Tenant A Admin must lose /api/audit-logs when audit.view removed")

      const auditBRes = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${adminBToken}`)
      assert.strictEqual(auditBRes.status, 200, "Uncustomized Tenant B Admin must still access /api/audit-logs")
    })

    await check("Scenario 13: Customized Account Admin with leads.view.own (leads.view.all removed) is strictly scoped in GET /api/leads & GET /api/leads/:id", async () => {
      const leadOwnAdminA = await runWithTenantContext(
        { tenantId: TENANT_A, isSuperAdmin: false, mode: "standalone" },
        () =>
          Lead.create({
            tenantId: TENANT_A,
            name: "Admin A Own Lead",
            phone: `9100001${String(Date.now()).slice(-3)}`,
            assignedStaffId: adminA._id.toString(),
            assignedTo: adminA.name,
            createdBy: adminA.email,
          }),
      )
      const leadOtherAgentA = await runWithTenantContext(
        { tenantId: TENANT_A, isSuperAdmin: false, mode: "standalone" },
        () =>
          Lead.create({
            tenantId: TENANT_A,
            name: "Agent A Lead Hidden From Restricted Admin",
            phone: `9100002${String(Date.now()).slice(-3)}`,
            assignedStaffId: agentA._id.toString(),
            assignedTo: agentA.name,
            createdBy: agentA.email,
          }),
      )
      const leadTenantB = await runWithTenantContext(
        { tenantId: TENANT_B, isSuperAdmin: false, mode: "standalone" },
        () =>
          Lead.create({
            tenantId: TENANT_B,
            name: "Tenant B Lead",
            phone: `9100003${String(Date.now()).slice(-3)}`,
            assignedStaffId: adminB._id.toString(),
            assignedTo: adminB.name,
            createdBy: adminB.email,
          }),
      )

      const meAdminARes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(meAdminARes.status, 200)
      assert.deepStrictEqual(
        meAdminARes.body.data.user.permissions.sort(),
        ["calls.log", "dashboard.view", "leads.edit.own", "leads.view.own"],
      )

      const leadsListARes = await request(app).get("/api/leads").set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(leadsListARes.status, 200)
      const leadIdsA = (leadsListARes.body.data?.leads || leadsListARes.body.data || []).map((l) =>
        String(l._id || l.id),
      )
      assert(leadIdsA.includes(leadOwnAdminA._id.toString()), "Restricted Admin A must see own lead")
      assert(!leadIdsA.includes(leadOtherAgentA._id.toString()), "Restricted Admin A must NOT see Agent A lead when leads.view.all is removed")
      assert(!leadIdsA.includes(leadTenantB._id.toString()), "Tenant B lead must remain isolated")

      const directOtherRes = await request(app)
        .get(`/api/leads/${leadOtherAgentA._id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(directOtherRes.status, 403, "Direct object access must deny Agent A lead to own-scoped Admin A")

      const directOwnRes = await request(app)
        .get(`/api/leads/${leadOwnAdminA._id}`)
        .set("Authorization", `Bearer ${adminAToken}`)
      assert.strictEqual(directOwnRes.status, 200, "Direct object access must allow Admin A's own lead")

      const leadsListBRes = await request(app).get("/api/leads").set("Authorization", `Bearer ${adminBToken}`)
      assert.strictEqual(leadsListBRes.status, 200)
      const leadIdsB = (leadsListBRes.body.data?.leads || leadsListBRes.body.data || []).map((l) =>
        String(l._id || l.id),
      )
      assert(leadIdsB.includes(leadTenantB._id.toString()), "Uncustomized Tenant B Admin must still see Tenant B leads")
    })

    await check("Scenario 14: Super Admin updates Tenant B Account Admin from 25/35 down to exact 21 scoped permissions via PUT /api/roles/:id and persists across MongoDB & GET /api/roles", async () => {
      // Simulate the exact Tenant B Account Admin doc starting from 25 un-scoped defaults
      const listBInitial = await request(app)
        .get(`/api/roles?tenantId=${TENANT_B}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_B)
      assert.strictEqual(listBInitial.status, 200)
      const roleAdminB = listBInitial.body.data.roles.find((r) => r.slug === "account_admin")
      assert(roleAdminB, "Account Admin role exists for Tenant B")

      // Exact 21-permission subset (14 unchecked from the 35 expanded permissions:
      // staff.view, staff.manage, teams.manage, roles.manage, leadfeed.manage,
      // settings.view, settings.manage, calls.view.team, leads.edit.all, leads.edit.team,
      // leads.delete, followups.view.team, followups.manage.own, recordings.listen)
      const exact21Permissions = [
        "dashboard.view",
        "leads.view.all",
        "leads.view.team",
        "leads.view.own",
        "leads.create",
        "leads.edit.own",
        "leads.assign",
        "leads.export",
        "leads.bulkUpdate",
        "followups.view.all",
        "followups.view.own",
        "followups.manage.all",
        "followups.manage.team",
        "calls.view.all",
        "calls.view.own",
        "calls.log",
        "devices.manage",
        "donotrecord.manage",
        "audit.view",
        "reports.view",
        "conversion.manage",
      ]
      assert.strictEqual(exact21Permissions.length, 21)

      // Sending PUT without Content-Type: application/json (empty req.body) must fail 400 loudly, not silently 200
      const emptyBodyRes = await request(app)
        .put(`/api/roles/${roleAdminB.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_B)
        .set("Content-Type", "text/plain")
        .send(JSON.stringify({ description: roleAdminB.description, permissions: exact21Permissions, tenantId: TENANT_B }))
      assert.strictEqual(emptyBodyRes.status, 400, "Missing application/json header must return 400 instead of silently succeeding")

      // Send exact Super Admin UI PUT /api/roles/:id payload with Content-Type: application/json + x-tenant-id
      const update21Res = await request(app)
        .put(`/api/roles/${roleAdminB.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_B)
        .set("x-auth-portal", "super_admin")
        .send({
          description: roleAdminB.description,
          permissions: exact21Permissions,
          tenantId: TENANT_B,
        })
      assert.strictEqual(update21Res.status, 200)
      assert.strictEqual(update21Res.body.data.isCustomized, true)
      assert.strictEqual(update21Res.body.data.permissions.length, 21)
      assert.deepStrictEqual([...update21Res.body.data.permissions].sort(), [...exact21Permissions].sort())

      // Verify raw MongoDB document holds exact 21 permissions (not 25 or 35)
      const dbAdminB = await Role.findById(roleAdminB.id).setOptions({ skipTenantFilter: true }).lean()
      assert.strictEqual(dbAdminB.isCustomized, true)
      assert.strictEqual(dbAdminB.permissions.length, 21)
      assert.deepStrictEqual([...dbAdminB.permissions].sort(), [...exact21Permissions].sort())

      // Verify subsequent GET /api/roles & GET /api/roles/:id after cache invalidation return exact 21 permissions
      invalidateTenantRoleCache(TENANT_B)
      const reloadListRes = await request(app)
        .get(`/api/roles?tenantId=${TENANT_B}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_B)
      assert.strictEqual(reloadListRes.status, 200)
      const reloadedAdminB = reloadListRes.body.data.roles.find((r) => r.slug === "account_admin")
      assert.strictEqual(reloadedAdminB.permissions.length, 21)
      assert.deepStrictEqual([...reloadedAdminB.permissions].sort(), [...exact21Permissions].sort())

      const reloadSingleRes = await request(app)
        .get(`/api/roles/${roleAdminB.id}?tenantId=${TENANT_B}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_B)
      assert.strictEqual(reloadSingleRes.status, 200)
      assert.strictEqual(reloadSingleRes.body.data.permissions.length, 21)
      assert.deepStrictEqual([...reloadSingleRes.body.data.permissions].sort(), [...exact21Permissions].sort())
    })

    await check("Scenario 15: Newly created tenant via POST /api/accounts auto-provisions Manager, Sales Executive, Telecaller, Marketing + preserves existing customizations on ensureTenantRoles", async () => {
      const createAccRes = await request(app)
        .post("/api/super-admin/accounts")
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-auth-portal", "super_admin")
        .send({
          companyName: `Provisioned Co ${TEST_TAG}`,
          displayName: `Provisioned Co`,
          adminName: "Provisioned Admin",
          adminEmail: `prov_admin_${TEST_TAG}@test.local`,
          password: "Password123!",
        })
      assert.strictEqual(createAccRes.status, 201, `Account create failed: ${JSON.stringify(createAccRes.body)}`)
      const provisionedTenantId = createAccRes.body.data.account.accountId
      createdExtraTenantIds.push(provisionedTenantId)

      const provRolesRes = await request(app)
        .get(`/api/roles?tenantId=${provisionedTenantId}`)
        .set("Authorization", `Bearer ${superToken}`)
      assert.strictEqual(provRolesRes.status, 200)
      const provRoles = provRolesRes.body.data.roles
      const bySlug = new Map(provRoles.map((r) => [r.slug, r]))

      for (const slug of ["account_admin", "manager", "sales_executive", "telecaller", "marketing"]) {
        assert(bySlug.has(slug), `Newly created tenant must have '${slug}' role provisioned`)
      }

      assert.deepStrictEqual(
        [...bySlug.get("sales_executive").permissions].sort(),
        [
          "calls.log",
          "calls.view.own",
          "dashboard.view",
          "followups.manage.own",
          "followups.view.own",
          "leads.create",
          "leads.edit.own",
          "leads.view.own",
        ],
      )
      assert.deepStrictEqual(
        [...bySlug.get("telecaller").permissions].sort(),
        [
          "calls.log",
          "calls.view.own",
          "dashboard.view",
          "followups.manage.own",
          "followups.view.own",
          "leads.create",
          "leads.edit.own",
          "leads.view.own",
          "recordings.listen",
        ],
      )
      assert.deepStrictEqual(
        [...bySlug.get("marketing").permissions].sort(),
        [
          "dashboard.view",
          "followups.manage.own",
          "followups.view.own",
          "leads.create",
          "leads.edit.own",
          "leads.export",
          "leads.view.team",
          "reports.view",
        ],
      )
      assert(bySlug.get("manager").permissions.includes("leads.view.all"))
      assert(bySlug.get("manager").permissions.includes("leads.edit.all"))
      assert(bySlug.get("manager").permissions.includes("leads.assign"))
      assert(!bySlug.get("manager").permissions.includes("settings.manage"))
      assert(!bySlug.get("manager").permissions.includes("integrations.manage"))
      assert(!bySlug.get("manager").permissions.includes("roles.manage"))
      assert(!bySlug.get("manager").permissions.includes("staff.manage"))

      // Simulate partially seeded existing tenant (missing telecaller & marketing, customized sales_executive)
      const salesExecRole = bySlug.get("sales_executive")
      const customSalesPerms = ["dashboard.view", "leads.view.own"]
      await Role.findByIdAndUpdate(salesExecRole.id, {
        permissions: customSalesPerms,
        isCustomized: true,
      }).setOptions({ skipTenantFilter: true })
      await Role.deleteMany({
        tenantId: provisionedTenantId,
        slug: { $in: ["telecaller", "marketing"] },
      }).setOptions({ skipTenantFilter: true })

      const reseeded = await ensureTenantRoles(provisionedTenantId)
      const reseededMap = new Map(reseeded.map((r) => [r.slug, r]))
      assert(reseededMap.has("telecaller"), "Missing telecaller role must be backfilled")
      assert(reseededMap.has("marketing"), "Missing marketing role must be backfilled")
      assert.deepStrictEqual(
        [...reseededMap.get("sales_executive").permissions].sort(),
        [...customSalesPerms].sort(),
        "Customized sales_executive permissions must NEVER be overwritten",
      )
      // Also confirm Tenant A & Tenant B remain untouched and isolated
      const tenantBRolesAfter = await ensureTenantRoles(TENANT_B)
      const tenantBSalesExec = tenantBRolesAfter.find((r) => r.slug === "sales_executive")
      assert(tenantBSalesExec && tenantBSalesExec.permissions.includes("leads.create"), "Other tenant roles remain untouched")

      // Test ceiling capping during backfill: tighten ceiling temporarily for a fresh tenant
      const restrictedTenantId = `ACC-RPT-CAP-${Date.now()}`
      createdExtraTenantIds.push(restrictedTenantId)
      const prevCeiling = await RolePermission.findOne({ targetRole: "account_admin" }).lean()
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: ["dashboard.view", "leads.view.own", "leads.create"], updatedBy: "test_cap" },
      )
      invalidatePermissionCache()
      const cappedRoles = await ensureTenantRoles(restrictedTenantId)
      const cappedSalesExec = cappedRoles.find((r) => r.slug === "sales_executive")
      assert(cappedSalesExec, "Capped tenant receives sales_executive")
      assert(!cappedSalesExec.permissions.includes("leads.edit.own"), "Capped seed omits permissions excluded from ceiling")
      assert(!cappedSalesExec.permissions.includes("calls.log"), "Capped seed omits calls.log excluded from ceiling")
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: prevCeiling.permissions, updatedBy: prevCeiling.updatedBy || "test_restore" },
      )
      invalidatePermissionCache()
    })

    await check("Scenario 16: Staff creation/update + login + runtime scope enforcement for Manager, Sales Executive, Telecaller & Marketing", async () => {
      const staffPassword = "StaffPassword123!"
      const createStaffRole = async (name, emailPrefix, roleSlug) => {
        const res = await request(app)
          .post("/api/staff")
          .set("Authorization", `Bearer ${superToken}`)
          .send({
            tenantId: TENANT_A,
            name,
            email: `${emailPrefix}_${TEST_TAG}@test.local`,
            role: roleSlug,
            password: staffPassword,
          })
        assert.strictEqual(res.status, 201, `Failed creating ${roleSlug} staff: ${JSON.stringify(res.body)}`)
        assert.strictEqual(res.body.data.staff.role, roleSlug)
        return res.body.data.staff
      }

      const mgrStaff = await createStaffRole("TenantA Manager", "mgr_new", "manager")
      const execStaff = await createStaffRole("TenantA SalesExec", "exec_new", "sales_executive")
      const teleStaff = await createStaffRole("TenantA Telecaller", "tele_new", "telecaller")
      const mktStaff = await createStaffRole("TenantA Marketing", "mkt_new", "marketing")

      // Verify updateStaff handles updating role slug cleanly & populates roleId
      const updateToTele = await request(app)
        .put(`/api/staff/${mktStaff.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .send({ role: "marketing" })
      assert.strictEqual(updateToTele.status, 200)

      const mktUserDoc = await User.findById(mktStaff.id).lean()
      assert(mktUserDoc.roleId, "Updated/created staff must have roleId linked to Role document")

      const loginStaff = async (emailPrefix, expectedRole, expectedTitle) => {
        const loginRes = await request(app)
          .post("/api/auth/login")
          .send({ email: `${emailPrefix}_${TEST_TAG}@test.local`, password: staffPassword })
        assert.strictEqual(loginRes.status, 200, `Login failed for ${expectedRole}: ${JSON.stringify(loginRes.body)}`)
        assert.strictEqual(loginRes.body.data.user.role, expectedRole)
        assert.strictEqual(loginRes.body.data.user.roleTitle, expectedTitle)

        const cookies = loginRes.headers["set-cookie"] || []
        const cookieStr = Array.isArray(cookies) ? cookies.map((c) => c.split(";")[0]).join("; ") : ""
        const meRes = await request(app).get("/api/auth/me").set("Cookie", cookieStr)
        assert.strictEqual(meRes.status, 200)
        assert.strictEqual(meRes.body.data.user.role, expectedRole)
        assert.strictEqual(meRes.body.data.user.roleTitle, expectedTitle)
        return cookieStr
      }

      const mgrCookie = await loginStaff("mgr_new", "manager", "Manager")
      const execCookie = await loginStaff("exec_new", "sales_executive", "Sales Executive")
      const teleCookie = await loginStaff("tele_new", "telecaller", "Telecaller")
      const mktCookie = await loginStaff("mkt_new", "marketing", "Marketing")

      // Seed leads owned by SalesExec and Telecaller separately
      const execLead = await Lead.create({
        tenantId: TENANT_A,
        name: `Exec Own Lead ${TEST_TAG}`,
        email: `exec_lead_${TEST_TAG}@test.local`,
        phone: "+919900001111",
        ownerId: execStaff.id,
        assignedStaffId: execStaff.id,
        assignedTo: execStaff.name,
        status: "New",
      })
      const teleLead = await Lead.create({
        tenantId: TENANT_A,
        name: `Tele Own Lead ${TEST_TAG}`,
        email: `tele_lead_${TEST_TAG}@test.local`,
        phone: "+919900002222",
        ownerId: teleStaff.id,
        assignedStaffId: teleStaff.id,
        assignedTo: teleStaff.name,
        status: "New",
      })

      // Sales Executive sees ONLY own lead, blocked on Telecaller lead / assign / delete / audit / settings / integrations
      const execList = await request(app).get("/api/leads").set("Cookie", execCookie)
      assert.strictEqual(execList.status, 200)
      const execLeadIds = execList.body.data.leads.map((l) => l.id || l._id)
      assert(execLeadIds.includes(execLead._id.toString()), "Sales Executive must see own lead")
      assert(!execLeadIds.includes(teleLead._id.toString()), "Sales Executive must NOT see other user's lead")
      assert.strictEqual((await request(app).get(`/api/leads/${teleLead._id}`).set("Cookie", execCookie)).status, 403)
      assert.strictEqual(
        (await request(app).patch(`/api/leads/${execLead._id}/assign`).set("Cookie", execCookie).send({ targetOwnerId: teleStaff.id })).status,
        403,
      )
      assert.strictEqual((await request(app).delete(`/api/leads/${execLead._id}`).set("Cookie", execCookie)).status, 403)
      assert.strictEqual((await request(app).get("/api/audit-logs").set("Cookie", execCookie)).status, 403)
      assert.strictEqual((await request(app).post("/api/custom-fields").set("Cookie", execCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/integrations").set("Cookie", execCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/roles").set("Cookie", execCookie).send({ name: "X" })).status, 403)

      // Telecaller sees ONLY own lead, blocked from assign / delete / audit / settings / integrations
      const teleList = await request(app).get("/api/leads").set("Cookie", teleCookie)
      assert.strictEqual(teleList.status, 200)
      const teleLeadIds = teleList.body.data.leads.map((l) => l.id || l._id)
      assert(teleLeadIds.includes(teleLead._id.toString()), "Telecaller must see own lead")
      assert(!teleLeadIds.includes(execLead._id.toString()), "Telecaller must NOT see other user's lead")
      assert.strictEqual((await request(app).patch(`/api/leads/${teleLead._id}/assign`).set("Cookie", teleCookie).send({ targetOwnerId: execStaff.id })).status, 403)
      assert.strictEqual((await request(app).delete(`/api/leads/${teleLead._id}`).set("Cookie", teleCookie)).status, 403)
      assert.strictEqual((await request(app).post("/api/integrations").set("Cookie", teleCookie).send({ name: "X" })).status, 403)

      // Marketing can access lead import config (200), blocked from delete / assign / roles / integrations / settings
      assert.strictEqual((await request(app).get("/api/leads/import/config").set("Cookie", mktCookie)).status, 200)
      assert.strictEqual((await request(app).delete(`/api/leads/${execLead._id}`).set("Cookie", mktCookie)).status, 403)
      assert.strictEqual((await request(app).patch(`/api/leads/${execLead._id}/assign`).set("Cookie", mktCookie).send({ targetOwnerId: mktStaff.id })).status, 403)
      assert.strictEqual((await request(app).post("/api/roles").set("Cookie", mktCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/integrations").set("Cookie", mktCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/custom-fields").set("Cookie", mktCookie).send({ name: "X" })).status, 403)

      // Manager sees ALL tenant leads, can assign leads, view staff & audit-logs, and is STILL blocked from settings/integrations/roles admin
      const mgrList = await request(app).get("/api/leads").set("Cookie", mgrCookie)
      assert.strictEqual(mgrList.status, 200)
      const mgrLeadIds = mgrList.body.data.leads.map((l) => l.id || l._id)
      assert(mgrLeadIds.includes(execLead._id.toString()), "Manager must see SalesExec lead")
      assert(mgrLeadIds.includes(teleLead._id.toString()), "Manager must see Telecaller lead")
      const assignRes = await request(app)
        .patch(`/api/leads/${teleLead._id}/assign`)
        .set("Cookie", mgrCookie)
        .send({ targetOwnerId: execStaff.id, reason: "Manager reassignment" })
      assert.strictEqual(assignRes.status, 200, `Manager lead assign failed: ${JSON.stringify(assignRes.body)}`)
      assert.strictEqual((await request(app).get("/api/staff").set("Cookie", mgrCookie)).status, 200)
      assert.strictEqual((await request(app).get("/api/audit-logs").set("Cookie", mgrCookie)).status, 200)
      assert.strictEqual((await request(app).post("/api/integrations").set("Cookie", mgrCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/custom-fields").set("Cookie", mgrCookie).send({ name: "X" })).status, 403)
      assert.strictEqual((await request(app).post("/api/roles").set("Cookie", mgrCookie).send({ name: "X" })).status, 403)

      // Customizing Tenant A's Sales Executive role persists across ensureTenantRoles and does not affect Tenant B
      const rolesARes = await request(app).get(`/api/roles?tenantId=${TENANT_A}`).set("Authorization", `Bearer ${superToken}`)
      const salesExecRoleA = rolesARes.body.data.roles.find((r) => r.slug === "sales_executive")
      const customPerms = ["dashboard.view", "leads.view.own", "leads.edit.own"]
      const patchExecA = await request(app)
        .put(`/api/roles/${salesExecRoleA.id}`)
        .set("Authorization", `Bearer ${superToken}`)
        .set("x-tenant-id", TENANT_A)
        .send({ tenantId: TENANT_A, permissions: customPerms })
      assert.strictEqual(patchExecA.status, 200)
      assert.strictEqual(patchExecA.body.data.isCustomized, true)

      await ensureTenantRoles(TENANT_A)
      invalidateTenantRoleCache(TENANT_A)
      const reloadExecA = await Role.findById(salesExecRoleA.id).setOptions({ skipTenantFilter: true }).lean()
      assert.deepStrictEqual([...reloadExecA.permissions].sort(), [...customPerms].sort())

      const rolesB = await ensureTenantRoles(TENANT_B)
      const salesExecRoleB = rolesB.find((r) => r.slug === "sales_executive")
      assert(salesExecRoleB.permissions.includes("calls.log"), "Tenant B Sales Executive keeps default calls.log")
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
