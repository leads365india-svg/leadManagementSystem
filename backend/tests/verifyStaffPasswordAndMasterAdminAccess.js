const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })
const connectDB = require("../db/connection")

async function runTests() {
  console.log("=== Starting Focused Verification: Staff Password Creation & Master Admin Workspace Access ===")
  await connectDB()
  console.log("[Setup] Connected to MongoDB")

  const Account = require("../models/Account")
  const Workspace = require("../models/Workspace")
  const WorkspaceMembership = require("../models/WorkspaceMembership")
  const User = require("../models/User")
  const { createStaff } = require("../controllers/staffController")
  const { listWorkspaces } = require("../controllers/workspaceController")
  const { login } = require("../controllers/authController")

  const timestamp = Date.now()
  const TEST_TENANT_ID = `ACC-STAFF-TEST-${timestamp}`
  const OTHER_TENANT_ID = `ACC-STAFF-OTHER-${timestamp}`
  const ORG_SLUG = `test-for-sub-project-${timestamp}`
  const WS_SLUG_1 = `naman`
  const WS_SLUG_2 = `sub-project-beta`

  let testAccount = null
  let otherAccount = null
  let ws1 = null
  let ws2 = null
  let orgAdminUser = null
  let superAdminUser = null
  let createdStaffUser = null

  let passedTests = 0
  let failedTests = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passedTests++
    } else {
      console.error(`  [FAIL] ${message}`)
      failedTests++
    }
  }

  try {
    // Create Master Admin (account_admin) for parent organization
    const adminPassword = "MasterAdminPassword123!"
    orgAdminUser = await User.create({
      name: "Master Admin",
      email: `masteradmin-${timestamp}@testorg.com`,
      password: adminPassword,
      role: "account_admin",
      tenantId: TEST_TENANT_ID,
      status: "active",
      isActive: true,
    })

    // User for other tenant
    const otherUser = await User.create({
      name: "Other Tenant Admin",
      email: `otheradmin-${timestamp}@othertenant.com`,
      password: "OtherPassword123!",
      role: "account_admin",
      tenantId: OTHER_TENANT_ID,
      status: "active",
      isActive: true,
    })

    // 1. Setup Parent Organization and Sub-Projects (Workspaces)
    testAccount = await Account.create({
      accountId: TEST_TENANT_ID,
      companyName: "Test For Sub Project",
      displayName: "Test Organization",
      slug: ORG_SLUG,
      status: "active",
      tier: "growth",
      workspaceModeEnabled: true,
      adminUserId: orgAdminUser._id,
      adminEmail: orgAdminUser.email,
      adminName: orgAdminUser.name,
      maxUsers: 50,
    })

    otherAccount = await Account.create({
      accountId: OTHER_TENANT_ID,
      companyName: "Other Organization",
      displayName: "Other Org",
      slug: `other-org-${timestamp}`,
      status: "active",
      tier: "growth",
      workspaceModeEnabled: true,
      adminUserId: otherUser._id,
      adminEmail: otherUser.email,
      adminName: otherUser.name,
      maxUsers: 50,
    })

    // Sub-project 1: "naman"
    ws1 = await Workspace.create({
      tenantId: TEST_TENANT_ID,
      name: "Naman Sub Project",
      slug: WS_SLUG_1,
      status: "active",
      isDefault: true,
    })

    // Sub-project 2: "sub-project-beta"
    ws2 = await Workspace.create({
      tenantId: TEST_TENANT_ID,
      name: "Beta Sub Project",
      slug: WS_SLUG_2,
      status: "active",
      isDefault: false,
    })

    // Create Super Admin for verification
    const superAdminPassword = "SuperAdminPassword123!"
    superAdminUser = await User.create({
      name: "Super Admin",
      email: `superadmin-${timestamp}@platform.com`,
      password: superAdminPassword,
      role: "super_admin",
      tenantId: null,
      status: "active",
      isActive: true,
    })

    console.log("\n--- TEST 1: Direct Staff Password Creation (No Invite Link) ---")
    const staffManualPassword = "InitialStaffPassword123!"
    const staffEmail = `directstaff-${timestamp}@testorg.com`

    let staffCreateRes = null
    const mockStaffReq = {
      tenantId: TEST_TENANT_ID,
      user: { _id: orgAdminUser._id, name: orgAdminUser.name, email: orgAdminUser.email, role: "account_admin", tenantId: TEST_TENANT_ID },
      headers: { "x-workspace-id": ws1._id.toString() },
      body: {
        name: "Direct Staff Member",
        email: staffEmail,
        phone: "+919876543210",
        role: "agent",
        password: staffManualPassword,
        workspaceId: ws1._id.toString(),
      },
      get: () => "localhost:3000",
    }

    const mockStaffRes = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.payload = payload
        return this
      },
    }

    await createStaff(mockStaffReq, mockStaffRes)
    staffCreateRes = mockStaffRes

    assert(staffCreateRes.statusCode === 201, `Staff creation returned HTTP 201 (got ${staffCreateRes.statusCode})`)
    assert(staffCreateRes.payload?.success === true, "Staff creation reported success: true")
    assert(!staffCreateRes.payload?.data?.inviteToken, "No inviteToken was returned in response")
    assert(!staffCreateRes.payload?.data?.inviteUrl, "No inviteUrl was returned in response")
    assert(staffCreateRes.payload?.data?.staff?.email === staffEmail, "Staff email matches")

    // Verify in MongoDB: password is hashed, not plaintext
    createdStaffUser = await User.findOne({ email: staffEmail, tenantId: TEST_TENANT_ID }).select("+password +inviteTokenHash")
    assert(createdStaffUser != null, "Staff user exists in MongoDB")
    assert(createdStaffUser.password !== staffManualPassword, "Password is NOT stored in plaintext")
    assert(createdStaffUser.password.startsWith("$2"), "Password is properly hashed with bcrypt")
    assert(!createdStaffUser.inviteTokenHash, "No inviteTokenHash stored in DB for direct password workflow")

    // Verify WorkspaceMembership was created
    const staffMembership = await WorkspaceMembership.findOne({
      tenantId: TEST_TENANT_ID,
      workspaceId: ws1._id,
      userId: createdStaffUser._id,
      status: "active",
    })
    assert(staffMembership != null, "Staff user automatically assigned active WorkspaceMembership to specified workspace")

    console.log("\n--- TEST 2: Immediate Staff Login With Created Password ---")
    const mockStaffLoginReq = {
      body: {
        email: staffEmail,
        password: staffManualPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const mockStaffLoginRes = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }

    await login(mockStaffLoginReq, mockStaffLoginRes)
    assert(mockStaffLoginRes.statusCode === 200, `Immediate staff login succeeded with HTTP 200 (got ${mockStaffLoginRes.statusCode})`)
    assert(mockStaffLoginRes.payload?.success === true, "Staff login reported success: true")
    assert(mockStaffLoginRes.payload?.data?.user?.email === staffEmail, "Staff user returned in login payload")
    assert(mockStaffLoginRes.payload?.data?.user?.targetWorkspace?.slug === WS_SLUG_1, "Staff targetWorkspace matches workspace 1 ('naman')")

    console.log("\n--- TEST 3: Workspace Staff Access Control (Forbidden to Access Unauthorized Workspace) ---")
    const mockStaffUnauthorizedReq = {
      body: {
        email: staffEmail,
        password: staffManualPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_2, // Staff is NOT assigned to sub-project-beta
      },
      headers: {},
    }
    const mockStaffUnauthorizedRes = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }

    await login(mockStaffUnauthorizedReq, mockStaffUnauthorizedRes)
    assert(mockStaffUnauthorizedRes.statusCode === 403, `Staff access to unauthorized workspace rejected with HTTP 403 (got ${mockStaffUnauthorizedRes.statusCode})`)
    assert(mockStaffUnauthorizedRes.payload?.code === "WORKSPACE_ACCESS_FORBIDDEN", "Error code is WORKSPACE_ACCESS_FORBIDDEN")

    console.log("\n--- TEST 4: Organization Master Admin Can Access All Sub-Projects with One Login ---")
    // Org Admin logs in targeting workspace 1 ("naman")
    const mockAdminWs1Req = {
      body: {
        email: orgAdminUser.email,
        password: adminPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const mockAdminWs1Res = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }

    await login(mockAdminWs1Req, mockAdminWs1Res)
    assert(mockAdminWs1Res.statusCode === 200, `Master Admin login for 'naman' returned HTTP 200 (got ${mockAdminWs1Res.statusCode})`)
    assert(mockAdminWs1Res.payload?.data?.user?.targetWorkspace?.slug === "naman", "Master Admin targetWorkspace resolved directly to 'naman'")
    assert(mockAdminWs1Res.payload?.data?.user?.targetWorkspace?.id === ws1._id.toString(), "Target workspace ID matches workspace 'naman' ID")

    // Org Admin logs in targeting workspace 2 ("sub-project-beta") without duplicate account
    const mockAdminWs2Req = {
      body: {
        email: orgAdminUser.email,
        password: adminPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_2,
      },
      headers: {},
    }
    const mockAdminWs2Res = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }

    await login(mockAdminWs2Req, mockAdminWs2Res)
    assert(mockAdminWs2Res.statusCode === 200, `Master Admin login for 'sub-project-beta' returned HTTP 200 (got ${mockAdminWs2Res.statusCode})`)
    assert(mockAdminWs2Res.payload?.data?.user?.targetWorkspace?.slug === WS_SLUG_2, "Master Admin targetWorkspace resolved to 'sub-project-beta'")

    // Org Admin calling listWorkspaces receives ALL active workspaces in the tenant
    const mockListWsReq = {
      tenantId: TEST_TENANT_ID,
      user: { _id: orgAdminUser._id, role: "account_admin", tenantId: TEST_TENANT_ID },
    }
    const mockListWsRes = {
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }
    await listWorkspaces(mockListWsReq, mockListWsRes)
    assert(mockListWsRes.statusCode === 200, "listWorkspaces returned HTTP 200 for Master Admin")
    const wsSlugs = (mockListWsRes.payload?.data || []).map(w => w.slug)
    assert(wsSlugs.includes("naman") && wsSlugs.includes("sub-project-beta"), "Master Admin sees all sub-projects in tenant")

    console.log("\n--- TEST 5: Master Admin Normal CRM Login (Without Workspace Selection) Retains All Projects Experience ---")
    const mockAdminNormalLoginReq = {
      body: {
        email: orgAdminUser.email,
        password: adminPassword,
        organization: ORG_SLUG,
      },
      headers: {},
    }
    const mockAdminNormalLoginRes = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }
    await login(mockAdminNormalLoginReq, mockAdminNormalLoginRes)
    assert(mockAdminNormalLoginRes.statusCode === 200, "Master Admin normal login returned HTTP 200")
    assert(mockAdminNormalLoginRes.payload?.data?.user?.targetWorkspace === null, "targetWorkspace is null when no workspace param specified (retains All Projects / Master dashboard)")

    console.log("\n--- TEST 6: Strict Cross-Tenant Isolation Protected ---")
    // User from other tenant tries to access test-for-sub-project
    const mockCrossTenantReq = {
      body: {
        email: otherUser.email,
        password: "OtherPassword123!",
        organization: ORG_SLUG, // Trying to access test-for-sub-project
        workspace: "naman",
      },
      headers: {},
    }
    const mockCrossTenantRes = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }
    await login(mockCrossTenantReq, mockCrossTenantRes)
    assert(mockCrossTenantRes.statusCode === 403, `Cross-tenant login rejected with HTTP 403 (got ${mockCrossTenantRes.statusCode})`)
    assert(mockCrossTenantRes.payload?.code === "DOMAIN_TENANT_MISMATCH", "Error code is DOMAIN_TENANT_MISMATCH")

    console.log("\n--- TEST 7: Platform Super Admin Access Unchanged ---")
    const mockSuperAdminReq = {
      body: {
        email: superAdminUser.email,
        password: superAdminPassword,
      },
      headers: {},
    }
    const mockSuperAdminRes = {
      cookies: {},
      cookie(k, v) { this.cookies[k] = v },
      clearCookie(k) { delete this.cookies[k] },
      status(c) { this.statusCode = c; return this },
      json(p) { this.payload = p; return this },
    }
    await login(mockSuperAdminReq, mockSuperAdminRes)
    assert(mockSuperAdminRes.statusCode === 200, "Super Admin login succeeded with HTTP 200")
    assert(mockSuperAdminRes.payload?.data?.user?.role === "super_admin", "Super Admin role preserved")
    assert(mockSuperAdminRes.cookies["superadmin_token"] != null, "Super Admin receives superadmin_token cookie")

  } catch (err) {
    console.error("Test execution encountered unexpected error:", err)
    failedTests++
  } finally {
    // Cleanup synthetic test records
    console.log("\n[Cleanup] Removing synthetic test entities...")
    try {
      await Account.deleteMany({ accountId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
      await Workspace.deleteMany({ tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
      await WorkspaceMembership.deleteMany({ tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
      await User.deleteMany({
        $or: [
          { tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } },
          { email: `superadmin-${timestamp}@platform.com` },
        ],
      })
      console.log("[Cleanup] Completed cleanly.")
    } catch (cleanErr) {
      console.warn("[Cleanup] Warning during cleanup:", cleanErr.message)
    }

    console.log(`\n=== Verification Summary ===`)
    console.log(`Passed: ${passedTests}`)
    console.log(`Failed: ${failedTests}`)
    if (failedTests === 0) {
      console.log("ALL TESTS PASSED SUCCESSFULLY.")
    } else {
      console.error("SOME TESTS FAILED.")
      process.exitCode = 1
    }
    await mongoose.disconnect()
  }
}

runTests()
