/**
 * Leads-365 Phase 27: Super Admin Entry Flow, Authentication Isolation & Performance Verification Suite
 *
 * Verifies:
 * 1. Part A - Local Application Entry Flow & Routing Invariants:
 *    - Root page (frontend/app/page.jsx) is an optimized entry router, not the heavy CRM dashboard.
 *    - Unauthenticated user at root is directed to /super-admin/login.
 *    - Super Admin user at root is directed to /super-admin.
 *    - Tenant user (account_admin / agent) at root is directed to /portal.
 *    - AuthGuard (frontend/components/auth-guard.jsx) exempts "/" from premature client redirection.
 *    - Header and Footer components suppress rendering on "/" to prevent visual flashing.
 *    - Dashboard page (frontend/app/dashboard/page.jsx) redirects cleanly to /portal.
 *
 * 2. Part A & C - Authentication & Authorization Isolation:
 *    - Unauthenticated access to /api/super-admin/* is rejected with HTTP 401.
 *    - Tenant cookie (client_token) on /api/super-admin/* is NEVER extracted or accepted (HTTP 401).
 *    - Tenant bearer token on /api/super-admin/* is rejected by requireSuperAdmin with HTTP 403.
 *    - Super Admin cookie (superadmin_token) on /api/super-admin/* is authorized with HTTP 200.
 *    - Tenant login via authController sets client_token and clears superadmin_token.
 *    - Super admin login via authController sets superadmin_token and clears client_token.
 *
 * 3. Part B & C - Performance Optimizations:
 *    - Authenticated user lookup in authMiddleware uses .select("-password").lean().
 *    - Elimination of redundant /api/leads and /api/leads/stats queries on unauthenticated root visits.
 *    - LeadFeedsClient eliminates duplicate loadSettings() call and unsolicited toast on initial mount.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")

const User = require("../models/User")
const Account = require("../models/Account")
const { authenticate, requireSuperAdmin, requireAccountAdmin } = require("../middleware/authMiddleware")
const { login, getMe } = require("../controllers/authController")
const { getAccounts } = require("../controllers/accountController")

let staticPassed = 0
let staticFailed = 0
let behavioralPassed = 0
let behavioralFailed = 0

function assertStatic(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    staticPassed++
  } else {
    console.error(`  [FAIL] ${message}`)
    staticFailed++
  }
}

function assertBehavioral(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    behavioralPassed++
  } else {
    console.error(`  [FAIL] ${message}`)
    behavioralFailed++
  }
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    cookies: {},
    clearedCookies: [],
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    cookie(name, val, options) {
      this.cookies[name] = { val, options }
      return this
    },
    clearCookie(name, options) {
      this.clearedCookies.push({ name, options })
      delete this.cookies[name]
      return this
    },
    json(data) {
      this.body = data
      return this
    },
    send(data) {
      this.body = data
      return this
    },
  }
  return res
}

function createMockReq(options = {}) {
  const headers = options.headers || {}
  return {
    protocol: options.protocol || "http",
    originalUrl: options.originalUrl || "/api/test",
    url: options.url || options.originalUrl || "/api/test",
    headers,
    cookies: options.cookies || {},
    get(name) {
      const lower = name.toLowerCase()
      for (const [k, v] of Object.entries(this.headers)) {
        if (k.toLowerCase() === lower) return v
      }
      return ""
    },
    user: options.user || null,
    query: options.query || {},
    params: options.params || {},
    body: options.body || {},
  }
}

// -------------------------------------------------------------
// SECTION 1: Static Code Invariants & Routing Architecture
// -------------------------------------------------------------
async function runStaticTests() {
  console.log("\n--- Section 1: Static Code Invariants & Routing Architecture ---")

  const rootPagePath = path.resolve(__dirname, "../../frontend/app/page.jsx")
  const rootPageContent = fs.readFileSync(rootPagePath, "utf8")

  assertStatic(
    rootPageContent.includes("RootEntryPage"),
    "frontend/app/page.jsx exports RootEntryPage router instead of CRM dashboard"
  )
  assertStatic(
    rootPageContent.includes('/super-admin/login'),
    "RootEntryPage redirects unauthenticated visitors to /super-admin/login"
  )
  assertStatic(
    rootPageContent.includes('/super-admin') && rootPageContent.includes('/portal'),
    "RootEntryPage directs super_admin to /super-admin and tenant users to /portal"
  )
  assertStatic(
    !rootPageContent.includes("getLeadStats") && !rootPageContent.includes("getLeads"),
    "RootEntryPage does not trigger premature CRM getLeadStats or getLeads API calls"
  )

  const authGuardPath = path.resolve(__dirname, "../../frontend/components/auth-guard.jsx")
  const authGuardContent = fs.readFileSync(authGuardPath, "utf8")
  assertStatic(
    authGuardContent.includes('"/"') && authGuardContent.includes('pathname === "/"'),
    "frontend/components/auth-guard.jsx exempts root route '/' from client redirect loops"
  )

  const headerPath = path.resolve(__dirname, "../../frontend/components/header.jsx")
  const headerContent = fs.readFileSync(headerPath, "utf8")
  assertStatic(
    headerContent.includes('pathname === "/"') && headerContent.includes('href: "/portal"'),
    "frontend/components/header.jsx suppresses rendering on '/' and links Home to /portal"
  )

  const footerPath = path.resolve(__dirname, "../../frontend/components/footer.jsx")
  const footerContent = fs.readFileSync(footerPath, "utf8")
  assertStatic(
    footerContent.includes('pathname === "/"'),
    "frontend/components/footer.jsx suppresses rendering on '/'"
  )

  const dashboardPagePath = path.resolve(__dirname, "../../frontend/app/dashboard/page.jsx")
  const dashboardPageContent = fs.readFileSync(dashboardPagePath, "utf8")
  assertStatic(
    dashboardPageContent.includes('/portal'),
    "frontend/app/dashboard/page.jsx redirects cleanly to /portal"
  )

  const authMiddlewarePath = path.resolve(__dirname, "../middleware/authMiddleware.js")
  const authMiddlewareContent = fs.readFileSync(authMiddlewarePath, "utf8")
  assertStatic(
    authMiddlewareContent.includes("isSuperAdminRoute") &&
      !authMiddlewareContent.includes("if (req.cookies.client_token) {\n        return req.cookies.client_token"),
    "backend/middleware/authMiddleware.js forbids client_token fallback on isSuperAdminRoute"
  )
  assertStatic(
    authMiddlewareContent.includes('.select("-password").lean()'),
    "backend/middleware/authMiddleware.js uses optimized .select('-password').lean() query"
  )

  const leadFeedsClientPath = path.resolve(__dirname, "../../frontend/app/settings/lead-feeds/lead-feeds-client.jsx")
  const leadFeedsContent = fs.readFileSync(leadFeedsClientPath, "utf8")
  assertStatic(
    leadFeedsContent.includes("loadAllStatuses(false)") &&
      !leadFeedsContent.includes("useEffect(() => {\n    loadSettings()\n  }, [loadSettings])"),
    "frontend/app/settings/lead-feeds/lead-feeds-client.jsx avoids duplicate loadSettings on mount"
  )
}

// -------------------------------------------------------------
// SECTION 2: Behavioral Authentication & Authorization Isolation
// -------------------------------------------------------------
async function runBehavioralTests() {
  console.log("\n--- Section 2: Behavioral Auth & Isolation Tests ---")

  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/leads365"

  await mongoose.connect(mongoUri)
  console.log("  Connected to MongoDB for Phase 27 behavioral testing.")

  const jwtSecret =
    process.env.JWT_SECRET || "leadflow-dev-secret-key-min32-chars-for-local-only"

  const suffix = Date.now().toString(36)
  const superAdminEmail = `superadmin_${suffix}@leadflow.io`
  const tenantAdminEmail = `tenant_${suffix}@example.com`
  const tenantId = `acc_${suffix}`

  let testSuperAdmin = null
  let testTenantAdmin = null
  let testAccount = null

  try {
    // Seed Super Admin (User pre-save hook hashes password)
    testSuperAdmin = await User.create({
      name: "Phase 27 Super Admin",
      email: superAdminEmail,
      password: "Password123!",
      role: "super_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    // Seed Tenant Admin first to satisfy Account required fields
    testTenantAdmin = await User.create({
      name: "Phase 27 Tenant Admin",
      email: tenantAdminEmail,
      password: "Password123!",
      role: "account_admin",
      tenantId: tenantId,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    // Seed Tenant Account
    testAccount = await Account.create({
      accountId: tenantId,
      companyName: `Tenant Account ${suffix}`,
      displayName: `Tenant Corp ${suffix}`,
      status: "active",
      adminUserId: testTenantAdmin._id,
      adminEmail: tenantAdminEmail,
      adminName: "Phase 27 Tenant Admin",
    })

    // Sign Tokens
    const superAdminToken = jwt.sign(
      {
        id: testSuperAdmin._id.toString(),
        email: testSuperAdmin.email,
        role: testSuperAdmin.role,
        tokenVersion: 1,
      },
      jwtSecret,
      { expiresIn: "1h" }
    )

    const tenantToken = jwt.sign(
      {
        id: testTenantAdmin._id.toString(),
        email: testTenantAdmin.email,
        role: testTenantAdmin.role,
        tenantId: testTenantAdmin.tenantId,
        tokenVersion: 1,
      },
      jwtSecret,
      { expiresIn: "1h" }
    )

    // ----------------------------------------------------
    // Test 1: Unauthenticated request to /api/super-admin/accounts
    // ----------------------------------------------------
    const reqUnauth = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      cookies: {},
    })
    const resUnauth = createMockRes()
    let unauthNextCalled = false
    await authenticate(reqUnauth, resUnauth, () => {
      unauthNextCalled = true
    })

    assertBehavioral(
      resUnauth.statusCode === 401 && !unauthNextCalled,
      "Unauthenticated request to /api/super-admin/accounts returns HTTP 401"
    )

    // ----------------------------------------------------
    // Test 2: Client token cookie sent to /api/super-admin/accounts
    // ----------------------------------------------------
    const reqClientCookie = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      cookies: { client_token: tenantToken },
    })
    const resClientCookie = createMockRes()
    let clientCookieNextCalled = false
    await authenticate(reqClientCookie, resClientCookie, () => {
      clientCookieNextCalled = true
    })

    assertBehavioral(
      resClientCookie.statusCode === 401 && !clientCookieNextCalled,
      "Tenant client_token cookie on Super Admin route is strictly ignored -> HTTP 401"
    )

    // ----------------------------------------------------
    // Test 3: Tenant Bearer token sent to /api/super-admin/accounts
    // ----------------------------------------------------
    const reqTenantBearer = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      headers: { authorization: `Bearer ${tenantToken}` },
    })
    const resTenantBearer = createMockRes()
    let tenantAuthNextCalled = false
    await authenticate(reqTenantBearer, resTenantBearer, () => {
      tenantAuthNextCalled = true
    })

    assertBehavioral(
      tenantAuthNextCalled && reqTenantBearer.user?.role === "account_admin",
      "Tenant bearer token authenticates user as account_admin"
    )

    // Authorization check on Super Admin route
    const resRequireSA = createMockRes()
    let saNextCalled = false
    requireSuperAdmin(reqTenantBearer, resRequireSA, () => {
      saNextCalled = true
    })

    assertBehavioral(
      resRequireSA.statusCode === 403 && !saNextCalled,
      "Tenant bearer token is rejected by requireSuperAdmin with HTTP 403"
    )

    // ----------------------------------------------------
    // Test 4: Valid Super Admin cookie on /api/super-admin/accounts
    // ----------------------------------------------------
    const reqSuperAdmin = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      cookies: { superadmin_token: superAdminToken },
    })
    const resSuperAdmin = createMockRes()
    let saAuthNextCalled = false
    await authenticate(reqSuperAdmin, resSuperAdmin, () => {
      saAuthNextCalled = true
    })

    assertBehavioral(
      saAuthNextCalled && reqSuperAdmin.user?.role === "super_admin",
      "Super admin cookie authenticates user as super_admin"
    )

    const resSAAuth = createMockRes()
    let saGateNextCalled = false
    requireSuperAdmin(reqSuperAdmin, resSAAuth, () => {
      saGateNextCalled = true
    })

    assertBehavioral(
      saGateNextCalled && resSAAuth.statusCode === 200,
      "Super admin passes requireSuperAdmin gate"
    )

    const resGetAccounts = createMockRes()
    await getAccounts(reqSuperAdmin, resGetAccounts)
    assertBehavioral(
      resGetAccounts.statusCode === 200 && resGetAccounts.body.success,
      "Super Admin gets accounts list via getAccounts with HTTP 200"
    )

    // ----------------------------------------------------
    // Test 5: Cookie Isolation on Login
    // ----------------------------------------------------
    // Tenant login
    const reqTenantLogin = createMockReq({
      body: { email: tenantAdminEmail, password: "Password123!" },
    })
    const resTenantLogin = createMockRes()
    await login(reqTenantLogin, resTenantLogin)

    assertBehavioral(
      resTenantLogin.statusCode === 200 &&
        resTenantLogin.cookies.client_token &&
        resTenantLogin.clearedCookies.some((c) => c.name === "superadmin_token"),
      "Tenant login sets client_token and explicitly clears superadmin_token"
    )

    // Super Admin login
    const reqSALogin = createMockReq({
      body: { email: superAdminEmail, password: "Password123!" },
    })
    const resSALogin = createMockRes()
    await login(reqSALogin, resSALogin)

    assertBehavioral(
      resSALogin.statusCode === 200 &&
        resSALogin.cookies.superadmin_token &&
        resSALogin.clearedCookies.some((c) => c.name === "client_token"),
      "Super Admin login sets superadmin_token and explicitly clears client_token"
    )

    // ----------------------------------------------------
    // Test 6: Performance Benchmark: Lean Authenticate latency
    // ----------------------------------------------------
    const iterations = 50
    const startMs = Date.now()
    for (let i = 0; i < iterations; i++) {
      const mockReq = createMockReq({
        originalUrl: "/api/super-admin/accounts",
        cookies: { superadmin_token: superAdminToken },
      })
      const mockRes = createMockRes()
      await authenticate(mockReq, mockRes, () => {})
    }
    const elapsedMs = Date.now() - startMs
    const avgLatency = (elapsedMs / iterations).toFixed(2)

    assertBehavioral(
      parseFloat(avgLatency) < 100,
      `Lean authenticate() average latency is fast: ${avgLatency}ms / call (< 100ms threshold)`
    )
  } finally {
    // Teardown test artifacts
    if (testSuperAdmin) await User.deleteOne({ _id: testSuperAdmin._id })
    if (testTenantAdmin) await User.deleteOne({ _id: testTenantAdmin._id })
    if (testAccount) await Account.deleteOne({ accountId: tenantId })
    await mongoose.disconnect()
    console.log("  Cleaned up test data & disconnected from MongoDB.")
  }
}

async function main() {
  console.log("==================================================================")
  console.log("  Leads-365 Phase 27: Super Admin Entry & Auth Isolation Suite")
  console.log("==================================================================")

  try {
    await runStaticTests()
    await runBehavioralTests()

    console.log("\n==================================================================")
    console.log(`  SUMMARY:`)
    console.log(`  Static Checks:     ${staticPassed} Passed, ${staticFailed} Failed`)
    console.log(`  Behavioral Checks: ${behavioralPassed} Passed, ${behavioralFailed} Failed`)
    console.log(`  Total:             ${staticPassed + behavioralPassed} Passed, ${staticFailed + behavioralFailed} Failed`)
    console.log("==================================================================")

    if (staticFailed > 0 || behavioralFailed > 0) {
      process.exit(1)
    } else {
      process.exit(0)
    }
  } catch (err) {
    console.error("Test Suite crashed with unexpected error:", err)
    process.exit(1)
  }
}

main()
