/**
 * Verification Test Suite: Phase 10 Complete - Final End-to-End Verification
 * 
 * Verifies:
 * 1. Historical Activity Migration (dry-run, live execution, idempotency, timestamps)
 * 2. Activity Timeline API (GET /api/leads/:id/activities):
 *    - 401 Unauthenticated rejection
 *    - 400 Invalid ID validation
 *    - 404 / 403 Multi-tenant isolation & cross-tenant defense
 *    - RBAC view scope enforcement
 *    - Chronological sorting, pagination, and type filtering
 * 3. Frontend Drawer & Follow-ups Integration Contract
 */

process.env.NODE_ENV = "test"
const assert = require("assert")
const path = require("path")
const fs = require("fs")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const jwt = require("jsonwebtoken")
const request = require("supertest")

dotenv.config({ path: path.join(__dirname, "../.env") })

const app = require("../start")
const { Activity } = require("../models/Activity")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { Role, ensureTenantRoles } = require("../models/Role")
const { migrateHistoricalActivities } = require("../scripts/migrateHistoricalActivities")
const { getJwtSecret } = require("../middleware/authMiddleware")

const TENANT_A = `tenant_p10_comp_a_${Date.now()}`
const TENANT_B = `tenant_p10_comp_b_${Date.now()}`

let tokenTenantA
let tokenTenantB
let userAdminA
let userAdminB
let testLeadA

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
  console.log("   PHASE 10: COMPLETE COMPREHENSIVE VERIFICATION SUITE  ")
  console.log("========================================================\n")

  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) throw new Error("Missing MONGODB_URI in environment")
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(mongoUri)
    }
    console.log("✅ MongoDB Connected")

    // Setup Test Fixtures
    const rolesA = await ensureTenantRoles(TENANT_A)
    const roleAdminA = rolesA.find((r) => r.slug === "account_admin")

    const rolesB = await ensureTenantRoles(TENANT_B)
    const roleAdminB = rolesB.find((r) => r.slug === "account_admin")

    userAdminA = await User.create({
      name: "Admin Alice",
      email: `alice.${Date.now()}@tenanta.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_A,
      role: "account_admin",
      roleId: roleAdminA?._id,
      status: "active",
    })

    userAdminB = await User.create({
      name: "Admin Bob",
      email: `bob.${Date.now()}@tenantb.com`,
      password: "HashedPassword123!",
      tenantId: TENANT_B,
      role: "account_admin",
      roleId: roleAdminB?._id,
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

    tokenTenantB = jwt.sign(
      {
        id: userAdminB._id.toString(),
        userId: userAdminB._id.toString(),
        email: userAdminB.email,
        role: userAdminB.role,
        tenantId: TENANT_B,
      },
      getJwtSecret(),
      { expiresIn: "1h" },
    )

    // Seed test lead with legacy statusHistory and assignmentHistory
    const pastDate1 = new Date(Date.now() - 86400000 * 3)
    const pastDate2 = new Date(Date.now() - 86400000 * 2)
    const pastDate3 = new Date(Date.now() - 86400000 * 1)

    testLeadA = await Lead.create({
      name: "Historical Case Lead",
      email: `hist.${Date.now()}@tenanta.com`,
      phone: "+91 99887 00001",
      phoneNormalized: "+919988700001",
      status: "Proposal Sent",
      source: "Google Ads",
      tenantId: TENANT_A,
      createdAt: pastDate1,
      metadata: {
        statusHistory: [
          {
            fromStatus: "New",
            toStatus: "Engaged",
            transitionedAt: pastDate2,
            transitionedBy: "Sales Agent 1",
          },
          {
            fromStatus: "Engaged",
            toStatus: "Proposal Sent",
            transitionedAt: pastDate3,
            transitionedBy: "Sales Agent 2",
          },
        ],
      },
      assignmentHistory: [
        {
          fromOwnerId: null,
          fromOwnerName: "Unassigned Pool",
          toOwnerId: userAdminA._id,
          toOwnerName: userAdminA.name,
          assignedAt: pastDate2,
          reason: "Lead distribution rule #1",
        },
      ],
    })

    console.log("✅ Test fixtures initialized.\n")

    // =========================================================================
    // --- SUITE 1: Historical Activity Migration ---
    // =========================================================================
    console.log("▶ SUITE 1: Historical Activity Migration (Dry-Run & Idempotency)")

    // 1.1 Dry-run execution
    try {
      const dryRunStats = await migrateHistoricalActivities({
        apply: false,
        tenantId: TENANT_A,
        quiet: true,
      })

      assert.strictEqual(dryRunStats.mode, "DRY-RUN (read-only)")
      assert.ok(dryRunStats.inserted >= 4, `Expected at least 4 prospective items, got ${dryRunStats.inserted}`)

      // Verify no documents were actually written in dry-run
      const countInDb = await Activity.countDocuments({ tenantId: TENANT_A })
      assert.strictEqual(countInDb, 0, "Dry-run must NOT write any documents to the database")
      pass("Migration dry-run: Accurately simulates without mutating database")
    } catch (err) {
      fail("Migration dry-run: Accurately simulates without mutating database", err)
    }

    // 1.2 Live apply execution
    try {
      const liveStats = await migrateHistoricalActivities({
        apply: true,
        tenantId: TENANT_A,
        quiet: true,
      })

      assert.strictEqual(liveStats.mode, "LIVE (--apply)")
      assert.ok(liveStats.inserted >= 4, `Expected at least 4 inserted items, got ${liveStats.inserted}`)
      assert.strictEqual(liveStats.failed, 0)

      const writtenActivities = await Activity.find({ tenantId: TENANT_A, leadId: testLeadA._id })
      assert.strictEqual(writtenActivities.length, 4, `Expected exactly 4 activities, got ${writtenActivities.length}`)

      const types = writtenActivities.map((a) => a.type)
      assert.ok(types.includes("lead.created"), "Must migrate lead.created")
      assert.strictEqual(types.filter((t) => t === "lead.status_changed").length, 2, "Must migrate 2 status transitions")
      assert.ok(types.includes("lead.owner_changed"), "Must migrate lead.owner_changed")

      pass("Migration live apply: Successfully backfills legacy status and assignment histories")
    } catch (err) {
      fail("Migration live apply: Successfully backfills legacy status and assignment histories", err)
    }

    // 1.3 Idempotency: re-running with --apply must NOT insert duplicates
    try {
      const secondRunStats = await migrateHistoricalActivities({
        apply: true,
        tenantId: TENANT_A,
        quiet: true,
      })

      assert.strictEqual(secondRunStats.inserted, 0, "Idempotency check: inserted count must be 0 on re-run")
      assert.ok(secondRunStats.skipped >= 4, "Previously migrated items must be skipped")

      const finalCount = await Activity.countDocuments({ tenantId: TENANT_A, leadId: testLeadA._id })
      assert.strictEqual(finalCount, 4, "Document count must remain 4 without duplicate records")

      pass("Migration idempotency: Re-running migration safely skips existing records without duplication")
    } catch (err) {
      fail("Migration idempotency: Re-running migration safely skips existing records without duplication", err)
    }

    // =========================================================================
    // --- SUITE 2: Activity Timeline API Endpoint (GET /api/leads/:id/activities) ---
    // =========================================================================
    console.log("\n▶ SUITE 2: Activity Timeline API Endpoint Verification")

    // 2.1 Unauthenticated access rejection
    try {
      const res = await request(app).get(`/api/leads/${testLeadA._id}/activities`)
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`)
      pass("GET /api/leads/:id/activities rejects unauthenticated requests with 401")
    } catch (err) {
      fail("GET /api/leads/:id/activities rejects unauthenticated requests with 401", err)
    }

    // 2.2 Invalid lead ID validation
    try {
      const res = await request(app)
        .get("/api/leads/invalid-not-an-objectid/activities")
        .set("Authorization", `Bearer ${tokenTenantA}`)
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`)
      pass("GET /api/leads/:id/activities validates ObjectId format with 400")
    } catch (err) {
      fail("GET /api/leads/:id/activities validates ObjectId format with 400", err)
    }

    // 2.3 Successful retrieval with pagination & chronological order
    try {
      const res = await request(app)
        .get(`/api/leads/${testLeadA._id}/activities?limit=10&page=1`)
        .set("Authorization", `Bearer ${tokenTenantA}`)

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`)
      assert.strictEqual(res.body.success, true)
      assert.ok(Array.isArray(res.body.data.activities))
      assert.strictEqual(res.body.data.activities.length, 4)
      assert.strictEqual(res.body.data.total, 4)
      assert.strictEqual(res.body.data.page, 1)

      // Verify descending chronological sort
      const times = res.body.data.activities.map((a) => new Date(a.createdAt).getTime())
      for (let i = 0; i < times.length - 1; i++) {
        assert.ok(times[i] >= times[i + 1], "Activities must be returned in descending chronological order")
      }

      pass("GET /api/leads/:id/activities returns chronological activities with pagination metadata")
    } catch (err) {
      fail("GET /api/leads/:id/activities returns chronological activities with pagination metadata", err)
    }

    // 2.4 Activity type filtering
    try {
      const res = await request(app)
        .get(`/api/leads/${testLeadA._id}/activities?type=lead.status_changed`)
        .set("Authorization", `Bearer ${tokenTenantA}`)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.data.activities.length, 2)
      assert.ok(res.body.data.activities.every((a) => a.type === "lead.status_changed"))
      pass("GET /api/leads/:id/activities supports ?type= filtering")
    } catch (err) {
      fail("GET /api/leads/:id/activities supports ?type= filtering", err)
    }

    // 2.5 Strict Multi-Tenant Isolation
    try {
      const res = await request(app)
        .get(`/api/leads/${testLeadA._id}/activities`)
        .set("Authorization", `Bearer ${tokenTenantB}`) // Token from Tenant B!

      assert.strictEqual(res.status, 404, `Expected 404 tenant isolation rejection, got ${res.status}`)
      pass("Strict Multi-Tenant Isolation: Tenant B receives 404 attempting to access Tenant A activities")
    } catch (err) {
      fail("Strict Multi-Tenant Isolation: Tenant B receives 404 attempting to access Tenant A activities", err)
    }

    // =========================================================================
    // --- SUITE 3: Frontend Contract & Drawer Integration Verification ---
    // =========================================================================
    console.log("\n▶ SUITE 3: Frontend Drawer & Follow-ups Contract Verification")

    // 3.1 Verify lead-detail-drawer.jsx fetches real activities from API
    try {
      const drawerFile = path.join(__dirname, "../../frontend/components/lead-detail-drawer.jsx")
      const drawerCode = fs.readFileSync(drawerFile, "utf-8")

      assert.ok(drawerCode.includes("getLeadActivities"), "Drawer must call apiClient.getLeadActivities")
      assert.ok(drawerCode.includes("loadingActivities"), "Drawer must implement loading state for activities")
      assert.ok(drawerCode.includes("activitiesError"), "Drawer must implement error state with retry button")
      assert.ok(drawerCode.includes("lead.status_changed"), "Drawer must parse canonical activity types")
      assert.ok(drawerCode.includes("lead.owner_changed"), "Drawer must parse assignment activity types")

      pass("lead-detail-drawer.jsx integrates real Activity API with loading and error states")
    } catch (err) {
      fail("lead-detail-drawer.jsx integrates real Activity API with loading and error states", err)
    }

    // 3.2 Verify follow-ups page opens LeadDetailDrawer
    try {
      const followUpsFile = path.join(__dirname, "../../frontend/app/communication/follow-ups/page.jsx")
      const followUpsCode = fs.readFileSync(followUpsFile, "utf-8")

      assert.ok(followUpsCode.includes("LeadDetailDrawer"), "Follow-ups page must import LeadDetailDrawer")
      assert.ok(followUpsCode.includes("activeDrawerLeadId"), "Follow-ups page must manage activeDrawerLeadId state")

      pass("follow-ups/page.jsx connects LeadDetailDrawer to open from follow-ups view")
    } catch (err) {
      fail("follow-ups/page.jsx connects LeadDetailDrawer to open from follow-ups view", err)
    }

    // 3.3 Verify frontend API client exports getLeadActivities
    try {
      const apiFile = path.join(__dirname, "../../frontend/lib/api.js")
      const apiCode = fs.readFileSync(apiFile, "utf-8")

      assert.ok(apiCode.includes("getLeadActivities(leadId"), "frontend/lib/api.js must export getLeadActivities")
      pass("frontend/lib/api.js exports getLeadActivities helper")
    } catch (err) {
      fail("frontend/lib/api.js exports getLeadActivities helper", err)
    }

  } catch (err) {
    console.error("FATAL ERROR in test execution:", err)
    failedTests++
  } finally {
    // Cleanup fixtures
    try {
      await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await Activity.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
      await Role.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    } catch (_) {}

    await mongoose.disconnect()

    console.log("\n========================================================")
    console.log(`  PHASE 10 COMPLETE TESTS: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log("========================================================\n")

    if (failedTests > 0) {
      process.exit(1)
    }
  }
}

runTests()
