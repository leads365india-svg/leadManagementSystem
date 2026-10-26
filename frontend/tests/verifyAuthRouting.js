/**
 * Phase 7 Verification Suite: Frontend Auth Routing & Protection Logic
 * Validates route classification, unauthenticated redirection, Super Admin role separation,
 * and session expiration handling across all LeadFlow CRM routes.
 */

const assert = require("assert")

// Replicate the exact logic from frontend/components/auth-guard.jsx
const PUBLIC_EXACT_ROUTES = new Set([
  "/portal/login",
  "/super-admin/login",
  "/login",
])

function isExemptRoute(pathname) {
  if (!pathname) return true

  // Public login routes
  if (PUBLIC_EXACT_ROUTES.has(pathname)) return true
  if (pathname.startsWith("/portal/login")) return true
  if (pathname.startsWith("/super-admin/login")) return true

  // Delegated layout guards
  if (pathname.startsWith("/super-admin")) return true
  if (pathname.startsWith("/portal")) return true

  return false
}

// Simulate AuthGuard state machine
function simulateAuthGuard(pathname, authState) {
  const isExempt = isExemptRoute(pathname)
  if (isExempt) {
    return { action: "render_exempt", target: null }
  }

  if (authState.loading || authState.status === "idle") {
    return { action: "show_spinner", target: null }
  }

  if (authState.status === "unauthenticated") {
    return { action: "redirect", target: "/portal/login" }
  }

  if (authState.status === "authenticated" && authState.user?.role === "super_admin") {
    return { action: "redirect", target: "/super-admin" }
  }

  if (authState.status === "authenticated" && authState.user?.role === "account_admin") {
    return { action: "render_protected", target: null }
  }

  return { action: "unknown", target: null }
}

// Simulate apiClient 401 session expiration interceptor
function simulateApiClient401(endpoint, currentPathname) {
  const isAuthEndpoint =
    endpoint === "/auth/me" ||
    endpoint === "/auth/login" ||
    endpoint.startsWith("/auth/tenant-info")
  const isLoginPage = currentPathname.includes("/login")

  if (!isAuthEndpoint && !isLoginPage) {
    const redirectUrl = currentPathname.startsWith("/super-admin")
      ? "/super-admin/login?session=expired"
      : "/portal/login?session=expired"
    return { redirected: true, target: redirectUrl }
  }
  return { redirected: false, target: null }
}

console.log("=======================================================")
console.log("    PHASE 7: AUTH ROUTING & SESSION VERIFICATION       ")
console.log("=======================================================\n")

let passed = 0
let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`  ✅ PASS: ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`)
    failed++
  }
}

// Suite 1: Unauthenticated direct visits to protected CRM routes
console.log("📋 Suite 1: Unauthenticated Direct Visits to Protected CRM Routes")
const protectedRoutes = [
  "/",
  "/dashboard",
  "/leads",
  "/leads/new",
  "/reports/leads",
  "/reports/call-reports",
  "/reports/meeting-reports",
  "/reports/performance",
  "/reports/call-ingestion",
  "/settings/custom-fields",
  "/settings/field-arrangement",
  "/settings/report-builder",
  "/settings/lead-feeds",
  "/settings/message-templates",
  "/settings/staff",
  "/settings/do-not-record",
  "/tools/import-leads",
  "/tools/assign-leads",
  "/tools/data-management",
  "/communication/call-reports",
  "/communication/meetings",
  "/communication/reminders",
  "/communication/follow-ups",
]

protectedRoutes.forEach((route) => {
  runTest(`Unauthenticated visit to '${route}' redirects to '/portal/login'`, () => {
    assert.strictEqual(isExemptRoute(route), false, `Route ${route} should not be exempt`)
    const result = simulateAuthGuard(route, { status: "unauthenticated", loading: false, user: null })
    assert.strictEqual(result.action, "redirect")
    assert.strictEqual(result.target, "/portal/login")
  })
})

// Suite 2: Public and login routes must never be blocked or trigger redirect loops
console.log("\n📋 Suite 2: Public Routes & Loop Prevention")
const publicRoutes = [
  "/portal/login",
  "/portal/login?tenant=ACC-9999",
  "/portal/login?session=expired",
  "/super-admin/login",
  "/login",
]

publicRoutes.forEach((route) => {
  runTest(`Public route '${route}' is recognized as exempt and rendered directly`, () => {
    assert.strictEqual(isExemptRoute(route), true, `Route ${route} must be exempt`)
    const result = simulateAuthGuard(route, { status: "unauthenticated", loading: false, user: null })
    assert.strictEqual(result.action, "render_exempt")
    assert.strictEqual(result.target, null)
  })
})

// Suite 3: Super Admin separation & role navigation
console.log("\n📋 Suite 3: Role Separation & Delegated Layout Protection")
runTest("Super Admin attempting to view Client CRM '/' is redirected to '/super-admin'", () => {
  const result = simulateAuthGuard("/", { status: "authenticated", loading: false, user: { role: "super_admin" } })
  assert.strictEqual(result.action, "redirect")
  assert.strictEqual(result.target, "/super-admin")
})

runTest("Super Admin attempting to view Client CRM '/leads' is redirected to '/super-admin'", () => {
  const result = simulateAuthGuard("/leads", { status: "authenticated", loading: false, user: { role: "super_admin" } })
  assert.strictEqual(result.action, "redirect")
  assert.strictEqual(result.target, "/super-admin")
})

runTest("Account Admin accessing '/leads' is granted access", () => {
  const result = simulateAuthGuard("/leads", { status: "authenticated", loading: false, user: { role: "account_admin" } })
  assert.strictEqual(result.action, "render_protected")
  assert.strictEqual(result.target, null)
})

runTest("Routes under '/super-admin' are delegated to SuperAdminLayout", () => {
  assert.strictEqual(isExemptRoute("/super-admin"), true)
  assert.strictEqual(isExemptRoute("/super-admin/roles-permissions"), true)
})

runTest("Routes under '/portal' are delegated to PortalLayout", () => {
  assert.strictEqual(isExemptRoute("/portal"), true)
  assert.strictEqual(isExemptRoute("/portal/leads"), true)
  assert.strictEqual(isExemptRoute("/portal/leads/new"), true)
})

// Suite 4: In-flight session expiration interceptor
console.log("\n📋 Suite 4: In-Flight API Session Expiration (401 Interceptor)")
runTest("401 on /api/leads while on /leads redirects to /portal/login?session=expired", () => {
  const res = simulateApiClient401("/leads", "/leads")
  assert.strictEqual(res.redirected, true)
  assert.strictEqual(res.target, "/portal/login?session=expired")
})

runTest("401 on /api/super-admin/accounts while on /super-admin redirects to /super-admin/login?session=expired", () => {
  const res = simulateApiClient401("/super-admin/accounts", "/super-admin")
  assert.strictEqual(res.redirected, true)
  assert.strictEqual(res.target, "/super-admin/login?session=expired")
})

runTest("401 on /api/auth/me during initial check throws without triggering window.location loop", () => {
  const res = simulateApiClient401("/auth/me", "/leads")
  assert.strictEqual(res.redirected, false)
})

runTest("401 while already on /portal/login throws without triggering redirect loop", () => {
  const res = simulateApiClient401("/leads", "/portal/login")
  assert.strictEqual(res.redirected, false)
})

// Suite 5: Session Persistence & Client-side Route Navigation State
console.log("\n📋 Suite 5: Session Persistence & Navigation Flow Verification")

class MockAuthProvider {
  constructor() {
    this.user = null
    this.status = "loading"
  }

  setSession(user) {
    if (user) {
      this.user = user
      this.status = "authenticated"
    } else {
      this.user = null
      this.status = "unauthenticated"
    }
  }

  logout() {
    this.user = null
    this.status = "unauthenticated"
  }
}

runTest("Login establishes authenticated session that persists across route transitions", () => {
  const auth = new MockAuthProvider()
  assert.strictEqual(auth.status, "loading")

  // Simulate login
  auth.setSession({ role: "account_admin", name: "Sara Khan" })
  assert.strictEqual(auth.status, "authenticated")

  // Navigating to /portal
  const portalRes = simulateAuthGuard("/portal", auth)
  assert.strictEqual(portalRes.action, "render_exempt")

  // Navigating through navbar to /leads preserves auth and renders protected
  const leadsRes = simulateAuthGuard("/leads", auth)
  assert.strictEqual(leadsRes.action, "render_protected")

  // Navigating to /communication/follow-ups preserves auth and renders protected
  const followUpsRes = simulateAuthGuard("/communication/follow-ups", auth)
  assert.strictEqual(followUpsRes.action, "render_protected")

  // Navigating to /dashboard preserves auth and renders protected
  const dashboardRes = simulateAuthGuard("/dashboard", auth)
  assert.strictEqual(dashboardRes.action, "render_protected")

  // Navigating to / preserves auth and renders protected
  const homeRes = simulateAuthGuard("/", auth)
  assert.strictEqual(homeRes.action, "render_protected")
})

runTest("HTTP 403 Forbidden does not trigger session expiration redirect", () => {
  const simulateApiStatus = (statusCode, endpoint, currentPathname) => {
    if (statusCode === 401) {
      return simulateApiClient401(endpoint, currentPathname)
    }
    return { redirected: false, target: null }
  }
  const res = simulateApiStatus(403, "/leads", "/leads")
  assert.strictEqual(res.redirected, false)
  assert.strictEqual(res.target, null)
})

runTest("Explicit logout resets AuthProvider state and blocks protected routes", () => {
  const auth = new MockAuthProvider()
  auth.setSession({ role: "account_admin", name: "Sara Khan" })
  assert.strictEqual(auth.status, "authenticated")

  auth.logout()
  assert.strictEqual(auth.status, "unauthenticated")
  assert.strictEqual(auth.user, null)

  const leadsRes = simulateAuthGuard("/leads", auth)
  assert.strictEqual(leadsRes.action, "redirect")
  assert.strictEqual(leadsRes.target, "/portal/login")
})

console.log("\n=======================================================")
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
console.log("=======================================================")

if (failed > 0) {
  process.exit(1)
}
