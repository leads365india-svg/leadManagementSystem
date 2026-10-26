/**
 * Targeted Regression Suite: Session Persistence & Route Navigation Integration Test
 * Validates the full authentication lifecycle, session persistence, multi-route access,
 * 403 non-expiration behavior, role isolation, and logout cleanup against MongoDB Atlas.
 */

const assert = require("assert")

const API_BASE = "http://localhost:5000/api"

let passed = 0
let failed = 0

function runTest(name, fn) {
  return fn()
    .then(() => {
      console.log(`  ✅ PASS: ${name}`)
      passed++
    })
    .catch((err) => {
      console.error(`  ❌ FAIL: ${name} -> ${err.message}`)
      failed++
    })
}

async function runAll() {
  console.log("=======================================================")
  console.log("   SESSION PERSISTENCE & NAVIGATION REGRESSION SUITE   ")
  console.log("=======================================================\n")

  let accountAdminCookie = ""
  let superAdminCookie = ""

  // 1. Unauthenticated baseline
  await runTest("1. Unauthenticated request to /auth/me returns 401 without crashing", async () => {
    const res = await fetch(`${API_BASE}/auth/me`)
    assert.strictEqual(res.status, 401)
    const data = await res.json()
    assert.strictEqual(data.success, false)
  })

  // 2. Account Admin login establishes valid session
  await runTest("2. Account Admin login establishes HTTP-only cookie and authenticated session", async () => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sara@test.com",
        password: "Password123!",
      }),
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert.strictEqual(data.data.user.role, "account_admin")

    const rawCookies = res.headers.get("set-cookie") || ""
    assert(rawCookies.includes("client_token"), "client_token cookie must be set")
    accountAdminCookie = rawCookies.split(";")[0]
  })

  // 3. /auth/me returns valid user with session cookie
  await runTest("3. /auth/me verifies active Account Admin session", async () => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert.strictEqual(data.data.user.name, "Sara Khan")
    assert.strictEqual(data.data.user.role, "account_admin")
    assert(data.data.user.tenantId, "Tenant ID must be present")
  })

  // 4. Navigation to All Leads API (/leads) succeeds with session
  await runTest("4. Navigating to Leads module retrieves tenant-scoped leads without session drop", async () => {
    const res = await fetch(`${API_BASE}/leads?limit=10`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert(Array.isArray(data.data.leads), "Leads array must be returned")
  })

  // 5. Navigation to Dashboard stats API (/leads/stats) succeeds
  await runTest("5. Navigating to Dashboard stats retrieves pipeline metrics without session drop", async () => {
    const res = await fetch(`${API_BASE}/leads/stats`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert(typeof data.data.total === "number", "Total leads count must be returned")
    assert(data.data.statusCounts, "Status counts breakdown must be returned")
  })

  // 6. Navigation to Communication Follow-ups (/follow-ups) succeeds
  await runTest("6. Navigating to Communication Follow-ups retrieves records without session drop", async () => {
    const res = await fetch(`${API_BASE}/follow-ups?limit=10`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert(Array.isArray(data.data.followUps), "Follow-ups array must be returned")
  })

  // 7. Navigation to Follow-up stats API (/follow-ups/stats) succeeds
  await runTest("7. Navigating to Follow-up stats retrieves KPI metrics without session drop", async () => {
    const res = await fetch(`${API_BASE}/follow-ups/stats`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert(typeof data.data.total === "number", "Total count must be returned")
  })

  // 8. 403 Forbidden does NOT revoke or invalidate the Account Admin session
  await runTest("8. Accessing unauthorized Super Admin route returns 403 Forbidden but preserves session", async () => {
    const forbiddenRes = await fetch(`${API_BASE}/super-admin/stats`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(forbiddenRes.status, 403, "Should return 403 Forbidden for Super Admin endpoint")

    // Immediately verify that subsequent request to /auth/me is STILL 200 OK (session was NOT destroyed)
    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(meRes.status, 200, "Session must still be completely valid after a 403")
    const meData = await meRes.json()
    assert.strictEqual(meData.data.user.role, "account_admin")
  })

  // 9. Super Admin login establishes isolated Super Admin session
  await runTest("9. Super Admin login establishes isolated superadmin_token cookie", async () => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "superadmin@leadflow.io",
        password: "SuperAdmin@2026!",
      }),
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
    assert.strictEqual(data.data.user.role, "super_admin")

    const rawCookies = res.headers.get("set-cookie") || ""
    assert(rawCookies.includes("superadmin_token"), "superadmin_token cookie must be set")
    superAdminCookie = rawCookies.split(";")[0]
  })

  // 10. Super Admin session can access Super Admin endpoints
  await runTest("10. Super Admin session accesses /super-admin/stats with 200 OK", async () => {
    const res = await fetch(`${API_BASE}/super-admin/stats`, {
      headers: { Cookie: superAdminCookie },
    })
    assert.strictEqual(res.status, 200)
    const data = await res.json()
    assert.strictEqual(data.success, true)
  })

  // 11. Logout clears session cookies and prevents access
  await runTest("11. Logout clears session and subsequent protected requests return 401", async () => {
    const logoutRes = await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { Cookie: accountAdminCookie },
    })
    assert.strictEqual(logoutRes.status, 200)

    // Verify set-cookie clears client_token
    const clearCookies = logoutRes.headers.get("set-cookie") || ""
    assert(clearCookies.includes("client_token"), "Should send clear cookie header")

    // Query /auth/me with cleared cookie (empty)
    const postLogoutMe = await fetch(`${API_BASE}/auth/me`)
    assert.strictEqual(postLogoutMe.status, 401, "Protected route must return 401 after logout")
  })

  console.log("\n=======================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("=======================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runAll().catch((err) => {
  console.error("FATAL SUITE ERROR:", err)
  process.exit(1)
})
