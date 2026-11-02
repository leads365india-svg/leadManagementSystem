require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const mongoose = require("mongoose")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const app = require("../start")
const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")
const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { getJwtSecret } = require("../middleware/authMiddleware")

const TEST_ID = `p2_${Date.now()}`
const TENANT_A = `ACC-P2-A-${TEST_ID}`
const TENANT_B = `ACC-P2-B-${TEST_ID}`

let tokenAdminA, tokenUserA, tokenAdminB
let adminUserA, regularUserA, adminUserB
let testProduct1, testProduct2
let testSourceManual, testSourceDoc

const results = []
const record = (name, passed, detail = "") => {
  results.push({ name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (!passed && detail) {
    console.log(`     Error: ${detail}`)
  }
}

function generateAuthToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion || 1,
    },
    getJwtSecret(),
    { expiresIn: "2h" }
  )
}

async function cleanup() {
  try {
    const tenants = [TENANT_A, TENANT_B]
    await TenantBusinessProfile.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await BusinessProduct.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AIKnowledgeSource.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AIKeywordTopic.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ $or: [{ accountId: { $in: tenants } }, { tenantId: { $in: tenants } }] }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup error:", err.message)
  }
}

async function runTests() {
  console.log("\n=======================================================")
  console.log("   AI CALL INTELLIGENCE - PHASE 2 VERIFICATION SUITE   ")
  console.log("=======================================================\n")

  await connectDB()

  try {
    // ---------------------------------------------------------
    // Setup Fixtures
    // ---------------------------------------------------------
    console.log("--- 1. Setting Up Test Fixtures & Accounts ---")
    await cleanup()

    adminUserA = await User.create({
      tenantId: TENANT_A,
      name: "Admin Tenant A",
      email: `admin_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    regularUserA = await User.create({
      tenantId: TENANT_A,
      name: "Staff Tenant A",
      email: `staff_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "user",
      status: "active",
    })

    adminUserB = await User.create({
      tenantId: TENANT_B,
      name: "Admin Tenant B",
      email: `admin_b_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Phase 2 Prime Tenant Corp",
        displayName: "Phase 2 Tenant A",
        adminUserId: adminUserA._id,
        adminName: adminUserA.name,
        adminEmail: adminUserA.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Phase 2 Isolated Tenant Ltd",
        displayName: "Phase 2 Tenant B",
        adminUserId: adminUserB._id,
        adminName: adminUserB.name,
        adminEmail: adminUserB.email,
        status: "active",
      },
    ])

    tokenAdminA = generateAuthToken(adminUserA)
    tokenUserA = generateAuthToken(regularUserA)
    tokenAdminB = generateAuthToken(adminUserB)

    // Seed Tenant A Business Profile
    await TenantBusinessProfile.create({
      tenantId: TENANT_A,
      businessName: "Nordic Teak & Woodworks",
      industry: "Furniture",
      description: "Premium handcrafted solid teak dining tables, ergonomic office chairs, and bespoke modular cabinetry.",
      languages: ["English", "Hindi"],
    })

    // Seed Tenant A Products
    testProduct1 = await BusinessProduct.create({
      tenantId: TENANT_A,
      name: "Royal Heritage 8-Seater Dining Table",
      type: "PRODUCT",
      category: "Dining Furniture",
      description: "Handcrafted reclaimed grade-A teak dining table with natural matte finish.",
      price: { amount: 85000, currency: "INR", billingCycle: "one-time" },
      features: ["Grade-A teak", "Termite resistant", "10-year structural warranty", "Seats 8 guests"],
    })

    testProduct2 = await BusinessProduct.create({
      tenantId: TENANT_A,
      name: "Custom Furniture Architecture Consultation",
      type: "SERVICE",
      category: "Consulting",
      description: "On-site architectural measurement and 3D CAD modeling for custom corporate interiors.",
      price: { amount: 15000, currency: "INR", billingCycle: "one-time" },
      features: ["On-site survey", "3D CAD renders", "Material samples delivered"],
    })

    // Seed Tenant A Knowledge Sources
    testSourceManual = await AIKnowledgeSource.create({
      tenantId: TENANT_A,
      title: "Wood Care & 10-Year Warranty Policy",
      sourceType: "manual",
      status: "COMPLETED",
      manualDetails: {
        content: "All solid teak tables include a 10-year warranty against warping and wood rot. Polishing is recommended every 12 months with organic beeswax.",
      },
      extractedText: "All solid teak tables include a 10-year warranty against warping and wood rot. Polishing is recommended every 12 months with organic beeswax.",
      wordCount: 22,
    })

    testSourceDoc = await AIKnowledgeSource.create({
      tenantId: TENANT_A,
      title: "Logistics, Delivery & Installation Guide",
      sourceType: "pdf",
      status: "COMPLETED",
      extractedText: "Pan-India white-glove delivery available. Metro deliveries completed within 5-7 business days. Assembly is complimentary.",
      wordCount: 17,
    })

    record("Tenant A & B test fixtures initialized successfully", true)

    // ---------------------------------------------------------
    // Suite 1: AI Keyword & Topic Generation Engine
    // ---------------------------------------------------------
    console.log("\n--- Suite 1: Keyword Generation Engine & Multi-Source Grounding ---")

    // Empty Tenant B generation should return 400
    const emptyGenRes = await request(app)
      .post("/api/ai-keywords/generate")
      .set("Authorization", `Bearer ${tokenAdminB}`)
      .send({})

    record("Empty tenant receives 400 Bad Request instructing knowledge setup", emptyGenRes.status === 400)

    // Tenant A Generation
    const genRes = await request(app)
      .post("/api/ai-keywords/generate")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ mode: "append", defaultStatus: "PENDING_APPROVAL" })

    record("POST /api/ai-keywords/generate returns 201 Created", genRes.status === 201)
    record("Generated topics count is greater than 0", genRes.body.count > 0)
    record("Generated topics have provider metadata", Boolean(genRes.body.provider))

    const generatedTopics = genRes.body.topics || []
    const sampleTopic = generatedTopics[0]

    record("Generated topic has valid name", Boolean(sampleTopic && sampleTopic.name && sampleTopic.name.length >= 2))
    record("Generated topic initial status is PENDING_APPROVAL", sampleTopic?.status === "PENDING_APPROVAL")
    record("Generated topic has primaryKeywords array", Array.isArray(sampleTopic?.primaryKeywords) && sampleTopic.primaryKeywords.length > 0)
    record("Generated topic has customerQuestions array", Array.isArray(sampleTopic?.customerQuestions))
    record("Generated topic has discussionPoints array", Array.isArray(sampleTopic?.discussionPoints))
    record("Generated topic has confidenceScore between 0.5 and 1.0", sampleTopic?.confidenceScore >= 0.5 && sampleTopic?.confidenceScore <= 1.0)
    record("Generated topic includes source citations or product links", Boolean(sampleTopic?.sourceReferences?.length > 0 || sampleTopic?.relatedProductIds?.length > 0))

    // ---------------------------------------------------------
    // Suite 2: Topic Listing, Filtering, Search & Stats
    // ---------------------------------------------------------
    console.log("\n--- Suite 2: Listing, Filtering, Search & Stats ---")

    const listRes = await request(app)
      .get("/api/ai-keywords")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("GET /api/ai-keywords returns 200 OK", listRes.status === 200)
    record("List response includes KPI stats object", Boolean(listRes.body.stats && listRes.body.stats.pending > 0))
    record("List response total matches generated count", listRes.body.total === genRes.body.count)

    // Filter by status
    const pendingRes = await request(app)
      .get("/api/ai-keywords?status=PENDING_APPROVAL")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Filter by status=PENDING_APPROVAL works", pendingRes.body.topics.every((t) => t.status === "PENDING_APPROVAL"))

    // Search by text
    const searchRes = await request(app)
      .get("/api/ai-keywords?search=Dining")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Search by keyword finds matching dining topic", searchRes.status === 200 && Array.isArray(searchRes.body.topics) && searchRes.body.topics.length > 0)

    // Get single topic by ID
    const singleRes = await request(app)
      .get(`/api/ai-keywords/${sampleTopic._id}`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("GET /api/ai-keywords/:id returns single topic", singleRes.status === 200 && singleRes.body.topic._id === sampleTopic._id)

    // ---------------------------------------------------------
    // Suite 3: Admin Review & Approval Workflow
    // ---------------------------------------------------------
    console.log("\n--- Suite 3: Admin Review & Approval Lifecycle ---")

    const targetTopicId = sampleTopic._id

    // Edit Topic
    const updateRes = await request(app)
      .put(`/api/ai-keywords/${targetTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Solid Teak Dining Sets & White Glove Delivery",
        primaryKeywords: ["solid teak", "dining set", "white glove", "artisan wood"],
        discussionPoints: ["Highlight sustainable harvesting", "Emphasize 10-year warranty"],
      })

    record("PUT /api/ai-keywords/:id updates topic successfully", updateRes.status === 200)
    record("Updated topic increments version to 2", updateRes.body.topic.version === 2)
    record("Updated primary keywords applied correctly", updateRes.body.topic.primaryKeywords.includes("artisan wood"))

    // Approve Single Topic
    const approveRes = await request(app)
      .patch(`/api/ai-keywords/${targetTopicId}/approve`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("PATCH /api/ai-keywords/:id/approve sets status to APPROVED", approveRes.status === 200 && approveRes.body.topic.status === "APPROVED")
    record("Approved topic records approvedAt timestamp", Boolean(approveRes.body.topic.approvedAt))
    record("Approved topic records approvedBy user ID", approveRes.body.topic.approvedBy === adminUserA._id.toString())

    // Reject Topic with Reason
    const secondTopicId = generatedTopics[1]._id
    const rejectRes = await request(app)
      .patch(`/api/ai-keywords/${secondTopicId}/reject`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ reason: "Discontinued seasonal collection" })

    record("PATCH /api/ai-keywords/:id/reject sets status to REJECTED", rejectRes.status === 200 && rejectRes.body.topic.status === "REJECTED")
    record("Rejected topic stores rejectionReason", rejectRes.body.topic.rejectionReason === "Discontinued seasonal collection")

    // Bulk Approve
    const remainingTopicIds = generatedTopics.slice(2).map((t) => t._id)
    if (remainingTopicIds.length > 0) {
      const bulkRes = await request(app)
        .post("/api/ai-keywords/bulk-approve")
        .set("Authorization", `Bearer ${tokenAdminA}`)
        .send({ ids: remainingTopicIds })

      record("POST /api/ai-keywords/bulk-approve succeeds", bulkRes.status === 200)
      record("Bulk approve modifies expected count", bulkRes.body.modifiedCount === remainingTopicIds.length)
    }

    // Archive Topic
    const archiveRes = await request(app)
      .patch(`/api/ai-keywords/${targetTopicId}/archive`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("PATCH /api/ai-keywords/:id/archive sets status to ARCHIVED", archiveRes.status === 200 && archiveRes.body.topic.status === "ARCHIVED")
    record("Archived topic records archivedAt timestamp", Boolean(archiveRes.body.topic.archivedAt))

    // Delete Topic
    const deleteRes = await request(app)
      .delete(`/api/ai-keywords/${secondTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("DELETE /api/ai-keywords/:id deletes topic", deleteRes.status === 200)

    const checkDeleted = await request(app)
      .get(`/api/ai-keywords/${secondTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Deleted topic returns 404 Not Found on subsequent fetch", checkDeleted.status === 404)

    // ---------------------------------------------------------
    // Suite 4: Strict Multi-Tenant Isolation
    // ---------------------------------------------------------
    console.log("\n--- Suite 4: Strict Multi-Tenant Isolation ---")

    // Tenant B list is empty
    const tenantBList = await request(app)
      .get("/api/ai-keywords")
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B keyword list has 0 topics (Strict Isolation)", tenantBList.status === 200 && tenantBList.body.topics.length === 0)

    // Tenant B cannot fetch Tenant A topic
    const crossGet = await request(app)
      .get(`/api/ai-keywords/${targetTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B cannot fetch Tenant A topic (404 Not Found)", crossGet.status === 404)

    // Tenant B cannot edit Tenant A topic
    const crossPut = await request(app)
      .put(`/api/ai-keywords/${targetTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminB}`)
      .send({ name: "Malicious Cross-Tenant Tamper" })

    record("Tenant B cannot mutate Tenant A topic (404 Not Found)", crossPut.status === 404)

    // Tenant B cannot approve Tenant A topic
    const crossApprove = await request(app)
      .patch(`/api/ai-keywords/${targetTopicId}/approve`)
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B cannot approve Tenant A topic (404 Not Found)", crossApprove.status === 404)

    // Tenant B cannot delete Tenant A topic
    const crossDelete = await request(app)
      .delete(`/api/ai-keywords/${targetTopicId}`)
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B cannot delete Tenant A topic (404 Not Found)", crossDelete.status === 404)

    // ---------------------------------------------------------
    // Suite 5: RBAC Permissions (Account Admin vs Regular User)
    // ---------------------------------------------------------
    console.log("\n--- Suite 5: RBAC Permissions (Admin vs Regular User) ---")

    const rbacGen = await request(app)
      .post("/api/ai-keywords/generate")
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user receives 403 Forbidden on generate", rbacGen.status === 403)

    const rbacList = await request(app)
      .get("/api/ai-keywords")
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user receives 403 Forbidden on list", rbacList.status === 403)

    const rbacApprove = await request(app)
      .patch(`/api/ai-keywords/${targetTopicId}/approve`)
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user receives 403 Forbidden on approve", rbacApprove.status === 403)

    const noAuth = await request(app)
      .get("/api/ai-keywords")

    record("RBAC: Unauthenticated request receives 401 Unauthorized", noAuth.status === 401)

    // ---------------------------------------------------------
    // Suite 6: Regeneration Strategy (replace_drafts)
    // ---------------------------------------------------------
    console.log("\n--- Suite 6: Regeneration Strategy (replace_drafts) ---")

    // Create a manual DRAFT topic
    const manualDraft = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Temporary Draft to be Replaced",
      status: "DRAFT",
      primaryKeywords: ["temporary", "draft"],
    })

    // Regenerate with mode: "replace_drafts"
    const regenRes = await request(app)
      .post("/api/ai-keywords/generate")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ mode: "replace_drafts", defaultStatus: "PENDING_APPROVAL" })

    record("POST /api/ai-keywords/generate with replace_drafts succeeds", regenRes.status === 201)

    const checkDraftReplaced = await AIKeywordTopic.findOne({ _id: manualDraft._id, tenantId: TENANT_A })
    record("Previous unapproved draft was safely replaced", checkDraftReplaced === null)

    // Verify archived topic was preserved
    const checkArchivedPreserved = await AIKeywordTopic.findOne({ _id: targetTopicId, tenantId: TENANT_A })
    record("Approved/Archived topic was preserved across regeneration", checkArchivedPreserved !== null)

    // ---------------------------------------------------------
    // Suite 7: Regression Testing (Phase 1 & Core CRM APIs)
    // ---------------------------------------------------------
    console.log("\n--- Suite 7: Regression Testing (Phase 1 & Core CRM APIs) ---")

    // Phase 1 Profile
    const profileCheck = await request(app)
      .get("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Regression: Phase 1 GET /api/ai-knowledge/profile operates normally", profileCheck.status === 200)

    // Phase 1 Products
    const productsCheck = await request(app)
      .get("/api/ai-knowledge/products")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Regression: Phase 1 GET /api/ai-knowledge/products operates normally", productsCheck.status === 200)

    // Phase 1 Sources
    const sourcesCheck = await request(app)
      .get("/api/ai-knowledge/sources")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Regression: Phase 1 GET /api/ai-knowledge/sources operates normally", sourcesCheck.status === 200)

    // Core Leads API
    const leadCreateRes = await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Phase 2 Regression Lead",
        phone: "+919876543210",
        email: "p2lead@example.com",
        status: "New",
      })

    record("Regression: Existing Lead creation API (/api/leads) functions normally", leadCreateRes.status === 201)

    // Clean up created lead
    const leadId = leadCreateRes.body.lead?.id || leadCreateRes.body.lead?._id
    if (leadId) {
      await Lead.deleteOne({ _id: leadId, tenantId: TENANT_A })
    }

    // Devices Route check
    const devCheck = await request(app)
      .get("/api/devices")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Regression: Device API route (/api/devices) is intact", [200, 404].includes(devCheck.status))

  } catch (err) {
    console.error("Test execution threw fatal exception:", err)
    record("Test Execution Harness", false, err.message)
  } finally {
    console.log("\n--- Final Cleanup of Test Fixtures ---")
    await cleanup()
    await mongoose.disconnect()
  }

  // Summary
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length

  console.log("\n=======================================================")
  console.log(`PHASE 2 VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (${results.length} total)`)
  console.log("=======================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
