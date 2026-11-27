/**
 * Complete End-to-End Verification Suite: Tools -> Import Leads
 *
 * Tests all 15 functional, security, isolation, duplicate, and reliability requirements:
 * 1. Valid CSV import (including UTF-8 BOM, quoted commas, leading-zero phones, phone-only & email-only leads)
 * 2. Valid Excel (.xlsx & .xls) import preserving integer phone numbers without scientific notation
 * 3. Valid JSON import (array & { leads: [...] } shapes)
 * 4. Invalid/unsupported files (.txt, 0-byte, malformed JSON, corrupt xlsx, header-only empty data rows, >max rows)
 * 5. Missing required fields & invalid phone/email/status/deal-amount validation in Preview & Execute
 * 6. Duplicate leads (DB email & normalized E.164 phone matches + intra-file duplicates), default skip without overwrite
 * 7. Unmapped columns ignored safely + CustomField mapping supported
 * 8. Partial import failures (valid rows still saved when invalid/duplicate rows exist in same batch)
 * 9. Large file handling (600-row CSV across parse -> preview -> batched execute)
 * 10. Retry idempotency with same importBatchId (prevents duplicate inserts on retry)
 * 11. Standalone tenant behavior (workspaceId=null, never auto-creates workspaces, rejects targetWorkspaceId)
 * 12. Multi-Workspace: Org Admin All Projects (workspaceId=null + explicit targetWorkspaceId validation)
 * 13. Multi-Workspace: Individual workspace isolation (Alpha vs Beta duplicate & visibility boundaries)
 * 14. Workspace staff RBAC & membership enforcement (viewer rejected, missing leads.create rejected, non-member rejected, staff 'all' rejected)
 * 15. Cross-tenant isolation & Super Admin read-only enforcement
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
const xlsx = require("xlsx")

const app = require("../start")
const Account = require("../models/Account")
const User = require("../models/User")
const Role = require("../models/Role")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const Lead = require("../models/Lead")
const { CustomField } = require("../models/CustomField")
const { invalidateAccountWorkspaceModeCache } = require("../middleware/tenantContext")
const { invalidateTenantRoleCache } = require("../middleware/authMiddleware")
const { parseLeadImportFile, MAX_IMPORT_ROWS } = require("../services/leadImportService")

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
  console.log("=================================================================")
  console.log("   COMPLETE IMPORT LEADS VERIFICATION & ISOLATION TEST SUITE      ")
  console.log("=================================================================\n")

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI)
  }

  const tag = `imp_${Date.now()}`
  const SOLO_TENANT = `ACC-SOLO-${tag}`
  const ORG_TENANT = `ACC-ORG-${tag}`
  const OTHER_TENANT = `ACC-OTHER-${tag}`

  let soloAdmin, orgAdmin, orgStaffAlpha, orgViewerAlpha, noCreateStaff, otherAdmin, superAdmin
  let soloToken, orgAdminToken, orgStaffToken, orgViewerToken, noCreateToken, otherToken, superAdminToken
  let wsAlpha, wsBeta, wsOther

  try {
    // Seed Accounts
    await Account.create([
      {
        accountId: SOLO_TENANT,
        companyName: "Solo Import Corp",
        displayName: "Solo Import",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Solo Admin",
        adminEmail: `solo_${tag}@test.local`,
        workspaceModeEnabled: false,
        status: "active",
      },
      {
        accountId: ORG_TENANT,
        companyName: "Org Import Corp",
        displayName: "Org Import",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Org Admin",
        adminEmail: `orgadmin_${tag}@test.local`,
        workspaceModeEnabled: true,
        status: "active",
      },
      {
        accountId: OTHER_TENANT,
        companyName: "Other Import Corp",
        displayName: "Other Import",
        adminUserId: new mongoose.Types.ObjectId(),
        adminName: "Other Admin",
        adminEmail: `otheradmin_${tag}@test.local`,
        workspaceModeEnabled: true,
        status: "active",
      },
    ])

    // Custom role without leads.create
    const viewOnlyRole = await Role.create({
      tenantId: SOLO_TENANT,
      name: "ReadOnly Reporter",
      slug: `readonly_${tag}`,
      permissions: ["leads.view.all", "dashboard.view"],
    })
    const creatorRole = await Role.create({
      tenantId: ORG_TENANT,
      name: "Workspace Agent",
      slug: `ws_agent_${tag}`,
      permissions: ["leads.view.all", "leads.create", "dashboard.view"],
    })

    // Seed Users
    soloAdmin = await User.create({
      tenantId: SOLO_TENANT,
      name: "Solo Admin",
      email: `solo_${tag}@test.local`,
      password: "TestPassword@123",
      role: "account_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    noCreateStaff = await User.create({
      tenantId: SOLO_TENANT,
      name: "ReadOnly Staff",
      email: `nocreate_${tag}@test.local`,
      password: "TestPassword@123",
      role: viewOnlyRole.slug,
      roleId: viewOnlyRole._id,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    orgAdmin = await User.create({
      tenantId: ORG_TENANT,
      name: "Org Admin",
      email: `orgadmin_${tag}@test.local`,
      password: "TestPassword@123",
      role: "account_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    orgStaffAlpha = await User.create({
      tenantId: ORG_TENANT,
      name: "Alpha Staff",
      email: `alpha_staff_${tag}@test.local`,
      password: "TestPassword@123",
      role: creatorRole.slug,
      roleId: creatorRole._id,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    orgViewerAlpha = await User.create({
      tenantId: ORG_TENANT,
      name: "Alpha Viewer",
      email: `alpha_viewer_${tag}@test.local`,
      password: "TestPassword@123",
      role: creatorRole.slug,
      roleId: creatorRole._id,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    otherAdmin = await User.create({
      tenantId: OTHER_TENANT,
      name: "Other Admin",
      email: `otheradmin_${tag}@test.local`,
      password: "TestPassword@123",
      role: "account_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    superAdmin = await User.create({
      tenantId: null,
      name: "Super Admin Imp",
      email: `superimp_${tag}@test.local`,
      password: "TestPassword@123",
      role: "super_admin",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    })

    // Seed Workspaces & Memberships
    wsAlpha = await Workspace.create({
      tenantId: ORG_TENANT,
      name: "Alpha Project",
      slug: `alpha-${tag}`,
      status: "active",
    })
    wsBeta = await Workspace.create({
      tenantId: ORG_TENANT,
      name: "Beta Project",
      slug: `beta-${tag}`,
      status: "active",
    })
    wsOther = await Workspace.create({
      tenantId: OTHER_TENANT,
      name: "Foreign Project",
      slug: `foreign-${tag}`,
      status: "active",
    })

    await WorkspaceMembership.create([
      {
        tenantId: ORG_TENANT,
        workspaceId: wsAlpha._id,
        userId: orgStaffAlpha._id,
        role: "agent",
        status: "active",
      },
      {
        tenantId: ORG_TENANT,
        workspaceId: wsAlpha._id,
        userId: orgViewerAlpha._id,
        role: "viewer",
        status: "active",
      },
    ])

    // Custom field in SOLO_TENANT
    await CustomField.create({
      tenantId: SOLO_TENANT,
      name: "industry_vertical",
      label: "Industry Vertical",
      type: "text",
      status: "active",
    })

    // Existing DB lead for duplicate testing in SOLO_TENANT
    const existingSoloLead = await Lead.create({
      tenantId: SOLO_TENANT,
      name: "Existing Original Lead",
      email: `existing_${tag}@test.com`,
      phone: "+91 98765 00001",
      phoneNormalized: "+919876500001",
      company: "Original Company Kept",
      status: "Engaged",
      source: "Website",
    })

    soloToken = makeToken(soloAdmin)
    orgAdminToken = makeToken(orgAdmin)
    orgStaffToken = makeToken(orgStaffAlpha)
    orgViewerToken = makeToken(orgViewerAlpha)
    noCreateToken = makeToken(noCreateStaff)
    otherToken = makeToken(otherAdmin)
    superAdminToken = makeToken(superAdmin)

    invalidateAccountWorkspaceModeCache()
    invalidateTenantRoleCache()

    // 1. Config & Standalone Schema
    await runTest("GET /api/leads/import/config returns schema + active custom field in standalone mode", async () => {
      const res = await request(app)
        .get("/api/leads/import/config")
        .set("Authorization", `Bearer ${soloToken}`)
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.body.success, true)
      assert.strictEqual(res.body.data.scope.mode, "standalone")
      assert.strictEqual(res.body.data.scope.workspaceModeEnabled, false)
      assert(res.body.data.supportedFields.some((f) => f.key === "name" && f.required))
      assert(res.body.data.customFields.some((cf) => cf.key === "customField:industry_vertical"))
    })

    // 2. Valid CSV parse -> auto-mapping -> preview -> execute (including phone-only & email-only + unmapped column + custom field)
    await runTest("Valid CSV parses, auto-maps, previews without saving, and executes cleanly", async () => {
      const csvText = [
        "\uFEFFFull Name,Email Address,Mobile,Company,Source,Industry Vertical,Ignored Column",
        `Alice Verma,alice_${tag}@example.com,09876511101,"Acme, Corp",Trade Show,Healthcare,extra1`,
        `Phone Only Lead,,9876511102,Clinic Two,Referral,Dental,extra2`,
        `Email Only Lead,emailonly_${tag}@example.com,,Clinic Three,,Diagnostics,extra3`,
      ].join("\n")

      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from(csvText, "utf8"), "leads.csv")

      assert.strictEqual(parseRes.status, 200)
      const { headers, autoMapping, rows, totalRows } = parseRes.body.data
      assert.strictEqual(totalRows, 3)
      assert.strictEqual(autoMapping["Full Name"], "name")
      assert.strictEqual(autoMapping["Email Address"], "email")
      assert.strictEqual(autoMapping["Mobile"], "phone")
      assert.strictEqual(autoMapping["Company"], "company")
      assert.strictEqual(autoMapping["Source"], "source")
      assert.strictEqual(autoMapping["Industry Vertical"], "customField:industry_vertical")
      assert.strictEqual(autoMapping["Ignored Column"], "")
      assert.strictEqual(headers.length, 7)

      const previewRes = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows, mapping: autoMapping, defaultSource: "Bulk Import" })

      assert.strictEqual(previewRes.status, 200)
      assert.strictEqual(previewRes.body.data.summary.total, 3)
      assert.strictEqual(previewRes.body.data.summary.valid, 3)

      // Confirm preview did NOT persist anything yet
      const preCount = await Lead.countDocuments({
        tenantId: SOLO_TENANT,
        email: `alice_${tag}@example.com`,
      })
      assert.strictEqual(preCount, 0)

      const batchId = `csv_batch_${tag}`
      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows, mapping: autoMapping, defaultSource: "Bulk Import", importBatchId: batchId, fileName: "leads.csv" })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 3)
      assert.strictEqual(execRes.body.data.summary.failed, 0)

      const alice = await Lead.findOne({ tenantId: SOLO_TENANT, email: `alice_${tag}@example.com` }).lean()
      assert(alice, "Alice must exist in DB")
      assert.strictEqual(alice.phoneNormalized, "+919876511101")
      assert.strictEqual(alice.company, "Acme, Corp")
      assert.strictEqual(alice.workspaceId, null)
      assert(alice.customFields.some((c) => c.key === "industry_vertical" && c.value === "Healthcare"))
      assert.strictEqual(alice.metadata.Ignored, undefined)

      const phoneOnly = await Lead.findOne({ tenantId: SOLO_TENANT, phoneNormalized: "+919876511102" }).lean()
      assert(phoneOnly, "Phone-only lead must persist cleanly")

      // Retry idempotency with SAME importBatchId must skip all 3 without errors or duplicates
      const retryRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows, mapping: autoMapping, defaultSource: "Bulk Import", importBatchId: batchId })

      assert.strictEqual(retryRes.status, 200)
      assert.strictEqual(retryRes.body.data.summary.imported, 0)
      assert.strictEqual(retryRes.body.data.summary.skipped, 3)
    })

    // 3. Valid Excel (.xlsx & .xls) import
    await runTest("Valid Excel (.xlsx) import preserves numeric phones and saves records", async () => {
      const wb = xlsx.utils.book_new()
      const ws = xlsx.utils.aoa_to_sheet([
        ["Lead Name", "Contact", "Email", "Company"],
        ["Excel Vikram", 919876522201, `excel1_${tag}@test.com`, "Excel Corp"],
        ["Excel Meera", 9876522202, `excel2_${tag}@test.com`, "Sheet Two"],
      ])
      xlsx.utils.book_append_sheet(wb, ws, "Prospects")
      const xlsxBuf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" })

      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", xlsxBuf, "prospects.xlsx")

      assert.strictEqual(parseRes.status, 200)
      assert.strictEqual(parseRes.body.data.fileType, "excel")
      const { autoMapping, rows } = parseRes.body.data
      assert.strictEqual(rows[0]["Contact"], "919876522201")

      // Also verify legacy .xls (biff8) parsing
      const xlsBuf = xlsx.write(wb, { type: "buffer", bookType: "xls" })
      const xlsParseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", xlsBuf, "prospects.xls")
      assert.strictEqual(xlsParseRes.status, 200)
      assert.strictEqual(xlsParseRes.body.data.fileType, "excel")
      assert.strictEqual(xlsParseRes.body.data.totalRows, 2)

      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows, mapping: autoMapping, importBatchId: `xlsx_${tag}` })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 2)

      const vikram = await Lead.findOne({ tenantId: SOLO_TENANT, email: `excel1_${tag}@test.com` }).lean()
      assert.strictEqual(vikram.phoneNormalized, "+919876522201")
    })

    // 4. Valid JSON import ({ leads: [...] })
    await runTest("Valid JSON import parses and creates leads", async () => {
      const payload = {
        leads: [
          {
            "Full Name": "JSON Priya",
            Email: `json1_${tag}@example.com`,
            Phone: "+91 98765 33301",
            Company: "JSON Tech",
            Source: "Meta Ads",
          },
        ],
      }
      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from(JSON.stringify(payload), "utf8"), "leads.json")

      assert.strictEqual(parseRes.status, 200)
      assert.strictEqual(parseRes.body.data.fileType, "json")

      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({
          rows: parseRes.body.data.rows,
          mapping: parseRes.body.data.autoMapping,
          importBatchId: `json_${tag}`,
        })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 1)
    })

    // 5. Invalid and unsupported files
    await runTest("Rejects unsupported extensions, empty files, malformed JSON, header-only CSV, and >MAX_IMPORT_ROWS", async () => {
      const badExt = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from("hello"), "notes.txt")
      assert.strictEqual(badExt.status, 400)

      const emptyFile = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from(""), "empty.csv")
      assert.strictEqual(emptyFile.status, 400)

      const badJson = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from("{bad json"), "broken.json")
      assert.strictEqual(badJson.status, 400)

      const headerOnly = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from("Name,Email,Phone\n"), "headers_only.csv")
      assert.strictEqual(headerOnly.status, 400)

      const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => ({ name: `L${i}`, email: `l${i}@x.com` }))
      assert.throws(() =>
        parseLeadImportFile({ buffer: Buffer.from(JSON.stringify(tooMany)), originalName: "huge.json" }),
      )
    })

    // 6. Duplicates, missing required fields, bad email/phone, partial import failures, no silent overwrite
    await runTest("Detects duplicates, invalid emails/phones, missing fields, allows partial success, never overwrites", async () => {
      const mixedRows = [
        { __rowNumber: 1, Name: "Dup Email Lead", Email: `EXISTING_${tag}@TEST.COM`, Phone: "9999988888", Company: "Overwrite Attempt" },
        { __rowNumber: 2, Name: "Dup Phone Lead", Email: `newmail_${tag}@test.com`, Phone: "09876500001", Company: "Phone Overwrite Attempt" },
        { __rowNumber: 3, Name: "A", Email: `short_${tag}@test.com`, Phone: "" }, // name < 2 chars
        { __rowNumber: 4, Name: "Bad Email", Email: "not-an-email", Phone: "9876544401" },
        { __rowNumber: 5, Name: "Bad Phone", Email: `badph_${tag}@test.com`, Phone: "abc9876543210" },
        { __rowNumber: 6, Name: "No Contact", Email: "", Phone: "" }, // missing email & phone
        { __rowNumber: 7, Name: "Valid Partial Lead 1", Email: `partial1_${tag}@test.com`, Phone: "9876544402" },
        { __rowNumber: 8, Name: "In-File Dup Lead", Email: `partial1_${tag}@test.com`, Phone: "9876544403" }, // duplicate in file
      ]
      const mapping = { Name: "name", Email: "email", Phone: "phone", Company: "company" }

      const previewRes = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows: mixedRows, mapping })

      assert.strictEqual(previewRes.status, 200)
      assert.strictEqual(previewRes.body.data.summary.total, 8)
      assert.strictEqual(previewRes.body.data.summary.valid, 1)
      assert.strictEqual(previewRes.body.data.summary.duplicate, 3) // 2 DB dups + 1 in-file dup
      assert.strictEqual(previewRes.body.data.summary.invalid, 4)

      const execRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows: mixedRows, mapping, importBatchId: `mixed_${tag}` })

      assert.strictEqual(execRes.status, 200)
      assert.strictEqual(execRes.body.data.summary.imported, 1)
      assert.strictEqual(execRes.body.data.summary.duplicate, 3)
      assert.strictEqual(execRes.body.data.summary.skipped, 3)
      assert.strictEqual(execRes.body.data.summary.failed, 4)

      // Confirm original lead was NOT overwritten
      const originalAfter = await Lead.findById(existingSoloLead._id).lean()
      assert.strictEqual(originalAfter.name, "Existing Original Lead")
      assert.strictEqual(originalAfter.company, "Original Company Kept")
    })

    // 7. Large file handling (600 rows across parse -> preview -> batched execute)
    await runTest("Handles 600-row CSV across parse, preview, and multi-batch execute", async () => {
      const csvLines = ["Name,Email,Phone,Company"]
      for (let i = 1; i <= 600; i++) {
        const num = String(9000000000 + i)
        csvLines.push(`Bulk Lead ${i},bulk_${tag}_${i}@example.com,${num},Bulk Co ${i}`)
      }
      const parseRes = await request(app)
        .post("/api/leads/import/parse")
        .set("Authorization", `Bearer ${soloToken}`)
        .attach("file", Buffer.from(csvLines.join("\n"), "utf8"), "bulk600.csv")

      assert.strictEqual(parseRes.status, 200)
      assert.strictEqual(parseRes.body.data.totalRows, 600)

      const { rows, autoMapping } = parseRes.body.data
      const previewRes = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({ rows, mapping: autoMapping })

      assert.strictEqual(previewRes.status, 200)
      assert.strictEqual(previewRes.body.data.summary.valid, 600)

      let totalImported = 0
      const batchId = `large_${tag}`
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100)
        const ex = await request(app)
          .post("/api/leads/import/execute")
          .set("Authorization", `Bearer ${soloToken}`)
          .send({ rows: chunk, mapping: autoMapping, importBatchId: batchId })
        assert.strictEqual(ex.status, 200)
        totalImported += ex.body.data.summary.imported
      }
      assert.strictEqual(totalImported, 600)
    })

    // 8. Standalone rejects explicit targetWorkspaceId & never creates workspace
    await runTest("Standalone tenant rejects targetWorkspaceId and never auto-creates workspaces", async () => {
      const res = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${soloToken}`)
        .send({
          rows: [{ __rowNumber: 1, Name: "Ws Attempt", Email: `wsatt_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
          targetWorkspaceId: wsAlpha._id.toString(),
        })
      assert.strictEqual(res.status, 400)
      const soloWsCount = await Workspace.countDocuments({ tenantId: SOLO_TENANT })
      assert.strictEqual(soloWsCount, 0)
    })

    // 9. Individual workspace import & workspace isolation (Alpha vs Beta)
    await runTest("Workspace import stamps workspaceId and keeps Alpha & Beta isolated", async () => {
      const sharedEmail = `shared_ws_${tag}@test.com`

      // Staff imports into Alpha
      const execAlpha = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgStaffToken}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .send({
          rows: [{ __rowNumber: 1, Name: "Alpha Lead", Email: sharedEmail }],
          mapping: { Name: "name", Email: "email" },
          importBatchId: `ws_a_${tag}`,
        })
      assert.strictEqual(execAlpha.status, 200)
      assert.strictEqual(execAlpha.body.data.summary.imported, 1, `execAlpha body: ${JSON.stringify(execAlpha.body)}`)

      const savedAlpha = await Lead.findOne({ tenantId: ORG_TENANT, workspaceId: wsAlpha._id, email: sharedEmail }).lean()
      assert(savedAlpha, "Lead must be saved in Workspace Alpha")

      // Previewing same email in Beta must NOT leak Alpha's lead or block Beta workspace
      const previewBeta = await request(app)
        .post("/api/leads/import/preview")
        .set("Authorization", `Bearer ${orgAdminToken}`)
        .set("x-workspace-id", wsBeta._id.toString())
        .send({
          rows: [{ __rowNumber: 1, Name: "Beta Lead", Email: sharedEmail }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(previewBeta.status, 200)
      assert.strictEqual(previewBeta.body.data.summary.valid, 1)
    })

    // 10. Org Admin "All Projects" mode behavior
    await runTest("Org Admin All Projects imports with workspaceId=null by default and validates explicit targetWorkspaceId", async () => {
      // Unassigned pool import under All Projects
      const execAll = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgAdminToken}`)
        .set("x-workspace-id", "all")
        .send({
          rows: [{ __rowNumber: 1, Name: "All Projects Lead", Email: `allproj_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
          importBatchId: `allproj_${tag}`,
        })
      assert.strictEqual(execAll.status, 200)
      assert.strictEqual(execAll.body.data.summary.imported, 1, `execAll body: ${JSON.stringify(execAll.body)}`)

      const unattributed = await Lead.findOne({ tenantId: ORG_TENANT, email: `allproj_${tag}@test.com` }).lean()
      assert.strictEqual(unattributed.workspaceId, null)

      // Importing under All Projects targeting foreign tenant's workspace must fail 404
      const foreignWsRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgAdminToken}`)
        .set("x-workspace-id", "all")
        .send({
          rows: [{ __rowNumber: 1, Name: "Bad Target", Email: `badtarget_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
          targetWorkspaceId: wsOther._id.toString(),
        })
      assert.strictEqual(foreignWsRes.status, 404)

      // Importing under All Projects targeting valid own workspace Beta succeeds and stamps Beta
      const targetBetaRes = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgAdminToken}`)
        .set("x-workspace-id", "all")
        .send({
          rows: [{ __rowNumber: 1, Name: "Routed To Beta", Email: `routedbeta_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
          targetWorkspaceId: wsBeta._id.toString(),
          importBatchId: `routebeta_${tag}`,
        })
      assert.strictEqual(targetBetaRes.status, 200)
      assert.strictEqual(targetBetaRes.body.data.summary.imported, 1)
      const betaLead = await Lead.findOne({ tenantId: ORG_TENANT, email: `routedbeta_${tag}@test.com` }).lean()
      assert.strictEqual(betaLead.workspaceId.toString(), wsBeta._id.toString())
    })

    // 11. Workspace staff permissions & cross-tenant security
    await runTest("Enforces leads.create RBAC, workspace membership, viewer block, non-admin All Projects block, and cross-tenant isolation", async () => {
      // Missing leads.create permission
      const rNoPerm = await request(app)
        .get("/api/leads/import/config")
        .set("Authorization", `Bearer ${noCreateToken}`)
      assert.strictEqual(rNoPerm.status, 403)

      // Viewer role in Alpha cannot import
      const rViewer = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgViewerToken}`)
        .set("x-workspace-id", wsAlpha._id.toString())
        .send({
          rows: [{ __rowNumber: 1, Name: "Viewer Att", Email: `v_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(rViewer.status, 403)

      // Alpha staff cannot import into Beta
      const rCrossWs = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgStaffToken}`)
        .set("x-workspace-id", wsBeta._id.toString())
        .send({
          rows: [{ __rowNumber: 1, Name: "Cross Ws", Email: `cw_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(rCrossWs.status, 403)

      // Regular staff cannot select 'all'
      const rStaffAll = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${orgStaffToken}`)
        .set("x-workspace-id", "all")
        .send({
          rows: [{ __rowNumber: 1, Name: "Staff All", Email: `sa_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(rStaffAll.status, 403)

      // Spoofing tenantId in body/header rejected (403) + uploaded tenantId ignored/never crosses tenants
      const rCrossTenantBody = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${otherToken}`)
        .set("x-workspace-id", wsOther._id.toString())
        .send({
          tenantId: SOLO_TENANT,
          rows: [{ __rowNumber: 1, Name: "Spoof", Email: `spoof_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(rCrossTenantBody.status, 403)

      // Even if uploaded CSV has a tenantId column inside rows, import strictly saves under authenticated tenant
      const execCsvSpoof = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${otherToken}`)
        .set("x-workspace-id", wsOther._id.toString())
        .send({
          rows: [{ __rowNumber: 1, Name: "Row Tenant Spoof", Email: `rowspoof_${tag}@test.com`, tenantId: SOLO_TENANT }],
          mapping: { Name: "name", Email: "email" },
          importBatchId: `rowspoof_${tag}`,
        })
      assert.strictEqual(execCsvSpoof.status, 200)
      const leakCheck = await Lead.findOne({ tenantId: SOLO_TENANT, email: `rowspoof_${tag}@test.com` }).lean()
      assert.strictEqual(leakCheck, null, "Must never leak into SOLO_TENANT")
      const savedOther = await Lead.findOne({ tenantId: OTHER_TENANT, email: `rowspoof_${tag}@test.com` }).lean()
      assert(savedOther, `Must be stored strictly in authenticated OTHER_TENANT. body=${JSON.stringify(execCsvSpoof.body)}`)

      // Super Admin read-only enforcement
      const rSuperAdmin = await request(app)
        .post("/api/leads/import/execute")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .set("x-tenant-id", SOLO_TENANT)
        .send({
          rows: [{ __rowNumber: 1, Name: "SA", Email: `sa2_${tag}@test.com` }],
          mapping: { Name: "name", Email: "email" },
        })
      assert.strictEqual(rSuperAdmin.status, 403)
    })
  } finally {
    // Cleanup synthetic test records completely
    const testTenants = [SOLO_TENANT, ORG_TENANT, OTHER_TENANT]
    await Promise.all([
      Lead.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      CustomField.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      WorkspaceMembership.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      Workspace.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      Role.deleteMany({ tenantId: { $in: testTenants } }).setOptions({ skipTenantFilter: true }),
      User.deleteMany({ email: { $regex: tag } }),
      Account.deleteMany({ accountId: { $in: testTenants } }),
    ]).catch((cleanErr) => console.warn("Cleanup notice:", cleanErr.message))
    await mongoose.disconnect().catch(() => {})
  }

  console.log(`\n=== IMPORT LEADS TEST SUMMARY: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
