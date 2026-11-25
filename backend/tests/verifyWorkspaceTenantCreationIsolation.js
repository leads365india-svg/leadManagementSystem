/**
 * Synthetic Isolation Verification Suite — Workspace Creation & Tenant Ownership (P0)
 *
 * Strictly isolated: NEVER connects to Atlas / MONGODB_URI.
 * Tests real Express routes, authMiddleware.authenticate, tenantContextMiddleware,
 * and workspaceController.{listWorkspaces, createWorkspace}.
 */

const assert = require("assert")
const express = require("express")
const cookieParser = require("cookie-parser")
const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")

process.env.NODE_ENV = "test"
process.env.JWT_SECRET = "isolated_workspace_creation_p0_test_secret_123456"
process.env.MONGODB_URI = "mongodb://127.0.0.1:0/isolated_never_connect"
mongoose.set("bufferTimeoutMS", 500)

const User = require("../models/User")
const Account = require("../models/Account")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const RolePermission = require("../models/RolePermission")
const Role = require("../models/Role")
const AuditLog = require("../models/AuditLog")
const DomainMapping = require("../models/DomainMapping")
const audit = require("../services/auditService")
const { invalidateCustomDomainCache } = require("../utils/customDomainCache")

const workspaceRoutes = require("../routes/workspaceRoutes")

function makeQuery(resolver) {
  const q = {
    setOptions() { return q },
    select() { return q },
    sort() { return q },
    populate() { return q },
    lean() { return q },
    exec() { return Promise.resolve().then(() => resolver()) },
    then(onFulfilled, onRejected) { return q.exec().then(onFulfilled, onRejected) },
    catch(onRejected) { return q.exec().catch(onRejected) },
  }
  return q
}

function findByFilter(list, filter = {}) {
  return list.filter((doc) => {
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof mongoose.Types.ObjectId)) {
        if (v.$ne !== undefined && String(doc[k]) === String(v.$ne)) return false
        if (v.$in && !v.$in.map(String).includes(String(doc[k]))) return false
        if (v.$regex) {
          const rx = v.$regex instanceof RegExp ? v.$regex : new RegExp(v.$regex, v.$options || "")
          if (!rx.test(String(doc[k] || ""))) return false
        }
        continue
      }
      if (String(doc[k]) !== String(v)) return false
    }
    return true
  })
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
  console.log("=== P0 WORKSPACE CREATION TENANT OWNERSHIP SYNTHETIC VERIFICATION ===")
  assert.strictEqual(mongoose.connection.readyState, 0)

  const TEST_TENANT = "ACC-289BBEA8"
  const MED_TENANT = "ACC-3E87985C"

  const testAdminId = new mongoose.Types.ObjectId()
  const medAdminId = new mongoose.Types.ObjectId()

  const accounts = [
    {
      _id: new mongoose.Types.ObjectId(),
      accountId: TEST_TENANT,
      companyName: "test for sub project",
      slug: "test-for-sub-project",
      customDomain: "",
      status: "active",
      workspaceModeEnabled: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      accountId: MED_TENANT,
      companyName: "Medical 365",
      slug: "medical-365",
      customDomain: "crm.medical365.in",
      status: "active",
      workspaceModeEnabled: true,
    },
  ]

  const users = [
    {
      _id: testAdminId,
      id: testAdminId.toString(),
      name: "Test Admin",
      email: "aryan@test.com",
      role: "account_admin",
      tenantId: TEST_TENANT,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    },
    {
      _id: medAdminId,
      id: medAdminId.toString(),
      name: "Pawan Harish",
      email: "pawanharish@gmail.com",
      role: "account_admin",
      tenantId: MED_TENANT,
      status: "active",
      isActive: true,
      tokenVersion: 1,
    },
  ]

  const workspaces = [
    {
      _id: new mongoose.Types.ObjectId("6b0560867a35bb084205e51e"),
      tenantId: TEST_TENANT,
      name: "test for sub project",
      slug: "primary",
      isDefault: true,
      status: "active",
    },
    {
      _id: new mongoose.Types.ObjectId("6b05609c7a35bb084205e55c"),
      tenantId: TEST_TENANT,
      name: "naman",
      slug: "naman",
      isDefault: false,
      status: "active",
    },
    {
      _id: new mongoose.Types.ObjectId("6b057e498657a0d15df1f3e1"),
      tenantId: MED_TENANT,
      name: "Medical 365",
      slug: "primary",
      isDefault: true,
      status: "active",
    },
    {
      _id: new mongoose.Types.ObjectId("6b057e588657a0d15df1f417"),
      tenantId: MED_TENANT,
      name: "naman",
      slug: "naman",
      isDefault: false,
      status: "archived", // safely archived duplicate
    },
  ]
  const memberships = []

  // Patch Mongoose models to use strict in-memory synthetic store
  User.findById = (id) => makeQuery(() => users.find((u) => String(u._id) === String(id)) || null)
  User.findOne = (f) => makeQuery(() => findByFilter(users, f)[0] || null)
  Account.findOne = (f) => makeQuery(() => findByFilter(accounts, f)[0] || null)
  RolePermission.findOne = () => makeQuery(() => ({ permissions: [] }))
  Role.find = () => makeQuery(() => [])
  AuditLog.create = async () => ({})
  AuditLog.prototype.save = async function () { return this }
  audit.log = async () => {}
  DomainMapping.findOne = () => makeQuery(() => null)
  DomainMapping.find = () => makeQuery(() => [])

  Workspace.find = (f) => makeQuery(() => findByFilter(workspaces, f))
  Workspace.findOne = (f) => makeQuery(() => findByFilter(workspaces, f)[0] || null)
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
  WorkspaceMembership.create = async (doc) => {
    const rec = { _id: new mongoose.Types.ObjectId(), ...doc }
    memberships.push(rec)
    return rec
  }

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/api/workspaces", workspaceRoutes)

  const testToken = jwt.sign(
    { id: testAdminId.toString(), role: "account_admin", tenantId: TEST_TENANT, tokenVersion: 1 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  )
  const medToken = jwt.sign(
    { id: medAdminId.toString(), role: "account_admin", tenantId: MED_TENANT, tokenVersion: 1 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  )

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

  try {
    invalidateCustomDomainCache()

    await check("1-3. Creating workspace as test org stores tenantId ACC-289BBEA8 and lists ONLY in test org", async () => {
      const createRes = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}` },
        body: { name: "Synth Alpha", slug: "synth-alpha" },
      })
      assert.strictEqual(createRes.status, 201)
      assert.strictEqual(createRes.data.data.tenantId, TEST_TENANT)
      assert.strictEqual(createRes.data.data.slug, "synth-alpha")

      const stored = workspaces.find((w) => w.slug === "synth-alpha")
      assert.ok(stored, "Workspace should be persisted in synthetic store")
      assert.strictEqual(stored.tenantId, TEST_TENANT)

      const listTest = await runReq(app, {
        method: "GET",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}` },
      })
      assert.strictEqual(listTest.status, 200)
      assert.ok(listTest.data.data.some((w) => w.slug === "synth-alpha"), "New workspace must appear in test org")
      assert.ok(listTest.data.data.some((w) => w.slug === "naman"), "Legitimate naman must appear in test org")
      assert.ok(listTest.data.data.every((w) => w.tenantId === TEST_TENANT))
    })

    await check("4-5. Medical 365 workspace list contains ONLY Medical 365 active workspaces (excludes Synth Alpha & archived naman)", async () => {
      const listMed = await runReq(app, {
        method: "GET",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${medToken}` },
      })
      assert.strictEqual(listMed.status, 200)
      assert.strictEqual(listMed.data.data.length, 1)
      assert.strictEqual(listMed.data.data[0].tenantId, MED_TENANT)
      assert.strictEqual(listMed.data.data[0].slug, "primary")
      assert.ok(!listMed.data.data.some((w) => w.slug === "synth-alpha"), "Test org workspace must NEVER appear in Medical 365")
      assert.ok(!listMed.data.data.some((w) => w.slug === "naman"), "Archived duplicate naman must NOT appear in Medical 365")
    })

    await check("6. Rejects tenant spoofing via body, header, cookie, custom domain mismatch, and cookie-vs-Bearer split brain (HTTP 403)", async () => {
      const beforeCount = workspaces.length

      // 6a. Body tenantId spoof
      const rBody = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}` },
        body: { name: "Spoof Body", slug: "spoof-body", tenantId: MED_TENANT },
      })
      assert.strictEqual(rBody.status, 403)
      assert.strictEqual(rBody.data.code, "CROSS_TENANT_SESSION_MISMATCH")

      // 6b. x-tenant-id header spoof
      const rHdr = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}`, "x-tenant-id": MED_TENANT },
        body: { name: "Spoof Header", slug: "spoof-header" },
      })
      assert.strictEqual(rHdr.status, 403)
      assert.strictEqual(rHdr.data.code, "CROSS_TENANT_SESSION_MISMATCH")

      // 6c. active_tenant_id cookie spoof
      const rCkTenant = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}`, Cookie: `active_tenant_id=${MED_TENANT}` },
        body: { name: "Spoof Cookie", slug: "spoof-cookie" },
      })
      assert.strictEqual(rCkTenant.status, 403)
      assert.strictEqual(rCkTenant.data.code, "CROSS_TENANT_SESSION_MISMATCH")

      // 6d. Split-brain: Bearer is test org (ACC-289BBEA8) while stale client_token cookie is Medical 365 (ACC-3E87985C) -> MUST reject 403!
      const rSplit = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}`, Cookie: `client_token=${medToken}` },
        body: { name: "Split Brain", slug: "split-brain" },
      })
      assert.strictEqual(rSplit.status, 403)
      assert.strictEqual(rSplit.data.code, "CROSS_TENANT_SESSION_MISMATCH")

      // 6e. White-label domain mismatch (test org token hitting Medical 365 domain) -> 403
      const rDomain = await runReq(app, {
        method: "POST",
        path: "/api/workspaces",
        headers: { Authorization: `Bearer ${testToken}`, "x-tenant-domain": "crm.medical365.in" },
        body: { name: "Domain Spoof", slug: "domain-spoof" },
      })
      assert.strictEqual(rDomain.status, 403)
      assert.strictEqual(rDomain.data.code, "CROSS_TENANT_SESSION_MISMATCH")

      assert.strictEqual(workspaces.length, beforeCount, "Zero spoofed workspaces may be persisted")
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
