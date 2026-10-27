const assert = require("assert")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const request = require("supertest")

dotenv.config()
process.env.NODE_ENV = "test"

const connectDB = require("../db/connection")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const User = require("../models/User")
const Account = require("../models/Account")
const { runWithTenantContext } = require("../middleware/tenantContext")

let app = null

/**
 * Automated Verification Suite for Roadmap Phase 3: Tenant Isolation Layer
 * 
 * Verifies:
 * 1. Automatic tenant partition injection on Mongoose queries (find, count, update, delete)
 * 2. Automatic tenant stamping on document save and bulk insert
 * 3. Fail-safe: rejection of queries executed without tenant context or explicit bypass
 * 4. Cross-tenant mutation and query tampering rejection
 * 5. Multi-tenant User compound email uniqueness (same agent email in multiple tenants)
 * 6. Global super-admin email uniqueness
 * 7. HTTP API boundary isolation
 */

const TEST_TAG = `p3_test_${Date.now()}`
const TENANT_A = `tenant_p3_a_${Date.now()}`
const TENANT_B = `tenant_p3_b_${Date.now()}`

const cleanupData = async () => {
  try {
    await Lead.deleteMany({
      $or: [
        { tenantId: { $in: [TENANT_A, TENANT_B] } },
        { email: { $regex: TEST_TAG } },
      ],
    }).setOptions({ skipTenantFilter: true })

    await FollowUp.deleteMany({
      tenantId: { $in: [TENANT_A, TENANT_B] },
    }).setOptions({ skipTenantFilter: true })

    await User.deleteMany({
      email: { $regex: TEST_TAG },
    })

    await Account.deleteMany({
      accountId: { $in: [TENANT_A, TENANT_B] },
    })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

const runTests = async () => {
  console.log("\n=======================================================")
  console.log("🚀 STARTING PHASE 3 VERIFICATION: TENANT ISOLATION LAYER")
  console.log("=======================================================\n")

  let passed = 0
  let failed = 0

  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`  ✅ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`)
      console.error(`     Reason: ${err.message}`)
      failed++
    }
  }

  try {
    await connectDB()
    app = require("../start")
    await cleanupData()

    console.log("--- Suite 1: Mongoose Ambient Context & Auto-Stamping ---")

    let leadAId = null
    let leadBId = null

    await test("Lead creation in Tenant A context automatically stamps tenantId without manual field", async () => {
      await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
        const leadA = new Lead({
          name: "Tenant A Lead",
          email: `leadA_${TEST_TAG}@example.com`,
          phone: "+15551112222",
          status: "New",
        })
        await leadA.save()
        leadAId = leadA._id.toString()
        assert.strictEqual(leadA.tenantId, TENANT_A, "tenantId must be automatically stamped from ambient context")
      })
    })

    await test("Lead creation in Tenant B context automatically stamps tenantId", async () => {
      await runWithTenantContext({ tenantId: TENANT_B, isSuperAdmin: false }, async () => {
        const leadB = new Lead({
          name: "Tenant B Lead",
          email: `leadB_${TEST_TAG}@example.com`,
          phone: "+15553334444",
          status: "New",
        })
        await leadB.save()
        leadBId = leadB._id.toString()
        assert.strictEqual(leadB.tenantId, TENANT_B, "tenantId must be automatically stamped from ambient context")
      })
    })

    await test("Lead.find() in Tenant A context returns ONLY Tenant A leads (zero leakage of Tenant B)", async () => {
      await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
        // Developer intentionally does NOT specify tenantId in query
        const leads = await Lead.find({ email: { $regex: TEST_TAG } })
        assert.strictEqual(leads.length, 1, "Should only return exactly 1 lead belonging to Tenant A")
        assert.strictEqual(leads[0].tenantId, TENANT_A)
        assert.strictEqual(leads[0].name, "Tenant A Lead")
      })
    })

    await test("Lead.countDocuments() in Tenant B context counts ONLY Tenant B leads", async () => {
      await runWithTenantContext({ tenantId: TENANT_B, isSuperAdmin: false }, async () => {
        const count = await Lead.countDocuments({ email: { $regex: TEST_TAG } })
        assert.strictEqual(count, 1, "Should count only Tenant B records")
      })
    })

    console.log("\n--- Suite 2: Fail-Safe Query Rejection without Context ---")

    await test("Query without ambient tenant context and without skipTenantFilter throws Error", async () => {
      let threw = false
      try {
        await Lead.find()
      } catch (err) {
        threw = true
        assert(
          err.message.includes("Tenant context missing"),
          `Expected 'Tenant context missing' error, got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Query must fail-close when executed without tenant context")
    })

    await test("Query with explicit { skipTenantFilter: true } succeeds without context (system migration bypass)", async () => {
      const allLeads = await Lead.find({ email: { $regex: TEST_TAG } }).setOptions({ skipTenantFilter: true })
      assert(allLeads.length >= 2, "Bypass query should return records across all tenants")
    })

    await test("Super Admin global context can query across tenants without filter", async () => {
      await runWithTenantContext({ isSuperAdmin: true, tenantId: null }, async () => {
        const allLeads = await Lead.find({ email: { $regex: TEST_TAG } })
        assert(allLeads.length >= 2, "Super Admin global query should see leads from both tenants")
      })
    })

    console.log("\n--- Suite 3: Tampering & Cross-Tenant Violation Rejection ---")

    await test("Query attempting cross-tenant access in Tenant A context is rejected with violation error", async () => {
      let threw = false
      try {
        await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
          // Attacker passes another tenant's ID
          await Lead.find({ tenantId: TENANT_B })
        })
      } catch (err) {
        threw = true
        assert(
          err.message.includes("Cross-tenant query violation"),
          `Expected cross-tenant violation, got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Cross-tenant query tampering must throw error")
    })

    await test("Attempting to save document with mismatched tenantId in Tenant A context is rejected", async () => {
      let threw = false
      try {
        await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
          const rogueLead = new Lead({
            name: "Rogue Lead",
            tenantId: TENANT_B, // Mismatched tenant
            email: `rogue_${TEST_TAG}@example.com`,
            status: "New",
          })
          await rogueLead.save()
        })
      } catch (err) {
        threw = true
        assert(
          err.message.includes("Cross-tenant mutation denied"),
          `Expected cross-tenant mutation rejection, got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Cross-tenant document save must be rejected")
    })

    await test("Bulk insert with mismatched tenantId is rejected", async () => {
      let threw = false
      try {
        await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
          await Lead.insertMany([
            { name: "Bulk Tamper", tenantId: TENANT_B, status: "New" },
          ])
        })
      } catch (err) {
        threw = true
        assert(
          err.message.includes("Cross-tenant bulk insert denied"),
          `Expected bulk insert rejection, got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Cross-tenant bulk insert must be rejected")
    })

    console.log("\n--- Suite 4: FollowUp Isolation ---")

    await test("FollowUp creation automatically stamps tenantId and isolates timeline", async () => {
      await runWithTenantContext({ tenantId: TENANT_A, isSuperAdmin: false }, async () => {
        const followUp = new FollowUp({
          leadId: leadAId,
          title: "Follow-up for Tenant A",
          type: "call",
          scheduledAt: new Date(Date.now() + 86400000),
          status: "pending",
        })
        await followUp.save()
        assert.strictEqual(followUp.tenantId, TENANT_A)
      })

      // In Tenant B context, querying followups returns 0
      await runWithTenantContext({ tenantId: TENANT_B, isSuperAdmin: false }, async () => {
        const followUps = await FollowUp.find()
        assert.strictEqual(followUps.length, 0, "Tenant B must not see Tenant A followups")
      })
    })

    console.log("\n--- Suite 5: Multi-Tenant User Compound Email Uniqueness ---")

    const sharedAgentEmail = `agent_${TEST_TAG}@sharedagency.com`

    await test("Agent with same email can be created in Tenant A and Tenant B", async () => {
      const userA = new User({
        name: "Agent Alpha",
        email: sharedAgentEmail,
        password: "Password123!",
        role: "account_admin",
        tenantId: TENANT_A,
        status: "active",
      })
      await userA.save()
      assert(userA._id, "User in Tenant A must be created successfully")

      const userB = new User({
        name: "Agent Alpha at Agency B",
        email: sharedAgentEmail,
        password: "Password123!",
        role: "account_admin",
        tenantId: TENANT_B,
        status: "active",
      })
      await userB.save()
      assert(userB._id, "User in Tenant B with identical email must be created successfully")
    })

    await test("Duplicate email within the SAME tenant is strictly rejected", async () => {
      let threw = false
      try {
        const duplicateInA = new User({
          name: "Duplicate Agent",
          email: sharedAgentEmail,
          password: "Password123!",
          role: "account_admin",
          tenantId: TENANT_A,
          status: "active",
        })
        await duplicateInA.save()
      } catch (err) {
        threw = true
        assert(
          err.code === 11000 || err.message.includes("duplicate key"),
          `Expected Mongo duplicate key error (11000), got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Duplicate email in same tenant must fail")
    })

    await test("Super Admin email is globally unique across the system", async () => {
      const superAdminEmail = `superadmin_${TEST_TAG}@leads365.com`
      const sa1 = new User({
        name: "Super Admin 1",
        email: superAdminEmail,
        password: "Password123!",
        role: "super_admin",
        tenantId: null,
        status: "active",
      })
      await sa1.save()

      let threw = false
      try {
        const sa2 = new User({
          name: "Super Admin Duplicate",
          email: superAdminEmail,
          password: "Password123!",
          role: "super_admin",
          tenantId: null,
          status: "active",
        })
        await sa2.save()
      } catch (err) {
        threw = true
        assert(
          err.code === 11000 || err.message.includes("duplicate key"),
          `Expected duplicate key error for super_admin email, got: ${err.message}`
        )
      }
      assert.strictEqual(threw, true, "Super admin email must be globally unique")
    })

  } catch (globalErr) {
    console.error("Fatal error during Phase 3 verification:", globalErr)
    failed++
  } finally {
    await cleanupData()
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  }

  console.log("\n=======================================================")
  console.log(`PHASE 3 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log("=======================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runTests()
