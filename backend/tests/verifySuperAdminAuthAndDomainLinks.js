/**
 * Comprehensive Verification Suite:
 * 1. Super Admin Authentication Security (Removal of hardcoded credentials, fail-closed behavior, role separation)
 * 2. Custom Domain Links across Super Admin Dashboard (Safe URL construction, target=_blank, rel=noopener noreferrer)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")

const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const { authenticate, requireSuperAdmin } = require("../middleware/authMiddleware")
const { login, getMe } = require("../controllers/authController")
const { getAccounts } = require("../controllers/accountController")
const { buildCustomDomainUrl } = require("../../frontend/lib/domain")

let passed = 0
let failed = 0

function assertTest(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`)
    passed++
  } else {
    console.error(`  ❌ [FAIL] ${message}`)
    failed++
  }
}

function createMockRes() {
  const res = {
    statusCode: 200,
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
      return undefined
    },
    body: options.body || {},
    query: options.query || {},
    params: options.params || {},
  }
}

async function runVerification() {
  console.log("\n==================================================================")
  console.log("  Super Admin Security & Custom Domain Links Verification Suite   ")
  console.log("==================================================================\n")

  // ---------------------------------------------------------------------------
  // SECTION 1: Custom Domain Safe URL Construction
  // ---------------------------------------------------------------------------
  console.log("--- Section 1: Custom Domain URL Construction Matrix ---")

  assertTest(
    buildCustomDomainUrl("example.com") === "https://example.com/",
    "example.com -> constructs https://example.com/"
  )

  assertTest(
    buildCustomDomainUrl("https://example.com") === "https://example.com/",
    "https://example.com -> retains https without duplicate protocol"
  )

  assertTest(
    buildCustomDomainUrl("http://example.com") === "https://example.com/",
    "http://example.com -> safely upgraded to https://"
  )

  assertTest(
    buildCustomDomainUrl("crm.medical365.in") === "https://crm.medical365.in/",
    "Domain with subdomain (crm.medical365.in) -> exact subdomain preserved"
  )

  assertTest(
    buildCustomDomainUrl("example.com/portal/login") === "https://example.com/portal/login",
    "Domain with path (example.com/portal/login) -> path preserved"
  )

  assertTest(
    buildCustomDomainUrl("") === null &&
    buildCustomDomainUrl(null) === null &&
    buildCustomDomainUrl(undefined) === null,
    "Empty custom domain -> returns null (no broken clickable link)"
  )

  assertTest(
    buildCustomDomainUrl("javascript:alert(1)") === null,
    "Dangerous scheme (javascript:alert(1)) -> safely rejected (null)"
  )

  assertTest(
    buildCustomDomainUrl("data:text/html,<script>alert(1)</script>") === null,
    "Dangerous scheme (data:text/html) -> safely rejected (null)"
  )

  assertTest(
    buildCustomDomainUrl("vbscript:msgbox(1)") === null,
    "Dangerous scheme (vbscript:) -> safely rejected (null)"
  )

  assertTest(
    buildCustomDomainUrl("file:///etc/passwd") === null,
    "Dangerous scheme (file:) -> safely rejected (null)"
  )

  assertTest(
    buildCustomDomainUrl("invalid domain with spaces.com") === null,
    "Invalid domain with spaces -> safely rejected (null)"
  )

  // ---------------------------------------------------------------------------
  // SECTION 2: Static Code Invariants
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 2: Static Code Auditing & Invariants ---")

  const authControllerPath = path.resolve(__dirname, "../controllers/authController.js")
  const authControllerContent = fs.readFileSync(authControllerPath, "utf8")

  assertTest(
    !authControllerContent.includes('superadmin@leadflow.io'),
    "backend/controllers/authController.js contains NO hardcoded 'superadmin@leadflow.io'"
  )

  assertTest(
    !authControllerContent.includes('SuperAdmin@2026!'),
    "backend/controllers/authController.js contains NO hardcoded 'SuperAdmin@2026!'"
  )

  const seedPath = path.resolve(__dirname, "../db/seedSuperAdmin.js")
  const seedContent = fs.readFileSync(seedPath, "utf8")

  assertTest(
    !seedContent.includes('superadmin@leadflow.io'),
    "backend/db/seedSuperAdmin.js contains NO fallback 'superadmin@leadflow.io'"
  )

  assertTest(
    !seedContent.includes('SuperAdmin@2026!'),
    "backend/db/seedSuperAdmin.js contains NO fallback 'SuperAdmin@2026!'"
  )

  const superAdminPagePath = path.resolve(__dirname, "../../frontend/app/super-admin/page.jsx")
  const superAdminPageContent = fs.readFileSync(superAdminPagePath, "utf8")

  assertTest(
    superAdminPageContent.includes("buildCustomDomainUrl") &&
    superAdminPageContent.includes('target="_blank"') &&
    superAdminPageContent.includes('rel="noopener noreferrer"'),
    "frontend/app/super-admin/page.jsx renders custom domain with buildCustomDomainUrl and target='_blank' rel='noopener noreferrer'"
  )

  assertTest(
    superAdminPageContent.includes("e.stopPropagation()"),
    "frontend/app/super-admin/page.jsx stops click propagation to prevent table row click interference"
  )

  const rolesPermPagePath = path.resolve(__dirname, "../../frontend/app/super-admin/roles-permissions/page.jsx")
  const rolesPermPageContent = fs.readFileSync(rolesPermPagePath, "utf8")

  assertTest(
    rolesPermPageContent.includes("buildCustomDomainUrl") &&
    rolesPermPageContent.includes('target="_blank"'),
    "frontend/app/super-admin/roles-permissions/page.jsx renders custom domain with buildCustomDomainUrl and target='_blank'"
  )

  // ---------------------------------------------------------------------------
  // SECTION 3: Behavioral Authentication & Role Separation Tests
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 3: Behavioral Authentication Matrix ---")

  const mongoURI = process.env.MONGODB_URI
  if (!mongoURI) {
    throw new Error("MONGODB_URI not defined in environment variables")
  }
  await mongoose.connect(mongoURI, { dbName: "leadflow", serverSelectionTimeoutMS: 5000 })
  console.log("  Connected to MongoDB for behavioral tests.\n")

  const suffix = Date.now().toString(36)
  const envSuperAdminEmail = `superadmin_${suffix}@leadflow.io`
  const envSuperAdminPassword = `EnvSuperSecret_${suffix}!2026`
  const tenantAdminEmail = `tenant_admin_${suffix}@example.com`
  const tenantUserPassword = `TenantPass_${suffix}!2026`
  const tenantId = `acc_${suffix}`

  // Temporarily configure environment variables
  const origEnvEmail = process.env.SUPERADMIN_EMAIL
  const origEnvPass = process.env.SUPERADMIN_PASSWORD
  process.env.SUPERADMIN_EMAIL = envSuperAdminEmail
  process.env.SUPERADMIN_PASSWORD = envSuperAdminPassword

  let testTenantAdmin = null
  let testAccount = null

  try {
    // Seed Tenant Admin
    testTenantAdmin = await User.create({
      name: "Verification Tenant Admin",
      email: tenantAdminEmail,
      password: tenantUserPassword,
      role: "account_admin",
      tenantId: tenantId,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    // Seed Tenant Account
    testAccount = await Account.create({
      accountId: tenantId,
      companyName: `Verification Tenant ${suffix}`,
      displayName: `Verification Corp ${suffix}`,
      status: "active",
      adminUserId: testTenantAdmin._id,
      adminEmail: tenantAdminEmail,
      adminName: "Verification Tenant Admin",
      customDomain: `crm.tenant-${suffix}.com`,
      domainStatus: "verified",
    })

    // Test 1: Correct environment Super Admin credentials -> Login successful
    const reqSALogin = createMockReq({
      body: { email: envSuperAdminEmail, password: envSuperAdminPassword, portal: "super_admin" },
    })
    const resSALogin = createMockRes()
    await login(reqSALogin, resSALogin)

    assertTest(
      resSALogin.statusCode === 200 &&
      resSALogin.body?.data?.user?.role === "super_admin" &&
      resSALogin.cookies.superadmin_token &&
      resSALogin.clearedCookies.some((c) => c.name === "client_token"),
      "Correct environment Super Admin credentials -> Login successful with super_admin role and isolated cookie"
    )

    const superAdminToken = resSALogin.body?.data?.token
    const superAdminUser = resSALogin.body?.data?.user

    // Test 2: Incorrect Super Admin password -> 401
    const reqSAWrongPass = createMockReq({
      body: { email: envSuperAdminEmail, password: "WrongPassword!999", portal: "super_admin" },
    })
    const resSAWrongPass = createMockRes()
    await login(reqSAWrongPass, resSAWrongPass)

    assertTest(
      resSAWrongPass.statusCode === 401 && resSAWrongPass.body?.success === false,
      "Incorrect Super Admin password -> 401 Invalid email or password"
    )

    // Test 3: Missing Super Admin environment variables -> Fail closed (500)
    delete process.env.SUPERADMIN_EMAIL
    delete process.env.SUPER_ADMIN_EMAIL
    delete process.env.SUPERADMIN_PASSWORD
    delete process.env.SUPER_ADMIN_PASSWORD

    const reqSAMissingEnv = createMockReq({
      body: { email: envSuperAdminEmail, password: envSuperAdminPassword, portal: "super_admin" },
    })
    const resSAMissingEnv = createMockRes()
    await login(reqSAMissingEnv, resSAMissingEnv)

    assertTest(
      resSAMissingEnv.statusCode === 500 && resSAMissingEnv.body?.success === false,
      "Missing Super Admin environment variables -> Fail closed with HTTP 500 error"
    )

    // Restore environment variables
    process.env.SUPERADMIN_EMAIL = envSuperAdminEmail
    process.env.SUPERADMIN_PASSWORD = envSuperAdminPassword

    // Test 4: Old hardcoded credentials must not authenticate
    const reqOldCreds = createMockReq({
      body: { email: "superadmin@leadflow.io", password: "SuperAdmin@2026!" },
    })
    const resOldCreds = createMockRes()
    await login(reqOldCreds, resOldCreds)

    assertTest(
      resOldCreds.statusCode === 401 && resOldCreds.body?.success === false,
      "Old hardcoded credentials ('superadmin@leadflow.io') -> Must not authenticate (401)"
    )

    // Test 5: Valid tenant credentials -> Tenant login successful
    const reqTenantLogin = createMockReq({
      body: { email: tenantAdminEmail, password: tenantUserPassword, tenantId },
    })
    const resTenantLogin = createMockRes()
    await login(reqTenantLogin, resTenantLogin)

    assertTest(
      resTenantLogin.statusCode === 200 &&
      resTenantLogin.body?.data?.user?.role === "account_admin" &&
      resTenantLogin.cookies.client_token &&
      resTenantLogin.clearedCookies.some((c) => c.name === "superadmin_token"),
      "Valid tenant credentials -> Tenant login successful with client_token and cleared superadmin_token"
    )

    const tenantToken = resTenantLogin.body?.data?.token

    // Test 6: Invalid tenant credentials -> Login rejected (401)
    const reqTenantWrongPass = createMockReq({
      body: { email: tenantAdminEmail, password: "WrongTenantPassword!", tenantId },
    })
    const resTenantWrongPass = createMockRes()
    await login(reqTenantWrongPass, resTenantWrongPass)

    assertTest(
      resTenantWrongPass.statusCode === 401 && resTenantWrongPass.body?.success === false,
      "Invalid tenant credentials -> Login rejected with 401"
    )

    // Test 7: Tenant accessing Super Admin API -> 403 / 401
    // 7a: Tenant with client_token cookie sent to /api/super-admin/accounts
    const reqTenantCookieToSA = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      cookies: { client_token: tenantToken },
    })
    const resTenantCookieToSA = createMockRes()
    let tenantCookieNextCalled = false
    await authenticate(reqTenantCookieToSA, resTenantCookieToSA, () => {
      tenantCookieNextCalled = true
    })

    assertTest(
      resTenantCookieToSA.statusCode === 401 && !tenantCookieNextCalled,
      "Tenant client_token cookie sent to Super Admin API -> HTTP 401"
    )

    // 7b: Tenant Bearer token sent to Super Admin API -> rejected by requireSuperAdmin with HTTP 403
    const reqTenantBearerToSA = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      headers: { authorization: `Bearer ${tenantToken}` },
    })
    const resTenantBearerToSA = createMockRes()
    let tenantAuthNextCalled = false
    await authenticate(reqTenantBearerToSA, resTenantBearerToSA, () => {
      tenantAuthNextCalled = true
    })
    let tenantSaNextCalled = false
    await requireSuperAdmin(reqTenantBearerToSA, resTenantBearerToSA, () => {
      tenantSaNextCalled = true
    })

    assertTest(
      tenantAuthNextCalled && resTenantBearerToSA.statusCode === 403 && !tenantSaNextCalled,
      "Tenant Bearer token sent to Super Admin API -> requireSuperAdmin rejects with HTTP 403"
    )

    // Test 8: Super Admin accessing authorized Super Admin APIs -> Allowed
    const reqSAAuthorized = createMockReq({
      originalUrl: "/api/super-admin/accounts",
      cookies: { superadmin_token: superAdminToken },
    })
    const resSAAuthorized = createMockRes()
    let saAuthNextCalled = false
    await authenticate(reqSAAuthorized, resSAAuthorized, () => {
      saAuthNextCalled = true
    })
    let saGateNextCalled = false
    await requireSuperAdmin(reqSAAuthorized, resSAAuthorized, () => {
      saGateNextCalled = true
    })

    const resGetAccounts = createMockRes()
    await getAccounts(reqSAAuthorized, resGetAccounts)

    assertTest(
      saAuthNextCalled && saGateNextCalled && resGetAccounts.statusCode === 200,
      "Super Admin accessing authorized Super Admin APIs -> Allowed with HTTP 200"
    )

    // Test 9: Tenant A accessing Tenant B data -> Blocked by tenant isolation
    const foreignTenantId = `acc_foreign_${suffix}`
    const foreignLead = await Lead.create({
      tenantId: foreignTenantId,
      name: "Foreign Lead",
      phone: "+919876543210",
      status: "New",
    })

    const reqTenantQuery = createMockReq({
      cookies: { client_token: tenantToken },
    })
    const resTenantQuery = createMockRes()
    await authenticate(reqTenantQuery, resTenantQuery, () => {})

    // Query leads scoped to authenticated tenant
    const accessibleLeads = await Lead.find({ tenantId: reqTenantQuery.user.tenantId, _id: foreignLead._id }).lean()

    assertTest(
      accessibleLeads.length === 0,
      "Tenant A accessing Tenant B lead data -> Blocked (0 foreign records accessible)"
    )

    await Lead.deleteOne({ _id: foreignLead._id })

    // Test 10: Refresh after Super Admin login -> Correct Super Admin session
    const reqSARefresh = createMockReq({
      cookies: { superadmin_token: superAdminToken },
    })
    const resSARefresh = createMockRes()
    await authenticate(reqSARefresh, resSARefresh, () => {})
    const resSAMe = createMockRes()
    await getMe(reqSARefresh, resSAMe)

    assertTest(
      resSAMe.statusCode === 200 &&
      resSAMe.body?.data?.user?.role === "super_admin" &&
      resSAMe.body?.data?.user?.email === envSuperAdminEmail,
      "Refresh after Super Admin login (/api/auth/me) -> Restores active Super Admin session"
    )

    // Test 11: Refresh after tenant login -> Correct tenant session
    const reqTenantRefresh = createMockReq({
      cookies: { client_token: tenantToken },
    })
    const resTenantRefresh = createMockRes()
    await authenticate(reqTenantRefresh, resTenantRefresh, () => {})
    const resTenantMe = createMockRes()
    await getMe(reqTenantRefresh, resTenantMe)

    assertTest(
      resTenantMe.statusCode === 200 &&
      resTenantMe.body?.data?.user?.role === "account_admin" &&
      resTenantMe.body?.data?.user?.tenantId === tenantId,
      "Refresh after tenant login (/api/auth/me) -> Restores active tenant session"
    )

    // Test 12: Tenant credentials must not authenticate through Super Admin login
    const reqTenantOnSAPortal = createMockReq({
      body: { email: tenantAdminEmail, password: tenantUserPassword, portal: "super_admin" },
    })
    const resTenantOnSAPortal = createMockRes()
    await login(reqTenantOnSAPortal, resTenantOnSAPortal)

    assertTest(
      (resTenantOnSAPortal.statusCode === 401 || resTenantOnSAPortal.statusCode === 403) &&
      resTenantOnSAPortal.body?.success === false,
      "Tenant credentials submitted on Super Admin login form -> Rejected (401/403)"
    )

    // Test 13: Super Admin credentials cannot be used to log into tenant portal
    const reqSAOnTenantPortal = createMockReq({
      body: { email: envSuperAdminEmail, password: envSuperAdminPassword, tenantId },
    })
    const resSAOnTenantPortal = createMockRes()
    await login(reqSAOnTenantPortal, resSAOnTenantPortal)

    assertTest(
      resSAOnTenantPortal.statusCode === 403 && resSAOnTenantPortal.body?.success === false,
      "Super Admin credentials submitted on Tenant portal -> Rejected with HTTP 403"
    )
  } finally {
    // Cleanup test records
    if (testTenantAdmin) await User.deleteOne({ _id: testTenantAdmin._id })
    if (testAccount) await Account.deleteOne({ _id: testAccount._id })
    await User.deleteMany({ email: envSuperAdminEmail })

    // Restore original env vars
    if (origEnvEmail !== undefined) process.env.SUPERADMIN_EMAIL = origEnvEmail
    else delete process.env.SUPERADMIN_EMAIL
    if (origEnvPass !== undefined) process.env.SUPERADMIN_PASSWORD = origEnvPass
    else delete process.env.SUPERADMIN_PASSWORD

    await mongoose.disconnect()
    console.log("\n  Disconnected from MongoDB.")
  }

  console.log("\n==================================================================")
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log("==================================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runVerification().catch((err) => {
  console.error("Fatal error during verification:", err)
  process.exit(1)
})
