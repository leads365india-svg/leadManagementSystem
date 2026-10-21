const mongoose = require("mongoose")
const dotenv = require("dotenv")
const crypto = require("crypto")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")

const BACKEND_URL = "http://localhost:5000/api/integrations/leads/website"

async function runEdgeCases() {
  console.log("=== RUNNING EXTERNAL ORIGIN, EDGE CASES & REPLAY PROTECTION TESTS ===")
  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected to MongoDB Atlas\n")

  const tenantA = "PROD-AUDIT-TENANT-1"
  const tenantB = "PROD-AUDIT-TENANT-2"

  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  const rawKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHashA = crypto.createHash("sha256").update(rawKeyA).digest("hex")

  const rawKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHashB = crypto.createHash("sha256").update(rawKeyB).digest("hex")

  // Tenant A: allows phone only, strict verification enabled
  const configA = new LeadFeedConfig({
    tenantId: tenantA,
    websiteSource: {
      enabled: true,
      apiKeyHash: keyHashA,
      apiKeyMasked: `lf_live_••••••••••••••••${rawKeyA.slice(-4)}`,
      assignedStaffId: "unassigned",
      assignedStaffName: "Unassigned",
      acceptedForms: [],
      blockedDomains: [],
      duplicateHandling: "reject",
      emailVerification: {
        requireVerifiedEmail: true,
        holdUntilConfirmed: false,
        strictVerification: true,
        allowPhoneOnly: true,
      },
    },
  })
  await configA.save()

  // Tenant B: allow duplicates, open email
  const configB = new LeadFeedConfig({
    tenantId: tenantB,
    websiteSource: {
      enabled: true,
      apiKeyHash: keyHashB,
      apiKeyMasked: `lf_live_••••••••••••••••${rawKeyB.slice(-4)}`,
      assignedStaffId: "unassigned",
      assignedStaffName: "Unassigned",
      acceptedForms: [],
      blockedDomains: [],
      duplicateHandling: "allow",
      emailVerification: {
        requireVerifiedEmail: false,
        holdUntilConfirmed: false,
        strictVerification: false,
        allowPhoneOnly: true,
      },
    },
  })
  await configB.save()

  console.log("Tenants configured.")

  // 1. External Origin Submission (simulating real website https://my-marketing-site.com)
  const externalOrigin = "https://my-marketing-site.com"
  const phoneOnlyLead = {
    name: "External Mobile Visitor",
    phone: "+1 (555) 888-1212",
    formId: "callback_form",
    landingPage: "https://my-marketing-site.com/get-started",
  }

  const resExternal = await fetch(BACKEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: externalOrigin,
      "x-api-key": rawKeyA,
    },
    body: JSON.stringify(phoneOnlyLead),
  })

  const dataExternal = await resExternal.json()
  console.log(`[Test 1: External Origin Phone-Only Lead] status: ${resExternal.status}`, dataExternal.message || dataExternal.error)
  if (resExternal.status !== 201) throw new Error("External origin submission failed")
  console.log("✔ Test 1 PASSED: External website origin accepted and phone-only lead created")

  // 2. Second Phone-Only Lead with DIFFERENT phone (neither has email)
  const secondPhoneLead = {
    name: "Second Mobile Visitor",
    phone: "+1 (555) 777-3434",
    formId: "callback_form",
  }

  const resSecondPhone = await fetch(BACKEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": rawKeyA,
    },
    body: JSON.stringify(secondPhoneLead),
  })
  if (resSecondPhone.status !== 201) {
    throw new Error("Second phone-only lead failed! Empty email conflict detected in database indexes.")
  }
  console.log("✔ Test 2 PASSED: Multiple phone-only leads with empty email do NOT collide in MongoDB indexes")

  // 3. Strict HMAC Email Verification & Timestamp Expiration
  const testEmail = "executive@enterprise.org"

  // 3a. Expired timestamp (> 1 hour old)
  const expiredTimestamp = Date.now() - 3700000 // 1 hour + 100 seconds ago
  const expiredSig = crypto.createHmac("sha256", rawKeyA).update(`${testEmail}:${expiredTimestamp}`).digest("hex")
  const expiredToken = `${expiredTimestamp}:${expiredSig}`

  const resExpired = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Expired Token Lead",
      email: testEmail,
      verificationToken: expiredToken,
    }),
  })
  if (resExpired.status !== 422) {
    throw new Error(`Expired token should be rejected with 422! Got status ${resExpired.status}`)
  }
  console.log("✔ Test 3a PASSED: Expired HMAC token (> 1 hr) rejected with 422")

  // 3b. Future timestamp (> 60s ahead)
  const futureTimestamp = Date.now() + 120000 // 2 minutes in future
  const futureSig = crypto.createHmac("sha256", rawKeyA).update(`${testEmail}:${futureTimestamp}`).digest("hex")
  const futureToken = `${futureTimestamp}:${futureSig}`

  const resFuture = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Future Token Lead",
      email: testEmail,
      verificationToken: futureToken,
    }),
  })
  if (resFuture.status !== 422) {
    throw new Error(`Future token should be rejected with 422! Got status ${resFuture.status}`)
  }
  console.log("✔ Test 3b PASSED: Future timestamp token (> 60s) rejected with 422")

  // 3c. Valid timestamped token
  const validTimestamp = Date.now()
  const validSig = crypto.createHmac("sha256", rawKeyA).update(`${testEmail}:${validTimestamp}`).digest("hex")
  const validToken = `${validTimestamp}:${validSig}`

  const resValid = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Valid Token Lead",
      email: testEmail,
      verificationToken: validToken,
    }),
  })
  if (resValid.status !== 201) {
    throw new Error(`Valid timestamped token should be accepted with 201! Got status ${resValid.status}`)
  }
  console.log("✔ Test 3c PASSED: Valid timestamped HMAC token accepted with 201")

  // 3d. Replay Attack: submit the EXACT same timestamped token again with a different name
  // Note: under duplicateHandling="reject", same email would be caught by duplicate check,
  // but let's test replay on Tenant B or with replay protection explicitly
  const resReplay = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Replay Attacker",
      email: "attacker@enterprise.org",
      verificationToken: validToken, // Token was issued for testEmail, not attacker!
    }),
  })
  if (resReplay.status !== 422) {
    throw new Error(`Replay of token for different email must return 422! Got status ${resReplay.status}`)
  }
  console.log("✔ Test 3d PASSED: Replay or reuse of HMAC token for another email rejected with 422")

  // 4. Duplicate Handling under 'allow' policy in Tenant B (allowing duplicates without database index collision)
  const dupEmail = "customer@duplicate-ok.com"
  const resDup1 = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyB },
    body: JSON.stringify({ name: "First Entry", email: dupEmail, phone: "+1 800 111 2222" }),
  })
  const resDup2 = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyB },
    body: JSON.stringify({ name: "Second Entry", email: dupEmail, phone: "+1 800 111 2222" }),
  })
  if (resDup1.status !== 201 || resDup2.status !== 201) {
    throw new Error("Duplicate allowed policy failed! Check database index constraints.")
  }
  console.log("✔ Test 4 PASSED: Under 'allow' policy, multiple leads with identical email/phone persist without index collision")

  // 5. Clean up
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  console.log("\n=======================================================")
  console.log("🎉 ALL EDGE CASE & EXTERNAL ORIGIN TESTS PASSED 100%!")
  console.log("=======================================================")
  await mongoose.disconnect()
  process.exit(0)
}

runEdgeCases().catch(async (e) => {
  console.error("Test failed:", e)
  await mongoose.disconnect()
  process.exit(1)
})
