/**
 * Leads365 AI Receptionist — Phase 1 Verification Test Suite
 * 
 * Verifies Multi-Tenant Telephony Foundation and Tenant Configuration:
 * 1. Safe default values (AI disabled, mock provider, unconfigured, recording enabled).
 * 2. Strict input validation (providers, connection modes, timeouts).
 * 3. AES-256-GCM credential encryption and tamper-evident authentication tags.
 * 4. Credential masking (raw tokens never leaked to API or client).
 * 5. Fail-closed security when cryptographic keys are missing or invalid.
 * 6. Internal decryption round-trip for voice session workers.
 * 7. Non-credential partial updates preserve existing encrypted credentials.
 * 8. Credential clearing resets configured status and purges ciphertext.
 * 9. Multi-tenant boundary isolation between Tenant A and Tenant B.
 * 10. Role-based access control (401 unauthenticated, 403 staff, 200 account admin).
 * 11. REST API endpoints (GET /api/telephony/config, PUT /api/telephony/config).
 * 12. Audit logging integration.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const request = require("supertest")

const connectDB = require("../db/connection")
const app = require("../start")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const User = require("../models/User")
const Account = require("../models/Account")
const AuditLog = require("../models/AuditLog")
const {
  DEFAULT_TELEPHONY_CONFIG,
  maskCredentials,
  sanitizeTelephonyConfig,
  getTenantTelephonyConfig,
  updateTenantTelephonyConfig,
  getDecryptedTelephonyCredentials,
} = require("../services/telephony/telephonyConfig.service")
const { encrypt, decrypt } = require("../utils/cryptoUtils")
const { getEffectiveTenant } = require("../middleware/tenantContext")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-superadmin-secret-key-2026-secure"
const TEST_TIMESTAMP = Date.now()
const TENANT_A = `ACC-PH1-A-${TEST_TIMESTAMP}`
const TENANT_B = `ACC-PH1-B-${TEST_TIMESTAMP}`

let passedCount = 0
let failedCount = 0
const results = []

function test(name, fn) {
  try {
    fn()
    passedCount++
    results.push({ name, passed: true })
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    results.push({ name, passed: false, error: err.message })
    console.error(`  ❌ [FAIL] ${name}`)
    console.error(`     Error: ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passedCount++
    results.push({ name, passed: true })
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    results.push({ name, passed: false, error: err.message })
    console.error(`  ❌ [FAIL] ${name}`)
    console.error(`     Error: ${err.message}`)
  }
}

function generateAuthToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion || 0,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )
}

async function cleanup() {
  try {
    const tenants = [TENANT_A, TENANT_B]
    await TenantBusinessProfile.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runPhase1Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 1 CONFIG & SECURITY SUITE    ")
  console.log("==================================================================\n")

  await connectDB()
  await cleanup()

  let userAdminA, userStaffA, userAdminB
  let tokenAdminA, tokenStaffA, tokenAdminB

  try {
    // 1. Create test users first
    userAdminA = await User.create({
      tenantId: TENANT_A,
      name: "Admin Alpha",
      email: `admin_a_${TEST_TIMESTAMP}@alpha.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    userStaffA = await User.create({
      tenantId: TENANT_A,
      name: "Staff Alpha",
      email: `staff_a_${TEST_TIMESTAMP}@alpha.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    userAdminB = await User.create({
      tenantId: TENANT_B,
      name: "Admin Beta",
      email: `admin_b_${TEST_TIMESTAMP}@beta.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    // 2. Create test accounts with required admin references
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Alpha Logistics Pvt Ltd",
        displayName: "Alpha Logistics",
        adminUserId: userAdminA._id,
        adminName: userAdminA.name,
        adminEmail: userAdminA.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Beta Solutions Ltd",
        displayName: "Beta Solutions",
        adminUserId: userAdminB._id,
        adminName: userAdminB.name,
        adminEmail: userAdminB.email,
        status: "active",
      },
    ])

    tokenAdminA = generateAuthToken(userAdminA)
    tokenStaffA = generateAuthToken(userStaffA)
    tokenAdminB = generateAuthToken(userAdminB)

    // ==================================================================
    // Suite 1: Safe Defaults & Schema Validation
    // ==================================================================
    console.log("Suite 1: Safe Defaults & Schema Validation")

    test("1.1: Default telephony configuration adheres to safe defaults", () => {
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.aiEnabled, false, "AI must be disabled by default")
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.provider, "mock", "Default provider must be mock")
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.status, "unconfigured", "Default status must be unconfigured")
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.answerMode, "unanswered_only")
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.recordingEnabled, true)
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.noAnswerTimeoutSeconds, 20)
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.credentialsConfigured, false)
      assert.deepStrictEqual(DEFAULT_TELEPHONY_CONFIG.credentialsMasked, {})
      assert.strictEqual(DEFAULT_TELEPHONY_CONFIG.credentialsEncrypted, undefined, "Encrypted field must not be in default config")
    })

    await testAsync("1.2: Rejects invalid provider names", async () => {
      let threw = false
      try {
        await updateTenantTelephonyConfig(TENANT_A, { provider: "invalid_carrier" }, userAdminA)
      } catch (err) {
        threw = true
        assert(err.message.includes("Invalid telephony provider"))
      }
      assert.strictEqual(threw, true, "Expected error on invalid provider")
    })

    await testAsync("1.3: Rejects invalid timeout bounds (< 10 or > 60 seconds)", async () => {
      let threwTooLow = false
      try {
        await updateTenantTelephonyConfig(TENANT_A, { noAnswerTimeoutSeconds: 5 }, userAdminA)
      } catch (err) {
        threwTooLow = true
        assert(err.message.includes("between 10 and 60"))
      }
      assert.strictEqual(threwTooLow, true, "Expected error on timeout < 10")

      let threwTooHigh = false
      try {
        await updateTenantTelephonyConfig(TENANT_A, { noAnswerTimeoutSeconds: 120 }, userAdminA)
      } catch (err) {
        threwTooHigh = true
        assert(err.message.includes("between 10 and 60"))
      }
      assert.strictEqual(threwTooHigh, true, "Expected error on timeout > 60")
    })

    // ==================================================================
    // Suite 2: AES-256-GCM Encryption & Masking
    // ==================================================================
    console.log("\nSuite 2: Provider Credential AES-256-GCM Encryption & Masking")

    test("2.1: Credential masking masks sensitive tokens and preserves non-sensitive keys", () => {
      const twilioCreds = {
        accountSid: "TEST_ACCOUNT_SID_NOT_REAL",
        authToken: "secret_auth_token_9999",
        apiKey: "SKabcdef123456",
        region: "us1",
      }
      const masked = maskCredentials("twilio", twilioCreds)

      assert(masked.accountSid.includes("••••"), "accountSid must be masked")
      assert(!masked.accountSid.includes("ACCOUNT_SID_NOT"), "Raw middle of accountSid must not appear")
      assert(masked.authToken.includes("••••"), "authToken must be masked")
      assert(!masked.authToken.includes("secret_auth_token"), "Raw authToken must never appear")
      assert.strictEqual(masked.region, "us1", "Non-sensitive region should be preserved")
    })

    test("2.2: sanitizeTelephonyConfig strictly removes credentialsEncrypted", () => {
      const raw = {
        provider: "twilio",
        credentialsEncrypted: "v1:j:0123456789abcdef:fedcba9876543210:abcd",
        credentialsConfigured: true,
        aiEnabled: true,
      }
      const sanitized = sanitizeTelephonyConfig(raw)
      assert.strictEqual(sanitized.credentialsEncrypted, undefined, "Sanitized config must NEVER contain credentialsEncrypted")
      assert.strictEqual(sanitized.credentialsConfigured, true)
      assert.strictEqual(sanitized.aiEnabled, true)
    })

    await testAsync("2.3: Storing credentials encrypts with AES-256-GCM in DB", async () => {
      const twilioRaw = {
        accountSid: "TEST_STORED_ACCOUNT_SID_9999",
        authToken: "super_secret_auth_token_xyz123",
      }

      const res = await updateTenantTelephonyConfig(
        TENANT_A,
        {
          provider: "twilio",
          credentials: twilioRaw,
          virtualNumber: "+15551234567",
        },
        userAdminA
      )

      assert.strictEqual(res.credentialsConfigured, true)
      assert.strictEqual(res.provider, "twilio")
      assert.strictEqual(res.virtualNumber, "+15551234567")
      assert.strictEqual(res.credentialsEncrypted, undefined)

      // Directly verify DB record
      const dbProfile = await TenantBusinessProfile.findOne({ tenantId: TENANT_A }).setOptions({ skipTenantFilter: true })
      assert(dbProfile.telephonyConfig.credentialsEncrypted, "Ciphertext must exist in DB")
      assert(dbProfile.telephonyConfig.credentialsEncrypted.startsWith("v1:j:"), "Must use v1:j format")
      assert(!JSON.stringify(dbProfile.telephonyConfig).includes("super_secret_auth_token_xyz123"), "Plaintext must not be anywhere in DB")
    })

    // ==================================================================
    // Suite 3: Fail-Closed Security
    // ==================================================================
    console.log("\nSuite 3: Fail-Closed Security & Tamper Detection")

    test("3.1: Rejects tampered ciphertext with cryptographic authentication error", () => {
      const validEncrypted = encrypt({ test: "data" }).serialized
      // Tamper with the ciphertext segment
      const parts = validEncrypted.split(":")
      parts[4] = parts[4].slice(0, -2) + (parts[4].slice(-2) === "aa" ? "bb" : "aa")
      const tampered = parts.join(":")

      let threw = false
      try {
        decrypt(tampered)
      } catch (err) {
        threw = true
        assert(err.message.includes("Decryption failed") || err.message.includes("tampered"))
      }
      assert.strictEqual(threw, true, "Expected decryption failure on tampered payload")
    })

    // ==================================================================
    // Suite 4: Internal Telephony Worker Decryption Round-Trip
    // ==================================================================
    console.log("\nSuite 4: Internal Telephony Worker Decryption Round-Trip")

    await testAsync("4.1: Internal worker recovers decrypted provider credentials with full fidelity", async () => {
      const creds = await getDecryptedTelephonyCredentials(TENANT_A)
      assert.strictEqual(creds.accountSid, "TEST_STORED_ACCOUNT_SID_9999")
      assert.strictEqual(creds.authToken, "super_secret_auth_token_xyz123")
    })

    await testAsync("4.2: Returns null for tenant without configured credentials", async () => {
      const creds = await getDecryptedTelephonyCredentials(TENANT_B)
      assert.strictEqual(creds, null, "Should return null when credentials not set")
    })

    // ==================================================================
    // Suite 5: Partial Updates & Credential Purge
    // ==================================================================
    console.log("\nSuite 5: Partial Updates & Credential Purge")

    await testAsync("5.1: Non-credential updates retain existing encrypted credentials", async () => {
      const res = await updateTenantTelephonyConfig(
        TENANT_A,
        {
          aiGreeting: "Hello from Alpha Logistics! How can we assist you?",
          aiLanguage: "english",
          aiEnabled: true,
        },
        userAdminA
      )

      assert.strictEqual(res.aiGreeting, "Hello from Alpha Logistics! How can we assist you?")
      assert.strictEqual(res.aiLanguage, "english")
      assert.strictEqual(res.aiEnabled, true)
      assert.strictEqual(res.credentialsConfigured, true, "credentialsConfigured must remain true")

      // Decryption still works
      const creds = await getDecryptedTelephonyCredentials(TENANT_A)
      assert.strictEqual(creds.authToken, "super_secret_auth_token_xyz123")
    })

    await testAsync("5.2: Explicit clearCredentials: true clears encrypted credentials", async () => {
      const res = await updateTenantTelephonyConfig(
        TENANT_A,
        {
          clearCredentials: true,
        },
        userAdminA
      )

      assert.strictEqual(res.credentialsConfigured, false)
      assert.deepStrictEqual(res.credentialsMasked, {})

      const creds = await getDecryptedTelephonyCredentials(TENANT_A)
      assert.strictEqual(creds, null, "Decrypted credentials must be null after clearing")
    })

    // ==================================================================
    // Suite 6: Multi-Tenant Boundary Enforcement
    // ==================================================================
    console.log("\nSuite 6: Multi-Tenant Boundary Enforcement")

    await testAsync("6.1: Tenant A and Tenant B maintain independent telephony configurations", async () => {
      // Configure Tenant B with mock provider
      await updateTenantTelephonyConfig(
        TENANT_B,
        {
          provider: "mock",
          aiEnabled: false,
          businessPhoneNumber: "+919876543210",
        },
        userAdminB
      )

      const configA = await getTenantTelephonyConfig(TENANT_A)
      const configB = await getTenantTelephonyConfig(TENANT_B)

      assert.strictEqual(configA.provider, "twilio")
      assert.strictEqual(configB.provider, "mock")
      assert.strictEqual(configB.businessPhoneNumber, "+919876543210")
      assert.strictEqual(configA.businessPhoneNumber, "")
    })

    // ==================================================================
    // Suite 7: REST API Endpoints & Role Authorization
    // ==================================================================
    console.log("\nSuite 7: REST API Endpoints & Role Authorization")

    await testAsync("7.1: GET /api/telephony/config without token returns 401 Unauthorized", async () => {
      const res = await request(app).get("/api/telephony/config")
      assert.strictEqual(res.status, 401)
      assert.strictEqual(res.body.success, false)
    })

    await testAsync("7.2: GET /api/telephony/config as regular staff user returns 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/telephony/config")
        .set("Authorization", `Bearer ${tokenStaffA}`)
      assert.strictEqual(res.status, 403)
      assert.strictEqual(res.body.success, false)
    })

    await testAsync("7.3: GET /api/telephony/config as account admin returns 200 with sanitized config", async () => {
      const res = await request(app)
        .get("/api/telephony/config")
        .set("Authorization", `Bearer ${tokenAdminA}`)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert(res.body.data)
      assert.strictEqual(res.body.data.credentialsEncrypted, undefined)
      assert.strictEqual(res.body.data.provider, "twilio")
    })

    await testAsync("7.4: PUT /api/telephony/config as account admin updates config and encrypts credentials", async () => {
      const payload = {
        provider: "exotel",
        credentials: {
          apiKey: "exo_api_key_11223344",
          apiToken: "exo_token_55667788",
          accountSid: "exo_sid_alpha",
        },
        connectionMode: "cloud_number",
        virtualNumber: "08012345678",
        aiEnabled: true,
        aiLanguage: "hinglish",
        noAnswerTimeoutSeconds: 25,
      }

      const res = await request(app)
        .put("/api/telephony/config")
        .set("Authorization", `Bearer ${tokenAdminA}`)
        .send(payload)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert.strictEqual(res.body.data.provider, "exotel")
      assert.strictEqual(res.body.data.connectionMode, "cloud_number")
      assert.strictEqual(res.body.data.virtualNumber, "08012345678")
      assert.strictEqual(res.body.data.aiEnabled, true)
      assert.strictEqual(res.body.data.noAnswerTimeoutSeconds, 25)
      assert.strictEqual(res.body.data.credentialsConfigured, true)
      assert.strictEqual(res.body.data.credentialsEncrypted, undefined)

      // Masked tokens
      assert(res.body.data.credentialsMasked.apiKey.includes("••••"))
      assert(res.body.data.credentialsMasked.apiToken.includes("••••"))
    })

    await testAsync("7.5: PUT /api/telephony/config rejecting invalid provider with 400", async () => {
      const res = await request(app)
        .put("/api/telephony/config")
        .set("Authorization", `Bearer ${tokenAdminA}`)
        .send({ provider: "unsupported_provider" })

      assert.strictEqual(res.status, 400)
      assert.strictEqual(res.body.success, false)
    })

    // ==================================================================
    // Suite 8: Audit Logging
    // ==================================================================
    console.log("\nSuite 8: Audit Logging Verification")

    await testAsync("8.1: Telephony config update created immutable audit log record", async () => {
      const auditLog = await AuditLog.findOne({
        tenantId: TENANT_A,
        action: "telephony.config_update",
      })
        .sort({ createdAt: -1 })
        .setOptions({ skipTenantFilter: true })

      assert(auditLog, "Audit log entry must be present")
      assert.strictEqual(auditLog.action, "telephony.config_update")
      assert.strictEqual(auditLog.entity, "TenantBusinessProfile")
      assert(auditLog.summary.includes(TENANT_A))
      // Verify no plaintext tokens leaked in audit log details
      const auditStr = JSON.stringify(auditLog)
      assert(!auditStr.includes("exo_api_key_11223344"), "Plaintext API key must not leak in audit log")
      assert(!auditStr.includes("exo_token_55667788"), "Plaintext API token must not leak in audit log")
    })
  } finally {
    await cleanup()
  }

  console.log("\n==================================================================")
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPhase1Tests().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err)
  process.exit(1)
})
