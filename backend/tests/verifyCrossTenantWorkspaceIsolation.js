const express = require("express")
const cookieParser = require("cookie-parser")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })
const connectDB = require("../db/connection")

async function runTests() {
  console.log("=== Starting Synthetic Cross-Tenant Workspace Isolation Regression Tests ===")
  await connectDB()

  const Account = require("../models/Account")
  const Workspace = require("../models/Workspace")
  const WorkspaceMembership = require("../models/WorkspaceMembership")
  const User = require("../models/User")
  const authRoutes = require("../routes/authRoutes")
  const workspaceRoutes = require("../routes/workspaceRoutes")

  // Mount real Express routes (authenticate + tenantContextMiddleware + controllers)
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/api/auth", authRoutes)
  app.use("/api/workspaces", workspaceRoutes)

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s))
  })
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}/api`

  const ts = Date.now()
  const TENANT_A = `ACC-ISOL-A-${ts}`
  const TENANT_B = `ACC-ISOL-B-${ts}`
  const TENANT_STANDALONE = `ACC-ISOL-STANDALONE-${ts}`

  let passed = 0
  let failed = 0
  function assert(cond, msg) {
    if (cond) {
      console.log(`  [PASS] ${msg}`)
      passed++
    } else {
      console.error(`  [FAIL] ${msg}`)
      failed++
    }
  }

  async function apiReq(urlPath, { method = "GET", token = null, headers = {}, body = null } = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }

  try {
    const pass = "IsolationTest@123"

    // Create synthetic users across Tenant A, Tenant B, and Standalone Tenant
    const [adminA, staffA, adminB, staffB, adminStandalone] = await Promise.all([
      User.create({ name: "Admin A", email: `admin-a-${ts}@test.local`, password: pass, role: "account_admin", tenantId: TENANT_A, status: "active", isActive: true }),
      User.create({ name: "Staff A", email: `staff-a-${ts}@test.local`, password: pass, role: "agent", tenantId: TENANT_A, status: "active", isActive: true }),
      User.create({ name: "Admin B", email: `admin-b-${ts}@test.local`, password: pass, role: "account_admin", tenantId: TENANT_B, status: "active", isActive: true }),
      User.create({ name: "Staff B", email: `staff-b-${ts}@test.local`, password: pass, role: "agent", tenantId: TENANT_B, status: "active", isActive: true }),
      User.create({ name: "Standalone Admin", email: `admin-s-${ts}@test.local`, password: pass, role: "account_admin", tenantId: TENANT_STANDALONE, status: "active", isActive: true }),
    ])

    await Promise.all([
      Account.create({ accountId: TENANT_A, companyName: "Tenant A Corp", displayName: "Tenant A", slug: `tenant-a-${ts}`, adminUserId: adminA._id, adminEmail: adminA.email, adminName: adminA.name, workspaceModeEnabled: true, status: "active" }),
      Account.create({ accountId: TENANT_B, companyName: "Tenant B Corp", displayName: "Tenant B", slug: `tenant-b-${ts}`, adminUserId: adminB._id, adminEmail: adminB.email, adminName: adminB.name, workspaceModeEnabled: true, status: "active" }),
      Account.create({ accountId: TENANT_STANDALONE, companyName: "Standalone Corp", displayName: "Standalone", slug: `standalone-${ts}`, adminUserId: adminStandalone._id, adminEmail: adminStandalone.email, adminName: adminStandalone.name, workspaceModeEnabled: false, status: "active" }),
    ])

    const [wsA1, wsA2, wsB1] = await Promise.all([
      Workspace.create({ tenantId: TENANT_A, name: "Alpha Primary", slug: "primary", isDefault: true, status: "active" }),
      Workspace.create({ tenantId: TENANT_A, name: "Alpha Sub", slug: "alpha-sub", isDefault: false, status: "active" }),
      Workspace.create({ tenantId: TENANT_B, name: "Beta Primary", slug: "primary", isDefault: true, status: "active" }),
    ])

    await Promise.all([
      WorkspaceMembership.create({ tenantId: TENANT_A, workspaceId: wsA1._id, userId: staffA._id, role: "agent", status: "active" }),
      WorkspaceMembership.create({ tenantId: TENANT_B, workspaceId: wsB1._id, userId: staffB._id, role: "agent", status: "active" }),
    ])

    // Authenticate all users via real /api/auth/login
    const loginA = await apiReq("/auth/login", { method: "POST", body: { email: adminA.email, password: pass } })
    const loginStaffA = await apiReq("/auth/login", { method: "POST", body: { email: staffA.email, password: pass } })
    const loginB = await apiReq("/auth/login", { method: "POST", body: { email: adminB.email, password: pass } })
    const loginS = await apiReq("/auth/login", { method: "POST", body: { email: adminStandalone.email, password: pass } })

    assert(loginA.status === 200 && Boolean(loginA.data?.data?.token), "Admin A logged in")
    assert(loginStaffA.status === 200 && Boolean(loginStaffA.data?.data?.token), "Staff A logged in")
    assert(loginB.status === 200 && Boolean(loginB.data?.data?.token), "Admin B logged in")
    assert(loginS.status === 200 && Boolean(loginS.data?.data?.token), "Standalone Admin logged in")

    const tokenAdminA = loginA.data.data.token
    const tokenStaffA = loginStaffA.data.data.token
    const tokenAdminB = loginB.data.data.token
    const tokenStandalone = loginS.data.data.token

    console.log("\n--- TEST 1: Tenant A sees ONLY Tenant A workspaces (Org Admin & Staff) ---")
    const listAdminA = await apiReq("/workspaces", { token: tokenAdminA })
    const namesAdminA = (listAdminA.data?.data || []).map((w) => w.name)
    assert(listAdminA.status === 200, "Tenant A Org Admin GET /workspaces succeeded")
    assert(namesAdminA.includes("Alpha Primary") && namesAdminA.includes("Alpha Sub"), "Tenant A Org Admin sees all Tenant A workspaces")
    assert(!namesAdminA.includes("Beta Primary"), "Tenant A Org Admin does NOT see Tenant B workspaces")
    assert((listAdminA.data?.data || []).every((w) => w.tenantId === TENANT_A), "Every returned workspace belongs to TENANT_A")

    const listStaffA = await apiReq("/workspaces", { token: tokenStaffA })
    assert(listStaffA.status === 200, "Tenant A Staff GET /workspaces succeeded")
    assert((listStaffA.data?.data || []).length === 1 && listStaffA.data.data[0].name === "Alpha Primary", "Staff A sees ONLY assigned Alpha Primary workspace")

    console.log("\n--- TEST 2: Creating workspace under Tenant B never makes it visible under Tenant A ---")
    const createB = await apiReq("/workspaces", {
      method: "POST",
      token: tokenAdminB,
      // Attempt client-side spoofing of tenantId in body + header — MUST be ignored / derived server-side
      headers: { "x-tenant-id": TENANT_A },
      body: { name: "Beta Sub Secret", slug: "beta-sub-secret", tenantId: TENANT_A },
    })
    assert(createB.status === 201, `Tenant B created workspace HTTP 201 (got ${createB.status})`)
    assert(createB.data?.data?.tenantId === TENANT_B, "Created workspace server-derived tenantId is strictly TENANT_B (ignored client spoofing)")

    const listAAfterBCreate = await apiReq("/workspaces", { token: tokenAdminA })
    const namesAAfter = (listAAfterBCreate.data?.data || []).map((w) => w.name)
    assert(!namesAAfter.includes("Beta Sub Secret"), "Tenant A does NOT see workspace created under Tenant B")

    const listB = await apiReq("/workspaces", { token: tokenAdminB })
    const namesB = (listB.data?.data || []).map((w) => w.name)
    assert(namesB.includes("Beta Primary") && namesB.includes("Beta Sub Secret"), "Tenant B sees both Tenant B workspaces")
    assert(!namesB.includes("Alpha Primary") && !namesB.includes("Alpha Sub"), "Tenant B sees ZERO Tenant A workspaces")

    console.log("\n--- TEST 3: Tenant A cannot access Tenant B workspace via API params or headers ---")
    const crossGetWs = await apiReq(`/workspaces/${wsB1._id}`, {
      token: tokenAdminA,
      headers: { "x-tenant-id": TENANT_B, "x-workspace-id": wsB1._id.toString() },
    })
    assert(crossGetWs.status === 404 || crossGetWs.status === 403, `Tenant A accessing Tenant B workspace ID rejected (HTTP ${crossGetWs.status})`)

    const crossListWithParam = await apiReq(`/workspaces?tenantId=${TENANT_B}`, {
      token: tokenAdminA,
      headers: { "x-tenant-id": TENANT_B },
    })
    assert(
      crossListWithParam.status === 200 && (crossListWithParam.data?.data || []).every((w) => w.tenantId === TENANT_A),
      "GET /workspaces?tenantId=TENANT_B with x-tenant-id spoofing STILL scopes strictly to TENANT_A"
    )

    const crossLoginUrl = await apiReq("/auth/login", {
      method: "POST",
      body: { email: adminA.email, password: pass, organization: `tenant-b-${ts}`, workspace: "primary" },
    })
    assert(crossLoginUrl.status === 403, `Tenant A user logging into Tenant B org/workspace URL rejected HTTP 403 (got ${crossLoginUrl.status})`)

    console.log("\n--- TEST 4: Standalone tenant remains isolated & unaffected ---")
    const listStandalone = await apiReq("/workspaces", { token: tokenStandalone })
    assert(listStandalone.status === 200, "Standalone tenant GET /workspaces returned HTTP 200")
    assert(listStandalone.data?.workspaceModeEnabled === false && (listStandalone.data?.data || []).length === 0, "Standalone tenant reports workspaceModeEnabled=false and 0 workspaces")
  } catch (err) {
    console.error("Unexpected test error:", err)
    failed++
  } finally {
    console.log("\n[Cleanup] Removing synthetic test records...")
    await Promise.all([
      Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } }),
      Workspace.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } }).setOptions({ skipTenantFilter: true }),
      WorkspaceMembership.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } }).setOptions({ skipTenantFilter: true }),
      User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_STANDALONE] } }),
    ]).catch((e) => console.warn("Cleanup warning:", e.message))

    server.close()
    await mongoose.disconnect()

    console.log(`\n=== Regression Summary ===`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${failed}`)
    if (failed > 0) {
      process.exitCode = 1
    }
  }
}

runTests()
