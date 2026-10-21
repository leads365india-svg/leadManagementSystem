const http = require("http")
const dotenv = require("dotenv")
const mongoose = require("mongoose")

dotenv.config()

const BACKEND_PORT = 5000
const FRONTEND_PORT = 3000

// Helper to make HTTP requests with cookie handling
function apiRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = ""
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () => {
        let json = null
        try {
          json = JSON.parse(body)
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json,
          rawBody: body,
        })
      })
    })

    req.on("error", (err) => reject(err))

    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData))
    }
    req.end()
  })
}

async function runEndToEndVerification() {
  console.log("\n=======================================================")
  console.log("   CLIENT CRM IDENTITY, HEADER & SECURITY AUDIT TEST   ")
  console.log("=======================================================\n")

  let passedTests = 0
  let failedTests = 0

  function assertTest(condition, testName, details = "") {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`)
      passedTests++
    } else {
      console.log(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ""}`)
      failedTests++
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Log in as Super Admin
    // -------------------------------------------------------------
    console.log("🔹 Step 1: Authenticate as Super Admin...")
    const superAdminLoginRes = await apiRequest(
      {
        hostname: "localhost",
        port: BACKEND_PORT,
        path: "/api/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        email: "superadmin@leadflow.io",
        password: "SuperAdmin@2026!",
      },
    )

    assertTest(
      superAdminLoginRes.statusCode === 200 && superAdminLoginRes.data?.data?.user?.role === "super_admin",
      "Super Admin login succeeded with role 'super_admin'",
    )

    const superAdminCookies = superAdminLoginRes.headers["set-cookie"]
    const superAdminCookieHeader = superAdminCookies ? superAdminCookies.map((c) => c.split(";")[0]).join("; ") : ""

    // -------------------------------------------------------------
    // Test 2: Create a new unique Leads Account and its Admin through Super Admin API
    // -------------------------------------------------------------
    console.log("\n🔹 Step 2: Create new Leads Account through Super Admin...")
    const testTag = Date.now()
    const newAccountPayload = {
      companyName: `Apex Cloud Systems ${testTag}`,
      displayName: `Apex Systems`,
      adminName: `Elena Rostova`,
      adminEmail: `elena.rostova.${testTag}@apexcloud.io`,
      contactNumber: "+1-555-0199",
      password: `ApexPass@${testTag}!`,
      status: "active",
    }

    const createAccountRes = await apiRequest(
      {
        hostname: "localhost",
        port: BACKEND_PORT,
        path: "/api/super-admin/accounts",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: superAdminCookieHeader,
        },
      },
      newAccountPayload,
    )

    assertTest(
      createAccountRes.statusCode === 201 && createAccountRes.data?.success === true,
      "Super Admin successfully created Leads Account and Admin user",
    )

    const createdAccount = createAccountRes.data?.data?.account
    const createdTenantId = createdAccount?.accountId

    assertTest(
      Boolean(createdTenantId && createdTenantId.startsWith("ACC-")),
      `Generated unique tenantId: ${createdTenantId}`,
    )

    // -------------------------------------------------------------
    // Test 3: Log in as the newly created Leads Account Admin
    // -------------------------------------------------------------
    console.log("\n🔹 Step 3: Log in as the new Leads Account Admin...")
    const adminLoginRes = await apiRequest(
      {
        hostname: "localhost",
        port: BACKEND_PORT,
        path: "/api/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        email: newAccountPayload.adminEmail,
        password: newAccountPayload.password,
      },
    )

    assertTest(
      adminLoginRes.statusCode === 200 && adminLoginRes.data?.success === true,
      "New Leads Account Admin successfully authenticated with assigned credentials",
    )

    const adminCookies = adminLoginRes.headers["set-cookie"]
    const adminCookieHeader = adminCookies ? adminCookies.map((c) => c.split(";")[0]).join("; ") : ""

    // -------------------------------------------------------------
    // Test 4: Verify session identity (/api/auth/me) for the Leads Account Admin
    // -------------------------------------------------------------
    console.log("\n🔹 Step 4: Verify Session Identity (/api/auth/me)...")
    const meRes = await apiRequest({
      hostname: "localhost",
      port: BACKEND_PORT,
      path: "/api/auth/me",
      method: "GET",
      headers: { Cookie: adminCookieHeader },
    })

    const loggedInUser = meRes.data?.data?.user

    assertTest(
      loggedInUser?.name === newAccountPayload.adminName,
      `User Full Name matches: "${loggedInUser?.name}"`,
    )
    assertTest(
      loggedInUser?.email === newAccountPayload.adminEmail.toLowerCase(),
      `User Email matches: "${loggedInUser?.email}"`,
    )
    assertTest(
      loggedInUser?.role === "account_admin" && loggedInUser?.roleTitle === "Leads Account Admin",
      `User Role is "account_admin" with title "Leads Account Admin"`,
    )
    assertTest(
      loggedInUser?.account?.companyName === newAccountPayload.companyName,
      `Associated Company Name matches: "${loggedInUser?.account?.companyName}"`,
    )
    assertTest(
      loggedInUser?.tenantId === createdTenantId,
      `User tenantId is correctly linked: "${loggedInUser?.tenantId}"`,
    )

    // Verify absence of Super Admin leakage
    assertTest(
      loggedInUser?.email !== "superadmin@leadflow.io" &&
        loggedInUser?.name !== "LeadFlow Super Admin" &&
        loggedInUser?.account?.companyName !== "Primary Organization",
      "No Super Admin identity or hardcoded text leaked into Client CRM user session",
    )

    // -------------------------------------------------------------
    // Test 5: Verify Lead CRUD & Tenant Isolation for the new Admin
    // -------------------------------------------------------------
    console.log("\n🔹 Step 5: Verify Lead CRUD and Tenant Isolation...")
    const createLeadRes = await apiRequest(
      {
        hostname: "localhost",
        port: BACKEND_PORT,
        path: "/api/leads",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookieHeader,
        },
      },
      {
        name: "Enterprise Prospect Alpha",
        email: `prospect.${testTag}@client.com`,
        status: "New",
      },
    )

    assertTest(
      createLeadRes.statusCode === 201 && createLeadRes.data?.success === true,
      "Account Admin can create new lead within their tenant",
    )

    const createdLead = createLeadRes.data?.data?.lead || createLeadRes.data?.data
    assertTest(
      createdLead?.tenantId === createdTenantId,
      `Created lead is strictly partitioned to tenant "${createdTenantId}"`,
    )

    // Unauthenticated user attempting to query the new tenant's leads must be blocked
    const unauthCrossTenantRes = await apiRequest({
      hostname: "localhost",
      port: BACKEND_PORT,
      path: `/api/leads?tenantId=${createdTenantId}`,
      method: "GET",
    })

    assertTest(
      unauthCrossTenantRes.statusCode === 403,
      "Cross-tenant parameter tampering without authorization is blocked (403 Forbidden)",
    )

    // -------------------------------------------------------------
    // Test 6: Verify Frontend HTML Header Features
    // -------------------------------------------------------------
    console.log("\n🔹 Step 6: Verify Frontend Header, Settings & Navigation...")
    const frontendRes = await apiRequest({
      hostname: "localhost",
      port: FRONTEND_PORT,
      path: "/",
      method: "GET",
    })

    const html = frontendRes.rawBody

    // Notification bell removed
    assertTest(
      !html.includes("CRM Notifications") && !html.includes("unreadNotifications"),
      "Notification bell icon and its badge are completely removed from header",
    )

    // Brand and logo present
    assertTest(
      html.includes("LeadFlow") && html.includes("CRM"),
      "Brand logo and application name 'LeadFlow CRM' present on left",
    )

    // Navigation categories present
    assertTest(
      html.includes("Dashboard") &&
        html.includes("Leads") &&
        html.includes("Communication") &&
        html.includes("Tools") &&
        html.includes("Reports") &&
        html.includes("Settings"),
      "All CRM navigation categories are accessible in header navigation",
    )

    // Scrollable navigation container with scroll chevrons present
    assertTest(
      html.includes("Scroll categories left") && html.includes("Scroll categories right"),
      "Horizontal scrolling controls present for compact navigation categories",
    )

    // Settings popover exists with client-scoped settings
    assertTest(
      html.includes("Client CRM Settings"),
      "Dedicated Client CRM Settings entry is configured",
    )

    // No Super Admin links or dashboard duplicate in profile dropdown
    assertTest(
      !html.includes("Super Admin Console") && !html.includes("Client CRM Dashboard link"),
      "No Super Admin links or duplicate CRM dashboard links present in client components",
    )

    console.log("\n=======================================================")
    console.log(`TEST RESULTS: ${passedTests} Passed, ${failedTests} Failed`)
    console.log("=======================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error("Test execution failed with error:", err)
    process.exit(1)
  }
}

runEndToEndVerification()
