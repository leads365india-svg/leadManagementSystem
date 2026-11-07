/**
 * Leads365 — Verification Suite: AI Sales Intelligence Scorecards & Tenant Refresh Protection
 * 
 * Tests:
 * 1. AI Sales Intelligence Scorecards Array Parsing & Rendering Resilience
 * 2. Super Admin Tenant Context Persistence across Hard Refresh
 * 3. Super Admin Tenant Switching & Boundary Isolation
 * 4. Super Admin without Tenant Console Redirection
 * 5. Normal Tenant Admin CRM Confinement & Route Guarding
 * 6. Suspended/Invalid Tenant Context Purge & Safe Exit
 */

const assert = require("assert")

console.log("==================================================================")
console.log("  LEADS365 — AI SALES INTELLIGENCE & TENANT REFRESH TEST SUITE   ")
console.log("==================================================================\n")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
    failed++
  }
}

// ============================================================================
// SUITE 1: AI Sales Intelligence Scorecards Array Extraction & Rendering Safety
// ============================================================================
console.log("📊 Suite 1: AI Sales Intelligence Scorecards Data Extraction & Resilience")

function extractScorecards(res) {
  if (!res || !res.success) return []
  return Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.scorecards)
      ? res.data.scorecards
      : []
}

test("1.1: Backend contract ({ success: true, data: { scorecards: [...] } }) correctly extracts array", () => {
  const backendResponse = {
    success: true,
    data: {
      scorecards: [
        { _id: "sc_1", agentId: { _id: "ag_1", name: "Rahul Sharma", role: "agent" }, sampleSize: 12, sampleCoverage: "SUFFICIENT" },
        { _id: "sc_2", agentId: { _id: "ag_2", name: "Priya Patel", role: "agent" }, sampleSize: 2, sampleCoverage: "INSUFFICIENT" },
      ]
    }
  }

  const scorecards = extractScorecards(backendResponse)
  assert(Array.isArray(scorecards), "Extracted scorecards must be an array")
  assert.strictEqual(scorecards.length, 2, "Expected 2 scorecards")

  // Verify .map executes without TypeError
  const rendered = scorecards.map(c => `${c.agentId.name} (${c.sampleSize})`)
  assert.strictEqual(rendered[0], "Rahul Sharma (12)")
  assert.strictEqual(rendered[1], "Priya Patel (2)")
})

test("1.2: Backward compatibility when res.data is directly an array", () => {
  const legacyResponse = {
    success: true,
    data: [
      { _id: "sc_old_1", agentId: { name: "Amit" }, sampleSize: 5 }
    ]
  }

  const scorecards = extractScorecards(legacyResponse)
  assert(Array.isArray(scorecards), "Must parse direct array correctly")
  assert.strictEqual(scorecards.length, 1)
  assert.strictEqual(scorecards[0]._id, "sc_old_1")
})

test("1.3: Empty state handling when no scorecards exist", () => {
  const emptyResponse = {
    success: true,
    data: { scorecards: [] }
  }

  const scorecards = extractScorecards(emptyResponse)
  assert(Array.isArray(scorecards), "Must be an array")
  assert.strictEqual(scorecards.length, 0, "Must be empty")

  // Verify empty check condition works cleanly
  const isEmpty = !Array.isArray(scorecards) || scorecards.length === 0
  assert.strictEqual(isEmpty, true, "Empty state flag must be true")
})

test("1.4: Unexpected response structure (null, undefined, malformed object) safely falls back to empty array", () => {
  const malformedResponses = [
    null,
    undefined,
    { success: false, error: "Unauthorized" },
    { success: true, data: null },
    { success: true, data: "invalid_string" },
    { success: true, data: { otherKey: 123 } },
  ]

  for (const resp of malformedResponses) {
    const scorecards = extractScorecards(resp)
    assert(Array.isArray(scorecards), "Must always return an Array")
    assert.strictEqual(scorecards.length, 0, "Must default to empty array")
    // Ensure .map never throws
    assert.doesNotThrow(() => scorecards.map(x => x))
  }
})

// ============================================================================
// SUITE 2: Super Admin Active Tenant Persistence & Route Guarding
// ============================================================================
console.log("\n🛡️ Suite 2: Super Admin Tenant Context & Refresh Redirection Guard")

function evaluateAuthGuard({ status, user, pathname, localStorageTenant, urlTenant }) {
  const PUBLIC_EXACT = new Set(["/", "/portal/login", "/super-admin/login", "/login"])
  if (!pathname || PUBLIC_EXACT.has(pathname) || pathname.startsWith("/portal/login") || pathname.startsWith("/super-admin/login")) {
    return { action: "exempt", target: null }
  }

  if (pathname.startsWith("/super-admin")) {
    if (status === "authenticated" && user?.role !== "super_admin") {
      return { action: "redirect", target: "/super-admin/login?error=unauthorized" }
    }
    return { action: "render_super_admin", target: null }
  }

  if (status === "unauthenticated") {
    return { action: "redirect", target: "/portal/login" }
  }

  if (status === "authenticated" && user?.role === "super_admin") {
    const effectiveTenant = localStorageTenant || urlTenant || user?.tenantId

    if (!effectiveTenant) {
      return { action: "redirect", target: "/super-admin" }
    }

    if (user?.account && user.account.status === "suspended") {
      return { action: "redirect_suspended", target: "/super-admin", clearStorage: true }
    }

    return { action: "render_tenant_crm", tenantId: effectiveTenant, target: null }
  }

  if (status === "authenticated" && user?.role === "account_admin") {
    return { action: "render_tenant_crm", tenantId: user.tenantId, target: null }
  }

  return { action: "unknown", target: null }
}

test("2.1: Super Admin accessing Tenant A preserves CRM access on hard refresh (Scenario A)", () => {
  const result = evaluateAuthGuard({
    status: "authenticated",
    user: {
      id: "usr_super_1",
      role: "super_admin",
      tenantId: "ACC-TENANT-A",
      account: { accountId: "ACC-TENANT-A", companyName: "Tenant A Corp", status: "active" }
    },
    pathname: "/dashboard/ai-sales-intelligence",
    localStorageTenant: "ACC-TENANT-A",
    urlTenant: null
  })

  assert.strictEqual(result.action, "render_tenant_crm", "Must allow Super Admin to access CRM")
  assert.strictEqual(result.tenantId, "ACC-TENANT-A", "Must be bound to Tenant A")
  assert.strictEqual(result.target, null, "Must NOT redirect to /super-admin")
})

test("2.2: Super Admin switching to Tenant B changes context safely (Scenario B)", () => {
  const result = evaluateAuthGuard({
    status: "authenticated",
    user: {
      id: "usr_super_1",
      role: "super_admin",
      tenantId: "ACC-TENANT-B",
      account: { accountId: "ACC-TENANT-B", companyName: "Tenant B Corp", status: "active" }
    },
    pathname: "/dashboard/ai-sales-intelligence",
    localStorageTenant: "ACC-TENANT-B",
    urlTenant: "ACC-TENANT-B"
  })

  assert.strictEqual(result.action, "render_tenant_crm")
  assert.strictEqual(result.tenantId, "ACC-TENANT-B", "Must reflect Tenant B context")
})

test("2.3: Super Admin without active tenant is routed to /super-admin console (Scenario C)", () => {
  const result = evaluateAuthGuard({
    status: "authenticated",
    user: {
      id: "usr_super_1",
      role: "super_admin",
      tenantId: null,
      account: null
    },
    pathname: "/leads",
    localStorageTenant: null,
    urlTenant: null
  })

  assert.strictEqual(result.action, "redirect")
  assert.strictEqual(result.target, "/super-admin", "Super Admin with no tenant must go to console")
})

test("2.4: Normal Tenant Admin remains in own tenant CRM and cannot access /super-admin (Scenario D)", () => {
  // Normal tenant admin visiting CRM
  const crmResult = evaluateAuthGuard({
    status: "authenticated",
    user: { id: "usr_adm_1", role: "account_admin", tenantId: "ACC-REAL-TENANT" },
    pathname: "/leads",
    localStorageTenant: null,
    urlTenant: null
  })
  assert.strictEqual(crmResult.action, "render_tenant_crm")
  assert.strictEqual(crmResult.tenantId, "ACC-REAL-TENANT")

  // Normal tenant admin attempting to access /super-admin
  const superAdminAttempt = evaluateAuthGuard({
    status: "authenticated",
    user: { id: "usr_adm_1", role: "account_admin", tenantId: "ACC-REAL-TENANT" },
    pathname: "/super-admin",
    localStorageTenant: null,
    urlTenant: null
  })
  assert.strictEqual(superAdminAttempt.action, "redirect")
  assert.strictEqual(superAdminAttempt.target, "/super-admin/login?error=unauthorized")
})

test("2.5: Suspended tenant context safely redirects Super Admin and purges storage (Scenario E)", () => {
  const result = evaluateAuthGuard({
    status: "authenticated",
    user: {
      id: "usr_super_1",
      role: "super_admin",
      tenantId: "ACC-SUSPENDED",
      account: { accountId: "ACC-SUSPENDED", companyName: "Suspended Corp", status: "suspended" }
    },
    pathname: "/portal",
    localStorageTenant: "ACC-SUSPENDED",
    urlTenant: null
  })

  assert.strictEqual(result.action, "redirect_suspended")
  assert.strictEqual(result.target, "/super-admin")
  assert.strictEqual(result.clearStorage, true, "Must flag storage cleanup")
})

// ============================================================================
// SUITE 3: Header Exit Action & Tenant Isolation Verification
// ============================================================================
console.log("\n🚪 Suite 3: Super Admin Tenant Exit & Session State Synchronization")

function simulateExitTenant({ localStorage, cookies, setTenantFn }) {
  localStorage.removeItem("leadflow_active_tenant")
  cookies.active_tenant_id = null
  if (setTenantFn) setTenantFn(null)
  return { destination: "/super-admin" }
}

test("3.1: Explicit Exit to Console clears active tenant context and routes to /super-admin", () => {
  const storage = {
    data: { "leadflow_active_tenant": "ACC-TEST-123" },
    removeItem(k) { delete this.data[k] }
  }
  const cookies = { active_tenant_id: "ACC-TEST-123" }
  let activeTenantState = "ACC-TEST-123"

  const exitResult = simulateExitTenant({
    localStorage: storage,
    cookies,
    setTenantFn: (t) => { activeTenantState = t }
  })

  assert.strictEqual(storage.data["leadflow_active_tenant"], undefined, "localStorage tenant must be cleared")
  assert.strictEqual(cookies.active_tenant_id, null, "active_tenant_id cookie must be cleared")
  assert.strictEqual(activeTenantState, null, "AuthContext activeTenant state must be null")
  assert.strictEqual(exitResult.destination, "/super-admin")
})

console.log("\n==================================================================")
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
console.log("==================================================================\n")

if (failed > 0) {
  process.exit(1)
}
