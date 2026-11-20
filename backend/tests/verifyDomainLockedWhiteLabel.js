/**
 * Verification Test: Domain-Locked White-Label Routing, Branding & Login Isolation
 *
 * Verifies:
 * 1. GET /api/auth/branding returns proper white-label metadata for registered custom domains.
 * 2. GET /api/auth/branding returns isWhiteLabel: false for admin/localhost/unknown domains.
 * 3. POST /api/auth/login with domain='crm.medical365.in' permits Medical 365 users.
 * 4. POST /api/auth/login with domain='crm.medical365.in' rejects Purewood users with 403 Forbidden.
 * 5. POST /api/auth/login with domain='crm.medical365.in' rejects Super Admin with 403 Forbidden.
 * 6. POST /api/auth/login without domain lock permits Purewood users on generic hosts.
 */

const assert = require("assert")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const BASE_URL = process.env.TEST_API_URL || "http://localhost:5000"

async function runVerification() {
  console.log("\n=======================================================")
  console.log("🔒 PHASE 31: DOMAIN-LOCKED WHITE-LABEL & LOGIN ISOLATION")
  console.log("=======================================================\n")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error("MONGODB_URI is required in environment")
  }

  await mongoose.connect(uri)
  console.log("✅ MongoDB Connected")

  const User = require("../models/User")
  const Account = require("../models/Account")

  // Ensure Medical 365 Account exists with customDomain 'crm.medical365.in'
  let medAccount = await Account.findOne({ customDomain: "crm.medical365.in" })
  if (!medAccount) {
    medAccount = await Account.findOne({ companyName: "Medical 365" })
    if (medAccount) {
      medAccount.customDomain = "crm.medical365.in"
      await medAccount.save()
    }
  }

  assert(medAccount, "Medical 365 Account not found in database")
  console.log(`ℹ️ Medical 365 Account ID: ${medAccount.accountId} (Domain: ${medAccount.customDomain})`)

  // Ensure Purewood Account exists
  let purewoodAccount = await Account.findOne({ companyName: { $regex: /purewood/i } })
  if (!purewoodAccount) {
    purewoodAccount = await Account.findOne({ accountId: { $ne: medAccount.accountId } })
  }
  assert(purewoodAccount, "Purewood / Secondary Account not found in database")
  console.log(`ℹ️ Secondary Account ID: ${purewoodAccount.accountId} (${purewoodAccount.companyName})`)

  // Find or create test users
  const TEST_PASSWORD = "Password123!"

  // 1. Medical 365 user
  let medUser = await User.findOne({ tenantId: medAccount.accountId })
  if (!medUser) {
    medUser = await User.create({
      name: "Medical 365 Staff",
      email: "staff_med365_test@example.com",
      password: TEST_PASSWORD,
      role: "agent",
      tenantId: medAccount.accountId,
    })
  } else {
    medUser.password = TEST_PASSWORD
    await medUser.save()
  }

  // 2. Purewood user
  let purewoodUser = await User.findOne({ tenantId: purewoodAccount.accountId })
  if (!purewoodUser) {
    purewoodUser = await User.create({
      name: "Purewood Staff",
      email: "staff_purewood_test@example.com",
      password: TEST_PASSWORD,
      role: "agent",
      tenantId: purewoodAccount.accountId,
    })
  } else {
    purewoodUser.password = TEST_PASSWORD
    await purewoodUser.save()
  }

  // 3. Super admin user
  let superAdminUser = await User.findOne({ role: "super_admin" })
  assert(superAdminUser, "Super Admin user required in database")
  const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "SuperAdmin@2026!"

  let passed = 0
  let failed = 0

  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`  ✅ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`)
      console.error(err)
      failed++
    }
  }

  console.log("\n📋 Suite 1: Public Branding Endpoint (GET /api/auth/branding)")

  await test("White-label domain 'crm.medical365.in' returns isWhiteLabel: true and branding data", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/branding?domain=crm.medical365.in`)
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.isWhiteLabel, true)
    assert.strictEqual(body.data.tenantId, medAccount.accountId)
    assert.strictEqual(body.data.accountId, medAccount.accountId)
    assert.strictEqual(body.data.companyName, medAccount.companyName)
    assert(body.data.displayName)
    assert(body.data.brandPrimaryColor)
  })

  await test("Administrative domain 'admin.leads365.in' returns isWhiteLabel: false", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/branding?domain=admin.leads365.in`)
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.data.isWhiteLabel, false)
  })

  await test("Localhost domain returns isWhiteLabel: false", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/branding?domain=localhost:3000`)
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.data.isWhiteLabel, false)
  })

  await test("Unregistered custom domain returns isWhiteLabel: false", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/branding?domain=unknown-portal.org`)
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.data.isWhiteLabel, false)
  })

  console.log("\n📋 Suite 2: Domain-Locked Login Isolation")

  await test("Medical 365 user logging into 'crm.medical365.in' succeeds with 200 OK", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: medUser.email,
        password: TEST_PASSWORD,
        domain: "crm.medical365.in",
      }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.user.email, medUser.email)
    assert.strictEqual(body.data.user.tenantId, medAccount.accountId)
  })

  await test("Cross-tenant user (Purewood) logging into 'crm.medical365.in' is rejected with 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: purewoodUser.email,
        password: TEST_PASSWORD,
        domain: "crm.medical365.in",
      }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 403)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, "Access denied: This account does not belong to this portal domain.")
  })

  await test("Super Admin attempting to log in on 'crm.medical365.in' is rejected with 403 Forbidden", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: superAdminUser.email,
        password: SUPERADMIN_PASSWORD,
        domain: "crm.medical365.in",
      }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 403)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, "Access denied: This account does not belong to this portal domain.")
  })

  await test("Purewood user logging in without domain lock (localhost/generic) succeeds with 200 OK", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: purewoodUser.email,
        password: TEST_PASSWORD,
        domain: "localhost:3000",
      }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.user.email, purewoodUser.email)
  })

  await test("Invalid password on 'crm.medical365.in' returns 401 Unauthorized without domain leakage", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: medUser.email,
        password: "WrongPassword999!",
        domain: "crm.medical365.in",
      }),
    })
    const body = await res.json()
    assert.strictEqual(res.status, 401)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, "Invalid email or password")
  })

  console.log("\n=======================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("=======================================================\n")

  await mongoose.disconnect()

  if (failed > 0) {
    process.exit(1)
  }
}

runVerification().catch((err) => {
  console.error("Verification error:", err)
  process.exit(1)
})
