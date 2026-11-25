/**
 * Synthetic Regression Suite — No Auto Default Workspace Provisioning
 *
 * Strictly isolated: NEVER connects to Atlas / MONGODB_URI.
 * Tests Requirements 1-4 across workspaceController, leadController,
 * authMiddleware, tenantContextMiddleware, and tenantIsolationPlugin.
 */

const assert = require("assert")
const express = require("express")
const cookieParser = require("cookie-parser")
const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")

process.env.NODE_ENV = "test"
process.env.JWT_SECRET = "isolated_no_auto_default_ws_test_secret_123456"
process.env.MONGODB_URI = "mongodb://127.0.0.1:0/isolated_never_connect"
mongoose.set("bufferTimeoutMS", 500)

const User = require("../models/User")
const Account = require("../models/Account")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const DomainMapping = require("../models/DomainMapping")
const AuditLog = require("../models/AuditLog")
const RolePermission = require("../models/RolePermission")
const Role = require("../models/Role")
const audit = require("../services/auditService")
const { invalidateAccountWorkspaceModeCache, applyWorkspaceScope, tenantContextMiddleware } = require("../middleware/tenantContext")
const { authenticate } = require("../middleware/authMiddleware")
const workspaceRoutes = require("../routes/workspaceRoutes")

function makeQuery(resolver) {
  const q = {
    setOptions() { return q },
    select() { return q },
    sort() { return q },
    limit() { return q },
    skip() { return q },
    populate() { return q },
    lean() { return q },
    exec() { return Promise.resolve().then(() => resolver()) },
    then(onFulfilled, onRejected) { return q.exec().then(onFulfilled, onRejected) },
    catch(onRejected) { return q.exec().catch(onRejected) },
  }
  return q
}

function matchFilter(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === "$or") {
      if (!v.some((sub) => matchFilter(doc, sub))) return false
      continue
    }
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof mongoose.Types.ObjectId)) {
      if (v.$ne !== undefined && String(doc[k]) === String(v.$ne)) return false
      if (v.$in && !v.$in.map(String).includes(String(doc[k]))) return false
      continue
    }
    if (v === null) {
      if (doc[k] !== null && doc[k] !== undefined) return false
      continue
    }
    if (String(doc[k]) !== String(v)) return false
  }
  return true
}

function findByFilter(list, filter = {}) {
  return list.filter((d) => matchFilter(d, filter))
}

async function runReq(app, { method = "GET", path = "/", headers = {}, body = undefined }) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s))
  })
  try {
    const port = server.address().port
    const opts = { method, headers: { ...headers } }
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json"
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts)
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  console.log("=== REGRESSION SUITE: NO AUTO DEFAULT WORKSPACE CREATION ===")
  assert.strictEqual(mongoose.connection.readyState, 0)

  const TENANT_A = "ACC-SYNTH-MED365"
  const TENANT_B = "ACC-SYNTH-OTHER"
  const TENANT_STANDALONE = "ACC-SYNTH-SOLO"

  const adminAId = new mongoose.Types.ObjectId()
  const adminBId = new mongoose.Types.ObjectId()
  const soloAdminId = new mongoose.Types.ObjectId()

  const accounts = [
    { _id: new mongoose.Types.ObjectId(), accountId: TENANT_A, companyName: "Medical 365 Synth", slug: "medical-365-synth", status: "active", workspaceModeEnabled: false },
    { _id: new mongoose.Types.ObjectId(), accountId: TENANT_B, companyName: "Beta Synth", slug: "beta-synth", status: "active", workspaceModeEnabled: true },
    { _id: new mongoose.Types.ObjectId(), accountId: TENANT_STANDALONE, companyName: "Solo Clinic", slug: "solo-clinic", status: "active", workspaceModeEnabled: false },
  ]
  const users = [
    { _id: adminAId, id: adminAId.toString(), name: "Admin A", email: "a@med.test", role: "account_admin", tenantId: TENANT_A, status: "active", isActive: true, tokenVersion: 1 },
    { _id: adminBId, id: adminBId.toString(), name: "Admin B", email: "b@beta.test", role: "account_admin", tenantId: TENANT_B, status: "active", isActive: true, tokenVersion: 1 },
    { _id: soloAdminId, id: soloAdminId.toString(), name: "Solo", email: "s@solo.test", role: "account_admin", tenantId: TENANT_STANDALONE, status: "active", isActive: true, tokenVersion: 1 },
  ]

  // Seed a legacy internal/system-managed workspace to confirm exclusion too
  const sysWsId = new mongoose.Types.ObjectId()
  const betaWsId = new mongoose.Types.ObjectId()
  const workspaces = [
    { _id: sysWsId, tenantId: TENANT_A, name: "Medical 365 Synth", slug: "primary", isDefault: false, isSystemManaged: true, status: "active" },
    { _id: betaWsId, tenantId: TENANT_B, name: "Beta Project", slug: "beta-project", isDefault: false, isSystemManaged: false, status: "active" },
  ]
  const memberships = []
  const leads = [
    // Existing org-level leads without workspaceId
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_A, workspaceId: null, name: "Legacy Lead 1", status: "New", createdAt: new Date() },
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_A, workspaceId: null, name: "Legacy Lead 2", status: "Closed-Won", createdAt: new Date() },
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_B, workspaceId: betaWsId, name: "Beta Cross Tenant Lead", status: "New", createdAt: new Date() },
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_STANDALONE, workspaceId: null, name: "Solo Lead", status: "New", createdAt: new Date() },
  ]
  const calls = [
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_A, workspaceId: null, phoneNumber: "+919000000001" },
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_B, workspaceId: betaWsId, phoneNumber: "+919000000002" },
    { _id: new mongoose.Types.ObjectId(), tenantId: TENANT_STANDALONE, workspaceId: null, phoneNumber: "+919000000003" },
  ]

  // In-memory model bindings
  User.findById = (id) => makeQuery(() => users.find((u) => String(u._id) === String(id)) || null)
  User.findOne = (f) => makeQuery(() => findByFilter(users, f)[0] || null)
  Account.findOne = (f) => makeQuery(() => {
    const doc = findByFilter(accounts, f)[0] || null
    if (!doc) return null
    doc.save = async () => doc
    return doc
  })
  RolePermission.findOne = () => makeQuery(() => ({ permissions: [] }))
  Role.find = () => makeQuery(() => [])
  DomainMapping.findOne = () => makeQuery(() => null)
  DomainMapping.countDocuments = () => makeQuery(() => 0)
  AuditLog.create = async () => ({})
  AuditLog.prototype.save = async function () { return this }
  audit.log = async () => {}

  Workspace.find = (f) => makeQuery(() => findByFilter(workspaces, f))
  Workspace.findOne = (f) => makeQuery(() => findByFilter(workspaces, f)[0] || null)
  Workspace.countDocuments = (f) => makeQuery(() => findByFilter(workspaces, f).length)
  Workspace.updateMany = () => makeQuery(() => ({ modifiedCount: 0 }))
  const origWsSave = Workspace.prototype.save
  Workspace.prototype.save = async function mockWsSave() {
    const obj = this.toObject ? this.toObject() : { ...this }
    if (!obj._id) obj._id = new mongoose.Types.ObjectId()
    this._id = obj._id
    workspaces.push(obj)
    return this
  }
  WorkspaceMembership.find = (f) => makeQuery(() => findByFilter(memberships, f))
  WorkspaceMembership.findOne = (f) => makeQuery(() => findByFilter(memberships, f)[0] || null)
  WorkspaceMembership.create = async (d) => { const r = { _id: new mongoose.Types.ObjectId(), ...d }; memberships.push(r); return r }
  WorkspaceMembership.aggregate = () => makeQuery(() => [])

  Lead.find = (f) => makeQuery(() => findByFilter(leads, f))
  Lead.countDocuments = (f) => makeQuery(() => findByFilter(leads, f).length)
  Lead.distinct = (field, f) => makeQuery(() => [...new Set(findByFilter(leads, f).map((d) => d[field]).filter(Boolean))])
  Lead.aggregate = (pipeline) => makeQuery(() => {
    const match = pipeline.find((s) => s.$match)?.$match || {}
    const group = pipeline.find((s) => s.$group)?.$group
    const matched = findByFilter(leads, match)
    if (group?._id === "$status") {
      const m = new Map()
      for (const l of matched) m.set(l.status, (m.get(l.status) || 0) + 1)
      return [...m.entries()].map(([_id, count]) => ({ _id, count }))
    }
    if (group?._id === "$workspaceId") {
      const m = new Map()
      for (const l of matched) if (l.workspaceId) m.set(String(l.workspaceId), (m.get(String(l.workspaceId)) || 0) + 1)
      return [...m.entries()].map(([_id, count]) => ({ _id, count }))
    }
    return []
  })
  Call.find = (f) => makeQuery(() => findByFilter(calls, f))
  Call.countDocuments = (f) => makeQuery(() => findByFilter(calls, f).length)
  Call.aggregate = (pipeline) => makeQuery(() => {
    const match = pipeline.find((s) => s.$match)?.$match || {}
    const matched = findByFilter(calls, match)
    const m = new Map()
    for (const c of matched) if (c.workspaceId) m.set(String(c.workspaceId), (m.get(String(c.workspaceId)) || 0) + 1)
    return [...m.entries()].map(([_id, count]) => ({ _id, count }))
  })
  FollowUp.countDocuments = () => makeQuery(() => 0)
  FollowUp.aggregate = () => makeQuery(() => [])

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/api/workspaces", workspaceRoutes)
  app.get("/api/probe-records", authenticate, tenantContextMiddleware, async (req, res) => {
    const leadQuery = applyWorkspaceScope({ tenantId: req.tenantContext.tenantId }, req)
    const callQuery = applyWorkspaceScope({ tenantId: req.tenantContext.tenantId }, req)
    const [scopedLeads, scopedCalls] = await Promise.all([Lead.find(leadQuery), Call.find(callQuery)])
    res.json({ mode: req.tenantContext.mode, leads: scopedLeads, calls: scopedCalls })
  })

  const tokA = jwt.sign({ id: adminAId.toString(), role: "account_admin", tenantId: TENANT_A, tokenVersion: 1 }, process.env.JWT_SECRET)
  const tokB = jwt.sign({ id: adminBId.toString(), role: "account_admin", tenantId: TENANT_B, tokenVersion: 1 }, process.env.JWT_SECRET)
  const tokSolo = jwt.sign({ id: soloAdminId.toString(), role: "account_admin", tenantId: TENANT_STANDALONE, tokenVersion: 1 }, process.env.JWT_SECRET)

  let passed = 0
  let failed = 0
  async function check(name, fn) {
    try {
      await fn()
      console.log(`  [PASS] ${name}`)
      passed++
    } catch (e) {
      console.error(`  [FAIL] ${name}: ${e.stack || e}`)
      failed++
    }
  }

  let createdProjectId = null

  try {
    invalidateAccountWorkspaceModeCache()

    await check("1-2. Enabling multi-workspace creates ZERO visible projects & excludes system-managed defaults", async () => {
      const wsBefore = workspaces.length
      const toggleRes = await runReq(app, {
        method: "POST",
        path: "/api/workspaces/mode/toggle",
        headers: { Authorization: `Bearer ${tokA}` },
        body: { enabled: true },
      })
      assert.strictEqual(toggleRes.status, 200)
      assert.strictEqual(toggleRes.data.workspaceModeEnabled, true)
      assert.strictEqual(workspaces.length, wsBefore, "No new workspace document may be created automatically")

      const listRes = await runReq(app, {
        method: "GET",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${tokA}` },
      })
      assert.strictEqual(listRes.status, 200)
      assert.strictEqual(listRes.data.workspaceModeEnabled, true)
      assert.strictEqual(listRes.data.data.length, 0, "Configured Workspaces must be 0 initially and exclude isSystemManaged")
    })

    await check("3. All Projects consolidated view shows org-level leads/calls without assigning them to any fake workspace", async () => {
      const masterRes = await runReq(app, {
        method: "GET",
        path: "/api/workspaces/dashboard/master",
        headers: { Authorization: `Bearer ${tokA}` },
      })
      assert.strictEqual(masterRes.status, 200)
      assert.strictEqual(masterRes.data.data.kpis.totalWorkspaces, 0)
      assert.strictEqual(masterRes.data.data.projects.length, 0, "Project-wise table must not show auto-created company workspace")
      assert.strictEqual(masterRes.data.data.kpis.totalLeads, 2, "All Projects must show all existing org leads")
      assert.strictEqual(masterRes.data.data.kpis.totalCalls, 1, "All Projects must show all existing org calls")

      const probeAll = await runReq(app, {
        method: "GET",
        path: "/api/probe-records",
        headers: { Authorization: `Bearer ${tokA}`, "X-Workspace-Id": "all" },
      })
      assert.strictEqual(probeAll.status, 200)
      assert.strictEqual(probeAll.data.leads.length, 2)
      assert.strictEqual(probeAll.data.calls.length, 1)
      assert.ok(leads.filter((l) => l.tenantId === TENANT_A).every((l) => l.workspaceId === null), "Legacy leads remain unassigned")
    })

    await check("4-5. Manually creating a project makes it visible in All Projects and isolates its own records", async () => {
      const createRes = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${tokA}` },
        body: { name: "Clinic North", slug: "clinic-north" },
      })
      assert.strictEqual(createRes.status, 201)
      assert.strictEqual(createRes.data.data.name, "Clinic North")
      assert.strictEqual(createRes.data.data.isSystemManaged, false)
      assert.ok(createRes.data.data.accessUrl && createRes.data.data.accessUrl.includes("workspace=clinic-north"))
      createdProjectId = new mongoose.Types.ObjectId(createRes.data.data._id)

      // Seed 1 project-specific lead & call
      leads.push({ _id: new mongoose.Types.ObjectId(), tenantId: TENANT_A, workspaceId: createdProjectId, name: "North Lead 1", status: "New", createdAt: new Date() })
      calls.push({ _id: new mongoose.Types.ObjectId(), tenantId: TENANT_A, workspaceId: createdProjectId, phoneNumber: "+919000000099" })

      const listRes = await runReq(app, {
        method: "GET",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${tokA}` },
      })
      assert.strictEqual(listRes.data.data.length, 1)
      assert.strictEqual(listRes.data.data[0].slug, "clinic-north")

      const masterRes = await runReq(app, {
        method: "GET",
        path: "/api/workspaces/dashboard/master",
        headers: { Authorization: `Bearer ${tokA}` },
      })
      assert.strictEqual(masterRes.data.data.projects.length, 1)
      assert.strictEqual(masterRes.data.data.projects[0].slug, "clinic-north")
      assert.strictEqual(masterRes.data.data.projects[0].totalLeads, 1)
      assert.strictEqual(masterRes.data.data.kpis.totalLeads, 3)

      // Selecting manual project returns ONLY its own records
      const scopedRes = await runReq(app, {
        method: "GET",
        path: "/api/probe-records",
        headers: { Authorization: `Bearer ${tokA}`, "X-Workspace-Id": createdProjectId.toString() },
      })
      assert.strictEqual(scopedRes.status, 200)
      assert.strictEqual(scopedRes.data.mode, "single_workspace")
      assert.strictEqual(scopedRes.data.leads.length, 1)
      assert.strictEqual(scopedRes.data.leads[0].name, "North Lead 1")
      assert.strictEqual(scopedRes.data.calls.length, 1)
    })

    await check("6-7. Standalone tenants work identically & no cross-tenant data becomes visible", async () => {
      const soloRes = await runReq(app, {
        method: "GET",
        path: "/api/probe-records",
        headers: { Authorization: `Bearer ${tokSolo}` },
      })
      assert.strictEqual(soloRes.status, 200)
      assert.strictEqual(soloRes.data.mode, "standalone")
      assert.strictEqual(soloRes.data.leads.length, 1)
      assert.strictEqual(soloRes.data.leads[0].name, "Solo Lead")

      const crossListB = await runReq(app, {
        method: "GET",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${tokB}` },
      })
      assert.strictEqual(crossListB.status, 200)
      assert.strictEqual(crossListB.data.data.length, 1)
      assert.strictEqual(crossListB.data.data[0].slug, "beta-project")
      assert.ok(!crossListB.data.data.some((w) => w.slug === "clinic-north"))
    })
  } finally {
    Workspace.prototype.save = origWsSave
  }

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
