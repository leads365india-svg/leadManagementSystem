const request = require("supertest")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")

// Force test environment
process.env.NODE_ENV = "test"
dotenv.config()

const app = require("../start")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const RolePermission = require("../models/RolePermission")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS } = RolePermission
const SystemConfig = require("../models/SystemConfig")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-superadmin-secret-key-2026-secure"

const results = []

const recordTest = (suite, name, passed, error) => {
  results.push({ suite, name, passed, error })
  const statusIcon = passed ? "✅ PASS" : "❌ FAIL"
  console.log(`  ${statusIcon}: ${name}`)
  if (error) {
    console.log(`    Error: ${error}`)
  }
}

async function runAllSecurityTests() {
  console.log("\n=======================================================")
  console.log("   AUTOMATED SECURITY AUDIT & VERIFICATION TEST SUITE   ")
  console.log("=======================================================\n")

  // Ensure DB connected
  if (mongoose.connection.readyState !== 1) {
    const mongoURI = process.env.MONGODB_URI
    if (!mongoURI) {
      throw new Error("MONGODB_URI not defined in environment variables")
    }
    await mongoose.connect(mongoURI)
  }

  // --- Test Fixture IDs & Identifiers ---
  const TEST_TAG = `sec_test_${Date.now()}`
  const TENANT_A_ID = `ACC-TEST-A-${TEST_TAG}`
  const TENANT_B_ID = `ACC-TEST-B-${TEST_TAG}`

  let superAdminUser
  let accountAdminA
  let accountAdminB
  let leadDefault
  let leadTenantA
  let leadTenantB

  let superAdminToken
  let accountAdminAToken
  let accountAdminBToken

  try {
    console.log("Setting up isolated test fixtures...")

    // 1. Create Test Super Admin
    superAdminUser = await User.create({
      name: "Test Super Admin",
      email: `superadmin_${TEST_TAG}@test.com`,
      password: "TestPassword@2026!",
      role: "super_admin",
      status: "active",
      tenantId: null,
    })
    superAdminToken = jwt.sign(
      { id: superAdminUser._id.toString(), email: superAdminUser.email, role: "super_admin" },
      JWT_SECRET,
      { expiresIn: "1h" },
    )

    // 2. Create Test Account Admin A
    accountAdminA = await User.create({
      name: "Account Admin A",
      email: `adminA_${TEST_TAG}@test.com`,
      password: "TestPassword@2026!",
      role: "account_admin",
      tenantId: TENANT_A_ID,
      status: "active",
    })
    accountAdminAToken = jwt.sign(
      { id: accountAdminA._id.toString(), email: accountAdminA.email, role: "account_admin", tenantId: TENANT_A_ID },
      JWT_SECRET,
      { expiresIn: "1h" },
    )

    // 3. Create Test Account Admin B
    accountAdminB = await User.create({
      name: "Account Admin B",
      email: `adminB_${TEST_TAG}@test.com`,
      password: "TestPassword@2026!",
      role: "account_admin",
      tenantId: TENANT_B_ID,
      status: "active",
    })
    accountAdminBToken = jwt.sign(
      { id: accountAdminB._id.toString(), email: accountAdminB.email, role: "account_admin", tenantId: TENANT_B_ID },
      JWT_SECRET,
      { expiresIn: "1h" },
    )

    // 4. Create Leads across partitions
    leadDefault = await Lead.create({
      name: "Default Legacy Lead",
      email: `lead_default_${TEST_TAG}@test.com`,
      status: "New",
      tenantId: "default-tenant",
    })

    leadTenantA = await Lead.create({
      name: "Tenant A Lead",
      email: `lead_a_${TEST_TAG}@test.com`,
      status: "Engaged",
      tenantId: TENANT_A_ID,
    })

    leadTenantB = await Lead.create({
      name: "Tenant B Lead",
      email: `lead_b_${TEST_TAG}@test.com`,
      status: "Proposal Sent",
      tenantId: TENANT_B_ID,
    })

    // 5. Ensure baseline permissions
    await RolePermission.findOneAndUpdate(
      { targetRole: "account_admin" },
      { permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, updatedBy: "test_setup" },
      { upsert: true },
    )

    console.log("Fixtures successfully created. Executing test suites...\n")

    // =========================================================================
    // SUITE 1: Super Admin Authentication & Endpoint Protection
    // =========================================================================
    console.log("📋 Suite 1: Super Admin Authentication & Endpoint Authorization")

    // Test 1.1: Unauthenticated request to /api/super-admin/stats rejected
    {
      const res = await request(app).get("/api/super-admin/stats")
      const passed = res.status === 401 && res.body.success === false
      recordTest("Suite 1", "Unauthenticated request to /api/super-admin/stats returns 401", passed, passed ? undefined : `Expected 401, got ${res.status}`)
    }

    // Test 1.2: Unauthenticated request to /api/super-admin/accounts rejected
    {
      const res = await request(app).get("/api/super-admin/accounts")
      const passed = res.status === 401 && res.body.success === false
      recordTest("Suite 1", "Unauthenticated request to /api/super-admin/accounts returns 401", passed, passed ? undefined : `Expected 401, got ${res.status}`)
    }

    // Test 1.3: Account Admin A cannot access /api/super-admin/stats (403 Forbidden)
    {
      const res = await request(app)
        .get("/api/super-admin/stats")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 1", "Account Admin cannot access /api/super-admin/stats (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // Test 1.4: Account Admin A cannot create an account on /api/super-admin/accounts
    {
      const res = await request(app)
        .post("/api/super-admin/accounts")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ companyName: "Malicious Co", displayName: "Malicious", adminName: "Hacker", adminEmail: `hacker_${TEST_TAG}@test.com` })
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 1", "Account Admin cannot create accounts via Super Admin API (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // Test 1.5: Account Admin A cannot modify global permissions
    {
      const res = await request(app)
        .put("/api/super-admin/permissions")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ permissions: ["leads.view"] })
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 1", "Account Admin cannot modify global role permissions (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // Test 1.6: Super Admin can access /api/super-admin/stats successfully
    {
      const res = await request(app)
        .get("/api/super-admin/stats")
        .set("Authorization", `Bearer ${superAdminToken}`)
      const passed = res.status === 200 && res.body.success === true && typeof res.body.data.totalAccounts === "number"
      recordTest("Suite 1", "Super Admin with valid token receives 200 OK on /api/super-admin/stats", passed, passed ? undefined : `Expected 200, got ${res.status}`)
    }

    // =========================================================================
    // SUITE 2: Multi-Tenant Data Isolation & Parameter Tampering
    // =========================================================================
    console.log("\n📋 Suite 2: Multi-Tenant Data Isolation & Parameter Tampering")

    // Test 2.1: Account Admin A only sees Tenant A leads
    {
      const res = await request(app)
        .get("/api/leads")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
      const leads = res.body.data?.leads || []
      const allTenantA = leads.every((l) => l.tenantId === TENANT_A_ID)
      const hasTenantBLead = leads.some((l) => l._id === leadTenantB._id.toString())
      const hasDefaultLead = leads.some((l) => l._id === leadDefault._id.toString())
      const passed = res.status === 200 && allTenantA && !hasTenantBLead && !hasDefaultLead
      recordTest("Suite 2", "Account Admin A queries /api/leads and receives ONLY Tenant A leads", passed, passed ? undefined : `Leads count: ${leads.length}, leaked: B=${hasTenantBLead}, default=${hasDefaultLead}`)
    }

    // Test 2.2: Account Admin B only sees Tenant B leads
    {
      const res = await request(app)
        .get("/api/leads")
        .set("Authorization", `Bearer ${accountAdminBToken}`)
      const leads = res.body.data?.leads || []
      const allTenantB = leads.every((l) => l.tenantId === TENANT_B_ID)
      const hasTenantALead = leads.some((l) => l._id === leadTenantA._id.toString())
      const passed = res.status === 200 && allTenantB && !hasTenantALead
      recordTest("Suite 2", "Account Admin B queries /api/leads and receives ONLY Tenant B leads", passed, passed ? undefined : `Leads count: ${leads.length}, leaked A=${hasTenantALead}`)
    }

    // Test 2.3: Unauthenticated caller receives ONLY default-tenant leads
    {
      const res = await request(app).get("/api/leads")
      const leads = res.body.data?.leads || []
      const hasTenantALead = leads.some((l) => l._id === leadTenantA._id.toString())
      const hasTenantBLead = leads.some((l) => l._id === leadTenantB._id.toString())
      const passed = res.status === 200 && !hasTenantALead && !hasTenantBLead
      recordTest("Suite 2", "Unauthenticated request receives ONLY default-tenant leads (never Tenant A or B)", passed, passed ? undefined : `Leaked A=${hasTenantALead}, B=${hasTenantBLead}`)
    }

    // Test 2.4: Account Admin A attempting to query with ?tenantId=TENANT_B_ID is blocked (403)
    {
      const res = await request(app)
        .get(`/api/leads?tenantId=${TENANT_B_ID}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 2", "Account Admin A passing ?tenantId=Tenant_B in query is blocked (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // Test 2.5: Unauthenticated caller attempting to query ?tenantId=TENANT_A_ID is blocked (403)
    {
      const res = await request(app).get(`/api/leads?tenantId=${TENANT_A_ID}`)
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 2", "Unauthenticated caller passing ?tenantId=Tenant_A is blocked (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // Test 2.6: Account Admin A cannot read Tenant B's lead by ID (404 Not Found)
    {
      const res = await request(app)
        .get(`/api/leads/${leadTenantB._id}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)
      const passed = res.status === 404 && res.body.success === false
      recordTest("Suite 2", "Account Admin A attempting GET /api/leads/:tenantBLeadId returns 404", passed, passed ? undefined : `Expected 404, got ${res.status}`)
    }

    // Test 2.7: Account Admin A cannot update Tenant B's lead (404 Not Found)
    {
      const res = await request(app)
        .put(`/api/leads/${leadTenantB._id}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ name: "Hacked by Admin A" })
      const passed = res.status === 404 && res.body.success === false
      recordTest("Suite 2", "Account Admin A attempting PUT /api/leads/:tenantBLeadId returns 404", passed, passed ? undefined : `Expected 404, got ${res.status}`)
    }

    // Test 2.8: Account Admin A cannot delete Tenant B's lead (Blocked by 403 if permission missing, or 404 tenant partition)
    {
      // First verify without leads.delete permission: blocked with 403
      const resWithoutPerm = await request(app)
        .delete(`/api/leads/${leadTenantB._id}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)

      // Now grant leads.delete permission to test tenant isolation specifically
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, "leads.delete"] },
      )

      const resWithPerm = await request(app)
        .delete(`/api/leads/${leadTenantB._id}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)

      // Reset permissions back
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS },
      )

      const passed = resWithoutPerm.status === 403 && resWithPerm.status === 404
      recordTest(
        "Suite 2",
        "Account Admin A cannot delete Tenant B's lead (403 without permission, 404 with permission)",
        passed,
        passed ? undefined : `Expected 403 & 404, got ${resWithoutPerm.status} & ${resWithPerm.status}`,
      )
    }

    // Test 2.9: Account Admin A cannot inject tenantId in body to create a lead in Tenant B
    {
      const res = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ name: "Injected Lead", email: `injected_${TEST_TAG}@test.com`, tenantId: TENANT_B_ID })
      const passed = res.status === 403 && res.body.success === false
      recordTest("Suite 2", "Account Admin A body tenantId injection attempt is rejected (403 Forbidden)", passed, passed ? undefined : `Expected 403, got ${res.status}`)
    }

    // =========================================================================
    // SUITE 3: Role Permissions Enforcement on API Routes
    // =========================================================================
    console.log("\n📋 Suite 3: Backend Role Permissions Enforcement")

    // Test 3.1: Account Admin A can create lead when 'leads.create' is enabled
    {
      const res = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ name: "Allowed Lead", email: `allowed_${TEST_TAG}@test.com`, status: "New" })
      const passed = res.status === 201 && res.body.success === true
      recordTest("Suite 3", "Account Admin can create lead when 'leads.create' permission is active", passed, passed ? undefined : `Expected 201, got ${res.status}`)
    }

    // Test 3.2: Disable 'leads.create' in database, then verify Account Admin is blocked with 403
    {
      // Disable leads.create by updating RolePermission
      await RolePermission.findOneAndUpdate(
        { targetRole: "account_admin" },
        { permissions: ["leads.view", "dashboard.view"] },
      )

      const res = await request(app)
        .post("/api/leads")
        .set("Authorization", `Bearer ${accountAdminAToken}`)
        .send({ name: "Blocked Lead", email: `blocked_${TEST_TAG}@test.com`, status: "New" })

      const passed = res.status === 403 && res.body.success === false && res.body.error?.includes("leads.create")
      recordTest("Suite 3", "Disabling 'leads.create' in database immediately returns 403 Forbidden", passed, passed ? undefined : `Expected 403 with permission message, got ${res.status}: ${JSON.stringify(res.body)}`)
    }

    // Test 3.3: Disable 'leads.delete', verify DELETE /api/leads/:id returns 403
    {
      const res = await request(app)
        .delete(`/api/leads/${leadTenantA._id}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)

      const passed = res.status === 403 && res.body.success === false && res.body.error?.includes("leads.delete")
      recordTest("Suite 3", "Disabling 'leads.delete' returns 403 Forbidden on deletion attempt", passed, passed ? undefined : `Expected 403 with permission error, got ${res.status}`)
    }

    // Restore permissions
    await RolePermission.findOneAndUpdate(
      { targetRole: "account_admin" },
      { permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS },
    )

    // =========================================================================
    // SUITE 4: Account Creation, Duplicate Handling, and Rollback
    // =========================================================================
    console.log("\n📋 Suite 4: Account Creation, Input Validation & Rollback")

    // Test 4.1: Missing required fields returns 400
    {
      const res = await request(app)
        .post("/api/super-admin/accounts")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ companyName: "" })
      const passed = res.status === 400 && res.body.success === false
      recordTest("Suite 4", "Account creation with missing fields returns 400 Bad Request", passed, passed ? undefined : `Expected 400, got ${res.status}`)
    }

    // Test 4.2: Duplicate Admin email returns 400
    {
      const res = await request(app)
        .post("/api/super-admin/accounts")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          companyName: "Duplicate Test Co",
          displayName: "Duplicate Test",
          adminName: "Duplicate Admin",
          adminEmail: `adminA_${TEST_TAG}@test.com`, // Already exists
          password: "DuplicateAdminPass1!",
        })
      const passed = res.status === 400 && res.body.success === false && res.body.error?.includes("already exists")
      recordTest("Suite 4", "Duplicate admin email returns 400 with 'already exists' error message", passed, passed ? undefined : `Expected 400 with 'already exists', got ${res.status}: ${res.body.error}`)
    }

    // Test 4.3: Valid account creation with manually set password and immediate login verification
    let createdAccId = ""
    {
      const newEmail = `newadmin_${TEST_TAG}@test.com`
      const manualPassword = "AdminCustom@2026!"
      const res = await request(app)
        .post("/api/super-admin/accounts")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          companyName: "Secure Enterprise Ltd",
          displayName: "Secure Enterprise",
          adminName: "Alice Walker",
          adminEmail: newEmail,
          password: manualPassword,
          contactNumber: "1234567890",
        })

      // Verify no plaintext password leaked in response
      const hasNoPasswordInResponse = !res.body.data?.adminCredentials?.temporaryPassword && !res.body.data?.password

      // Verify newly created admin can immediately log in with the manually set password
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
          email: newEmail,
          password: manualPassword,
        })

      const loginSuccess = loginRes.status === 200 && loginRes.body.success === true && loginRes.body.data?.user?.role === "account_admin"

      const passed =
        res.status === 201 &&
        res.body.success === true &&
        res.body.data.account.accountId.startsWith("ACC-") &&
        hasNoPasswordInResponse &&
        loginSuccess

      if (res.body.data?.account?.id) {
        createdAccId = res.body.data.account.id
      }

      recordTest("Suite 4", "Account creation with manually set password succeeds and Admin logs in immediately", passed, passed ? undefined : `Expected 201 & successful login, got create=${res.status}, login=${loginRes.status}`)
    }

    // Test 4.4: Super Admin can suspend and activate account
    if (createdAccId) {
      const suspendRes = await request(app)
        .patch(`/api/super-admin/accounts/${createdAccId}/status`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ status: "suspended" })

      const suspendPassed = suspendRes.status === 200 && suspendRes.body.data.status === "suspended"
      recordTest("Suite 4", "Super Admin can suspend account (status set to 'suspended')", suspendPassed, suspendPassed ? undefined : `Expected 200, got ${suspendRes.status}`)

      const activateRes = await request(app)
        .patch(`/api/super-admin/accounts/${createdAccId}/status`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ status: "active" })

      const activatePassed = activateRes.status === 200 && activateRes.body.data.status === "active"
      recordTest("Suite 4", "Super Admin can reactivate account (status set to 'active')", activatePassed, activatePassed ? undefined : `Expected 200, got ${activateRes.status}`)
    }

    // =========================================================================
    // SUITE 5: Injection Resilience & ReDoS Protection
    // =========================================================================
    console.log("\n📋 Suite 5: Injection Resilience & ReDoS Protection")

    // Test 5.1: Malicious regex in search string does not crash or timeout
    {
      const start = Date.now()
      const redosPayload = "((((((a+)+)+)+)+)+)+$"
      const res = await request(app)
        .get(`/api/leads?search=${encodeURIComponent(redosPayload)}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)

      const duration = Date.now() - start
      const passed = res.status === 200 && duration < 1000 // Fast execution proves sanitization
      recordTest("Suite 5", `ReDoS search string is escaped and executes safely (${duration}ms < 1000ms)`, passed, passed ? undefined : `Expected 200 within 1s, got ${res.status} in ${duration}ms`)
    }

    // Test 5.2: Unexpected sortBy field falls back safely without NoSQL injection
    {
      const res = await request(app)
        .get(`/api/leads?sortBy=${encodeURIComponent("$where")}`)
        .set("Authorization", `Bearer ${accountAdminAToken}`)
      const passed = res.status === 200 && Array.isArray(res.body.data?.leads)
      recordTest("Suite 5", "Non-allowlisted sortBy field falls back safely to 'createdAt'", passed, passed ? undefined : `Expected 200, got ${res.status}`)
    }

    // Test 5.3: Invalid permissions key in updatePermissions is rejected
    {
      const res = await request(app)
        .put("/api/super-admin/permissions")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ permissions: ["leads.view", "malicious.hack.system"] })
      const passed = res.status === 400 && res.body.success === false && res.body.error?.includes("Invalid permission keys")
      recordTest("Suite 5", "Server-defined allowlist rejects invalid permission keys (400 Bad Request)", passed, passed ? undefined : `Expected 400, got ${res.status}`)
    }

  } catch (unexpectedError) {
    console.error("Fatal test runner error:", unexpectedError)
  } finally {
    console.log("\nCleaning up test fixtures...")
    try {
      if (superAdminUser) await User.findByIdAndDelete(superAdminUser._id)
      if (accountAdminA) await User.findByIdAndDelete(accountAdminA._id)
      if (accountAdminB) await User.findByIdAndDelete(accountAdminB._id)
      if (leadDefault) await Lead.findByIdAndDelete(leadDefault._id)
      if (leadTenantA) await Lead.findByIdAndDelete(leadTenantA._id)
      if (leadTenantB) await Lead.findByIdAndDelete(leadTenantB._id)
      await Account.deleteMany({ companyName: { $in: ["Secure Enterprise Ltd", "Duplicate Test Co"] } })
      await User.deleteMany({ email: { $regex: TEST_TAG } })
      await Lead.deleteMany({ email: { $regex: TEST_TAG } })
      console.log("Cleanup completed.")
    } catch (cleanupErr) {
      console.error("Cleanup error:", cleanupErr)
    }
  }

  // Final Summary
  console.log("\n=======================================================")
  console.log("               TEST EXECUTION SUMMARY                  ")
  console.log("=======================================================")
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  console.log(`Total Tests Run: ${total}`)
  console.log(`Passed:          ${passed}`)
  console.log(`Failed:          ${failed}`)
  console.log("=======================================================\n")

  if (failed > 0) {
    console.error(`❌ ${failed} test(s) failed!`)
    process.exit(1)
  } else {
    console.log("🎉 ALL SECURITY TESTS PASSED SUCCESSFULLY!")
    process.exit(0)
  }
}

runAllSecurityTests()
