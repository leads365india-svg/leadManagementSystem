/**
 * Verification Test Suite: Phase 10 - Task 2: Activity Model & Service
 * 
 * Verifies:
 * 1. Activity model creation with tenantId, leadId, type, actor, payload, createdAt
 * 2. Activity schema validation (allowed types, required fields)
 * 3. Strict Lead Validation: Lead must exist in the caller's tenant
 * 4. Cross-tenant isolation: Cannot record activity for a lead belonging to another tenant
 * 5. Multi-tenant query isolation: Tenant B cannot read Tenant A activities
 * 6. Payload sanitization: Sensitive fields (passwords, tokens, raw keys) are automatically redacted
 * 7. Compound indexes exist on Activity collection
 */

const assert = require("assert")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")

dotenv.config({ path: path.join(__dirname, "../.env") })

const { Activity, ALLOWED_ACTIVITY_TYPES } = require("../models/Activity")
const { activity, activityService } = require("../services/activityService")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { runWithTenantContext } = require("../middleware/tenantContext")

const TENANT_A = `tenant_act_a_${Date.now()}`
const TENANT_B = `tenant_act_b_${Date.now()}`

let leadTenantA
let leadTenantB
let userTenantA

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
  console.log("   PHASE 10 TASK 2: ACTIVITY MODEL & SERVICE TESTS")
  console.log("========================================================\n")

  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) throw new Error("Missing MONGODB_URI in environment")
    await mongoose.connect(mongoUri)
    console.log("✅ MongoDB Connected")

    // Setup Test Fixtures
    userTenantA = await User.create({
      name: "Agent Sarah Tenant A",
      email: `sarah.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "agent",
      status: "active",
    })

    leadTenantA = await Lead.create({
      name: "Marcus Vance",
      email: `marcus.${Date.now()}@test.org`,
      phone: "+91 98765 11111",
      phoneNormalized: "+919876511111",
      status: "New",
      source: "Website",
      tenantId: TENANT_A,
    })

    leadTenantB = await Lead.create({
      name: "Diana Prince",
      email: `diana.${Date.now()}@test.org`,
      phone: "+91 98765 22222",
      phoneNormalized: "+919876522222",
      status: "New",
      source: "Google Ads",
      tenantId: TENANT_B,
    })

    console.log("✅ Test fixtures initialized.\n")

    // --- SUITE 1: Activity Creation & Schema Validation ---
    console.log("▶ SUITE 1: Activity Creation & Schema Validation")

    // 1.1 Successful recording of lead.created
    try {
      const act = await activity.record({
        tenantId: TENANT_A,
        leadId: leadTenantA._id,
        type: "lead.created",
        actor: {
          id: userTenantA._id,
          name: userTenantA.name,
          email: userTenantA.email,
          role: userTenantA.role,
        },
        payload: {
          source: "Website",
          landingPage: "https://leads365.com/demo",
        },
      })

      assert.ok(act, "Activity document should be returned")
      assert.strictEqual(act.tenantId, TENANT_A)
      assert.strictEqual(act.leadId.toString(), leadTenantA._id.toString())
      assert.strictEqual(act.type, "lead.created")
      assert.strictEqual(act.actor.name, "Agent Sarah Tenant A")
      assert.strictEqual(act.payload.source, "Website")
      assert.ok(act.createdAt instanceof Date, "createdAt should be a Date")
      pass("activity.record() saves valid activity document with proper fields")
    } catch (err) {
      fail("activity.record() saves valid activity document with proper fields", err)
    }

    // 1.2 Successful recording with short alias type (e.g. status_changed)
    try {
      const act = await activity.record({
        tenantId: TENANT_A,
        leadId: leadTenantA._id,
        type: "status_changed",
        actor: { name: "System Pipeline", role: "system" },
        payload: {
          fromStatus: "New",
          toStatus: "Engaged",
        },
      })
      assert.strictEqual(act.type, "status_changed")
      assert.strictEqual(act.payload.toStatus, "Engaged")
      pass("activity.record() supports canonical and alias event types")
    } catch (err) {
      fail("activity.record() supports canonical and alias event types", err)
    }

    // 1.3 Rejection of invalid activity type
    try {
      let threw = false
      try {
        await activity.record({
          tenantId: TENANT_A,
          leadId: leadTenantA._id,
          type: "unsupported.random_event",
          payload: {},
        })
      } catch (e) {
        threw = true
        assert.ok(e.message.includes("Invalid activity type"))
      }
      assert.strictEqual(threw, true, "Should reject unlisted activity type")
      pass("activity.record() rejects unlisted activity type")
    } catch (err) {
      fail("activity.record() rejects unlisted activity type", err)
    }

    // --- SUITE 2: Strict Lead Validation & Tenant Boundary Enforcement ---
    console.log("\n▶ SUITE 2: Strict Lead Validation & Tenant Boundary Enforcement")

    // 2.1 Rejects activity for non-existent lead
    try {
      let threw = false
      const fakeLeadId = new mongoose.Types.ObjectId()
      try {
        await activity.record({
          tenantId: TENANT_A,
          leadId: fakeLeadId,
          type: "lead.note_added",
          payload: { note: "Test note" },
        })
      } catch (e) {
        threw = true
        assert.ok(e.message.includes("not found or tenant mismatch"))
      }
      assert.strictEqual(threw, true, "Should reject non-existent lead")
      pass("activity.record() rejects non-existent leadId")
    } catch (err) {
      fail("activity.record() rejects non-existent leadId", err)
    }

    // 2.2 Cross-Tenant Isolation: Cannot record activity for Tenant B's lead using Tenant A
    try {
      let threw = false
      try {
        await activity.record({
          tenantId: TENANT_A,
          leadId: leadTenantB._id, // Belongs strictly to TENANT_B!
          type: "lead.status_changed",
          payload: { status: "Proposal Sent" },
        })
      } catch (e) {
        threw = true
        assert.ok(e.message.includes("not found or tenant mismatch"))
      }
      assert.strictEqual(threw, true, "Should reject cross-tenant activity injection")
      pass("Strict Tenant Isolation: Rejects recording activity for cross-tenant lead")
    } catch (err) {
      fail("Strict Tenant Isolation: Rejects recording activity for cross-tenant lead", err)
    }

    // 2.3 Rejects activity when tenantId is missing
    try {
      let threw = false
      try {
        await activity.record({
          tenantId: "",
          leadId: leadTenantA._id,
          type: "lead.created",
        })
      } catch (e) {
        threw = true
        assert.ok(e.message.includes("Tenant context is required"))
      }
      assert.strictEqual(threw, true, "Should reject missing tenantId")
      pass("activity.record() enforces presence of tenantId")
    } catch (err) {
      fail("activity.record() enforces presence of tenantId", err)
    }

    // --- SUITE 3: Payload Sanitization & Security ---
    console.log("\n▶ SUITE 3: Payload Sanitization & Security")

    // 3.1 Sensitive credentials in payload are automatically redacted
    try {
      const act = await activity.record({
        tenantId: TENANT_A,
        leadId: leadTenantA._id,
        type: "lead.field_edited",
        actor: { name: "Security Auditor" },
        payload: {
          field: "notes",
          noteContent: "User updated communication preferences",
          password: "PlainTextPassword123!",
          userToken: "jwt.secret.token.xyz",
          rawApiKey: "live_secret_key_9999",
          authCookie: "session=abcdef12345",
          safeIdentityKey: "safe_customer_id_101",
        },
      })

      assert.strictEqual(act.payload.field, "notes")
      assert.strictEqual(act.payload.noteContent, "User updated communication preferences")
      assert.strictEqual(act.payload.password, "[REDACTED]")
      assert.strictEqual(act.payload.userToken, "[REDACTED]")
      assert.strictEqual(act.payload.rawApiKey, "[REDACTED]")
      assert.strictEqual(act.payload.authCookie, "[REDACTED]")
      assert.strictEqual(act.payload.safeIdentityKey, "safe_customer_id_101")
      pass("Payload Sanitization: Automatically redacts passwords, tokens, and raw keys")
    } catch (err) {
      fail("Payload Sanitization: Automatically redacts passwords, tokens, and raw keys", err)
    }

    // --- SUITE 4: Activity Querying & Multi-Tenant Retrieval ---
    console.log("\n▶ SUITE 4: Activity Querying & Multi-Tenant Retrieval")

    // 4.1 Retrieve activities for Tenant A lead
    try {
      const list = await activity.getLeadActivities(leadTenantA._id, {
        tenantId: TENANT_A,
      })
      assert.ok(Array.isArray(list))
      assert.ok(list.length >= 3, `Expected at least 3 activities, got ${list.length}`)
      // Verify descending timestamp order
      for (let i = 0; i < list.length - 1; i++) {
        assert.ok(
          new Date(list[i].createdAt) >= new Date(list[i + 1].createdAt),
          "Activities must be sorted newest first",
        )
      }
      pass("activity.getLeadActivities() retrieves activities sorted newest first")
    } catch (err) {
      fail("activity.getLeadActivities() retrieves activities sorted newest first", err)
    }

    // 4.2 Cross-Tenant Query Isolation: Tenant B querying Tenant A's lead gets zero items
    try {
      const crossList = await activity.getLeadActivities(leadTenantA._id, {
        tenantId: TENANT_B,
      })
      assert.strictEqual(crossList.length, 0, "Tenant B must not see Tenant A lead activities")
      pass("Cross-Tenant Isolation: Tenant B cannot query Tenant A lead activities")
    } catch (err) {
      fail("Cross-Tenant Isolation: Tenant B cannot query Tenant A lead activities", err)
    }

    // 4.3 Type filtering works correctly
    try {
      const filtered = await activity.getLeadActivities(leadTenantA._id, {
        tenantId: TENANT_A,
        type: "lead.created",
      })
      assert.ok(filtered.length >= 1)
      assert.ok(filtered.every((item) => item.type === "lead.created"))
      pass("activity.getLeadActivities() filters by specific activity type")
    } catch (err) {
      fail("activity.getLeadActivities() filters by specific activity type", err)
    }

    // --- SUITE 5: Compound Index & Schema Verification ---
    console.log("\n▶ SUITE 5: Compound Index & Schema Verification")

    try {
      await Activity.syncIndexes()
      const indexes = await Activity.collection.indexes()
      const indexKeys = indexes.map((idx) => Object.keys(idx.key).join("_"))

      assert.ok(
        indexKeys.some((k) => k === "tenantId_leadId_createdAt"),
        "Missing compound index: { tenantId: 1, leadId: 1, createdAt: -1 }",
      )
      assert.ok(
        indexKeys.some((k) => k === "tenantId_type_createdAt"),
        "Missing compound index: { tenantId: 1, type: 1, createdAt: -1 }",
      )
      pass("Activity collection compound indexes are synchronized and verified")
    } catch (err) {
      fail("Activity collection compound indexes are synchronized and verified", err)
    }

  } catch (err) {
    console.error("FATAL ERROR in test execution:", err)
    failedTests++
  } finally {
    // Cleanup fixtures
    try {
      if (leadTenantA) {
        await Lead.deleteOne({ _id: leadTenantA._id })
        await Activity.deleteMany({ tenantId: TENANT_A })
      }
      if (leadTenantB) {
        await Lead.deleteOne({ _id: leadTenantB._id })
        await Activity.deleteMany({ tenantId: TENANT_B })
      }
      if (userTenantA) {
        await User.deleteOne({ _id: userTenantA._id })
      }
    } catch (_) {}

    await mongoose.disconnect()

    console.log("\n========================================================")
    console.log(`  PHASE 10 TASK 2 TESTS: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log("========================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  }
}

runTests()
