const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const connectDB = require("../db/connection")
const User = require("../models/User")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const leadService = require("../services/leadService")
const { normalizePhoneE164, isValidE164 } = require("../utils/phoneNormalizer")
const { migrateLeadModelV2 } = require("../scripts/migrateLeadModelV2")
const { runWithTenantContext } = require("../middleware/tenantContext")
const app = require("../start")

/**
 * Automated Verification Suite for Roadmap Phase 6: Lead Model v2 & Shared Lead Service
 */

const TEST_TAG = `p6_${Date.now()}`
const TENANT_A = `tenant_p6_a_${Date.now()}`
const TENANT_B = `tenant_p6_b_${Date.now()}`

let adminAUser = null
let agentAUser = null
let adminBUser = null

let adminAToken = null
let adminBToken = null

const getClientCookie = (res) => {
  const setCookie = res.headers["set-cookie"]
  if (!setCookie) return ""
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
  const clientCookie = cookies.find((c) => c.startsWith("client_token="))
  return clientCookie ? clientCookie.split(";")[0] : ""
}

const cleanupData = async () => {
  try {
    await runWithTenantContext({ isSuperAdmin: true }, async () => {
      await User.deleteMany({ email: new RegExp(TEST_TAG, "i") })
      await Lead.deleteMany({ email: new RegExp(TEST_TAG, "i") })
      await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
    })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runPhase6Tests() {
  console.log("================================================================================")
  console.log("   AUTOMATED VERIFICATION SUITE: PHASE 6 — LEAD MODEL V2 & SHARED LEAD SERVICE   ")
  console.log("================================================================================\n")

  let passedTests = 0
  let failedTests = 0

  const recordTest = (suite, description, condition, errorMsg = "") => {
    if (condition) {
      console.log(`  ✅ [PASS] ${suite} -> ${description}`)
      passedTests++
    } else {
      console.error(`  ❌ [FAIL] ${suite} -> ${description} | ${errorMsg}`)
      failedTests++
    }
  }

  try {
    await connectDB()
    await cleanupData()

    const adminAUserId = new mongoose.Types.ObjectId()
    const adminBUserId = new mongoose.Types.ObjectId()

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Phase 6 Tenant Alpha",
        displayName: "Tenant Alpha",
        adminName: "Admin Phase6 A",
        adminEmail: `adminA_${TEST_TAG}@test.com`,
        adminUserId: adminAUserId,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Phase 6 Tenant Beta",
        displayName: "Tenant Beta",
        adminName: "Admin Phase6 B",
        adminEmail: `adminB_${TEST_TAG}@test.com`,
        adminUserId: adminBUserId,
        status: "active",
      },
    ])

    adminAUser = await User.create({
      _id: adminAUserId,
      name: "Admin Phase6 A",
      email: `adminA_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    agentAUser = await User.create({
      name: "Agent Phase6 A",
      email: `agentA_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
      isActive: true,
    })

    adminBUser = await User.create({
      _id: adminBUserId,
      name: "Admin Phase6 B",
      email: `adminB_${TEST_TAG}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
      isActive: true,
    })

    const loginResA = await request(app)
      .post("/api/auth/login")
      .send({ email: `adminA_${TEST_TAG}@test.com`, password: "Password123!" })
    adminAToken = getClientCookie(loginResA)

    const loginResB = await request(app)
      .post("/api/auth/login")
      .send({ email: `adminB_${TEST_TAG}@test.com`, password: "Password123!" })
    adminBToken = getClientCookie(loginResB)

    // =========================================================================
    // SUITE 1: Phone Normalizer Utility (E.164)
    // =========================================================================
    console.log("\n--- Suite 1: Phone Normalizer Utility (E.164) ---")

    const test1_1 = normalizePhoneE164("9876543210") === "+919876543210"
    recordTest("Suite 1", "Normalizes 10-digit Indian number with default +91 prefix", test1_1)

    const test1_2 = normalizePhoneE164("09876543210") === "+919876543210"
    recordTest("Suite 1", "Strips leading 0 from 11-digit Indian number", test1_2)

    const test1_3 = normalizePhoneE164("+91 98765-43210") === "+919876543210"
    recordTest("Suite 1", "Strips spaces and hyphens from Indian number with +91", test1_3)

    const test1_4 = normalizePhoneE164("00919876543210") === "+919876543210"
    recordTest("Suite 1", "Converts international 00 prefix to +", test1_4)

    const test1_5 = normalizePhoneE164("+1 (555) 123-4567") === "+15551234567"
    recordTest("Suite 1", "Preserves valid US E.164 international phone format", test1_5)

    const test1_6 = normalizePhoneE164("123") === "" && normalizePhoneE164("") === ""
    recordTest("Suite 1", "Returns empty string for invalid short or empty input", test1_6)

    const test1_7 = isValidE164("+919876543210") === true && isValidE164("9876543210") === false
    recordTest("Suite 1", "isValidE164 accurately verifies strict E.164 formatting", test1_7)

    // =========================================================================
    // SUITE 2: Lead Model v2 Schema & Pre-Save Hooks
    // =========================================================================
    console.log("\n--- Suite 2: Lead Model v2 Schema & Pre-Save Hooks ---")

    const leadDoc = new Lead({
      name: "Schema Test Lead",
      email: `schema_${TEST_TAG}@test.com`,
      phone: "9876543210",
      company: "Acme Corp",
      city: "Mumbai",
      alternatePhone: "02223456789",
      tenantId: TENANT_A,
      tags: ["vip", "enterprise"],
      assignedStaffId: agentAUser._id.toString(),
    })
    await leadDoc.save()

    const test2_1 = leadDoc.phoneNormalized === "+919876543210"
    recordTest("Suite 2", "Pre-save hook automatically computes phoneNormalized to E.164", test2_1)

    const test2_2 = leadDoc.metadata?.company === "Acme Corp" && leadDoc.company === "Acme Corp"
    recordTest("Suite 2", "Pre-save hook synchronizes company to metadata.company", test2_2)

    const test2_3 = leadDoc.ownerId && leadDoc.ownerId.toString() === agentAUser._id.toString()
    recordTest("Suite 2", "Pre-save hook populates ownerId from assignedStaffId", test2_3)

    const test2_4 = Array.isArray(leadDoc.tags) && leadDoc.tags.includes("vip")
    recordTest("Suite 2", "Lead model correctly persists array of tags", test2_4)

    // Check compound indexes
    const leadIndexes = await Lead.collection.indexes()
    const hasPhoneNormIdx = leadIndexes.some((idx) => idx.key.tenantId === 1 && idx.key.phoneNormalized === 1)
    const hasOwnerStatusIdx = leadIndexes.some((idx) => idx.key.tenantId === 1 && idx.key.ownerId === 1 && idx.key.status === 1)
    const hasSourceCreatedIdx = leadIndexes.some((idx) => idx.key.tenantId === 1 && idx.key.sourceId === 1 && idx.key.createdAt === -1)
    recordTest("Suite 2", "Required compound index { tenantId: 1, phoneNormalized: 1 } exists", hasPhoneNormIdx)
    recordTest("Suite 2", "Required compound index { tenantId: 1, ownerId: 1, status: 1 } exists", hasOwnerStatusIdx)
    recordTest("Suite 2", "Required compound index { tenantId: 1, sourceId: 1, createdAt: -1 } exists", hasSourceCreatedIdx)

    // =========================================================================
    // SUITE 3: Shared Lead Service — Lead Creation & Attribution
    // =========================================================================
    console.log("\n--- Suite 3: Shared Lead Service — Creation & Attribution ---")

    let failClosedBlocked = false
    try {
      await leadService.createOrMergeLead({
        tenantId: "",
        payload: { name: "No Tenant", email: `notenant_${TEST_TAG}@test.com` },
      })
    } catch (err) {
      failClosedBlocked = true
    }
    recordTest("Suite 3", "leadService.createOrMergeLead fails closed if tenant context is missing", failClosedBlocked)

    const createdResult = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Google Ads",
      payload: {
        name: "Attribution Prospect",
        email: `attr_${TEST_TAG}@test.com`,
        phone: "9123456780",
        company: "Alpha Global",
        city: "Delhi",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "brand_search",
        gclid: "test_gclid_12345",
        landingPage: "https://example.com/demo",
      },
      actor: adminAUser,
    })

    const test3_1 = createdResult.action === "created" && createdResult.lead._id
    recordTest("Suite 3", "Successfully creates new lead with action 'created'", test3_1)

    const firstTouch = createdResult.lead.attribution?.firstTouch
    const test3_2 = firstTouch &&
      firstTouch.source === "google" &&
      firstTouch.medium === "cpc" &&
      firstTouch.campaign === "brand_search" &&
      firstTouch.gclid === "test_gclid_12345" &&
      firstTouch.landingPage === "https://example.com/demo"
    recordTest("Suite 3", "Captures complete marketing attribution touches on firstTouch", test3_2)

    // =========================================================================
    // SUITE 4: Duplicate Detection & Conflict Handling
    // =========================================================================
    console.log("\n--- Suite 4: Duplicate Detection & Conflict Handling ---")

    // 4.1 Duplicate Rejected on Email
    const dupEmailRes = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Facebook Ads",
      payload: {
        name: "Duplicate Email Lead",
        email: `attr_${TEST_TAG}@test.com`,
        phone: "9988776655",
      },
      options: { duplicateHandling: "reject" },
    })
    recordTest(
      "Suite 4",
      "duplicateHandling='reject' rejects duplicate email with action 'duplicate_rejected'",
      dupEmailRes.action === "duplicate_rejected"
    )

    // 4.2 Duplicate Rejected on Phone (even with different format e.g. 09123456780)
    const dupPhoneRes = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Referral",
      payload: {
        name: "Duplicate Phone Lead",
        email: `different_email_${TEST_TAG}@test.com`,
        phone: "09123456780", // Matches 9123456780 normalized to +919123456780
      },
      options: { duplicateHandling: "reject" },
    })
    recordTest(
      "Suite 4",
      "duplicateHandling='reject' detects duplicate normalized phone number and rejects",
      dupPhoneRes.action === "duplicate_rejected"
    )

    // 4.3 Duplicate Merge / Update Policy (Write-once firstTouch, updated lastTouch)
    const mergeRes = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Meta Ads",
      payload: {
        name: "Attribution Prospect Updated",
        email: `attr_${TEST_TAG}@test.com`,
        company: "Alpha Global Enterprises",
        city: "New Delhi",
        tags: ["retargeted"],
        message: "Customer re-submitted form requesting quote",
        utm_source: "facebook",
        utm_medium: "paid_social",
        utm_campaign: "reengagement_q4",
        fbclid: "fb_click_test_888",
      },
      options: { duplicateHandling: "merge" },
      actor: agentAUser,
    })

    const test4_1 = mergeRes.action === "merged" && mergeRes.lead._id.toString() === createdResult.lead._id.toString()
    recordTest("Suite 4", "duplicateHandling='merge' updates existing lead document", test4_1)

    // Verify firstTouch was PRESERVED (write-once) and lastTouch was UPDATED
    const mergedDoc = await Lead.findById(createdResult.lead._id)
    const test4_2 = mergedDoc.attribution.firstTouch.source === "google" &&
      mergedDoc.attribution.firstTouch.gclid === "test_gclid_12345"
    recordTest("Suite 4", "firstTouch attribution remains immutable (write-once) after merge", test4_2)

    const test4_3 = mergedDoc.attribution.lastTouch.source === "facebook" &&
      mergedDoc.attribution.lastTouch.fbclid === "fb_click_test_888" &&
      mergedDoc.attribution.lastTouch.campaign === "reengagement_q4"
    recordTest("Suite 4", "lastTouch attribution reflects latest touchpoint metadata", test4_3)

    const test4_4 = mergedDoc.company === "Alpha Global Enterprises" &&
      mergedDoc.city === "New Delhi" &&
      mergedDoc.tags.includes("retargeted")
    recordTest("Suite 4", "Lead fields (company, city, tags) are successfully merged", test4_4)

    // 4.4 Duplicate Handling Allow Policy
    const allowRes = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Manual",
      payload: {
        name: "Allowed Duplicate Lead",
        email: `attr_${TEST_TAG}@test.com`,
        phone: "9123456780",
      },
      options: { duplicateHandling: "allow" },
    })
    const test4_5 = allowRes.action === "created" && allowRes.lead._id.toString() !== createdResult.lead._id.toString()
    recordTest("Suite 4", "duplicateHandling='allow' creates distinct lead record", test4_5)

    // =========================================================================
    // SUITE 5: Multi-Tenant Lead Isolation
    // =========================================================================
    console.log("\n--- Suite 5: Multi-Tenant Lead Isolation ---")

    // Create lead with identical email and phone in Tenant B
    const tenantBLeadRes = await leadService.createOrMergeLead({
      tenantId: TENANT_B,
      source: "Website",
      payload: {
        name: "Tenant B Lead",
        email: `attr_${TEST_TAG}@test.com`, // Same email as Tenant A!
        phone: "9123456780",               // Same phone as Tenant A!
        company: "Beta Solutions",
      },
      options: { duplicateHandling: "reject" },
    })

    const test5_1 = tenantBLeadRes.action === "created" && tenantBLeadRes.lead.tenantId === TENANT_B
    recordTest("Suite 5", "Identical email/phone permitted across different tenants without collision", test5_1)

    // Query Tenant A leads with Tenant A admin token -> Tenant B lead must NOT appear
    const listTenantARes = await request(app)
      .get("/api/leads")
      .set("Cookie", adminAToken)
    const leadsInA = listTenantARes.body?.data?.leads || []
    const crossTenantLeak = leadsInA.some((l) => l.tenantId === TENANT_B || l.name === "Tenant B Lead")
    recordTest("Suite 5", "Tenant A lead list strictly excludes Tenant B leads", !crossTenantLeak)

    // =========================================================================
    // SUITE 6: Controller Endpoints & Webhook Ingestion via Lead Service
    // =========================================================================
    console.log("\n--- Suite 6: Controller Endpoints via Lead Service ---")

    // 6.1 POST /api/leads using service
    const apiCreateRes = await request(app)
      .post("/api/leads")
      .set("Cookie", adminAToken)
      .send({
        name: "Manual Controller Lead",
        email: `ctrl_${TEST_TAG}@test.com`,
        phone: "9811223344",
        company: "Manual Corp",
        city: "Bangalore",
        alternatePhone: "08012345678",
      })

    const test6_1 = apiCreateRes.statusCode === 201 && apiCreateRes.body.success === true
    recordTest("Suite 6", "POST /api/leads creates lead via leadService with 201 Created", test6_1)

    // 6.2 GET /api/leads returns v2 fields
    const getLeadsRes = await request(app)
      .get("/api/leads?search=Manual%20Controller%20Lead")
      .set("Cookie", adminAToken)

    const createdLeadInList = (getLeadsRes.body?.data?.leads || []).find((l) => l.email === `ctrl_${TEST_TAG}@test.com`)
    const test6_2 = createdLeadInList &&
      createdLeadInList.phoneNormalized === "+919811223344" &&
      createdLeadInList.company === "Manual Corp" &&
      createdLeadInList.city === "Bangalore" &&
      createdLeadInList.alternatePhone === "08012345678"
    recordTest("Suite 6", "GET /api/leads outputs phoneNormalized, company, city, alternatePhone", test6_2)

    // 6.3 PUT /api/leads/:id updates Phase 6 fields
    const updateRes = await request(app)
      .put(`/api/leads/${createdLeadInList.id}`)
      .set("Cookie", adminAToken)
      .send({
        company: "Manual Corp International",
        city: "Hyderabad",
        phone: "9811223399",
      })

    const test6_3 = updateRes.statusCode === 200 &&
      updateRes.body.data?.company === "Manual Corp International" &&
      updateRes.body.data?.phoneNormalized === "+919811223399" &&
      updateRes.body.data?.city === "Hyderabad"
    recordTest("Suite 6", "PUT /api/leads/:id updates company, city, and recomputes phoneNormalized", test6_3)

    // 6.4 Webhook Ingestion POST /api/integrations/leads/website
    // Configure lead feeds for Tenant A
    const configRes = await request(app)
      .get("/api/integrations/settings/website")
      .set("Cookie", adminAToken)
    const apiKeyRotateRes = await request(app)
      .post("/api/integrations/settings/website/rotate-key")
      .set("Cookie", adminAToken)
    const rawApiKey = apiKeyRotateRes.body?.data?.rawApiKey

    const webhookRes = await request(app)
      .post("/api/integrations/leads/website")
      .set("x-api-key", rawApiKey)
      .send({
        name: "Webhook Ingested Lead",
        email: `webhook_${TEST_TAG}@test.com`,
        phone: "9822334455",
        company: "Webhook Tech Ltd",
        utm_source: "newsletter",
        utm_campaign: "welcome_digest",
      })

    const test6_4 = webhookRes.statusCode === 201 && webhookRes.body.success === true
    recordTest("Suite 6", "Website webhook ingests lead via leadService with 201 Created", test6_4)

    // =========================================================================
    // SUITE 7: Migration Script Verification (Dry-Run & Live)
    // =========================================================================
    console.log("\n--- Suite 7: Migration Script (migrateLeadModelV2) ---")

    // Insert legacy lead with un-normalized phone, company only in metadata, and unpopulated ownerId
    const legacyLead = new Lead({
      name: "Legacy Lead Unmigrated",
      email: `legacy_${TEST_TAG}@test.com`,
      phone: "9765432100",
      phoneNormalized: "",
      company: "",
      tenantId: TENANT_A,
      metadata: {
        company: "Legacy Enterprises Ltd",
      },
      assignedStaffId: agentAUser._id.toString(),
      ownerId: null,
      attribution: null,
      deletedAt: undefined,
    })
    // Save bypassing pre-save synchronization to simulate legacy data
    await Lead.collection.insertOne(legacyLead.toObject())

    // 7.1 Dry-Run mode
    const dryRunResult = await migrateLeadModelV2({ dryRun: true })
    const checkAfterDryRun = await Lead.collection.findOne({ email: `legacy_${TEST_TAG}@test.com` })
    const test7_1 = dryRunResult.isDryRun === true &&
      dryRunResult.modifiedCount >= 1 &&
      checkAfterDryRun.phoneNormalized === "" && // Unchanged in dry run!
      checkAfterDryRun.company === ""
    recordTest("Suite 7", "Dry-run reports modifications without modifying MongoDB records", test7_1)

    // 7.2 Live mode
    const liveRunResult = await migrateLeadModelV2({ dryRun: false })
    const checkAfterLive = await Lead.collection.findOne({ email: `legacy_${TEST_TAG}@test.com` })
    const test7_2 = liveRunResult.isDryRun === false &&
      checkAfterLive.phoneNormalized === "+919765432100" &&
      checkAfterLive.company === "Legacy Enterprises Ltd" &&
      checkAfterLive.ownerId && checkAfterLive.ownerId.toString() === agentAUser._id.toString() &&
      checkAfterLive.attribution?.firstTouch?.source !== undefined
    recordTest("Suite 7", "Live migration successfully backfills phoneNormalized, company, ownerId, and attribution", test7_2)

    // =========================================================================
    // SUITE 8: Soft Delete & Query Filtering
    // =========================================================================
    console.log("\n--- Suite 8: Soft Delete & Query Filtering ---")

    const leadToSoftDelete = await leadService.createOrMergeLead({
      tenantId: TENANT_A,
      source: "Manual",
      payload: {
        name: "Soft Delete Target",
        email: `softdelete_${TEST_TAG}@test.com`,
        phone: "9911223344",
      },
    })

    // Perform soft delete
    const softDeletedDoc = await leadService.softDeleteLead(leadToSoftDelete.lead._id, TENANT_A)
    const test8_1 = softDeletedDoc && softDeletedDoc.deletedAt instanceof Date
    recordTest("Suite 8", "leadService.softDeleteLead stamps deletedAt timestamp", test8_1)

    // GET /api/leads must exclude it by default
    const getWithoutDeleted = await request(app)
      .get("/api/leads?search=Soft%20Delete%20Target")
      .set("Cookie", adminAToken)
    const excludedByDefault = (getWithoutDeleted.body?.data?.leads || []).length === 0
    recordTest("Suite 8", "GET /api/leads excludes soft-deleted leads by default (deletedAt: null)", excludedByDefault)

    // GET /api/leads?includeDeleted=true must include it
    const getWithDeleted = await request(app)
      .get("/api/leads?search=Soft%20Delete%20Target&includeDeleted=true")
      .set("Cookie", adminAToken)
    const includedWhenRequested = (getWithDeleted.body?.data?.leads || []).some((l) => l.email === `softdelete_${TEST_TAG}@test.com`)
    recordTest("Suite 8", "GET /api/leads?includeDeleted=true includes soft-deleted records", includedWhenRequested)

  } catch (err) {
    console.error("\n❌ Fatal error in Phase 6 test suite:", err)
    failedTests++
  } finally {
    await cleanupData()
  }

  console.log("\n================================================================================")
  console.log(`Phase 6 Test Results: ${passedTests} passed, ${failedTests} failed`)
  console.log("================================================================================")

  if (failedTests > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

if (require.main === module) {
  runPhase6Tests()
}

module.exports = { runPhase6Tests }
