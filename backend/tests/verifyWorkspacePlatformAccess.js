const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })
const connectDB = require("../db/connection")

async function runTests() {
  console.log("=== Starting Synthetic Verification: Auto-Generated Platform Workspace Access ===")
  await connectDB()
  console.log("[Setup] Connected to MongoDB")

  const Account = require("../models/Account")
  const Workspace = require("../models/Workspace")
  const WorkspaceMembership = require("../models/WorkspaceMembership")
  const User = require("../models/User")
  const { listWorkspaces, createWorkspace, updateWorkspace, removeWorkspaceDomain } = require("../controllers/workspaceController")
  const { login } = require("../controllers/authController")

  const TEST_TENANT_ID = "ACC-TEST-AUTO-URL-" + Date.now()
  const OTHER_TENANT_ID = "ACC-TEST-OTHER-" + Date.now()
  const ORG_SLUG = "apex-health-" + Date.now()
  const WS_SLUG_1 = "cardiology-unit"
  const WS_SLUG_2 = "neurology-unit"
  const WS_SLUG_NEW = "advanced-cardiology"

  let testAccount = null
  let otherAccount = null
  let ws1 = null
  let ws2 = null
  let orgAdminUser = null
  let assignedStaff = null
  let unassignedStaff = null
  let otherTenantUser = null

  try {
    // 1. Create synthetic Users
    const testPassword = "Password@123"

    orgAdminUser = await User.create({
      name: "Org Admin",
      email: `admin-${Date.now()}@apexhealth.test`,
      password: testPassword,
      role: "account_admin",
      tenantId: TEST_TENANT_ID,
      status: "active",
      isActive: true,
    })

    assignedStaff = await User.create({
      name: "Assigned Staff",
      email: `assigned-${Date.now()}@apexhealth.test`,
      password: testPassword,
      role: "agent",
      tenantId: TEST_TENANT_ID,
      status: "active",
      isActive: true,
    })

    unassignedStaff = await User.create({
      name: "Unassigned Staff",
      email: `unassigned-${Date.now()}@apexhealth.test`,
      password: testPassword,
      role: "agent",
      tenantId: TEST_TENANT_ID,
      status: "active",
      isActive: true,
    })

    otherTenantUser = await User.create({
      name: "Other Tenant User",
      email: `other-${Date.now()}@otherhealth.test`,
      password: testPassword,
      role: "agent",
      tenantId: OTHER_TENANT_ID,
      status: "active",
      isActive: true,
    })

    // 2. Create synthetic Accounts
    testAccount = await Account.create({
      accountId: TEST_TENANT_ID,
      companyName: "Apex Health Network",
      displayName: "Apex Health",
      slug: ORG_SLUG,
      adminUserId: orgAdminUser._id,
      adminEmail: orgAdminUser.email,
      adminName: orgAdminUser.name,
      workspaceModeEnabled: true,
      status: "active",
    })

    otherAccount = await Account.create({
      accountId: OTHER_TENANT_ID,
      companyName: "Other Health Corp",
      displayName: "Other Health",
      slug: "other-health-" + Date.now(),
      adminUserId: otherTenantUser._id,
      adminEmail: otherTenantUser.email,
      adminName: otherTenantUser.name,
      workspaceModeEnabled: true,
      status: "active",
    })

    // 3. Create synthetic Workspaces
    ws1 = await Workspace.create({
      tenantId: TEST_TENANT_ID,
      name: "Cardiology Unit",
      slug: WS_SLUG_1,
      description: "Cardiac care operational unit",
      customDomain: null,
      domainStatus: "unconfigured",
      status: "active",
    })

    ws2 = await Workspace.create({
      tenantId: TEST_TENANT_ID,
      name: "Neurology Unit",
      slug: WS_SLUG_2,
      description: "Neurology operational unit",
      customDomain: null,
      domainStatus: "unconfigured",
      status: "active",
    })

    // Assign assignedStaff to ws1 ONLY
    await WorkspaceMembership.create({
      tenantId: TEST_TENANT_ID,
      workspaceId: ws1._id,
      userId: assignedStaff._id,
      role: "agent",
      status: "active",
    })

    // Mock Express req/res helper
    function createMockRes() {
      const res = {
        statusCode: 200,
        headers: {},
        cookies: {},
        clearedCookies: [],
        jsonData: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.jsonData = data
          return this
        },
        cookie(name, val, opts) {
          this.cookies[name] = { val, opts }
          return this
        },
        clearCookie(name, opts) {
          this.clearedCookies.push(name)
          return this
        },
      }
      return res
    }

    console.log("\n--- TEST 1: Auto-generated accessUrl on workspace listing ---")
    const listReq = {
      tenantId: TEST_TENANT_ID,
      user: { role: "account_admin", tenantId: TEST_TENANT_ID, _id: orgAdminUser._id },
    }
    const listRes = createMockRes()
    await listWorkspaces(listReq, listRes)

    console.log(`HTTP Status: ${listRes.statusCode}`)
    const listedWs = listRes.jsonData.data.find((w) => w.slug === WS_SLUG_1)
    console.log(`Workspace: ${listedWs?.name}, Slug: ${listedWs?.slug}`)
    console.log(`Generated Access URL: ${listedWs?.accessUrl}`)
    const expectedUrl1 = `https://crm.leads365.in/portal/login?organization=${ORG_SLUG}&workspace=${WS_SLUG_1}`
    if (listedWs?.accessUrl === expectedUrl1) {
      console.log("PASS: Access URL matches expected format without custom domain.")
    } else {
      throw new Error(`FAIL: Access URL mismatch! Expected ${expectedUrl1}, got ${listedWs?.accessUrl}`)
    }

    console.log("\n--- TEST 2: Assigned employee authenticates via auto-generated platform URL ---")
    const authReqAssigned = {
      body: {
        email: assignedStaff.email,
        password: testPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const authResAssigned = createMockRes()
    await login(authReqAssigned, authResAssigned)

    console.log(`HTTP Status: ${authResAssigned.statusCode}`)
    if (authResAssigned.statusCode === 200 && authResAssigned.jsonData?.data?.user?.targetWorkspace?.slug === WS_SLUG_1) {
      console.log(`PASS: Assigned employee authenticated and directly received targetWorkspace: ${authResAssigned.jsonData.data.user.targetWorkspace.name}`)
    } else {
      throw new Error(`FAIL: Assigned employee failed to authenticate or targetWorkspace missing: ${JSON.stringify(authResAssigned.jsonData)}`)
    }

    console.log("\n--- TEST 3: Unauthorized staff member is rejected with 403 Forbidden ---")
    const authReqUnassigned = {
      body: {
        email: unassignedStaff.email,
        password: testPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const authResUnassigned = createMockRes()
    await login(authReqUnassigned, authResUnassigned)

    console.log(`HTTP Status: ${authResUnassigned.statusCode}`)
    console.log(`Error Response: ${authResUnassigned.jsonData?.error}`)
    if (authResUnassigned.statusCode === 403 && authResUnassigned.jsonData?.code === "WORKSPACE_ACCESS_FORBIDDEN") {
      console.log("PASS: Unauthorized staff member strictly rejected with HTTP 403 WORKSPACE_ACCESS_FORBIDDEN.")
    } else {
      throw new Error(`FAIL: Unauthorized staff was not rejected with 403 WORKSPACE_ACCESS_FORBIDDEN! Got: ${authResUnassigned.statusCode}`)
    }

    console.log("\n--- TEST 4: User from another organization is rejected with 403 DOMAIN_TENANT_MISMATCH ---")
    const authReqOtherTenant = {
      body: {
        email: otherTenantUser.email,
        password: testPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const authResOtherTenant = createMockRes()
    await login(authReqOtherTenant, authResOtherTenant)

    console.log(`HTTP Status: ${authResOtherTenant.statusCode}`)
    console.log(`Error Response: ${authResOtherTenant.jsonData?.error}`)
    if (authResOtherTenant.statusCode === 403 && authResOtherTenant.jsonData?.code === "DOMAIN_TENANT_MISMATCH") {
      console.log("PASS: Cross-tenant attempt strictly rejected with HTTP 403 DOMAIN_TENANT_MISMATCH.")
    } else {
      throw new Error(`FAIL: Cross-tenant attempt was not rejected with 403 DOMAIN_TENANT_MISMATCH! Got: ${authResOtherTenant.statusCode}`)
    }

    console.log("\n--- TEST 5: Org Admin can access any workspace within their organization ---")
    const authReqAdmin = {
      body: {
        email: orgAdminUser.email,
        password: testPassword,
        organization: ORG_SLUG,
        workspace: WS_SLUG_1,
      },
      headers: {},
    }
    const authResAdmin = createMockRes()
    await login(authReqAdmin, authResAdmin)

    console.log(`HTTP Status: ${authResAdmin.statusCode}`)
    if (authResAdmin.statusCode === 200 && authResAdmin.jsonData?.data?.user?.targetWorkspace?.slug === WS_SLUG_1) {
      console.log(`PASS: Org Admin successfully accessed workspace '${WS_SLUG_1}' without explicit membership requirement.`)
    } else {
      throw new Error(`FAIL: Org Admin failed to access workspace: ${JSON.stringify(authResAdmin.jsonData)}`)
    }

    console.log("\n--- TEST 6: Single workspace assigned employee logging in without workspace parameter ---")
    const authReqSingleWs = {
      body: {
        email: assignedStaff.email,
        password: testPassword,
      },
      headers: {},
    }
    const authResSingleWs = createMockRes()
    await login(authReqSingleWs, authResSingleWs)

    console.log(`HTTP Status: ${authResSingleWs.statusCode}`)
    if (authResSingleWs.statusCode === 200 && authResSingleWs.jsonData?.data?.user?.targetWorkspace?.slug === WS_SLUG_1) {
      console.log(`PASS: Employee assigned to 1 workspace automatically received targetWorkspace: ${authResSingleWs.jsonData.data.user.targetWorkspace.name}`)
    } else {
      throw new Error(`FAIL: Single workspace auto-resolution failed: ${JSON.stringify(authResSingleWs.jsonData)}`)
    }

    console.log("\n--- TEST 7: Safe slug update with collision check & access URL update ---")
    // A: Collision check: attempt to update ws1 slug to ws2 slug
    const updateReqDuplicate = {
      params: { workspaceId: ws1._id.toString() },
      user: { role: "account_admin", tenantId: TEST_TENANT_ID },
      body: { slug: WS_SLUG_2 },
    }
    const updateResDuplicate = createMockRes()
    await updateWorkspace(updateReqDuplicate, updateResDuplicate)

    console.log(`Duplicate slug status: ${updateResDuplicate.statusCode}`)
    if (updateResDuplicate.statusCode === 409 && updateResDuplicate.jsonData?.code === "DUPLICATE_WORKSPACE_SLUG") {
      console.log("PASS: Slug collision within organization rejected with HTTP 409 DUPLICATE_WORKSPACE_SLUG.")
    } else {
      throw new Error(`FAIL: Duplicate slug was not rejected with 409! Got: ${updateResDuplicate.statusCode}`)
    }

    // B: Valid slug update: update ws1 slug to WS_SLUG_NEW
    const updateReqValid = {
      params: { workspaceId: ws1._id.toString() },
      user: { role: "account_admin", tenantId: TEST_TENANT_ID },
      body: { slug: WS_SLUG_NEW },
    }
    const updateResValid = createMockRes()
    await updateWorkspace(updateReqValid, updateResValid)

    console.log(`Valid slug update status: ${updateResValid.statusCode}`)
    const updatedWs = updateResValid.jsonData?.data
    console.log(`Updated Workspace Slug: ${updatedWs?.slug}`)
    console.log(`Updated Access URL: ${updatedWs?.accessUrl}`)
    const expectedNewUrl = `https://crm.leads365.in/portal/login?organization=${ORG_SLUG}&workspace=${WS_SLUG_NEW}`
    if (updatedWs?.slug === WS_SLUG_NEW && updatedWs?.accessUrl === expectedNewUrl) {
      console.log("PASS: Slug and auto-generated access URL updated cleanly.")
    } else {
      throw new Error(`FAIL: Updated slug or URL mismatch! Got ${updatedWs?.accessUrl}`)
    }

    // Verify assigned employee membership remained active and intact
    const verifyMembership = await WorkspaceMembership.findOne({
      tenantId: TEST_TENANT_ID,
      workspaceId: ws1._id,
      userId: assignedStaff._id,
      status: "active",
    })
    if (verifyMembership) {
      console.log("PASS: WorkspaceMembership preserved after slug change.")
    } else {
      throw new Error("FAIL: WorkspaceMembership was broken by slug update!")
    }

    console.log("\n--- TEST 8: Custom domain verification & fallback on removal ---")
    // When custom domain is verified, accessUrl is white-label URL
    ws1.customDomain = "cardio.apexhealth.test"
    ws1.domainStatus = "verified"
    await ws1.save()

    const listResDomain = createMockRes()
    await listWorkspaces(listReq, listResDomain)
    const wsWithDomain = listResDomain.jsonData.data.find((w) => w._id.toString() === ws1._id.toString())
    console.log(`Verified customDomain Access URL: ${wsWithDomain?.accessUrl}`)
    if (wsWithDomain?.accessUrl === "https://cardio.apexhealth.test/portal/login") {
      console.log("PASS: Verified custom domain uses white-label URL.")
    } else {
      throw new Error(`FAIL: Verified custom domain URL expected https://cardio.apexhealth.test/portal/login, got ${wsWithDomain?.accessUrl}`)
    }

    // When custom domain is removed, falls back to platform URL
    const removeDomainReq = {
      params: { workspaceId: ws1._id.toString() },
      user: { role: "account_admin", tenantId: TEST_TENANT_ID },
    }
    const removeDomainRes = createMockRes()
    await removeWorkspaceDomain(removeDomainReq, removeDomainRes)

    console.log(`Remove domain status: ${removeDomainRes.statusCode}`)
    console.log(`Post-removal Access URL: ${removeDomainRes.jsonData?.data?.accessUrl}`)
    if (removeDomainRes.jsonData?.data?.accessUrl === expectedNewUrl) {
      console.log("PASS: Domain removal cleanly fell back to auto-generated platform URL.")
    } else {
      throw new Error(`FAIL: Post-removal URL mismatch! Got: ${removeDomainRes.jsonData?.data?.accessUrl}`)
    }

    console.log("\n=======================================================")
    console.log("ALL 8 VERIFICATION TESTS PASSED SUCCESSFULLY!")
    console.log("=======================================================")
  } finally {
    // Cleanup synthetic fixtures
    console.log("\n[Cleanup] Removing synthetic test fixtures...")
    await Account.deleteMany({ accountId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
    await Workspace.deleteMany({ tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
    await WorkspaceMembership.deleteMany({ tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
    await User.deleteMany({ tenantId: { $in: [TEST_TENANT_ID, OTHER_TENANT_ID] } })
    await mongoose.disconnect()
    console.log("[Cleanup] Complete and disconnected.")
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
