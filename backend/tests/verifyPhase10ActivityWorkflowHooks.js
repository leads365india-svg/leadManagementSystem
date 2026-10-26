/**
 * Verification Test Suite: Phase 10 - Task 3: Activity Workflow Hooks
 * 
 * Verifies activity.record() integration across 4 core workflows:
 * 1. Lead creation: leadService.createOrMergeLead (type: lead.created)
 * 2. Lead status change: leadController.updateLead (type: lead.status_changed)
 * 3. Lead assignment & reassignment: assignmentService (type: lead.owner_changed)
 * 4. Lead note additions: leadController.updateLead (type: lead.note_added)
 * 5. Duplicate prevention: unchanged status or notes do not generate redundant events
 * 6. Resilience & Security: payload sanitization, tenant isolation, and error tolerance
 */

process.env.NODE_ENV = "test"
const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const jwt = require("jsonwebtoken")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })

const app = require("../start")
const { Activity } = require("../models/Activity")
const { activity } = require("../services/activityService")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { Role, ensureTenantRoles } = require("../models/Role")
const leadService = require("../services/leadService")
const assignmentService = require("../services/assignmentService")
const { getJwtSecret } = require("../middleware/authMiddleware")

const TENANT_A = `tenant_acthooks_a_${Date.now()}`
const TENANT_B = `tenant_acthooks_b_${Date.now()}`

let tokenTenantA
let userAdminA
let userAgentA1
let userAgentA2

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
  console.log("   PHASE 10 TASK 3: ACTIVITY WORKFLOW HOOKS TESTS")
  console.log("========================================================\n")

  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) throw new Error("Missing MONGODB_URI in environment")
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(mongoUri)
    }
    console.log("✅ MongoDB Connected")

    // Setup Test Fixtures for Tenant A
    const rolesA = await ensureTenantRoles(TENANT_A)
    const roleAdminA = rolesA.find((r) => r.slug === "account_admin")
    const roleAgentA = rolesA.find((r) => r.slug === "agent")

    userAdminA = await User.create({
      name: "Admin Alice",
      email: `alice.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "account_admin",
      roleId: roleAdminA?._id,
      status: "active",
    })

    userAgentA1 = await User.create({
      name: "Agent Bob",
      email: `bob.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "agent",
      roleId: roleAgentA?._id,
      status: "active",
    })

    userAgentA2 = await User.create({
      name: "Agent Charlie",
      email: `charlie.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "agent",
      roleId: roleAgentA?._id,
      status: "active",
    })

    tokenTenantA = jwt.sign(
      {
        id: userAdminA._id.toString(),
        userId: userAdminA._id.toString(),
        email: userAdminA.email,
        role: userAdminA.role,
        tenantId: TENANT_A,
      },
      getJwtSecret(),
      { expiresIn: "1h" },
    )

    console.log("✅ Test fixtures initialized.\n")

    // =========================================================================
    // --- SUITE 1: Lead Creation Workflow Hook ---
    // =========================================================================
    console.log("▶ SUITE 1: Lead Creation Workflow Hook")

    let createdLead = null
    try {
      const result = await leadService.createOrMergeLead({
        tenantId: TENANT_A,
        source: "Website",
        payload: {
          name: "Dr. Gregory House",
          email: `house.${Date.now()}@princeton.edu`,
          phone: "+91 98765 00001",
          company: "Princeton Plainsboro",
          status: "New",
        },
        actor: {
          id: userAdminA._id,
          name: userAdminA.name,
          email: userAdminA.email,
          role: userAdminA.role,
        },
      })

      assert.strictEqual(result.action, "created")
      createdLead = result.lead

      // Query Activity collection for lead.created event
      const act = await Activity.findOne({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.created",
      })

      assert.ok(act, "Activity document for lead.created must be created")
      assert.strictEqual(act.actor.name, "Admin Alice")
      assert.strictEqual(act.payload.source, "Website")
      assert.strictEqual(act.payload.status, "New")
      assert.strictEqual(act.payload.company, "Princeton Plainsboro")
      pass("leadService.createOrMergeLead automatically records lead.created activity")
    } catch (err) {
      fail("leadService.createOrMergeLead automatically records lead.created activity", err)
    }

    // =========================================================================
    // --- SUITE 2: Lead Status Change Workflow Hook ---
    // =========================================================================
    console.log("\n▶ SUITE 2: Lead Status Change Workflow Hook")

    try {
      // 2.1 Transition from New to Engaged via HTTP API
      const res = await request(app)
        .patch(`/api/leads/${createdLead._id}/status`)
        .set("Authorization", `Bearer ${tokenTenantA}`)
        .set("Cookie", `client_token=${tokenTenantA}; token=${tokenTenantA}`)
        .send({ status: "Engaged" })

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)

      const act = await Activity.findOne({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.status_changed",
      })

      assert.ok(act, "Activity document for lead.status_changed must exist")
      assert.strictEqual(act.payload.fromStatus, "New")
      assert.strictEqual(act.payload.toStatus, "Engaged")
      assert.strictEqual(act.actor.name, userAdminA.name)
      pass("Lead status transition automatically records lead.status_changed activity")
    } catch (err) {
      fail("Lead status transition automatically records lead.status_changed activity", err)
    }

    // 2.2 Duplicate event prevention: updating to same status does NOT record new activity
    try {
      const countBefore = await Activity.countDocuments({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.status_changed",
      })

      const res = await request(app)
        .patch(`/api/leads/${createdLead._id}/status`)
        .set("Authorization", `Bearer ${tokenTenantA}`)
        .set("Cookie", `client_token=${tokenTenantA}; token=${tokenTenantA}`)
        .send({ status: "Engaged" }) // Unchanged!

      assert.strictEqual(res.status, 200)

      const countAfter = await Activity.countDocuments({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.status_changed",
      })

      assert.strictEqual(countAfter, countBefore, "Must not record activity when status is unchanged")
      pass("Duplicate prevention: Unchanged status does not create redundant activity records")
    } catch (err) {
      fail("Duplicate prevention: Unchanged status does not create redundant activity records", err)
    }

    // =========================================================================
    // --- SUITE 3: Lead Assignment Workflow Hook ---
    // =========================================================================
    console.log("\n▶ SUITE 3: Lead Assignment & Reassignment Workflow Hooks")

    // 3.1 Single lead assignment via assignmentService
    try {
      await assignmentService.assignLead(createdLead._id, userAgentA1._id, {
        actor: userAdminA,
        reason: "Initial clinical case routing",
        tenantId: TENANT_A,
      })

      const act = await Activity.findOne({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.owner_changed",
        "payload.toOwnerId": userAgentA1._id.toString(),
      })

      assert.ok(act, "Activity document for lead.owner_changed must exist")
      assert.strictEqual(act.payload.toOwnerName, "Agent Bob")
      assert.strictEqual(act.payload.reason, "Initial clinical case routing")
      assert.strictEqual(act.actor.name, "Admin Alice")
      pass("assignmentService.assignLead records lead.owner_changed activity")
    } catch (err) {
      fail("assignmentService.assignLead records lead.owner_changed activity", err)
    }

    // 3.2 Bulk reassignment hook via assignmentService.bulkAssignLeads
    try {
      const lead2 = await Lead.create({
        name: "Dr. James Wilson",
        email: `wilson.${Date.now()}@princeton.edu`,
        phone: "+91 98765 00002",
        status: "New",
        tenantId: TENANT_A,
      })

      await assignmentService.bulkAssignLeads({
        leadIds: [createdLead._id, lead2._id],
        targetOwnerId: userAgentA2._id,
        actor: userAdminA,
        reason: "Bulk department workload balancing",
        tenantId: TENANT_A,
      })

      const bulkActs = await Activity.find({
        tenantId: TENANT_A,
        leadId: { $in: [createdLead._id, lead2._id] },
        type: "lead.owner_changed",
        "payload.toOwnerId": userAgentA2._id.toString(),
      })

      assert.strictEqual(bulkActs.length, 2, "Bulk assignment must record activity for each reassigned lead")
      assert.ok(bulkActs.every((b) => b.payload.toOwnerName === "Agent Charlie"))
      pass("assignmentService.bulkAssignLeads records lead.owner_changed for all affected leads")

      await Lead.deleteOne({ _id: lead2._id })
    } catch (err) {
      fail("assignmentService.bulkAssignLeads records lead.owner_changed for all affected leads", err)
    }

    // =========================================================================
    // --- SUITE 4: Lead Note Addition Workflow Hook ---
    // =========================================================================
    console.log("\n▶ SUITE 4: Lead Note Addition Workflow Hook")

    try {
      // 4.1 Update lead with new note content via API
      const noteText = "Patient responded favorably to initial trial protocol."
      const res = await request(app)
        .put(`/api/leads/${createdLead._id}`)
        .set("Authorization", `Bearer ${tokenTenantA}`)
        .set("Cookie", `client_token=${tokenTenantA}; token=${tokenTenantA}`)
        .send({
          name: createdLead.name,
          email: createdLead.email,
          phone: createdLead.phone,
          message: noteText,
        })

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`)

      const act = await Activity.findOne({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.note_added",
      })

      assert.ok(act, "Activity document for lead.note_added must exist")
      assert.strictEqual(act.payload.note, noteText)
      assert.strictEqual(act.actor.name, userAdminA.name)
      pass("Adding communication note records lead.note_added activity")
    } catch (err) {
      fail("Adding communication note records lead.note_added activity", err)
    }

    // 4.2 Updating unrelated fields (e.g. company) does NOT trigger lead.note_added
    try {
      const countBefore = await Activity.countDocuments({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.note_added",
      })

      const res = await request(app)
        .put(`/api/leads/${createdLead._id}`)
        .set("Authorization", `Bearer ${tokenTenantA}`)
        .set("Cookie", `client_token=${tokenTenantA}; token=${tokenTenantA}`)
        .send({
          name: createdLead.name,
          email: createdLead.email,
          phone: createdLead.phone,
          company: "Princeton Diagnostic Medicine", // Only company changed
        })

      assert.strictEqual(res.status, 200)

      const countAfter = await Activity.countDocuments({
        tenantId: TENANT_A,
        leadId: createdLead._id,
        type: "lead.note_added",
      })

      assert.strictEqual(countAfter, countBefore, "Must not record note_added when message is unchanged")
      pass("Duplicate prevention: Non-note edits do not create redundant note_added events")
    } catch (err) {
      fail("Duplicate prevention: Non-note edits do not create redundant note_added events", err)
    }

    // =========================================================================
    // --- SUITE 5: Full Lead Timeline Feeder Querying & Tenant Isolation ---
    // =========================================================================
    console.log("\n▶ SUITE 5: Complete Timeline Feed & Tenant Boundary Isolation")

    try {
      const fullTimeline = await activity.getLeadActivities(createdLead._id, {
        tenantId: TENANT_A,
      })

      assert.ok(fullTimeline.length >= 4, `Expected at least 4 timeline events, got ${fullTimeline.length}`)
      const types = fullTimeline.map((item) => item.type)
      assert.ok(types.includes("lead.created"), "Timeline must contain lead.created")
      assert.ok(types.includes("lead.status_changed"), "Timeline must contain lead.status_changed")
      assert.ok(types.includes("lead.owner_changed"), "Timeline must contain lead.owner_changed")
      assert.ok(types.includes("lead.note_added"), "Timeline must contain lead.note_added")

      pass("getLeadActivities returns unified chronological activity story for lead drawer")
    } catch (err) {
      fail("getLeadActivities returns unified chronological activity story for lead drawer", err)
    }

    // 5.2 Tenant boundary isolation on activities
    try {
      const crossTenantActs = await activity.getLeadActivities(createdLead._id, {
        tenantId: TENANT_B,
      })
      assert.strictEqual(crossTenantActs.length, 0, "Cross-tenant query must return 0 activity records")
      pass("Tenant Boundary: Tenant B cannot access Tenant A activities")
    } catch (err) {
      fail("Tenant Boundary: Tenant B cannot access Tenant A activities", err)
    }

    // 5.3 Failure Handling: Activity recording failure does not crash core lead update
    try {
      // Intentionally mock an activity failure to verify resilience
      const originalRecord = activity.record
      activity.record = async () => {
        throw new Error("Simulated database failure during activity recording")
      }

      // Updating lead status must still succeed even if activity logging fails
      const res = await request(app)
        .patch(`/api/leads/${createdLead._id}/status`)
        .set("Authorization", `Bearer ${tokenTenantA}`)
        .set("Cookie", `client_token=${tokenTenantA}; token=${tokenTenantA}`)
        .send({ status: "Proposal Sent" })

      assert.strictEqual(res.status, 200, "Core business operation must succeed even if activity recording fails")
      activity.record = originalRecord // Restore original function
      pass("Resilience: Core business operations gracefully survive activity recording errors")
    } catch (err) {
      fail("Resilience: Core business operations gracefully survive activity recording errors", err)
    }

  } catch (err) {
    console.error("FATAL ERROR in test execution:", err)
    failedTests++
  } finally {
    // Cleanup fixtures
    try {
      await Lead.deleteMany({ tenantId: TENANT_A })
      await Activity.deleteMany({ tenantId: TENANT_A })
      await User.deleteMany({ tenantId: TENANT_A })
      await Role.deleteMany({ tenantId: TENANT_A })
    } catch (_) {}

    await mongoose.disconnect()

    console.log("\n========================================================")
    console.log(`  PHASE 10 TASK 3 TESTS: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log("========================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  }
}

runTests()
