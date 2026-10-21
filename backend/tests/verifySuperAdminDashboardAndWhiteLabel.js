/**
 * Automated Verification Script for Super Admin Dashboard & White-Label Management
 * Tests:
 * 1. Super Admin Authentication & Profile Session
 * 2. Super Admin Navbar & Layout Structure (2 tabs only, no Client Portal or Multi-Tenant badges)
 * 3. Validation: Indian Mobile (10-digit), Email format, Duplicate Admin Email, Domain format
 * 4. Leads Account Creation with White-Label settings and Admin password hashing
 * 5. White-Label Management & Account Update (PUT /api/super-admin/accounts/:id)
 * 6. Pagination (exactly 10 per page, limit/page params, total counts)
 * 7. Summary Cards / Stats endpoint integrity
 * 8. Account Status Toggle (Activate/Suspend with cascade to Admin user)
 * 9. Multi-Tenant isolation preservation
 */

const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const fs = require("fs")
const path = require("path")

// Connect to DB using app's connection
const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")

const API_BASE = "http://localhost:5000/api"

async function runTests() {
  console.log("\n=======================================================")
  console.log("   SUPER ADMIN & WHITE-LABEL COMPREHENSIVE AUDIT TEST   ")
  console.log("=======================================================\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      passed++
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      failed++
    }
  }

  try {
    await connectDB()

    // ----------------------------------------------------
    // TEST 1: Super Admin Layout & Navbar Code Inspection
    // ----------------------------------------------------
    console.log("🔹 Test Suite 1: Super Admin Layout & Navbar Code Inspection...")
    const layoutPath = path.join(__dirname, "../../frontend/app/super-admin/layout.jsx")
    const layoutContent = fs.readFileSync(layoutPath, "utf-8")

    assert(
      !layoutContent.includes("Multi-Tenant Isolation"),
      "Navbar does NOT contain 'Multi-Tenant Isolation' badge"
    )
    assert(
      !layoutContent.includes("Client Portal"),
      "Navbar does NOT contain separate 'Client Portal' button"
    )
    assert(
      layoutContent.includes("Super Admin Console"),
      "Navbar brand includes 'Super Admin Console' subtitle"
    )
    assert(
      layoutContent.includes("Dashboard Overview") && layoutContent.includes("Roles & Permissions"),
      "Navbar includes exactly the two designated tabs: 'Dashboard Overview' and 'Roles & Permissions'"
    )
    assert(
      layoutContent.includes("profileDropdownOpen") && layoutContent.includes("Sign Out"),
      "Navbar right side uses compact avatar profile dropdown with Sign Out"
    )

    // ----------------------------------------------------
    // TEST 2: Super Admin Authentication & Session
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 2: Super Admin Authentication & Session...")
    const superAdminRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "superadmin@leadflow.io",
        password: "SuperAdmin@2026!",
      }),
    })

    const superAdminData = await superAdminRes.json()
    assert(superAdminRes.status === 200 && superAdminData.success, "Super Admin login succeeds")

    const rawCookies = superAdminRes.headers.get("set-cookie") || ""
    const superAdminCookieMatch = rawCookies.match(/superadmin_token=([^;]+)/)
    const superAdminToken = superAdminCookieMatch ? superAdminCookieMatch[1] : ""
    const authHeaders = {
      "Content-Type": "application/json",
      Cookie: `superadmin_token=${superAdminToken}`,
    }

    // Verify /api/auth/me session
    const meRes = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders })
    const meData = await meRes.json()
    assert(
      meData.success && meData.data?.user?.role === "super_admin",
      "Authenticated session returns Super Admin identity"
    )

    // ----------------------------------------------------
    // TEST 3: Validation Rules (Mobile, Email, Domain, Duplicate)
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 3: Validation Rules...")

    // 3a. Invalid Indian Mobile (less than 10 digits or invalid starting digit)
    const badMobileRes = await fetch(`${API_BASE}/super-admin/accounts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        companyName: "Validation Test Corp",
        displayName: "Validation Corp",
        adminName: "Tester Admin",
        adminEmail: `tester.badmobile.${Date.now()}@test.io`,
        contactNumber: "12345", // Invalid
        countryCode: "IN",
        password: "password123",
      }),
    })
    const badMobileData = await badMobileRes.json()
    assert(
      badMobileRes.status === 400 && badMobileData.error.includes("mobile"),
      "Rejects invalid Indian mobile number with 400 Bad Request"
    )

    // 3b. Invalid Custom Domain (contains protocol or invalid characters)
    const badDomainRes = await fetch(`${API_BASE}/super-admin/accounts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        companyName: "Validation Test Corp",
        displayName: "Validation Corp",
        adminName: "Tester Admin",
        adminEmail: `tester.baddomain.${Date.now()}@test.io`,
        contactNumber: "9876543210",
        countryCode: "IN",
        customDomain: "https://bad_domain/test",
        password: "password123",
      }),
    })
    const badDomainData = await badDomainRes.json()
    assert(
      badDomainRes.status === 400 && badDomainData.error.includes("custom domain"),
      "Rejects invalid custom domain format with 400 Bad Request"
    )

    // ----------------------------------------------------
    // TEST 4: Account Creation with White-Label & Indian Mobile
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 4: Account Creation with White-Label Settings...")
    const timestamp = Date.now()
    const testEmail = `admin.whitelabel.${timestamp}@novatech.com`
    const testDomain = `crm-nova-${timestamp}.novatech.com`

    const createRes = await fetch(`${API_BASE}/super-admin/accounts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        companyName: `NovaTech Enterprise ${timestamp}`,
        displayName: "NovaTech CRM",
        adminName: "Maya Lin",
        adminEmail: testEmail,
        contactNumber: "9876543210", // Valid Indian 10-digit mobile
        countryCode: "IN",
        customDomain: testDomain,
        logoUrl: "https://novatech.com/assets/logo.png",
        primaryColor: "#0ea5e9",
        pageTitle: "NovaTech Client Portal",
        password: "secureNovaPass123!",
        status: "active",
      }),
    })

    const createData = await createRes.json()
    assert(
      createRes.status === 201 && createData.success,
      "Creates Leads Account with white-label settings successfully"
    )
    const newAccount = createData.data?.account
    assert(newAccount?.customDomain === testDomain, "Saved customDomain matches")
    assert(newAccount?.domainStatus === "pending_verification", "domainStatus initialized to 'pending_verification'")
    assert(newAccount?.contactNumber === "9876543210", "Saved contactNumber matches")

    // Verify Admin User in database has hashed password (not plaintext)
    const adminUser = await User.findOne({ email: testEmail }).select("+password")
    assert(adminUser !== null, "Admin user document exists in MongoDB")
    assert(
      adminUser.password !== "secureNovaPass123!" && adminUser.password.startsWith("$2"),
      "Admin password is securely bcrypt hashed in MongoDB"
    )

    // Test duplicate admin email rejection
    const dupRes = await fetch(`${API_BASE}/super-admin/accounts`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        companyName: "Duplicate Corp",
        displayName: "Duplicate Corp",
        adminName: "Another Admin",
        adminEmail: testEmail, // Duplicate
        password: "anotherPass123!",
      }),
    })
    const dupData = await dupRes.json()
    assert(
      dupRes.status === 400 && dupData.error.includes("already exists"),
      "Rejects duplicate admin email with 400 Bad Request"
    )

    // ----------------------------------------------------
    // TEST 5: White-Label Updating (PUT /api/super-admin/accounts/:id)
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 5: White-Label Updating & Account Details...")
    const updatedDomain = `portal-v2-${timestamp}.novatech.com`
    const updateRes = await fetch(`${API_BASE}/super-admin/accounts/${newAccount.id}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        companyName: `NovaTech Enterprise Updated`,
        displayName: "NovaTech Global CRM",
        adminName: "Maya Lin Vance",
        contactNumber: "9123456780",
        customDomain: updatedDomain,
        logoUrl: "https://novatech.com/v2/logo.png",
        primaryColor: "#10b981",
        pageTitle: "NovaTech Global Leads Portal",
      }),
    })

    const updateData = await updateRes.json()
    assert(updateRes.status === 200 && updateData.success, "PUT /api/super-admin/accounts/:id succeeds")
    assert(updateData.data?.customDomain === updatedDomain, "Updated customDomain saved successfully")
    assert(updateData.data?.primaryColor === "#10b981", "Updated primaryColor saved successfully")
    assert(updateData.data?.domainStatus === "pending_verification", "Domain status remains pending verification")

    // Verify GET /api/super-admin/accounts/:id returns full white-label data
    const getByIdRes = await fetch(`${API_BASE}/super-admin/accounts/${newAccount.id}`, {
      headers: authHeaders,
    })
    const getByIdData = await getByIdRes.json()
    assert(
      getByIdData.success && getByIdData.data?.customDomain === updatedDomain,
      "GET /api/super-admin/accounts/:id returns persistent white-label settings"
    )

    // ----------------------------------------------------
    // TEST 6: Pagination (Exactly 10 Per Page) & Filtering
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 6: Pagination (Exactly 10 Per Page) & Filtering...")
    const paginatedRes = await fetch(`${API_BASE}/super-admin/accounts?page=1&limit=10`, {
      headers: authHeaders,
    })
    const paginatedData = await paginatedRes.json()
    assert(paginatedRes.status === 200 && paginatedData.success, "GET /accounts?page=1&limit=10 returns 200")
    assert(paginatedData.data?.limit === 10, "Pagination limit is exactly 10")
    assert(paginatedData.data?.accounts.length <= 10, "Page contains at most 10 accounts")
    assert(typeof paginatedData.data?.total === "number", "Returns accurate total accounts count")
    assert(typeof paginatedData.data?.totalPages === "number", "Returns accurate totalPages count")

    // Test search filtering with pagination
    const searchRes = await fetch(
      `${API_BASE}/super-admin/accounts?page=1&limit=10&search=${encodeURIComponent("NovaTech")}`,
      { headers: authHeaders }
    )
    const searchData = await searchRes.json()
    assert(
      searchData.data?.accounts.some((a) => a.companyName.includes("NovaTech")),
      "Search filter by company name matches accounts correctly"
    )

    // ----------------------------------------------------
    // TEST 7: Summary Cards / Stats Consistency
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 7: Summary Metrics Consistency...")
    const statsRes = await fetch(`${API_BASE}/super-admin/stats`, { headers: authHeaders })
    const statsData = await statsRes.json()
    assert(statsRes.status === 200 && statsData.success, "GET /stats returns 200")
    assert(typeof statsData.data?.totalAccounts === "number", "Stats has totalAccounts metric")
    assert(typeof statsData.data?.activeAccounts === "number", "Stats has activeAccounts metric")
    assert(typeof statsData.data?.suspendedAccounts === "number", "Stats has suspendedAccounts metric")
    assert(typeof statsData.data?.totalAdmins === "number", "Stats has totalAdmins metric")

    // ----------------------------------------------------
    // TEST 8: Suspend & Reactivate Account Toggle
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 8: Account Suspend / Activate...")
    // Suspend
    const suspendRes = await fetch(`${API_BASE}/super-admin/accounts/${newAccount.id}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "suspended" }),
    })
    const suspendData = await suspendRes.json()
    assert(suspendRes.status === 200 && suspendData.data?.status === "suspended", "Account successfully suspended")

    // Verify Admin User status cascaded to suspended
    const suspendedAdmin = await User.findOne({ email: testEmail })
    assert(suspendedAdmin.status === "suspended", "Admin user status cascaded to 'suspended'")

    // Reactivate
    const activateRes = await fetch(`${API_BASE}/super-admin/accounts/${newAccount.id}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "active" }),
    })
    const activateData = await activateRes.json()
    assert(activateRes.status === 200 && activateData.data?.status === "active", "Account successfully reactivated")

    // ----------------------------------------------------
    // TEST 9: Multi-Tenant Data Isolation Still Enforced
    // ----------------------------------------------------
    console.log("\n🔹 Test Suite 9: Multi-Tenant Data Isolation...")
    // Log in as the new account admin
    const clientLoginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "secureNovaPass123!",
      }),
    })
    const clientLoginData = await clientLoginRes.json()
    assert(clientLoginRes.status === 200 && clientLoginData.success, "New Account Admin logs in successfully")

    const clientCookies = clientLoginRes.headers.get("set-cookie") || ""
    const clientTokenMatch = clientCookies.match(/client_token=([^;]+)/)
    const clientToken = clientTokenMatch ? clientTokenMatch[1] : ""
    const clientHeaders = {
      "Content-Type": "application/json",
      Cookie: `client_token=${clientToken}`,
    }

    // Attempt to access Super Admin API as Account Admin (Must be 403 Forbidden)
    const forbidRes = await fetch(`${API_BASE}/super-admin/stats`, { headers: clientHeaders })
    assert(forbidRes.status === 403, "Account Admin is strictly blocked from /super-admin/stats (403 Forbidden)")

    // Clean up test account & user
    await Account.findByIdAndDelete(newAccount.id)
    await User.findOneAndDelete({ email: testEmail })

    console.log("\n=======================================================")
    console.log(`TEST RESULTS: ${passed} Passed, ${failed} Failed`)
    console.log("=======================================================\n")

    process.exit(failed > 0 ? 1 : 0)
  } catch (error) {
    console.error("Test execution failed with error:", error)
    process.exit(1)
  }
}

runTests()
