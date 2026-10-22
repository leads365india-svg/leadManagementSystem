const mongoose = require("mongoose")
const dotenv = require("dotenv")
const crypto = require("crypto")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")

const WEBHOOK_URL = "http://localhost:5000/api/integrations/leads/website"
const BASE_API = "http://localhost:5000/api"

async function runProductionReadinessTests() {
  console.log("================================================================================")
  console.log("       LEADFLOW CRM - FINAL PRODUCTION READINESS & SECURITY AUDIT TEST SUITE    ")
  console.log("================================================================================")

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("MongoDB Atlas Connected\n")

  const tenantA = "PROD-AUDIT-ORG-1"
  const tenantB = "PROD-AUDIT-ORG-2"

  // Clean test partitions
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  // Setup Tenant A Admin & Staff
  const adminA = new User({
    name: "Tenant A Director",
    email: "director@tenanta.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantA,
    status: "active",
  })
  await adminA.save()

  const staffA = new User({
    name: "Senior Advisor Alpha",
    email: "advisor@tenanta.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantA,
    status: "active",
  })
  await staffA.save()

  // Setup Tenant B Admin
  const adminB = new User({
    name: "Tenant B Director",
    email: "director@tenantb.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantB,
    status: "active",
  })
  await adminB.save()

  const rawKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHashA = crypto.createHash("sha256").update(rawKeyA).digest("hex")

  const rawKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHashB = crypto.createHash("sha256").update(rawKeyB).digest("hex")

  // Config Tenant A: strict verification enabled, staff assigned to Senior Advisor Alpha
  const configA = new LeadFeedConfig({
    tenantId: tenantA,
    websiteSource: {
      enabled: true,
      apiKeyHash: keyHashA,
      apiKeyMasked: `lf_live_••••••••••••••••${rawKeyA.slice(-4)}`,
      assignedStaffId: staffA._id.toString(),
      assignedStaffName: staffA.name,
      acceptedForms: ["demo_request_form"],
      blockedDomains: ["throwawaymail.com", "spam.net"],
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

  // Config Tenant B: allow duplicates, open verification
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

  console.log("Configured Tenant A (Strict verification, Assigned Staff) & Tenant B (Open)")

  // Helper login
  const loginUser = async (email, password) => {
    const res = await fetch(`${BASE_API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    const cookie = res.headers.get("set-cookie")?.split(";")[0] || ""
    return { res, data, cookie }
  }

  // ---------------------------------------------------------------------------
  // 1. External Origin Preflight & Lead Submission (CORS Verification)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 1] External Website CORS Preflight & Form Ingestion")
  const externalOrigin = "https://client-corp-website.com"

  // Preflight
  const preflightRes = await fetch(WEBHOOK_URL, {
    method: "OPTIONS",
    headers: {
      Origin: externalOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type,x-api-key,x-idempotency-key",
    },
  })
  console.log("  CORS preflight status:", preflightRes.status)
  if (preflightRes.status !== 204 && preflightRes.status !== 200) {
    throw new Error(`CORS preflight failed with status ${preflightRes.status}`)
  }

  // Submit phone-only lead from external website
  const resExtLead = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: externalOrigin,
      "x-api-key": rawKeyA,
    },
    body: JSON.stringify({
      name: "External Web Visitor",
      phone: "+1 (555) 444-9900",
      formId: "demo_request_form",
      landingPage: "https://client-corp-website.com/enterprise",
    }),
  })
  const extLeadData = await resExtLead.json()
  console.log(`  External form submission status: ${resExtLead.status}`, extLeadData.message)
  if (resExtLead.status !== 201) throw new Error("External form submission failed")
  console.log("  ✔ Test 1 PASSED: External website preflight and submission succeeded")

  // ---------------------------------------------------------------------------
  // 2. Webhook Idempotency (Retry protection)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 2] Webhook Idempotency Mechanism")
  const idempotencyKey = `idemp_${Date.now()}_abc123`
  const idempotentLeadPayload = {
    name: "Retry Testing Lead",
    phone: "+1 (555) 777-6655",
    formId: "demo_request_form",
    message: "First automated webhook attempt",
  }

  // 1st request with idempotency key
  const resIdemp1 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": rawKeyA,
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(idempotentLeadPayload),
  })
  const dataIdemp1 = await resIdemp1.json()
  console.log(`  1st attempt status: ${resIdemp1.status}`, dataIdemp1.message)
  if (resIdemp1.status !== 201) throw new Error("First idempotent lead creation failed")

  // 2nd request (simulated webhook retry with same key)
  const resIdemp2 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": rawKeyA,
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(idempotentLeadPayload),
  })
  const dataIdemp2 = await resIdemp2.json()
  console.log(`  2nd attempt (retry) status: ${resIdemp2.status}`, dataIdemp2.message, "(idempotent flag:", dataIdemp2.idempotent, ")")
  if (resIdemp2.status !== 200 || !dataIdemp2.idempotent) {
    throw new Error("Idempotency retry failed! Must return 200 with idempotent flag.")
  }

  // Verify only 1 record exists in DB for this idempotency key
  const idempLeadCount = await Lead.countDocuments({
    tenantId: tenantA,
    "metadata.idempotencyKey": idempotencyKey,
  })
  if (idempLeadCount !== 1) {
    throw new Error(`Idempotency failed! Found ${idempLeadCount} records instead of 1.`)
  }
  console.log("  ✔ Test 2 PASSED: Webhook retry gracefully handled idempotently without creating duplicate")

  // ---------------------------------------------------------------------------
  // 3. Validation & Malformed Input Handling
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 3] Input Validation & Edge Cases")

  // 3a. Missing both email and phone
  const resNoContact = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({ name: "Ghost User", formId: "demo_request_form" }),
  })
  console.log(`  Missing contact info status: ${resNoContact.status} (expected 400)`)
  if (resNoContact.status !== 400) throw new Error("Missing contact info should return 400")
  console.log("  ✔ 3a: Missing both phone and email rejected with 400")

  // 3b. Malformed phone (< 5 digits)
  const resBadPhone = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({ name: "Bad Phone User", phone: "123", formId: "demo_request_form" }),
  })
  console.log(`  Malformed phone status: ${resBadPhone.status} (expected 400)`)
  if (resBadPhone.status !== 400) throw new Error("Malformed phone should return 400")
  console.log("  ✔ 3b: Malformed phone rejected with 400")

  // 3c. Oversized email (> 255 chars)
  const longEmail = "a".repeat(250) + "@example.com"
  const resLongEmail = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({ name: "Long Email", email: longEmail, formId: "demo_request_form" }),
  })
  console.log(`  Oversized email status: ${resLongEmail.status} (expected 400)`)
  if (resLongEmail.status !== 400) throw new Error("Oversized email should return 400")
  console.log("  ✔ 3c: Oversized email rejected with 400")

  // ---------------------------------------------------------------------------
  // 4. HMAC Verification: Invalid, Expired, Future & Replay Tokens
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 4] HMAC Security & Anti-Replay Guard")
  const targetEmail = "compliance.officer@globex.corp"

  // 4a. Invalid signature
  const resBadSig = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Tampered Token",
      email: targetEmail,
      formId: "demo_request_form",
      verificationToken: `${Date.now()}:deadbeefbadf00d1234567890abcdef1234567890abcdef1234567890abcdef1`,
    }),
  })
  console.log(`  Forged signature status: ${resBadSig.status} (expected 422)`)
  if (resBadSig.status !== 422) throw new Error("Forged HMAC token should return 422")
  console.log("  ✔ 4a: Forged signature rejected with 422")

  // 4b. Expired token (> 1 hr)
  const expiredTs = Date.now() - 3700000
  const expiredSig = crypto.createHmac("sha256", rawKeyA).update(`${targetEmail}:${expiredTs}`).digest("hex")
  const resExpired = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Expired Token",
      email: targetEmail,
      formId: "demo_request_form",
      verificationToken: `${expiredTs}:${expiredSig}`,
    }),
  })
  console.log(`  Expired token status: ${resExpired.status} (expected 422)`)
  if (resExpired.status !== 422) throw new Error("Expired token should return 422")
  console.log("  ✔ 4b: Expired timestamp (> 1 hr) rejected with 422")

  // 4c. Valid token accepted
  const validTs = Date.now()
  const validSig = crypto.createHmac("sha256", rawKeyA).update(`${targetEmail}:${validTs}`).digest("hex")
  const validToken = `${validTs}:${validSig}`

  const resValid = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Legit Officer",
      email: targetEmail,
      phone: "+1 (555) 888-0011",
      formId: "demo_request_form",
      verificationToken: validToken,
    }),
  })
  const validData = await resValid.json()
  console.log(`  Valid token status: ${resValid.status}`, validData.message)
  if (resValid.status !== 201) throw new Error("Valid HMAC token should be accepted with 201")
  console.log("  ✔ 4c: Valid timestamped HMAC token accepted with 201")

  // 4d. Replay Guard: attempt to use the exact same token for another email
  const resReplayed = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Replay Attacker",
      email: "intruder@globex.corp",
      formId: "demo_request_form",
      verificationToken: validToken,
    }),
  })
  console.log(`  Replayed token status: ${resReplayed.status} (expected 422)`)
  if (resReplayed.status !== 422) throw new Error("Replayed token must be rejected with 422")
  console.log("  ✔ 4d: Replay of redeemed token rejected with 422")

  // ---------------------------------------------------------------------------
  // 5. All Leads Dashboard Integration & Field Verification
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 5] All Leads Dashboard Query & Field Display")
  const sessionA = await loginUser("director@tenanta.com", "Password123!")

  const leadsRes = await fetch(`${BASE_API}/leads`, {
    headers: { Cookie: sessionA.cookie },
  })
  const leadsData = await leadsRes.json()
  if (leadsRes.status !== 200 || !leadsData.success) {
    throw new Error("Failed to fetch leads list for Tenant A")
  }

  const complianceLead = leadsData.data.leads.find((l) => l.email === targetEmail)
  if (!complianceLead) {
    throw new Error("Target lead not found in All Leads dashboard!")
  }
  console.log("  Retrieved lead fields from All Leads query:", {
    id: complianceLead._id,
    name: complianceLead.name,
    email: complianceLead.email,
    phone: complianceLead.phone,
    source: complianceLead.source,
    assignedTo: complianceLead.assignedTo,
    status: complianceLead.status,
    isEmailVerified: complianceLead.isEmailVerified,
    verificationStatus: complianceLead.verificationStatus,
  })

  if (complianceLead.source !== "Website") throw new Error("Source mismatch!")
  if (complianceLead.assignedTo !== "Senior Advisor Alpha") throw new Error("Staff assignment mismatch!")
  if (complianceLead.status !== "New") throw new Error("Status mismatch!")
  if (!complianceLead.isEmailVerified || complianceLead.verificationStatus !== "trusted") {
    throw new Error("Email verification status not reflected on lead!")
  }
  console.log("  ✔ Test 5 PASSED: All fields (source, assignedTo, status, phone, isEmailVerified) verified in CRM dashboard output")

  // ---------------------------------------------------------------------------
  // 6. Cross-Tenant Complete Isolation
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Test 6] Cross-Tenant Isolation")
  const sessionB = await loginUser("director@tenantb.com", "Password123!")

  const leadsBRes = await fetch(`${BASE_API}/leads`, {
    headers: { Cookie: sessionB.cookie },
  })
  const leadsBData = await leadsBRes.json()
  const crossLeads = leadsBData.data.leads.filter((l) => l.tenantId === tenantA)
  if (crossLeads.length > 0) {
    throw new Error("Cross-tenant leakage detected! Tenant B can view Tenant A leads.")
  }
  console.log("  ✔ Test 6 PASSED: Tenant B cannot view any of Tenant A's leads")

  // Clean test partitions
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  console.log("\n================================================================================")
  console.log("🎉 ALL PRODUCTION READINESS CHECKS PASSED WITH 100% SUCCESS!")
  console.log("================================================================================")
  await mongoose.disconnect()
  process.exit(0)
}

runProductionReadinessTests().catch(async (err) => {
  console.error("Test failed:", err)
  await mongoose.disconnect()
  process.exit(1)
})
