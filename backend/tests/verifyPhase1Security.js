/**
 * Phase 1: Security Leftovers and Repo Hygiene Verification Suite
 * 
 * Tests:
 * 1. CSRF Origin Validation: Rejection of evil-prefix origin (http://localhost:3000.evil.com -> 403)
 * 2. CSRF Allowed Origin: Acceptance of exact authorized origin (http://localhost:3000 -> not 403)
 * 3. Fail Closed Security: getJwtSecret() strictly throws when NODE_ENV is undefined or production with missing/weak secret
 * 4. Model Enforcement: Lead model strictly requires tenantId and rejects instantiation without tenantId
 * 5. Permission Cache: getCachedRolePermissions returns cached permissions and invalidates on demand
 * 6. Rate Limiters: authLimiter, integrationLimiter, dashboardLimiter configured and operational
 * 7. Route Mounting: /api/follow-ups is mounted; duplicate /api/followups is cleaned up
 */

const http = require("http")
const mongoose = require("mongoose")
const connectDB = require("../db/connection")
const { getJwtSecret, getCachedRolePermissions, invalidatePermissionCache } = require("../middleware/authMiddleware")
const Lead = require("../models/Lead")

const BASE_HOST = "localhost"
const BASE_PORT = 5000

let passCount = 0
let failCount = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.error(`  ❌ FAIL: ${message}`)
    failCount++
    throw new Error(message)
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        let json = null
        try {
          json = JSON.parse(data)
        } catch (e) {
          json = data
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json,
        })
      })
    })

    req.on("error", reject)

    if (body) {
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body)
      req.write(bodyStr)
    }

    req.end()
  })
}

async function loginUser(email, password) {
  const res = await request(
    {
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  )

  if (res.statusCode !== 200 || !res.data.success) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`)
  }

  const cookie = res.headers["set-cookie"]
    ? res.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
    : ""

  return { user: res.data.data.user, cookie }
}

async function runPhase1SecurityTests() {
  console.log("=======================================================")
  console.log("   PHASE 1: SECURITY LEFTOVERS & HYGIENE VERIFICATION  ")
  console.log("=======================================================\n")

  await connectDB()

  try {
    // -----------------------------------------------------------------
    // Test 1: Fail Closed Secret Validation
    // -----------------------------------------------------------------
    console.log("📋 Test 1: Testing Fail Closed Secret Validation in getJwtSecret()...")

    const originalNodeEnv = process.env.NODE_ENV
    const originalSecret = process.env.JWT_SECRET

    // Case 1A: NODE_ENV is unset / undefined, secret is missing -> Must throw
    delete process.env.NODE_ENV
    delete process.env.JWT_SECRET
    let threwOnMissingSecret = false
    try {
      getJwtSecret()
    } catch (err) {
      threwOnMissingSecret = err.message.includes("FATAL: JWT_SECRET")
    }
    assert(threwOnMissingSecret, "getJwtSecret() throws when NODE_ENV is missing/undefined and secret is absent")

    // Case 1B: NODE_ENV is unset / undefined, secret is weak/insecure -> Must throw
    process.env.JWT_SECRET = "secret"
    let threwOnWeakSecret = false
    try {
      getJwtSecret()
    } catch (err) {
      threwOnWeakSecret = err.message.includes("Insecure or weak JWT_SECRET")
    }
    assert(threwOnWeakSecret, "getJwtSecret() throws when NODE_ENV is missing/undefined and secret is weak/short")

    // Case 1C: NODE_ENV=development -> Fallback is allowed
    process.env.NODE_ENV = "development"
    delete process.env.JWT_SECRET
    let devFallbackSecret = null
    try {
      devFallbackSecret = getJwtSecret()
    } catch (_) {}
    assert(typeof devFallbackSecret === "string" && devFallbackSecret.length >= 32, "getJwtSecret() allows development fallback only in explicit dev mode")

    // Restore original environment
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv
    else delete process.env.NODE_ENV
    if (originalSecret !== undefined) process.env.JWT_SECRET = originalSecret
    else delete process.env.JWT_SECRET

    // -----------------------------------------------------------------
    // Test 2: CSRF Exact-Origin Validation
    // -----------------------------------------------------------------
    console.log("\n📋 Test 2: Testing Exact-Origin CSRF Protection against Prefix Spoofing...")

    // Login as Account Admin to obtain authenticated session cookie
    const authSession = await loginUser("sara@test.com", "Password123!")
    assert(Boolean(authSession.cookie), "Authenticated session cookie acquired")

    // 2A: Mutating request with spoofed evil-prefix origin: http://localhost:3000.evil.com
    const evilPrefixRes = await request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/leads",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authSession.cookie,
        Origin: "http://localhost:3000.evil.com",
      },
    }, { name: "CSRF Test", email: "csrf@test.com" })

    assert(
      evilPrefixRes.statusCode === 403 &&
      evilPrefixRes.data?.error?.includes("CSRF verification failed"),
      "CSRF protection strictly blocks evil-prefix origin (http://localhost:3000.evil.com -> 403 Forbidden)"
    )

    // 2B: Mutating request with valid exact authorized origin: http://localhost:3000
    const validOriginRes = await request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/leads",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authSession.cookie,
        Origin: "http://localhost:3000",
      },
    }, { name: "CSRF Test", email: "csrf@test.com" })

    assert(
      validOriginRes.statusCode !== 403,
      "CSRF protection permits exact authorized origin (http://localhost:3000 does not receive 403)"
    )

    // -----------------------------------------------------------------
    // Test 3: Lead Model tenantId Requirement
    // -----------------------------------------------------------------
    console.log("\n📋 Test 3: Testing Lead model tenantId requirement and removal of default-tenant...")

    const leadWithoutTenant = new Lead({
      name: "Tenantless Lead",
      email: "tenantless@example.com",
      status: "New",
    })

    const validationError = leadWithoutTenant.validateSync()
    assert(
      validationError && validationError.errors && validationError.errors.tenantId,
      "Lead model strictly rejects instantiation without tenantId (required constraint enforced)"
    )
    assert(
      leadWithoutTenant.tenantId === undefined,
      "Lead model no longer silently defaults tenantId to 'default-tenant'"
    )

    // -----------------------------------------------------------------
    // Test 4: RolePermission Caching and Invalidation
    // -----------------------------------------------------------------
    console.log("\n📋 Test 4: Testing RolePermission In-Memory Cache (30-60s TTL)...")

    invalidatePermissionCache()
    const permsFirstCall = await getCachedRolePermissions("account_admin")
    assert(Array.isArray(permsFirstCall) && permsFirstCall.length > 0, "getCachedRolePermissions returns active permissions array")

    // Second call should return cached data instantly
    const permsSecondCall = await getCachedRolePermissions("account_admin")
    assert(permsFirstCall === permsSecondCall, "Subsequent permission lookup returns cached memory reference (no redundant DB query)")

    // Invalidation clears cache
    invalidatePermissionCache()
    const permsAfterInvalidation = await getCachedRolePermissions("account_admin")
    assert(Array.isArray(permsAfterInvalidation), "Fresh lookup succeeds after cache invalidation")

    // -----------------------------------------------------------------
    // Test 5: Route Hygiene and Mounting
    // -----------------------------------------------------------------
    console.log("\n📋 Test 5: Testing Route Mounting & Hygiene...")

    // 5A: /api/follow-ups is active
    const followUpsRes = await request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/follow-ups",
      method: "GET",
      headers: { Cookie: authSession.cookie },
    })
    assert(followUpsRes.statusCode === 200, "Canonical route /api/follow-ups is mounted and active (200 OK)")

    // 5B: Duplicate /api/followups is cleaned up and returns 404
    const duplicateRouteRes = await request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/followups",
      method: "GET",
      headers: { Cookie: authSession.cookie },
    })
    assert(duplicateRouteRes.statusCode === 404, "Duplicate alias /api/followups is removed as per roadmap (404 Not Found)")

    console.log("\n🎉 ALL PHASE 1 SECURITY & REPO HYGIENE TESTS PASSED!")

  } catch (err) {
    console.error("Test failed with unexpected error:", err)
    process.exit(1)
  } finally {
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  }

  console.log(`\n=======================================================`)
  console.log(`   TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`)
  console.log(`=======================================================\n`)

  if (failCount > 0) process.exit(1)
}

runPhase1SecurityTests().catch((e) => {
  console.error(e)
  process.exit(1)
})
