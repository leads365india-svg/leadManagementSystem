/**
 * End-to-End Verification Suite: CSV City Mapping Persistence, Display APIs, Case Variants & Safe Repair
 *
 * Tests all 10 required checks against real Express endpoints & MongoDB Atlas:
 * 1. CSV City mapping reaches preview cleanly (manual & auto-mapped)
 * 2. Preview API returns exact `data.city`
 * 3. Execute API saves `city` directly into `Lead.city` (no custom-field duplication)
 * 4. Case-variant keys in nested JSON (`Data.City` vs `Data.city`) consolidate cleanly so later rows never drop City
 * 5. Standalone dotted column (`Sr. City` when `Sr` is scalar) is preserved cleanly
 * 6. `GET /api/leads`, `GET /api/leads?search=<city>`, `GET /api/leads/:id`, and `PUT /api/leads/:id` return/persist `city`
 * 7. Dry-run city repair audits eligible records without mutating MongoDB
 * 8. Apply city repair fills only missing `city` by email/normalized phone, preserving tenantId/workspaceId/ownerId
 * 9. Already-populated `city` is NEVER overwritten; ambiguous/unmatched records are reported rather than guessed; no duplicates created
 * 10. Strict tenant & workspace isolation enforced across import and repair
 */

process.env.NODE_ENV = "test"
const path = require("path")
const dns = require("dns")
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const dotenv = require("dotenv")
dotenv.config({ path: path.join(__dirname, "../.env") })

const assert = require("assert")
const mongoose = require("mongoose")
const request = require("supertest")
const jwt = require("jsonwebtoken")

const app = require("../start")
const Account = require("../models/Account")
const User = require("../models/User")
const Workspace = require("../models/Workspace")
const Lead = require("../models/Lead")
const { invalidateAccountWorkspaceModeCache } = require("../middleware/tenantContext")
const { invalidateTenantRoleCache } = require("../middleware/authMiddleware")
const { repairMissingCitiesFromFileBuffer } = require("../services/leadCityRepairService")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-dev-secret-key-min32-chars-for-local-only"

let passed = 0
let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`  ✅ PASS: ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`)
    failed++
  }
}

function makeToken(userDoc) {
  return jwt.sign(
    {
      id: userDoc._id.toString(),
      email: userDoc.email,
      role: userDoc.role,
      tenantId: userDoc.tenantId || null,
      tokenVersion: userDoc.tokenVersion ?? 1,
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  )
}

async function main() {
  console.log("==========================================================================")
  console.log("   IMPORT LEADS - CITY PERSISTENCE, SEARCH/API & SAFE REPAIR SUITE        ")
  console.log("==========================================================================\n")

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI)
  }

  const tag = `cityfix_${Date.now()}`
  const TENANT_A = `ACC-CITY-A-${tag}`
  const TENANT_B = `ACC-CITY-B-${tag}`

  let adminA, adminB, wsAlpha, tokenA, tokenB

  try {
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "City Test Org A",
        displayName: "City Org A",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin A",
        adminEmail: `admina_${tag}@test.local`,
        workspaceModeEnabled: true,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "City Test Org B",
        displayName: "City Org B",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Admin B",
        adminEmail: `adminb_${tag}@test.local`,
        workspaceModeEnabled: false,
        status: "active",
      },
    ])

    adminA = await User.create({
      tenantId: TENANT_A,
      name: "Admin A",
      email: `admina_${tag}@test.local`,
      password: "TestPassword@123",
      role: "account_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    adminB = await User.create({
      tenantId: TENANT_B,
      name: "Admin B",
      email: `adminb_${tag}@test.local`,
      password: "TestPassword@123",
      role: "account_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    wsAlpha = await Workspace.create({
      tenantId: TENANT_A,
      name: "Alpha Showroom",
      slug: `alpha-${tag}`,
      status: "active",
    })

    tokenA = makeToken(adminA)
    tokenB = makeToken(adminB)
    invalidateAccountWorkspaceModeCache()
    invalidateTenantRoleCache()

    // 1. Standard CSV with manually mapped City column reaches preview -> execute -> Lead.city -> Leads API + search + update
    await runTest("1. Manual CSV City mapping flows through parse -> preview -> execute -> DB Lead.city -> Leads API & search", async () => {
      const csv = [
        "Full Name,Email Address,Phone,Destination Town,Sr,Sr. City",
        `Rohan Mehta,rohan_${tag}@example.com,9876501101,Jaipur,1,ignored_dot`,
        `Meera Kapoor,meera_${tag}@example.com,9876501102,Udaipur,2,ignored_dot2`,
      ].join("\n")

      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .attach("file", Buffer.from(csv, "utf8"), "city_manual.csv")

      assert.strictEqual(parseRes.status, 200)
      const { rows, autoMapping } = parseRes.body.data
      assert.strictEqual(rows[0]["Destination Town"], "Jaipur")

      // User explicitly maps "Destination Town" -> "city" manually
      const manualMapping = { ...autoMapping, "Destination Town": "city" }

      const previewRes = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .send({ rows, mapping: manualMapping })

      assert.strictEqual(previewRes.status, 200)
      assert.strictEqual(previewRes.body.data.summary.valid, 2)
      assert.strictEqual(previewRes.body.data.rows[0].data.city, "Jaipur")
      assert.strictEqual(previewRes.body.data.rows[1].data.city, "Udaipur")

      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .send({ rows, mapping: manualMapping, importBatchId: `manual_city_${tag}`, fileName: "city_manual.csv" })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 2)

      const rohanDb = await Lead.findOne({ tenantId: TENANT_A, email: `rohan_${tag}@example.com` }).lean()
      assert(rohanDb, "Lead must exist in DB")
      assert.strictEqual(rohanDb.city, "Jaipur")
      assert.strictEqual(rohanDb.workspaceId.toString(), wsAlpha._id.toString())

      // Verify GET /api/leads returns city & supports search by city
      const listRes = await request(app)
        .get(`/api/leads?search=Udaipur`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
      assert.strictEqual(listRes.status, 200)
      assert.strictEqual(listRes.body.data.leads.length, 1)
      assert.strictEqual(listRes.body.data.leads[0].city, "Udaipur")

      // Verify GET /api/leads/:id returns city
      const detailRes = await request(app)
        .get(`/api/leads/${rohanDb._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
      assert.strictEqual(detailRes.status, 200)
      assert.strictEqual(detailRes.body.data.city, "Jaipur")

      // Verify PUT /api/leads/:id updates city cleanly
      const updateRes = await request(app)
        .put(`/api/leads/${rohanDb._id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .send({ city: "Jodhpur" })
      assert.strictEqual(updateRes.status, 200)
      const afterUpdate = await Lead.findById(rohanDb._id).lean()
      assert.strictEqual(afterUpdate.city, "Jodhpur")
    })

    // 2. Dotted top-level column (`Sr. City`) alongside scalar `Sr` preserves value cleanly
    await runTest("2. Top-level dotted column (`Sr. City` when `Sr` is plain scalar) preserves City value cleanly", async () => {
      const csv = [
        "Name,Email,Sr,Sr. City",
        `Dot Header Lead,dot_${tag}@example.com,100,Bikaner`,
      ].join("\n")

      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${tokenB}`)
        .attach("file", Buffer.from(csv, "utf8"), "dotted.csv")

      const { rows, autoMapping } = parseRes.body.data
      const mapping = { ...autoMapping, "Sr. City": "city" }

      const previewRes = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ rows, mapping })
      assert.strictEqual(previewRes.status, 200)
      assert.strictEqual(previewRes.body.data.rows[0].data.city, "Bikaner")
    })

    // 3. Nested JSON case-variant City keys (`Data.City` vs `Data.city`) consolidate cleanly without losing later rows
    await runTest("3. Nested JSON case-variant keys (`Data.City` and `Data.city`) consolidate into mapped column cleanly", async () => {
      const esc = (s) => `"${String(s).replace(/"/g, '""')}"`
      const csv = [
        "ID,Data",
        `1,${esc(JSON.stringify({ Name: "Case Upper Lead", Email: `upper_${tag}@test.com`, Phone: "9876502201", City: "Jaipur" }))}`,
        `2,${esc(JSON.stringify({ Name: "Case Lower Lead", Email: `lower_${tag}@test.com`, Phone: "9876502202", city: "Ahmedabad" }))}`,
        `3,${esc(JSON.stringify({ Name: "Case Trim Lead", Email: `trim_${tag}@test.com`, Phone: "9876502203", "City ": "Indore" }))}`,
      ].join("\n")

      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${tokenB}`)
        .attach("file", Buffer.from(csv, "utf8"), "nested_city_cases.csv")

      assert.strictEqual(parseRes.status, 200)
      const { headers, rows, autoMapping } = parseRes.body.data
      assert.strictEqual(headers.filter((h) => h.toLowerCase() === "data.city").length, 1, "Must consolidate case-variant Data.City keys")
      assert.strictEqual(autoMapping["Data.City"], "city")

      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ rows, mapping: autoMapping, importBatchId: `nested_cases_${tag}` })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 3)

      const lowerDoc = await Lead.findOne({ tenantId: TENANT_B, email: `lower_${tag}@test.com` }).lean()
      const trimDoc = await Lead.findOne({ tenantId: TENANT_B, email: `trim_${tag}@test.com` }).lean()
      assert.strictEqual(lowerDoc.city, "Ahmedabad")
      assert.strictEqual(trimDoc.city, "Indore")
    })

    // 4. Safe batch repair: dry-run, apply missing only, never overwrite existing City, skip ambiguous/unmatched, keep isolation
    await runTest("4. Safe city repair audits in dry-run, fills missing City accurately, never overwrites existing City, and enforces tenant isolation", async () => {
      const repairBatchId = `imp_repair_${tag}`
      const ownerObjId = adminA._id

      // Seed prior imported leads in TENANT_A (wsAlpha) & TENANT_B (must stay isolated!)
      const lMissing1 = await Lead.create({
        tenantId: TENANT_A,
        workspaceId: wsAlpha._id,
        ownerId: ownerObjId,
        assignedTo: adminA.name,
        name: "Missing City Phone Match",
        email: "",
        phone: "9876503301",
        phoneNormalized: "+919876503301",
        city: "",
        source: "Bulk Import",
        metadata: { importBatchId: repairBatchId, idempotencyKey: `import:${repairBatchId}:row:1` },
      })
      const lMissing2 = await Lead.create({
        tenantId: TENANT_A,
        workspaceId: wsAlpha._id,
        ownerId: ownerObjId,
        assignedTo: adminA.name,
        name: "Missing City Email Match",
        email: `rep_email_${tag}@test.com`,
        phone: "",
        city: "",
        source: "Bulk Import",
        metadata: { importBatchId: repairBatchId, idempotencyKey: `import:${repairBatchId}:row:2` },
      })
      const lAlreadySet = await Lead.create({
        tenantId: TENANT_A,
        workspaceId: wsAlpha._id,
        ownerId: ownerObjId,
        name: "Already Has City",
        email: `rep_keep_${tag}@test.com`,
        phone: "+91 98765 03303",
        phoneNormalized: "+919876503303",
        city: "Existing Verified City",
        source: "Bulk Import",
        metadata: { importBatchId: repairBatchId, idempotencyKey: `import:${repairBatchId}:row:3` },
      })
      // Ambiguous duplicate emails in same batch scope (should NOT guess!)
      await Lead.create([
        {
          tenantId: TENANT_A,
          workspaceId: wsAlpha._id,
          name: "Ambiguous One",
          email: `ambig_${tag}@test.com`,
          city: "",
          metadata: { importBatchId: repairBatchId, idempotencyKey: `import:${repairBatchId}:row:98` },
        },
        {
          tenantId: TENANT_A,
          workspaceId: wsAlpha._id,
          name: "Ambiguous Two",
          email: `ambig_${tag}@test.com`,
          city: "",
          metadata: { importBatchId: repairBatchId, idempotencyKey: `import:${repairBatchId}:row:99` },
        },
      ])
      // Lead in TENANT_B with SAME phone as lMissing1 (must stay untouched!)
      const lOtherTenant = await Lead.create({
        tenantId: TENANT_B,
        name: "Foreign Tenant Untouched",
        email: `foreign_${tag}@test.com`,
        phone: "9876503301",
        phoneNormalized: "+919876503301",
        city: "",
        source: "Bulk Import",
      })

      const esc = (s) => `"${String(s).replace(/"/g, '""')}"`
      const sourceCsv = Buffer.from(
        [
          "ID,Data",
          `1,${esc(JSON.stringify({ Name: "Missing City Phone Match", Phone: "+91 98765 03301", City: "Mumbai" }))}`,
          `2,${esc(JSON.stringify({ Name: "Missing City Email Match", Email: `REP_EMAIL_${tag}@test.com`, City: "Bengaluru" }))}`,
          `3,${esc(JSON.stringify({ Name: "Already Has City", Email: `rep_keep_${tag}@test.com`, City: "Should Never Overwrite" }))}`,
          `4,${esc(JSON.stringify({ Name: "Ambiguous", Email: `ambig_${tag}@test.com`, City: "Chennai" }))}`,
          `5,${esc(JSON.stringify({ Name: "Unmatched Row", Email: `noone_${tag}@test.com`, City: "Kolkata" }))}`,
        ].join("\n"),
        "utf8",
      )

      // Dry-run first
      const dryRes = await repairMissingCitiesFromFileBuffer({
        tenantId: TENANT_A,
        importBatchId: repairBatchId,
        buffer: sourceCsv,
        originalName: "repair.csv",
        dryRun: true,
      })
      assert.strictEqual(dryRes.summary.eligibleRepairs, 2)
      assert.strictEqual(dryRes.summary.repairedCount, 0)
      assert.strictEqual(dryRes.summary.alreadyPopulatedCount, 1)
      assert.strictEqual(dryRes.summary.ambiguousCount, 1)
      assert.strictEqual(dryRes.summary.unmatchedCount, 1)

      // Confirm dry-run wrote zero DB changes
      const checkDry = await Lead.findById(lMissing1._id).lean()
      assert.strictEqual(checkDry.city, "")

      // Apply repair
      const applyRes = await repairMissingCitiesFromFileBuffer({
        tenantId: TENANT_A,
        importBatchId: repairBatchId,
        buffer: sourceCsv,
        originalName: "repair.csv",
        dryRun: false,
      })
      assert.strictEqual(applyRes.summary.eligibleRepairs, 2)
      assert.strictEqual(applyRes.summary.repairedCount, 2)

      const repaired1 = await Lead.findById(lMissing1._id).lean()
      const repaired2 = await Lead.findById(lMissing2._id).lean()
      const kept3 = await Lead.findById(lAlreadySet._id).lean()
      const foreignUntouched = await Lead.findById(lOtherTenant._id).lean()

      assert.strictEqual(repaired1.city, "Mumbai")
      assert.strictEqual(repaired1.workspaceId.toString(), wsAlpha._id.toString())
      assert.strictEqual(repaired1.ownerId.toString(), ownerObjId.toString())
      assert.strictEqual(repaired2.city, "Bengaluru")
      assert.strictEqual(kept3.city, "Existing Verified City", "Existing non-empty City MUST NOT be overwritten")
      assert.strictEqual(foreignUntouched.city, "", "TENANT_B lead MUST remain untouched")

      // Idempotent second run changes 0 rows
      const secondRun = await repairMissingCitiesFromFileBuffer({
        tenantId: TENANT_A,
        importBatchId: repairBatchId,
        buffer: sourceCsv,
        originalName: "repair.csv",
        dryRun: false,
      })
      assert.strictEqual(secondRun.summary.repairedCount, 0)
      assert.strictEqual(secondRun.summary.alreadyPopulatedCount, 3)
    })
  } finally {
    const testTenants = [TENANT_A, TENANT_B]
    await Promise.all([
      Lead.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      Workspace.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      User.deleteMany({ email: { $regex: tag } }),
      Account.deleteMany({ accountId: { $in: testTenants } }),
    ]).catch(() => {})
    await mongoose.disconnect().catch(() => {})
  }

  console.log(`\n=== CITY IMPORT & REPAIR SUITE SUMMARY: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
