/**
 * Verification Test Suite: Phase 10 - Lead Detail Drawer & Activity Timeline (Task 1)
 * 
 * Verifies:
 * 1. GET /api/leads/:id returns complete lead details (attribution, statusHistory, assignmentHistory, normalized phone)
 * 2. Multi-tenant isolation and 401/404 security on lead detail retrieval
 * 3. Timeline event feeder: status transitions (metadata.statusHistory) and assignment history
 * 4. Timeline associated follow-ups (GET /api/follow-ups?leadId=...)
 * 5. In-drawer action support: status updates (PATCH /api/leads/:id/status) and note appending
 * 6. Frontend static contract: LeadDetailDrawer component structure and tabs
 */

const assert = require("assert")
const path = require("path")
const fs = require("fs")
const mongoose = require("mongoose")
const dotenv = require("dotenv")

dotenv.config({ path: path.join(__dirname, "../.env") })

const User = require("../models/User")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const jwt = require("jsonwebtoken")
const { getJwtSecret } = require("../middleware/authMiddleware")

function generateTestToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    getJwtSecret(),
    { expiresIn: "1h" },
  )
}

const BASE_URL = process.env.TEST_API_URL || "http://localhost:5000/api"

const TENANT_A = `tenant_p10_a_${Date.now()}`
const TENANT_B = `tenant_p10_b_${Date.now()}`

let tokenTenantA
let tokenTenantB
let userTenantA
let userTenantB
let leadTenantA
let leadTenantB
let followUpTenantA

let passedTests = 0
let failedTests = 0

function pass(testName) {
  passedTests++
  console.log(`  ✅ [PASS] ${testName}`)
}

function fail(testName, err) {
  failedTests++
  console.error(`  ❌ [FAIL] ${testName}:`, err.message || err)
}

async function runTests() {
  console.log("\n========================================================")
  console.log("   PHASE 10: LEAD DETAIL DRAWER & TIMELINE VERIFICATION")
  console.log("========================================================\n")

  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) throw new Error("Missing MONGODB_URI in environment")
    await mongoose.connect(mongoUri)
    console.log("✅ MongoDB Connected")

    // Setup Test Fixtures
    const { ensureTenantRoles } = require("../models/Role")
    const rolesA = await ensureTenantRoles(TENANT_A)
    const rolesB = await ensureTenantRoles(TENANT_B)
    const roleAdminA = rolesA.find((r) => r.slug === "account_admin")
    const roleAdminB = rolesB.find((r) => r.slug === "account_admin")

    userTenantA = await User.create({
      name: "Agent Alice Tenant A",
      email: `alice.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "account_admin",
      roleId: roleAdminA?._id,
      status: "active",
    })

    userTenantB = await User.create({
      name: "Agent Bob Tenant B",
      email: `bob.${Date.now()}@tenantb.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_B,
      role: "account_admin",
      roleId: roleAdminB?._id,
      status: "active",
    })

    tokenTenantA = generateTestToken(userTenantA)
    tokenTenantB = generateTestToken(userTenantB)

    // Create sample Lead for Tenant A with status history and attribution
    leadTenantA = await Lead.create({
      name: "Dr. Evelyn Reed",
      email: `evelyn.${Date.now()}@biomed.org`,
      phone: "+91 98765 43210",
      phoneNormalized: "+919876543210",
      alternatePhone: "+91 91234 56789",
      company: "BioMed Technologies",
      city: "Bengaluru",
      status: "New",
      source: "Website",
      assignedTo: userTenantA.name,
      assignedStaffId: userTenantA._id.toString(),
      ownerId: userTenantA._id,
      tenantId: TENANT_A,
      message: "Initial inquiry regarding clinical trial telemetry integration.",
      attribution: {
        firstTouch: {
          source: "Google Ads",
          medium: "cpc",
          campaign: "Healthcare_Telemed_2026",
          term: "cloud crm for doctors",
          gclid: "test-gclid-101010",
          landingPage: "https://leads365.com/medical-solutions",
          timestamp: new Date(),
        },
      },
      metadata: {
        statusHistory: [
          {
            status: "New",
            changedAt: new Date(Date.now() - 3600000),
            changedBy: "Webhook Ingestion",
            note: "Lead ingested via website form",
          },
        ],
      },
      assignmentHistory: [
        {
          fromOwnerId: null,
          fromOwnerName: "Unassigned",
          toOwnerId: userTenantA._id,
          toOwnerName: userTenantA.name,
          assignedBy: userTenantA._id,
          assignedByName: "System Admin",
          assignedAt: new Date(Date.now() - 3500000),
          reason: "Default rule assignment",
        },
      ],
    })

    // Create sample Lead for Tenant B
    leadTenantB = await Lead.create({
      name: "Marcus Vance",
      email: `marcus.${Date.now()}@vancemedia.com`,
      phone: "+91 99999 11111",
      status: "New",
      tenantId: TENANT_B,
    })

    // Create Follow-up for Tenant A's lead
    followUpTenantA = await FollowUp.create({
      leadId: leadTenantA._id,
      tenantId: TENANT_A,
      title: "Initial Product Demo & Walkthrough",
      type: "call",
      scheduledAt: new Date(Date.now() + 86400000),
      status: "pending",
      priority: "high",
      notes: "Discuss multi-agent call recording compliance.",
      assignedTo: userTenantA.name,
    })

    console.log("✅ Test fixtures initialized.\n")

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `client_token=${token}; token=${token}`,
    ...extra,
  }
}

    // --- SUITE 1: GET /api/leads/:id (Lead Detail Retrieval) ---
    console.log("▶ SUITE 1: Lead Detail Endpoint Verification")

    // 1.1 Unauthenticated request returns 401
    try {
      const res = await fetch(`${BASE_URL}/leads/${leadTenantA._id}`)
      assert.strictEqual(res.status, 401, "Expected 401 for unauthenticated detail request")
      pass("GET /api/leads/:id rejects unauthenticated request with 401")
    } catch (err) {
      fail("GET /api/leads/:id rejects unauthenticated request with 401", err)
    }

    // 1.2 Authenticated Tenant A user retrieves complete lead detail
    try {
      const res = await fetch(`${BASE_URL}/leads/${leadTenantA._id}`, {
        headers: authHeaders(tokenTenantA),
      })
      assert.strictEqual(res.status, 200, "Expected 200 for authenticated detail request")
      const json = await res.json()
      assert.strictEqual(json.success, true)
      assert.strictEqual(json.data.name, "Dr. Evelyn Reed")
      assert.strictEqual(json.data.company, "BioMed Technologies")
      assert.strictEqual(json.data.phoneNormalized, "+919876543210")
      assert.strictEqual(json.data.attribution?.firstTouch?.source, "Google Ads")
      assert.ok(Array.isArray(json.data.metadata?.statusHistory), "statusHistory should be array")
      assert.ok(Array.isArray(json.data.assignmentHistory), "assignmentHistory should be array")
      pass("GET /api/leads/:id returns complete lead details with attribution and histories")
    } catch (err) {
      fail("GET /api/leads/:id returns complete lead details with attribution and histories", err)
    }

    // 1.3 Strict Tenant Isolation: Tenant B cannot access Tenant A's lead detail
    try {
      const res = await fetch(`${BASE_URL}/leads/${leadTenantA._id}`, {
        headers: authHeaders(tokenTenantB),
      })
      assert.ok([403, 404].includes(res.status), `Expected 403 or 404, got ${res.status}`)
      pass("Strict Tenant Isolation: Cross-tenant lead detail request returns 403/404")
    } catch (err) {
      fail("Strict Tenant Isolation: Cross-tenant lead detail request returns 403/404", err)
    }

    // --- SUITE 2: Timeline Feeder Support ---
    console.log("\n▶ SUITE 2: Activity Timeline Data Feeds")

    // 2.1 Follow-ups for lead are queried by leadId
    try {
      const res = await fetch(`${BASE_URL}/follow-ups?leadId=${leadTenantA._id}`, {
        headers: authHeaders(tokenTenantA),
      })
      assert.strictEqual(res.status, 200)
      const json = await res.json()
      const list = json.data?.followUps || json.data || []
      assert.ok(list.length >= 1, "Should return at least 1 follow-up for lead")
      assert.strictEqual(list[0].title, "Initial Product Demo & Walkthrough")
      pass("GET /api/follow-ups?leadId=... retrieves associated timeline follow-ups")
    } catch (err) {
      fail("GET /api/follow-ups?leadId=... retrieves associated timeline follow-ups", err)
    }

    // 2.2 Status transition adds to statusHistory
    try {
      const res = await fetch(`${BASE_URL}/leads/${leadTenantA._id}/status`, {
        method: "PATCH",
        headers: authHeaders(tokenTenantA, { "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "Engaged" }),
      })
      assert.strictEqual(res.status, 200)
      const json = await res.json()
      assert.strictEqual(json.data.status, "Engaged")
      const history = json.data.metadata?.statusHistory || json.data.statusHistory || []
      assert.ok(
        history.some((s) => s.toStatus === "Engaged" || s.status === "Engaged"),
        "statusHistory should record 'Engaged' transition",
      )
      pass("PATCH /api/leads/:id/status records stage transition in statusHistory for timeline")
    } catch (err) {
      fail("PATCH /api/leads/:id/status records stage transition in statusHistory for timeline", err)
    }

    // 2.3 Note update appends to message
    try {
      const res = await fetch(`${BASE_URL}/leads/${leadTenantA._id}`, {
        method: "PUT",
        headers: authHeaders(tokenTenantA, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: leadTenantA.name,
          email: leadTenantA.email,
          phone: leadTenantA.phone,
          message: `${leadTenantA.message}\n[Note]: Customer requested clinical pricing sheet.`,
        }),
      })
      assert.strictEqual(res.status, 200)
      const json = await res.json()
      assert.ok(json.data.message.includes("Customer requested clinical pricing sheet"))
      pass("PUT /api/leads/:id persists note additions for timeline and notes tab")
    } catch (err) {
      fail("PUT /api/leads/:id persists note additions for timeline and notes tab", err)
    }

    // --- SUITE 3: Frontend Component Static Contract ---
    console.log("\n▶ SUITE 3: Frontend Drawer UI Contract")

    const drawerPath = path.join(__dirname, "../../frontend/components/lead-detail-drawer.jsx")
    const leadsClientPath = path.join(__dirname, "../../frontend/app/leads/leads-client.jsx")

    // 3.1 LeadDetailDrawer exists and exports component
    try {
      assert.ok(fs.existsSync(drawerPath), "lead-detail-drawer.jsx must exist")
      const drawerCode = fs.readFileSync(drawerPath, "utf-8")
      assert.ok(drawerCode.includes("export default function LeadDetailDrawer"), "Must export LeadDetailDrawer")
      assert.ok(drawerCode.includes('activeTab === "timeline"'), "Must include Timeline tab")
      assert.ok(drawerCode.includes('activeTab === "notes"'), "Must include Notes tab")
      assert.ok(drawerCode.includes('activeTab === "followups"'), "Must include Follow-ups tab")
      assert.ok(drawerCode.includes('activeTab === "calls"'), "Must include Calls tab")
      assert.ok(drawerCode.includes('activeTab === "details"'), "Must include Details & Attribution tab")
      pass("lead-detail-drawer.jsx implements all 5 required Phase 10 tabs")
    } catch (err) {
      fail("lead-detail-drawer.jsx implements all 5 required Phase 10 tabs", err)
    }

    // 3.2 leads-client.jsx imports and renders LeadDetailDrawer
    try {
      assert.ok(fs.existsSync(leadsClientPath), "leads-client.jsx must exist")
      const clientCode = fs.readFileSync(leadsClientPath, "utf-8")
      assert.ok(
        clientCode.includes('import LeadDetailDrawer from "@/components/lead-detail-drawer"'),
        "Must import LeadDetailDrawer",
      )
      assert.ok(
        clientCode.includes("<LeadDetailDrawer"),
        "Must mount <LeadDetailDrawer /> in component tree",
      )
      assert.ok(
        clientCode.includes("title=\"Click to open Lead Drawer\""),
        "Must bind click handler to open drawer from lead name",
      )
      pass("leads-client.jsx integrates LeadDetailDrawer with click-to-open and callbacks")
    } catch (err) {
      fail("leads-client.jsx integrates LeadDetailDrawer with click-to-open and callbacks", err)
    }

  } catch (err) {
    console.error("FATAL ERROR in test execution:", err)
    failedTests++
  } finally {
    // Cleanup fixtures
    try {
      if (leadTenantA) await Lead.deleteOne({ _id: leadTenantA._id })
      if (leadTenantB) await Lead.deleteOne({ _id: leadTenantB._id })
      if (followUpTenantA) await FollowUp.deleteOne({ _id: followUpTenantA._id })
      if (userTenantA) await User.deleteOne({ _id: userTenantA._id })
      if (userTenantB) await User.deleteOne({ _id: userTenantB._id })
    } catch (_) {}

    await mongoose.disconnect()

    console.log("\n========================================================")
    console.log(`  PHASE 10 TESTS: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log("========================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  }
}

runTests()
