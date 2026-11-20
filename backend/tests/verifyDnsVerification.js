require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const assert = require("assert")
const jwt = require("jsonwebtoken")
const Account = require("../models/Account")
const User = require("../models/User")
const { verifyCustomDomainDns } = require("../controllers/accountController")

let passed = 0
let failed = 0

async function runTest(name, fn) {
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

async function runVerification() {
  console.log("\n=======================================================")
  console.log("🌐 PHASE 32: DNS VERIFICATION UNIT & API SUITE")
  console.log("=======================================================\n")

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("MONGODB_URI is not set in backend/.env")
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log("✅ MongoDB Connected")

  // Suite 1: verifyCustomDomainDns helper
  console.log("\n📋 Suite 1: verifyCustomDomainDns Helper Logic")

  await runTest("verifyCustomDomainDns('crm.medical365.in') resolves live and returns 'verified'", async () => {
    const status = await verifyCustomDomainDns("crm.medical365.in")
    assert.strictEqual(status, "verified")
  })

  await runTest("verifyCustomDomainDns with protocol 'https://crm.medical365.in/' normalizes and returns 'verified'", async () => {
    const status = await verifyCustomDomainDns("https://crm.medical365.in/")
    assert.strictEqual(status, "verified")
  })

  await runTest("verifyCustomDomainDns with empty domain returns 'unconfigured'", async () => {
    const status = await verifyCustomDomainDns("")
    assert.strictEqual(status, "unconfigured")
  })

  await runTest("verifyCustomDomainDns with invalid/non-existent domain returns 'pending'", async () => {
    const status = await verifyCustomDomainDns("unresolvable-random-domain-test-99999.xyz")
    assert.strictEqual(status, "pending")
  })

  // Suite 2: MongoDB Persistence for Account.domainStatus
  console.log("\n📋 Suite 2: Account.domainStatus MongoDB Persistence")

  const medicalAccount = await Account.findOne({ customDomain: "crm.medical365.in" })
  if (medicalAccount) {
    await runTest("Medical 365 Account can persist domainStatus='verified'", async () => {
      medicalAccount.domainStatus = "verified"
      await medicalAccount.save()
      const reloaded = await Account.findById(medicalAccount._id).lean()
      assert.strictEqual(reloaded.domainStatus, "verified")
    })

    await runTest("Account schema permits 'pending' and 'verified' enums", async () => {
      medicalAccount.domainStatus = "pending"
      await medicalAccount.save()
      let reloaded = await Account.findById(medicalAccount._id).lean()
      assert.strictEqual(reloaded.domainStatus, "pending")

      medicalAccount.domainStatus = "verified"
      await medicalAccount.save()
      reloaded = await Account.findById(medicalAccount._id).lean()
      assert.strictEqual(reloaded.domainStatus, "verified")
    })
  } else {
    console.log("  ⚠️ Skipping Medical 365 DB test: Account not found")
  }

  // Suite 3: On-demand API endpoint test POST /api/super-admin/accounts/:id/verify-domain
  console.log("\n📋 Suite 3: Super Admin API Endpoint POST /api/super-admin/accounts/:id/verify-domain")

  const superAdminUser = await User.findOne({ role: "super_admin" })
  if (superAdminUser && medicalAccount) {
    const jwtSecret = process.env.JWT_SECRET || "default_jwt_secret_change_me"
    const superAdminToken = jwt.sign(
      {
        id: superAdminUser._id.toString(),
        email: superAdminUser.email,
        role: "super_admin",
      },
      jwtSecret,
      { expiresIn: "1h" }
    )

    const API_BASE = "http://localhost:5000/api"

    // Check if backend server is responsive
    let serverRunning = false
    try {
      const probe = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null)
      if (probe) serverRunning = true
    } catch (_) {}

    if (serverRunning) {
      await runTest("POST /api/super-admin/accounts/:id/verify-domain verifies Medical 365 DNS", async () => {
        const res = await fetch(`${API_BASE}/super-admin/accounts/${medicalAccount.accountId}/verify-domain`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${superAdminToken}`,
            "Content-Type": "application/json",
          },
        })
        const data = await res.json()
        assert.strictEqual(res.status, 200)
        assert.strictEqual(data.success, true)
        assert.strictEqual(data.data.domainStatus, "verified")
      })

      await runTest("POST /api/super-admin/accounts/:id/verify-domain returns 404 for nonexistent account", async () => {
        const res = await fetch(`${API_BASE}/super-admin/accounts/NONEXISTENT-9999/verify-domain`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${superAdminToken}`,
            "Content-Type": "application/json",
          },
        })
        assert.strictEqual(res.status, 404)
      })
    } else {
      console.log("  ℹ️ Local backend server on :5000 is offline; direct handler testing completed.")
    }
  }

  console.log("\n=======================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("=======================================================\n")

  await mongoose.disconnect()

  if (failed > 0) {
    process.exit(1)
  }
}

runVerification().catch((err) => {
  console.error("Verification failed unexpectedly:", err)
  process.exit(1)
})
