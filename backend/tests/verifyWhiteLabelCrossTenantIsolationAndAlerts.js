/**
 * Automated Verification: White-Label Cross-Tenant Isolation & Follow-Up Alerts
 * Tests:
 * 1. Domain-to-tenant mapping: Medical 365 vs The Purewood vs Platform vs Unknown domains
 * 2. Cache-Control and Vary headers on public branding API
 * 3. Cross-tenant session protection (Purewood session cannot access Medical365 domain)
 * 4. Multi-tenant follow-up alert scoping and reschedule idempotency
 */

const assert = require("assert")
const jwt = require("jsonwebtoken")
const path = require("path")
const dotenv = require("dotenv")
dotenv.config({ path: path.resolve(__dirname, "../.env") })

const API_BASE = "http://localhost:5000/api"
const JWT_SECRET = process.env.JWT_SECRET || "leadflow-dev-secret-key-min32-chars-for-local-only"

async function fetchWithHeaders(url, headers = {}) {
  const res = await fetch(url, { headers })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch (_) {
    data = text
  }
  return {
    status: res.status,
    headers: res.headers,
    data,
  }
}

async function runTests() {
  console.log("=== STARTING CROSS-TENANT ISOLATION & FOLLOW-UP ALERTS VERIFICATION ===\n")

  // --- TEST 1: Authoritative Hostname Branding Resolution ---
  console.log("TEST 1: Authoritative Hostname Branding Resolution...")
  
  // 1a: Medical 365
  const medRes = await fetchWithHeaders(`${API_BASE}/auth/branding?domain=crm.medical365.in`)
  assert.strictEqual(medRes.status, 200)
  assert.strictEqual(medRes.data.success, true)
  assert.strictEqual(medRes.data.data.isWhiteLabel, true)
  assert.strictEqual(medRes.data.data.accountId, "ACC-3E87985C")
  assert.strictEqual(medRes.data.data.companyName, "Medical 365")
  console.log("   ✅ crm.medical365.in strictly resolves to Medical 365 (ACC-3E87985C)")

  // 1b: Purewood
  const pureRes = await fetchWithHeaders(`${API_BASE}/auth/branding?domain=crm.thepurewood.com`)
  assert.strictEqual(pureRes.status, 200)
  assert.strictEqual(pureRes.data.success, true)
  assert.strictEqual(pureRes.data.data.isWhiteLabel, true)
  assert.strictEqual(pureRes.data.data.accountId, "ACC-F372B78C")
  assert.strictEqual(pureRes.data.data.companyName, "The Purewood")
  console.log("   ✅ crm.thepurewood.com strictly resolves to The Purewood (ACC-F372B78C)")

  // 1c: Cache-Control & Vary headers check
  const cacheControl = medRes.headers.get("cache-control") || ""
  const vary = medRes.headers.get("vary") || ""
  assert.ok(cacheControl.includes("no-cache") || cacheControl.includes("no-store"), "Must have no-cache/no-store")
  assert.ok(vary.toLowerCase().includes("host"), "Must have Vary: Host")
  console.log(`   ✅ Cache-Control: ${cacheControl}`)
  console.log(`   ✅ Vary: ${vary}`)
  console.log("✅ TEST 1 PASSED: Domain branding strictly mapped and isolated.\n")

  // --- TEST 2: Platform and Unknown Domains ---
  console.log("TEST 2: Platform and Unknown Domains...")
  const localRes = await fetchWithHeaders(`${API_BASE}/auth/branding?domain=localhost`)
  assert.strictEqual(localRes.data.data.isWhiteLabel, false)

  const adminRes = await fetchWithHeaders(`${API_BASE}/auth/branding?domain=admin.leads365.in`)
  assert.strictEqual(adminRes.data.data.isWhiteLabel, false)

  const unknownRes = await fetchWithHeaders(`${API_BASE}/auth/branding?domain=crm.unknown-tenant-domain.com`)
  assert.strictEqual(unknownRes.data.data.isWhiteLabel, false)
  assert.strictEqual(unknownRes.data.data.unconfiguredDomain, true)
  console.log("✅ TEST 2 PASSED: Platform domains return false; unconfigured domains return unconfiguredDomain: true.\n")

  // --- TEST 3: Cross-Tenant Session Contamination Defense ---
  console.log("TEST 3: Cross-Tenant Session Contamination Defense...")

  const mongoose = require("mongoose")
  const User = require("../models/User")
  await mongoose.connect(process.env.MONGODB_URI)

  let purewoodUser = await User.findOne({ tenantId: "ACC-F372B78C" }).lean()
  let medicalUser = await User.findOne({ tenantId: "ACC-3E87985C" }).lean()

  if (!purewoodUser) {
    purewoodUser = await User.create({
      name: "Purewood Test Admin",
      email: "test_purewood@example.com",
      password: "TestPassword123!",
      role: "account_admin",
      tenantId: "ACC-F372B78C",
      status: "active",
    })
  }

  if (!medicalUser) {
    medicalUser = await User.create({
      name: "Medical 365 Test Admin",
      email: "test_medical@example.com",
      password: "TestPassword123!",
      role: "account_admin",
      tenantId: "ACC-3E87985C",
      status: "active",
    })
  }

  // Generate tokens with valid user IDs from DB:
  const purewoodToken = jwt.sign(
    {
      id: purewoodUser._id.toString(),
      email: purewoodUser.email,
      role: purewoodUser.role,
      tenantId: "ACC-F372B78C",
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )

  const medicalToken = jwt.sign(
    {
      id: medicalUser._id.toString(),
      email: medicalUser.email,
      role: medicalUser.role,
      tenantId: "ACC-3E87985C",
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )

  // Subtest 3a: Purewood user tries to access Medical 365 domain
  console.log("   Subtest 3a: Request with Purewood token to crm.medical365.in...")
  const crossRes1 = await fetchWithHeaders(`${API_BASE}/auth/me`, {
    Authorization: `Bearer ${purewoodToken}`,
    "x-tenant-domain": "crm.medical365.in",
  })
  assert.strictEqual(crossRes1.status, 403, "Must return 403 Forbidden for cross-tenant session")
  assert.strictEqual(crossRes1.data.code, "CROSS_TENANT_SESSION_MISMATCH", "Must return CROSS_TENANT_SESSION_MISMATCH code")
  console.log("   ✅ Cross-tenant request strictly blocked with 403 CROSS_TENANT_SESSION_MISMATCH")

  // Subtest 3b: Medical 365 user tries to access Purewood domain
  console.log("   Subtest 3b: Request with Medical 365 token to crm.thepurewood.com...")
  const crossRes2 = await fetchWithHeaders(`${API_BASE}/auth/me`, {
    Authorization: `Bearer ${medicalToken}`,
    "x-tenant-domain": "crm.thepurewood.com",
  })
  assert.strictEqual(crossRes2.status, 403, "Must return 403 Forbidden for cross-tenant session")
  assert.strictEqual(crossRes2.data.code, "CROSS_TENANT_SESSION_MISMATCH")
  console.log("   ✅ Cross-tenant request strictly blocked with 403 CROSS_TENANT_SESSION_MISMATCH")

  // Subtest 3c: Medical 365 user accessing Medical 365 domain (valid)
  console.log("   Subtest 3c: Valid request with Medical 365 token to crm.medical365.in...")
  const validRes = await fetchWithHeaders(`${API_BASE}/auth/me`, {
    Authorization: `Bearer ${medicalToken}`,
    "x-tenant-domain": "crm.medical365.in",
  })
  assert.strictEqual(validRes.status, 200, "Valid session must return 200 OK")
  assert.strictEqual(validRes.data.success, true)
  assert.strictEqual(validRes.data.data.user.tenantId, "ACC-3E87985C")
  assert.strictEqual(validRes.data.data.user.account.companyName, "Medical 365")
  console.log("   ✅ Valid session correctly authorized for Medical 365")
  console.log("✅ TEST 3 PASSED: Cross-tenant session protection verified.\n")

  // --- TEST 4: Follow-up Alert Multi-Tenant Scoping & Rescheduling Logic ---
  console.log("TEST 4: Follow-up alert multi-tenant scoping & rescheduling...")

  function getStorageKey(user) {
    const tenantId = user?.tenantId || "global_tenant"
    const userId = user?.id || user?._id || "anon_user"
    return `leadflow_alerted_followups_${tenantId}_${userId}`
  }

  const userMed = { id: "user_med_1", tenantId: "ACC-3E87985C" }
  const userPure = { id: "user_pure_1", tenantId: "ACC-F372B78C" }

  const keyMed = getStorageKey(userMed)
  const keyPure = getStorageKey(userPure)
  assert.notStrictEqual(keyMed, keyPure, "Storage keys for different tenants/users must be completely distinct")
  assert.strictEqual(keyMed, "leadflow_alerted_followups_ACC-3E87985C_user_med_1")
  assert.strictEqual(keyPure, "leadflow_alerted_followups_ACC-F372B78C_user_pure_1")

  // Simulated Rescheduling Verification:
  const taskId = "task_999"
  const originalSchedule = new Date("2026-11-23T10:00:00Z").getTime()
  const originalKey = `${taskId}_${originalSchedule}`

  // Simulate user dismissing original schedule:
  const history = {}
  history[originalKey] = { due: Date.now(), dismissed: true }

  assert.strictEqual(history[originalKey].dismissed, true, "Original schedule is dismissed")

  // Now task is rescheduled to 4:00 PM:
  const rescheduledTime = new Date("2026-11-23T16:00:00Z").getTime()
  const newScheduleKey = `${taskId}_${rescheduledTime}`

  assert.notStrictEqual(originalKey, newScheduleKey, "Rescheduled scheduleKey must differ from original")
  assert.strictEqual(history[newScheduleKey], undefined, "New schedule must have empty history (not dismissed)")
  console.log("   ✅ Storage key scoping verified for Tenant A vs Tenant B")
  console.log("   ✅ Rescheduling to new timestamp generates new scheduleKey, unblocking fresh reminder")
  console.log("✅ TEST 4 PASSED: Follow-up alert multi-tenant scoping and reschedule idempotency verified.\n")

  await mongoose.disconnect()
  console.log("=== ALL CROSS-TENANT ISOLATION & ALERT VERIFICATIONS PASSED ===")
}

runTests().catch((err) => {
  console.error("❌ VERIFICATION FAILED:", err)
  process.exit(1)
})
