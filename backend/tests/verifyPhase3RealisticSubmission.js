const mongoose = require("mongoose")
const dotenv = require("dotenv")
const crypto = require("crypto")
const path = require("path")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")

const WEBHOOK_URL = "http://localhost:5000/api/integrations/leads/website"
const BASE_API = "http://localhost:5000/api"

async function runPhase3ExternalSubmissionVerification() {
  console.log("================================================================================")
  console.log("    LEADFLOW CRM — PHASE 3: REALISTIC EXTERNAL INTEGRATION VERIFICATION       ")
  console.log("================================================================================")

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("MongoDB Atlas Connected\n")

  const tenantA = "PHASE3-TEST-ORG"
  const tenantB = "PHASE3-OTHER-ORG"

  // 1. Clean previous test runs for isolation
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  // 2. Provision Tenant A admin & assigned sales rep
  const adminA = new User({
    name: "Tenant A Director",
    email: "director@phase3-a.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantA,
    status: "active",
  })
  await adminA.save()

  const salesRepA = new User({
    name: "Sarah Sales",
    email: "sarah@phase3-a.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantA,
    status: "active",
  })
  await salesRepA.save()

  // 3. Provision Tenant B admin
  const adminB = new User({
    name: "Tenant B Director",
    email: "director@phase3-b.com",
    password: "Password123!",
    role: "account_admin",
    tenantId: tenantB,
    status: "active",
  })
  await adminB.save()

  // 4. Generate Integration Key for Tenant A
  const rawKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
  const keyHashA = crypto.createHash("sha256").update(rawKeyA).digest("hex")

  const configA = new LeadFeedConfig({
    tenantId: tenantA,
    websiteSource: {
      enabled: true,
      apiKeyHash: keyHashA,
      apiKeyMasked: `lf_live_••••••••••••••••${rawKeyA.slice(-4)}`,
      assignedStaffId: salesRepA._id.toString(),
      assignedStaffName: salesRepA.name,
      acceptedForms: ["pricing_inquiry_form"],
      blockedDomains: ["throwawaymail.com"],
      duplicateHandling: "reject",
      emailVerification: {
        requireVerifiedEmail: false,
        holdUntilConfirmed: false,
        strictVerification: false,
        allowPhoneOnly: true,
      },
    },
  })
  await configA.save()

  console.log(`Configured Tenant A (${tenantA}) with staff assignment to 'Sarah Sales'`)
  console.log(`Configured Tenant B (${tenantB}) as isolated competitor tenant\n`)

  // Helper login to simulate web browser dashboard sessions
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
  // Check 1 & 2: Submit lead from external integration client & verify API response
  // ---------------------------------------------------------------------------
  console.log("▶ [Check 1 & 2] External Website Form Submission & Response Verification")
  const externalOrigin = "https://client-portal.example.com"
  const idempotencyKey = `ext_sub_${Date.now()}_9948`

  // CORS Preflight
  const preflightRes = await fetch(WEBHOOK_URL, {
    method: "OPTIONS",
    headers: {
      Origin: externalOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type,x-api-key,x-idempotency-key",
    },
  })
  console.log("  CORS preflight response code:", preflightRes.status)
  if (preflightRes.status !== 204 && preflightRes.status !== 200) {
    throw new Error(`CORS preflight failed with HTTP ${preflightRes.status}`)
  }

  // Inbound Webhook POST
  const externalLeadPayload = {
    name: "Dr. Alexander Wright",
    email: "alexander.wright@medicalcorp.com",
    phone: "+1 (555) 789-0123",
    message: "Requesting a quote for enterprise clinical software package.",
    formId: "pricing_inquiry_form",
    landingPage: "https://client-portal.example.com/clinical-plans",
  }

  const postRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: externalOrigin,
      Referer: "https://client-portal.example.com/clinical-plans",
      "x-api-key": rawKeyA,
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(externalLeadPayload),
  })

  const postData = await postRes.json()
  console.log(`  Webhook submission response code: ${postRes.status}`, postData)
  if (postRes.status !== 201 || !postData.success) {
    throw new Error(`Webhook submission failed with HTTP ${postRes.status}`)
  }
  const createdLeadId = postData.data.id
  console.log(`  ✔ Check 1 & 2 PASSED: External client successfully submitted lead (ID: ${createdLeadId})`)

  // ---------------------------------------------------------------------------
  // Check 3: Verify the lead is saved in the correct tenant partition
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Check 3] MongoDB Tenant Partition Verification")
  const savedLeadInDb = await Lead.findById(createdLeadId)
  if (!savedLeadInDb) {
    throw new Error("Created lead could not be found in MongoDB!")
  }
  console.log("  Lead in MongoDB:", {
    _id: savedLeadInDb._id.toString(),
    name: savedLeadInDb.name,
    email: savedLeadInDb.email,
    tenantId: savedLeadInDb.tenantId,
    source: savedLeadInDb.source,
    assignedTo: savedLeadInDb.assignedTo,
    assignedStaffId: savedLeadInDb.assignedStaffId,
  })

  if (savedLeadInDb.tenantId !== tenantA) {
    throw new Error(`Tenant mismatch! Expected ${tenantA}, found ${savedLeadInDb.tenantId}`)
  }
  console.log("  ✔ Check 3 PASSED: Lead partition strictly confirmed as Tenant A")

  // ---------------------------------------------------------------------------
  // Check 4 & 5: Verify lead appears in All Leads dashboard with configured fields
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Check 4 & 5] All Leads Dashboard Query & Configured Field Verification")
  const sessionA = await loginUser("director@phase3-a.com", "Password123!")

  const dashboardRes = await fetch(`${BASE_API}/leads`, {
    headers: { Cookie: sessionA.cookie },
  })
  const dashboardData = await dashboardRes.json()
  if (dashboardRes.status !== 200 || !dashboardData.success) {
    throw new Error("Failed to load All Leads dashboard for Tenant A")
  }

  const matchingDashboardLead = dashboardData.data.leads.find((l) => l.email === externalLeadPayload.email)
  if (!matchingDashboardLead) {
    throw new Error("Submitted lead does not appear in Tenant A All Leads view!")
  }

  console.log("  Retrieved Lead in All Leads view:", {
    id: matchingDashboardLead._id,
    name: matchingDashboardLead.name,
    email: matchingDashboardLead.email,
    phone: matchingDashboardLead.phone,
    source: matchingDashboardLead.source,
    status: matchingDashboardLead.status,
    assignedTo: matchingDashboardLead.assignedTo,
  })

  if (matchingDashboardLead.source !== "Website") {
    throw new Error(`Expected source 'Website', found '${matchingDashboardLead.source}'`)
  }
  if (matchingDashboardLead.status !== "New") {
    throw new Error(`Expected status 'New', found '${matchingDashboardLead.status}'`)
  }
  if (matchingDashboardLead.assignedTo !== "Sarah Sales") {
    throw new Error(`Expected staff assignment 'Sarah Sales', found '${matchingDashboardLead.assignedTo}'`)
  }
  console.log("  ✔ Check 4 & 5 PASSED: Lead appears in All Leads with source='Website', status='New', assignedTo='Sarah Sales'")

  // ---------------------------------------------------------------------------
  // Check 6: Verify a retry does not create another lead (Idempotency)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Check 6] Webhook Delivery Retry & Idempotency Verification")
  const retryRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: externalOrigin,
      "x-api-key": rawKeyA,
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(externalLeadPayload),
  })

  const retryData = await retryRes.json()
  console.log(`  Retry response code: ${retryRes.status} (idempotent: ${retryData.idempotent})`)
  if (retryRes.status !== 200 || !retryData.idempotent) {
    throw new Error("Retry was not handled idempotently!")
  }

  const totalLeadsWithEmail = await Lead.countDocuments({
    tenantId: tenantA,
    email: externalLeadPayload.email,
  })
  if (totalLeadsWithEmail !== 1) {
    throw new Error(`Duplicate lead created! Total leads with email: ${totalLeadsWithEmail}`)
  }
  console.log("  ✔ Check 6 PASSED: Automated retry returned HTTP 200 idempotent response without duplicating lead")

  // ---------------------------------------------------------------------------
  // Check 7: Verify another tenant cannot access or view the test lead
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Check 7] Cross-Tenant Isolation Verification")
  const sessionB = await loginUser("director@phase3-b.com", "Password123!")

  // 7a. Query Tenant B leads list
  const leadsBRes = await fetch(`${BASE_API}/leads`, {
    headers: { Cookie: sessionB.cookie },
  })
  const leadsBData = await leadsBRes.json()
  const leakedLeads = leadsBData.data.leads.filter((l) => l.email === externalLeadPayload.email)
  if (leakedLeads.length > 0) {
    throw new Error("Cross-tenant leak detected! Tenant B can view Tenant A lead.")
  }

  // 7b. Attempt direct access to lead ID from Tenant B session
  const directAccessRes = await fetch(`${BASE_API}/leads/${createdLeadId}`, {
    headers: { Cookie: sessionB.cookie },
  })
  console.log(`  Direct access to Tenant A lead by Tenant B returned code: ${directAccessRes.status} (expected 404)`)
  if (directAccessRes.status !== 404) {
    throw new Error(`Tenant B was able to fetch Tenant A lead by ID! Status: ${directAccessRes.status}`)
  }
  console.log("  ✔ Check 7 PASSED: Tenant B is completely isolated and cannot access Tenant A's lead")

  // ---------------------------------------------------------------------------
  // Check 8: Verify isTest diagnostic exclusion from standard dashboard
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Check 8] Diagnostic Test Lead Exclusion Verification")
  // Simulate a test diagnostic submission with isTest: true
  const testSubRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": rawKeyA },
    body: JSON.stringify({
      name: "Mock Diagnostic Lead",
      email: "mock-diag@example.com",
      phone: "+1 555 000 1111",
      formId: "pricing_inquiry_form",
      isTest: true,
    }),
  })
  const testSubData = await testSubRes.json()
  console.log(`  Diagnostic test submission response code: ${testSubRes.status} (isTest: ${testSubData.isTest})`)
  if (testSubRes.status !== 200 || !testSubData.isTest) {
    throw new Error("Diagnostic test lead submission should return 200 with isTest flag")
  }

  const diagCountInDb = await Lead.countDocuments({
    tenantId: tenantA,
    email: "mock-diag@example.com",
  })
  if (diagCountInDb !== 0) {
    throw new Error(`Diagnostic lead should not be saved in database! Found ${diagCountInDb} records.`)
  }
  console.log("  ✔ Check 8 PASSED: Diagnostic test submissions validate pipeline without creating records in database")

  // 5. Cleanup test partitions
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  console.log("\n================================================================================")
  console.log("🎉 ALL 8 REALISTIC EXTERNAL INTEGRATION CHECKS PASSED WITH 100% SUCCESS!")
  console.log("================================================================================")
  await mongoose.disconnect()
  process.exit(0)
}

runPhase3ExternalSubmissionVerification().catch(async (err) => {
  console.error("Test failed:", err)
  await mongoose.disconnect()
  process.exit(1)
})
