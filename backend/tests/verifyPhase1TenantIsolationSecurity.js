/**
 * Isolated Synthetic Security & Cross-Tenant Isolation Verification Suite (Phase 1 P1/P2)
 *
 * SAFETY GUARANTEE:
 * - NEVER reads backend/.env
 * - NEVER connects Mongoose to MONGODB_URI or production Atlas
 * - Executes REAL Express routers, middleware, controllers, services, and tenantIsolationPlugin
 *   against in-memory model/service stubs over ephemeral local HTTP (127.0.0.1:0).
 */

const assert = require("assert")
const crypto = require("crypto")
const express = require("express")
const cookieParser = require("cookie-parser")
const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")

// Hard-pin non-production environment BEFORE importing backend modules
process.env.NODE_ENV = "test"
process.env.JWT_SECRET = "isolated_synthetic_test_secret_1234567890_abcdef"
process.env.MONGODB_URI = "mongodb://127.0.0.1:0/isolated_synthetic_never_connect"
mongoose.set("bufferTimeoutMS", 500)

const User = require("../models/User")
const Account = require("../models/Account")
const Device = require("../models/Device")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const Quotation = require("../models/Quotation")
const Brochure = require("../models/Brochure")
const { Integration } = require("../models/Integration")
const { WhatsAppMessage } = require("../models/WhatsAppMessage")
const WhatsAppQrSession = require("../models/WhatsAppQrSession")
const TenantPhoneContact = require("../models/TenantPhoneContact")
const WhatsAppSuppressedNumber = require("../models/WhatsAppSuppressedNumber")
const RolePermission = require("../models/RolePermission")
const Role = require("../models/Role")

const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const {
  tenantContextMiddleware,
  runWithTenantContext,
  getTenantContext,
  invalidateAccountWorkspaceModeCache,
} = require("../middleware/tenantContext")
const { authenticateDevice } = require("../middleware/deviceAuthMiddleware")
const { authenticateRecordingUpload } = require("../middleware/recordingAuthMiddleware")
const telephonyWebhookAuth = require("../middleware/telephonyWebhookAuth")

const authController = require("../controllers/authController")
const mobileController = require("../controllers/mobileController")
const quotationController = require("../controllers/quotationController")
const whatsappWebhookController = require("../controllers/whatsappWebhookController")
const metaController = require("../controllers/metaController")
const mobileRoutes = require("../routes/mobileRoutes")
const quotationRoutes = require("../routes/quotationRoutes")
const telephonyRoutes = require("../routes/telephonyRoutes")

const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")

const documentStorage = require("../services/documentStorage.service")
const deviceAuthService = require("../services/deviceAuthService")
const aiCallbackScheduling = require("../services/aiCallbackScheduling.service")
const recordingStorage = require("../services/recordingStorage")
const whatsappService = require("../services/whatsappService")
const metaService = require("../services/metaService")
const whatsappQrService = require("../services/whatsappQrService")
const { inboundCallRouter } = require("../services/telephony/inboundCallRouter.service")
const telephonyConfigService = require("../services/telephony/telephonyConfig.service")
const pushNotificationService = require("../services/pushNotificationService")
const auditService = require("../services/auditService")

// Chainable Mongoose Query mock preserving filter + setOptions inspection
function makeQuery(resolver) {
  const state = {
    options: {},
    projection: null,
    sortSpec: null,
    populateFields: [],
    isLean: false,
  }
  const q = {
    setOptions(opts) {
      Object.assign(state.options, opts || {})
      return q
    },
    select(p) {
      state.projection = p
      return q
    },
    sort(s) {
      state.sortSpec = s
      return q
    },
    limit() {
      return q
    },
    skip() {
      return q
    },
    populate(f) {
      state.populateFields.push(f)
      return q
    },
    lean() {
      state.isLean = true
      return q
    },
    exec() {
      return Promise.resolve().then(() => resolver(state))
    },
    then(onFulfilled, onRejected) {
      return q.exec().then(onFulfilled, onRejected)
    },
    catch(onRejected) {
      return q.exec().catch(onRejected)
    },
  }
  return q
}

let passed = 0
let failed = 0

async function runCase(name, fn) {
  try {
    await fn()
    console.log(`  [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  [FAIL] ${name}`)
    console.error(`    -> ${err && err.stack ? err.stack : err}`)
    failed++
  }
}

function makeIds() {
  return {
    TENANT_A: "ACC-SYNTH-A",
    TENANT_B: "ACC-SYNTH-B",
    WS_A1: new mongoose.Types.ObjectId(),
    WS_A2: new mongoose.Types.ObjectId(),
    WS_B1: new mongoose.Types.ObjectId(),
    USER_A_ID: new mongoose.Types.ObjectId(),
    USER_B_ID: new mongoose.Types.ObjectId(),
    DEV_A_ID: new mongoose.Types.ObjectId(),
    DEV_B_ID: new mongoose.Types.ObjectId(),
  }
}

function signJwt(payload, expiresIn = "1h") {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn })
}

async function runExpressRequest(app, { method = "GET", path = "/", headers = {}, body = undefined, rawBody = undefined }) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s))
  })
  try {
    const port = server.address().port
    const url = `http://127.0.0.1:${port}${path}`
    const opts = { method, headers: { ...headers } }
    if (rawBody !== undefined) {
      opts.body = rawBody
    } else if (body !== undefined) {
      if (!opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json"
      opts.body = typeof body === "string" ? body : JSON.stringify(body)
    }
    const res = await fetch(url, opts)
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { status: res.status, data, headers: res.headers }
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function main() {
  console.log("=== LEADS365 PHASE 1 TENANT ISOLATION SECURITY VERIFICATION (SYNTHETIC IN-MEMORY) ===")
  assert.strictEqual(mongoose.connection.readyState, 0, "Safety check: Mongoose must NOT be connected to any external DB")

  const ids = makeIds()

  // Common deterministic fixtures
  const accounts = {
    [ids.TENANT_A]: { accountId: ids.TENANT_A, status: "active", workspaceModeEnabled: true, customDomain: "crm.tenanta.test" },
    [ids.TENANT_B]: { accountId: ids.TENANT_B, status: "active", workspaceModeEnabled: true, customDomain: "crm.tenantb.test" },
  }
  const users = {
    [ids.USER_A_ID.toString()]: {
      _id: ids.USER_A_ID,
      id: ids.USER_A_ID.toString(),
      tenantId: ids.TENANT_A,
      role: "agent",
      name: "Agent A",
      email: "agenta@tenanta.test",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    },
    [ids.USER_B_ID.toString()]: {
      _id: ids.USER_B_ID,
      id: ids.USER_B_ID.toString(),
      tenantId: ids.TENANT_B,
      role: "agent",
      name: "Agent B",
      email: "agentb@tenantb.test",
      status: "active",
      isActive: true,
      tokenVersion: 1,
    },
  }
  const devices = {
    [ids.DEV_A_ID.toString()]: {
      _id: ids.DEV_A_ID,
      deviceUuid: "uuid-dev-a",
      tenantId: ids.TENANT_A,
      workspaceId: ids.WS_A1,
      userId: ids.USER_A_ID,
      status: "ACTIVE",
    },
    [ids.DEV_B_ID.toString()]: {
      _id: ids.DEV_B_ID,
      deviceUuid: "uuid-dev-b",
      tenantId: ids.TENANT_B,
      workspaceId: ids.WS_B1,
      userId: ids.USER_B_ID,
      status: "REVOKED",
    },
  }
  const workspaces = {
    [ids.WS_A1.toString()]: { _id: ids.WS_A1, tenantId: ids.TENANT_A, name: "A1", slug: "a1", status: "active", isDefault: true },
    [ids.WS_A2.toString()]: { _id: ids.WS_A2, tenantId: ids.TENANT_A, name: "A2", slug: "a2", status: "active", isDefault: false },
    [ids.WS_B1.toString()]: { _id: ids.WS_B1, tenantId: ids.TENANT_B, name: "B1", slug: "b1", status: "active", isDefault: true },
  }
  // Agent A is ONLY a member of WS_A1 (NOT WS_A2 or WS_B1)
  const memberships = [
    { tenantId: ids.TENANT_A, userId: ids.USER_A_ID, workspaceId: ids.WS_A1, role: "agent", status: "active" },
    { tenantId: ids.TENANT_B, userId: ids.USER_B_ID, workspaceId: ids.WS_B1, role: "agent", status: "active" },
  ]

  const findByFilter = (list, filter = {}) => {
    return list.filter((doc) => {
      for (const [k, v] of Object.entries(filter)) {
        if (k === "$or") {
          if (!v.some((sub) => findByFilter([doc], sub).length > 0)) return false
          continue
        }
        if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof mongoose.Types.ObjectId)) {
          if (v.$in && !v.$in.map(String).includes(String(doc[k]))) return false
          if (v.$ne !== undefined && String(doc[k]) === String(v.$ne)) return false
          continue
        }
        if (doc[k] === undefined && v !== null) return false
        if (String(doc[k]) !== String(v)) return false
      }
      return true
    })
  }

  // Install baseline read-only DB stubs for User/Account/Device/Workspace/Membership
  User.findById = (id) => makeQuery(() => users[String(id)] || null)
  User.findOne = (filter = {}) => makeQuery(() => findByFilter(Object.values(users), filter)[0] || null)
  Account.findOne = (filter = {}) => makeQuery(() => findByFilter(Object.values(accounts), filter)[0] || null)
  Device.findOne = (filter = {}) => makeQuery(() => findByFilter(Object.values(devices), filter)[0] || null)
  Device.findOneAndUpdate = () => makeQuery(() => null)
  Workspace.findOne = (filter = {}) => makeQuery(() => findByFilter(Object.values(workspaces), filter)[0] || null)
  Workspace.find = (filter = {}) => makeQuery(() => findByFilter(Object.values(workspaces), filter))
  WorkspaceMembership.findOne = (filter = {}) => makeQuery(() => findByFilter(memberships, filter)[0] || null)
  WorkspaceMembership.find = (filter = {}) => makeQuery(() => findByFilter(memberships, filter))
  RolePermission.findOne = () => makeQuery(() => ({ permissions: [] }))
  Role.find = () => makeQuery(() => [])

  // =========================================================================
  // TEST 6: Cross-Tenant Mobile Auth & Device Isolation
  // =========================================================================
  console.log("\n[6] Cross-Tenant Mobile Auth & Device Isolation")

  await runCase("6a. deviceAuthMiddleware enforces WorkspaceMembership (allows WS_A1, denies WS_A2 & cross-tenant WS_B1, honors body.workspace_id)", async () => {
    invalidateAccountWorkspaceModeCache()
    const app = express()
    app.use(express.json())
    app.post("/probe", authenticateDevice, (req, res) => {
      res.json({ ok: true, tenantContext: req.tenantContext })
    })

    const devTokenA = signJwt({
      userId: ids.USER_A_ID.toString(),
      deviceId: ids.DEV_A_ID.toString(),
      tenantId: ids.TENANT_A,
      tokenType: "device_access",
      tokenVersion: 1,
    })

    // Allowed member workspace WS_A1
    const okRes = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}`, "X-Workspace-Id": ids.WS_A1.toString() },
      body: {},
    })
    assert.strictEqual(okRes.status, 200)
    assert.strictEqual(okRes.data.tenantContext.mode, "single_workspace")
    assert.strictEqual(okRes.data.tenantContext.workspaceId, ids.WS_A1.toString())

    // Unauthorized same-tenant workspace WS_A2 via header when device is bound to WS_A1 -> 403 DEVICE_WORKSPACE_MISMATCH
    const deniedWs = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}`, "X-Workspace-Id": ids.WS_A2.toString() },
      body: {},
    })
    assert.strictEqual(deniedWs.status, 403)

    // Unauthorized workspace WS_A2 via req.body.workspace_id without header -> denied 403
    const deniedBodyWs = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}` },
      body: { workspace_id: ids.WS_A2.toString() },
    })
    assert.strictEqual(deniedBodyWs.status, 403)

    // Conflicting header vs body workspace -> 403 WORKSPACE_MISMATCH
    const conflictWs = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}`, "X-Workspace-Id": ids.WS_A1.toString() },
      body: { workspace_id: ids.WS_A2.toString() },
    })
    assert.strictEqual(conflictWs.status, 403)
    assert.strictEqual(conflictWs.data.code, "WORKSPACE_MISMATCH")

    // Unbound device + agent NOT a member of WS_A2 -> 403 WorkspaceMembership enforcement
    const origDevWs = devices[ids.DEV_A_ID.toString()].workspaceId
    devices[ids.DEV_A_ID.toString()].workspaceId = null
    const unauthMemberWs = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}`, "X-Workspace-Id": ids.WS_A2.toString() },
      body: {},
    })
    devices[ids.DEV_A_ID.toString()].workspaceId = origDevWs
    assert.strictEqual(unauthMemberWs.status, 403)

    // Cross-tenant workspace WS_B1 -> denied (403 or 404)
    const deniedCrossTenantWs = await runExpressRequest(app, {
      method: "POST",
      path: "/probe",
      headers: { Authorization: `Bearer ${devTokenA}`, "X-Workspace-Id": ids.WS_B1.toString() },
      body: {},
    })
    assert.ok([403, 404].includes(deniedCrossTenantWs.status), `Expected 403 or 404, got ${deniedCrossTenantWs.status}`)
  })

  await runCase("6d. deviceAuthService.refreshDeviceToken rejects non-refresh tokens, stale tokenVersion, REVOKED device, and suspended Account", async () => {
    const devATokenHash = require("../utils/cryptoUtils").hashApiKey("dummy")
    const origDevFindOne = Device.findOne
    const origAccFindOne = Account.findOne
    try {
      const validDeviceRefresh = signJwt({
        id: ids.USER_A_ID.toString(),
        userId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        deviceId: ids.DEV_A_ID.toString(),
        deviceUuid: "uuid-dev-a",
        tokenType: "device_refresh",
        tokenVersion: 1,
      })
      const validHash = require("../utils/cryptoUtils").hashApiKey(validDeviceRefresh)
      const deviceState = {
        _id: ids.DEV_A_ID,
        tenantId: ids.TENANT_A,
        userId: ids.USER_A_ID,
        deviceUuid: "uuid-dev-a",
        status: "ACTIVE",
        refreshTokenHash: validHash,
        save: async () => {},
      }
      Device.findOne = () => makeQuery(() => deviceState)

      // 1. Access token rejected as INVALID_TOKEN_TYPE (401)
      const wrongTypeTok = signJwt({
        id: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        deviceId: ids.DEV_A_ID.toString(),
        tokenType: "device_access",
      })
      await assert.rejects(
        () => deviceAuthService.refreshDeviceToken({ refreshToken: wrongTypeTok }),
        (err) => err.statusCode === 401 && err.code === "INVALID_TOKEN_TYPE"
      )

      // 2. Uppercase REVOKED device rejected (403 DEVICE_REVOKED)
      deviceState.status = "REVOKED"
      await assert.rejects(
        () => deviceAuthService.refreshDeviceToken({ refreshToken: validDeviceRefresh }),
        (err) => err.statusCode === 403 && err.code === "DEVICE_REVOKED"
      )
      deviceState.status = "ACTIVE"

      // 3. Stale tokenVersion rejected (401 REFRESH_TOKEN_INVALIDATED)
      const staleDevRefresh = signJwt({
        id: ids.USER_A_ID.toString(),
        userId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        deviceId: ids.DEV_A_ID.toString(),
        deviceUuid: "uuid-dev-a",
        tokenType: "device_refresh",
        tokenVersion: 0,
      })
      deviceState.refreshTokenHash = require("../utils/cryptoUtils").hashApiKey(staleDevRefresh)
      await assert.rejects(
        () => deviceAuthService.refreshDeviceToken({ refreshToken: staleDevRefresh }),
        (err) => err.statusCode === 401 && err.code === "REFRESH_TOKEN_INVALIDATED"
      )

      // 4. Suspended tenant Account rejected (403 ACCOUNT_SUSPENDED)
      deviceState.refreshTokenHash = validHash
      Account.findOne = () => makeQuery(() => ({ accountId: ids.TENANT_A, status: "suspended" }))
      await assert.rejects(
        () => deviceAuthService.refreshDeviceToken({ refreshToken: validDeviceRefresh }),
        (err) => err.statusCode === 403 && err.code === "ACCOUNT_SUSPENDED"
      )
      assert.ok(devATokenHash)
    } finally {
      Device.findOne = origDevFindOne
      Account.findOne = origAccFindOne
    }
  })

  await runCase("6b. mobileRefreshToken rejects access tokens, stale tokenVersion, and revoked devices", async () => {
    const app = express()
    app.use(express.json())
    app.post("/refresh", mobileController.mobileRefreshToken)

    // Access token instead of refresh token -> 401
    const accessTok = signJwt({
      id: ids.USER_A_ID.toString(),
      tenantId: ids.TENANT_A,
      role: "agent",
    })
    const resAccess = await runExpressRequest(app, {
      method: "POST",
      path: "/refresh",
      body: { refreshToken: accessTok },
    })
    assert.strictEqual(resAccess.status, 401)

    // Stale tokenVersion -> 401
    const staleRefresh = signJwt({
      id: ids.USER_A_ID.toString(),
      tenantId: ids.TENANT_A,
      role: "agent",
      type: "refresh",
      tokenVersion: 0,
    })
    const resStale = await runExpressRequest(app, {
      method: "POST",
      path: "/refresh",
      body: { refreshToken: staleRefresh },
    })
    assert.strictEqual(resStale.status, 401)

    // Revoked Device B -> 403 DEVICE_REVOKED
    const revokedDevRefresh = signJwt({
      id: ids.USER_B_ID.toString(),
      tenantId: ids.TENANT_B,
      role: "agent",
      type: "refresh",
      tokenVersion: 1,
      deviceId: ids.DEV_B_ID.toString(),
    })
    const resRevoked = await runExpressRequest(app, {
      method: "POST",
      path: "/refresh",
      body: { refreshToken: revokedDevRefresh },
    })
    assert.strictEqual(resRevoked.status, 403)
    assert.strictEqual(resRevoked.data.code, "DEVICE_REVOKED")

    // Valid active refresh JWT -> 200
    const validRefresh = signJwt({
      id: ids.USER_A_ID.toString(),
      tenantId: ids.TENANT_A,
      role: "agent",
      type: "refresh",
      tokenVersion: 1,
      deviceId: ids.DEV_A_ID.toString(),
    })
    const resOk = await runExpressRequest(app, {
      method: "POST",
      path: "/refresh",
      body: { refreshToken: validRefresh },
    })
    assert.strictEqual(resOk.status, 200)
    assert.ok(resOk.data.accessToken)
    assert.ok(resOk.data.refreshToken)
  })

  await runCase("6c. mobileRoutes authenticateAnyMobile rejects revoked device_access token on GET /calls", async () => {
    const app = express()
    app.use(express.json())
    app.use("/api/mobile/v1", mobileRoutes)

    const revokedDevToken = signJwt({
      userId: ids.USER_B_ID.toString(),
      deviceId: ids.DEV_B_ID.toString(),
      tenantId: ids.TENANT_B,
      tokenType: "device_access",
      tokenVersion: 1,
    })
    const res = await runExpressRequest(app, {
      method: "GET",
      path: "/api/mobile/v1/calls",
      headers: { Authorization: `Bearer ${revokedDevToken}` },
    })
    assert.strictEqual(res.status, 403)
    assert.strictEqual(res.data.code, "DEVICE_REVOKED")
  })

  // =========================================================================
  // TEST 7: Recording Upload Ticket & GridFS Fail-Closed Isolation
  // =========================================================================
  console.log("\n[7] Recording Upload Ticket & GridFS Document Fail-Closed")

  await runCase("7a. recordingAuthMiddleware rejects forged ticket, call mismatch, workspace spoofing, wrong owner, revoked tokenVersion, and REVOKED device", async () => {
    invalidateAccountWorkspaceModeCache()
    const origCallFindOne = Call.findOne
    const otherAgentId = new mongoose.Types.ObjectId()
    const callFixtures = {
      call_A1: { _id: new mongoose.Types.ObjectId(), clientCallId: "call_A1", tenantId: ids.TENANT_A, workspaceId: ids.WS_A1, agentId: ids.USER_A_ID },
      call_OtherOwner: { _id: new mongoose.Types.ObjectId(), clientCallId: "call_OtherOwner", tenantId: ids.TENANT_A, workspaceId: ids.WS_A1, agentId: otherAgentId },
      call_B1: { _id: new mongoose.Types.ObjectId(), clientCallId: "call_B1", tenantId: ids.TENANT_B, workspaceId: ids.WS_B1, agentId: ids.USER_B_ID },
    }
    Call.findOne = (q) => makeQuery(() => {
      const or = q?.$or || []
      const cid = or.find((x) => x.clientCallId)?.clientCallId
      const c = cid ? callFixtures[cid] : null
      if (c && q.tenantId && c.tenantId !== q.tenantId) return null
      return c || null
    })

    const app = express()
    app.use(express.json())
    app.put("/api/calls/:callId/recording", authenticateRecordingUpload, (req, res) => {
      res.json({ ok: true, tenantContext: req.tenantContext })
    })

    try {
      // 1. Explicit invalid X-Recording-Ticket fails closed 401
      const badTicketRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_A1/recording",
        headers: { "X-Recording-Ticket": "not-a-valid-jwt" },
        body: {},
      })
      assert.strictEqual(badTicketRes.status, 401)
      assert.strictEqual(badTicketRes.data.code, "INVALID_RECORDING_TICKET")

      // 2. Ticket for call_A1 submitted to call_A2 -> 403 TICKET_CALL_MISMATCH
      const ticketA1 = signJwt({
        subject: "recording_upload_ticket",
        agentId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        callId: "call_A1",
        workspaceId: ids.WS_A1.toString(),
        deviceId: ids.DEV_A_ID.toString(),
        tokenVersion: 1,
      })
      const mismatchCall = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_A2/recording",
        headers: { "X-Recording-Ticket": ticketA1 },
        body: {},
      })
      assert.strictEqual(mismatchCall.status, 403)
      assert.strictEqual(mismatchCall.data.code, "TICKET_CALL_MISMATCH")

      // 3. Call not found in user's tenant (e.g. call_B1 accessed with tenant A ticket matching callId) -> 404 CALL_NOT_FOUND
      const ticketCrossCall = signJwt({
        subject: "recording_upload_ticket",
        agentId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        callId: "call_B1",
        workspaceId: ids.WS_A1.toString(),
        deviceId: ids.DEV_A_ID.toString(),
        tokenVersion: 1,
      })
      const missingCallRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_B1/recording",
        headers: { "X-Recording-Ticket": ticketCrossCall },
        body: {},
      })
      assert.strictEqual(missingCallRes.status, 404)
      assert.strictEqual(missingCallRes.data.code, "CALL_NOT_FOUND")

      // 4. Ticket issued for a call owned by another agent -> 403 FORBIDDEN_CALL_OWNERSHIP
      const otherOwnerTicket = signJwt({
        subject: "recording_upload_ticket",
        agentId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        callId: "call_OtherOwner",
        workspaceId: ids.WS_A1.toString(),
        deviceId: ids.DEV_A_ID.toString(),
        tokenVersion: 1,
      })
      const otherOwnerRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_OtherOwner/recording",
        headers: { "X-Recording-Ticket": otherOwnerTicket },
        body: {},
      })
      assert.strictEqual(otherOwnerRes.status, 403)
      assert.strictEqual(otherOwnerRes.data.code, "FORBIDDEN_CALL_OWNERSHIP")

      // 5. Workspace spoofing X-Workspace-Id: WS_A2 -> 403 TICKET_WORKSPACE_MISMATCH
      const spoofedWs = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_A1/recording",
        headers: { "X-Recording-Ticket": ticketA1, "X-Workspace-Id": ids.WS_A2.toString() },
        body: {},
      })
      assert.strictEqual(spoofedWs.status, 403)
      assert.strictEqual(spoofedWs.data.code, "TICKET_WORKSPACE_MISMATCH")

      // 6. Stale tokenVersion on ticket -> 401 TOKEN_REVOKED
      const staleTicket = signJwt({
        subject: "recording_upload_ticket",
        agentId: ids.USER_A_ID.toString(),
        tenantId: ids.TENANT_A,
        callId: "call_A1",
        workspaceId: ids.WS_A1.toString(),
        tokenVersion: 0,
      })
      const staleRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_A1/recording",
        headers: { "X-Recording-Ticket": staleTicket },
        body: {},
      })
      assert.strictEqual(staleRes.status, 401)
      assert.strictEqual(staleRes.data.code, "TOKEN_REVOKED")

      // 7. Uppercase REVOKED device on ticket -> 403 DEVICE_REVOKED
      const revokedDevTicket = signJwt({
        subject: "recording_upload_ticket",
        agentId: ids.USER_B_ID.toString(),
        tenantId: ids.TENANT_B,
        callId: "call_B1",
        workspaceId: ids.WS_B1.toString(),
        deviceId: ids.DEV_B_ID.toString(),
        tokenVersion: 1,
      })
      const revDevRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_B1/recording",
        headers: { "X-Recording-Ticket": revokedDevTicket },
        body: {},
      })
      assert.strictEqual(revDevRes.status, 403)
      assert.strictEqual(revDevRes.data.code, "DEVICE_REVOKED")

      // 8. Valid ticket -> 200 & workspace bound
      const okRes = await runExpressRequest(app, {
        method: "PUT",
        path: "/api/calls/call_A1/recording",
        headers: { "X-Recording-Ticket": ticketA1 },
        body: {},
      })
      assert.strictEqual(okRes.status, 200)
      assert.strictEqual(okRes.data.tenantContext.workspaceId, ids.WS_A1.toString())
    } finally {
      Call.findOne = origCallFindOne
    }
  })

  await runCase("7b. documentStorage resolves unambiguous legacy files without metadata.tenantId and fails closed on orphaned/ambiguous/cross-tenant files", async () => {
    const fileAId = new mongoose.Types.ObjectId()
    const fileLegacyOwnedId = new mongoose.Types.ObjectId()
    const fileLegacyOrphanId = new mongoose.Types.ObjectId()
    const fileLegacyAmbiguousId = new mongoose.Types.ObjectId()
    const { Readable } = require("stream")

    const gridDocs = {
      [fileAId.toString()]: { _id: fileAId, filename: "quoteA.pdf", contentType: "application/pdf", metadata: { tenantId: ids.TENANT_A } },
      [fileLegacyOwnedId.toString()]: { _id: fileLegacyOwnedId, filename: "legacy_quoteA.pdf", contentType: "application/pdf", metadata: {} },
      [fileLegacyOrphanId.toString()]: { _id: fileLegacyOrphanId, filename: "orphan.pdf", contentType: "application/pdf", metadata: {} },
      [fileLegacyAmbiguousId.toString()]: { _id: fileLegacyAmbiguousId, filename: "ambiguous.pdf", contentType: "application/pdf", metadata: {} },
    }
    const origQuoteFind = Quotation.find
    const origBrochureFind = Brochure.find
    Quotation.find = (q) => makeQuery(() => {
      const fids = (q?.$or || []).map((x) => String(x.fileId))
      if (fids.includes(fileLegacyOwnedId.toString())) return [{ _id: new mongoose.Types.ObjectId(), tenantId: ids.TENANT_A, workspaceId: ids.WS_A1 }]
      if (fids.includes(fileLegacyAmbiguousId.toString())) return [{ _id: new mongoose.Types.ObjectId(), tenantId: ids.TENANT_A, workspaceId: ids.WS_A1 }]
      return []
    })
    Brochure.find = (q) => makeQuery(() => {
      const fids = (q?.$or || []).map((x) => String(x.fileId))
      if (fids.includes(fileLegacyAmbiguousId.toString())) return [{ _id: new mongoose.Types.ObjectId(), tenantId: ids.TENANT_B, workspaceId: ids.WS_B1 }]
      return []
    })

    let bucketDeleteCalled = 0

    // Temporary in-memory mock on GridFSBucket.prototype + mongoose.connection for this isolated unit check
    const GridFSBucket = mongoose.mongo.GridFSBucket
    const origFind = GridFSBucket.prototype.find
    const origOpenDownloadStream = GridFSBucket.prototype.openDownloadStream
    const origDelete = GridFSBucket.prototype.delete
    const origReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState")
    const origDb = Object.getOwnPropertyDescriptor(mongoose.connection, "db")

    Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true })
    Object.defineProperty(mongoose.connection, "db", {
      value: {
        s: { options: {} },
        collection: () => ({
          findOne: async (q) => gridDocs[String(q._id)] || null,
        }),
      },
      configurable: true,
    })
    GridFSBucket.prototype.find = (q) => ({
      toArray: async () => (gridDocs[String(q?._id)] ? [gridDocs[String(q._id)]] : []),
    })
    GridFSBucket.prototype.openDownloadStream = () => Readable.from([Buffer.from("%PDF-1.4\nhello")])
    GridFSBucket.prototype.delete = async () => {
      bucketDeleteCalled++
    }

    try {
      // Cross-tenant tagged read -> 403
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileAId.toString(), tenantId: ids.TENANT_B }),
        (err) => err.statusCode === 403
      )
      // Orphaned legacy read (missing metadata + 0 parents) -> fail closed 403 LEGACY_GRIDFS_UNOWNED
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileLegacyOrphanId.toString(), tenantId: ids.TENANT_A }),
        (err) => err.statusCode === 403 && err.code === "LEGACY_GRIDFS_UNOWNED"
      )
      // Ambiguous legacy read (parent refs across Tenant A & Tenant B) -> fail closed 403 LEGACY_GRIDFS_AMBIGUOUS
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileLegacyAmbiguousId.toString(), tenantId: ids.TENANT_A }),
        (err) => err.statusCode === 403 && err.code === "LEGACY_GRIDFS_AMBIGUOUS"
      )
      // Valid legacy file accessed by Tenant B or wrong Workspace WS_A2 -> 403
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileLegacyOwnedId.toString(), tenantId: ids.TENANT_B }),
        (err) => err.statusCode === 403
      )
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileLegacyOwnedId.toString(), tenantId: ids.TENANT_A, workspaceId: ids.WS_A2.toString() }),
        (err) => err.statusCode === 403 && err.code === "LEGACY_GRIDFS_WORKSPACE_MISMATCH"
      )
      // Valid legacy file accessed unambiguously by owning Tenant A + WS_A1 -> SUCCEEDS!
      const legacyDoc = await documentStorage.getDocumentBuffer({
        fileId: fileLegacyOwnedId.toString(),
        tenantId: ids.TENANT_A,
        workspaceId: ids.WS_A1.toString(),
      })
      assert.ok(legacyDoc.buffer.toString("utf8").includes("%PDF-"))

      // Missing caller tenantId read -> fail closed 400 or 403
      await assert.rejects(
        () => documentStorage.getDocumentBuffer({ fileId: fileAId.toString(), tenantId: "" }),
        (err) => err.statusCode === 400 || err.statusCode === 403
      )
      // Cross-tenant & orphaned delete -> fail closed 403 with 0 deletes
      await assert.rejects(
        () => documentStorage.deleteDocument({ fileId: fileAId.toString(), tenantId: ids.TENANT_B }),
        (err) => err.statusCode === 403
      )
      await assert.rejects(
        () => documentStorage.deleteDocument({ fileId: fileLegacyOrphanId.toString(), tenantId: ids.TENANT_A }),
        (err) => err.statusCode === 403
      )
      assert.strictEqual(bucketDeleteCalled, 0)

      // Matching tenant read & delete succeed
      const doc = await documentStorage.getDocumentBuffer({ fileId: fileAId.toString(), tenantId: ids.TENANT_A })
      assert.ok(doc.buffer.toString("utf8").includes("%PDF-"))
      await documentStorage.deleteDocument({ fileId: fileAId.toString(), tenantId: ids.TENANT_A })
      assert.strictEqual(bucketDeleteCalled, 1)
    } finally {
      Quotation.find = origQuoteFind
      Brochure.find = origBrochureFind
      GridFSBucket.prototype.find = origFind
      GridFSBucket.prototype.openDownloadStream = origOpenDownloadStream
      GridFSBucket.prototype.delete = origDelete
      if (origReadyState) Object.defineProperty(mongoose.connection, "readyState", origReadyState)
      if (origDb) Object.defineProperty(mongoose.connection, "db", origDb)
    }
  })

  await runCase("7c. recordingStorage.streamPlayback resolves legacy GridFS recording missing metadata.tenantId only when Call ownership is unambiguous", async () => {
    const { Readable } = require("stream")
    const legacyRecId = new mongoose.Types.ObjectId()
    const callRecId = new mongoose.Types.ObjectId()

    const origCallFindOne = Call.findOne
    const origCallFind = Call.find
    const GridFSBucket = mongoose.mongo.GridFSBucket
    const origFind = GridFSBucket.prototype.find
    const origOpenDownloadStream = GridFSBucket.prototype.openDownloadStream
    const origReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState")
    const origDb = Object.getOwnPropertyDescriptor(mongoose.connection, "db")

    Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true })
    Object.defineProperty(mongoose.connection, "db", {
      value: {
        s: { options: {} },
        collection: () => ({
          findOne: async () => ({ _id: new mongoose.Types.ObjectId() }),
        }),
      },
      configurable: true,
    })

    const recFileDoc = {
      _id: legacyRecId,
      filename: "legacy_audio.mp3",
      contentType: "audio/mpeg",
      length: 12,
      metadata: { codec: "mp3" }, // intentionally missing metadata.tenantId
    }

    GridFSBucket.prototype.find = (q) => ({
      next: async () => {
        if (q?.["metadata.tenantId"]) return null
        if (String(q?._id) === legacyRecId.toString()) return recFileDoc
        return null
      },
    })
    GridFSBucket.prototype.openDownloadStream = () => Readable.from([Buffer.from("ID3_LEGACY_A")])

    Call.findOne = (q) => makeQuery(() => {
      if (q.tenantId && q.tenantId !== ids.TENANT_A) return null
      return {
        _id: callRecId,
        tenantId: ids.TENANT_A,
        workspaceId: ids.WS_A1,
        agentId: ids.USER_A_ID,
        recording: { fileId: legacyRecId, codec: "mp3", format: "mp3" },
        save: async () => {},
      }
    })

    const mockRes = () => {
      const r = {
        statusCode: 200,
        headers: {},
        bodyChunks: [],
        ended: false,
        listeners: {},
        setHeader(k, v) { this.headers[k] = v },
        writeHead(code, hdrs) { this.statusCode = code; Object.assign(this.headers, hdrs || {}) },
        status(c) { this.statusCode = c; return this },
        json(d) { this.jsonBody = d; this.ended = true; return this },
        send(d) { this.bodyChunks.push(Buffer.from(d)); this.ended = true; return this },
        on(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb) },
        once(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb) },
        emit() {},
        write(chunk) { this.bodyChunks.push(Buffer.from(chunk)); return true },
        end(chunk) { if (chunk) this.bodyChunks.push(Buffer.from(chunk)); this.ended = true },
      }
      return r
    }

    try {
      // 1. Unambiguous Call parent in TENANT_A -> streams audio!
      Call.find = () => makeQuery(() => [{ _id: callRecId, tenantId: ids.TENANT_A, workspaceId: ids.WS_A1 }])
      const resOk = mockRes()
      await recordingStorage.streamPlayback({
        callId: callRecId.toString(),
        tenantId: ids.TENANT_A,
        user: users[ids.USER_A_ID.toString()],
        res: resOk,
      })
      assert.strictEqual(resOk.statusCode, 200)

      // 2. Ambiguous parent Calls across TENANT_A and TENANT_B -> fails closed (never streams audio!)
      Call.find = () => makeQuery(() => [
        { _id: callRecId, tenantId: ids.TENANT_A, workspaceId: ids.WS_A1 },
        { _id: new mongoose.Types.ObjectId(), tenantId: ids.TENANT_B, workspaceId: ids.WS_B1 },
      ])
      const resAmbig = mockRes()
      await recordingStorage.streamPlayback({
        callId: callRecId.toString(),
        tenantId: ids.TENANT_A,
        user: users[ids.USER_A_ID.toString()],
        res: resAmbig,
      })
      assert.strictEqual(resAmbig.statusCode, 404)
    } finally {
      Call.findOne = origCallFindOne
      Call.find = origCallFind
      GridFSBucket.prototype.find = origFind
      GridFSBucket.prototype.openDownloadStream = origOpenDownloadStream
      if (origReadyState) Object.defineProperty(mongoose.connection, "readyState", origReadyState)
      if (origDb) Object.defineProperty(mongoose.connection, "db", origDb)
    }
  })

  // =========================================================================
  // TEST 8: Cross-Tenant Login Mismatch, Quotation Scope, & Mobile Call Attribution
  // =========================================================================
  console.log("\n[8] Cross-Tenant Login, Quotation Lookup & Call Attribution")

  await runCase("8a. authController.login strictly rejects cross-tenant email+tenantId mismatch (403 CROSS_TENANT_LOGIN_MISMATCH)", async () => {
    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.post("/api/auth/login", authController.login)

    const origUserFind = User.find
    User.find = (filter = {}) => makeQuery(() => findByFilter(Object.values(users), filter))
    try {
      const res = await runExpressRequest(app, {
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: "agentb@tenantb.test",
          password: "SomePassword123!",
          tenantId: ids.TENANT_A,
        },
      })
      assert.strictEqual(res.status, 403)
      assert.strictEqual(res.data.code, "CROSS_TENANT_LOGIN_MISMATCH")
    } finally {
      User.find = origUserFind
    }
  })

  await runCase("8b. quotationController download/delete blocks cross-tenant and wrong-workspace access", async () => {
    invalidateAccountWorkspaceModeCache()
    const quoteA1Id = new mongoose.Types.ObjectId()
    const leadA1Id = new mongoose.Types.ObjectId()
    const fileA1Id = new mongoose.Types.ObjectId()
    const quoteDocs = [
      {
        _id: quoteA1Id,
        tenantId: ids.TENANT_A,
        workspaceId: ids.WS_A1,
        leadId: leadA1Id,
        fileId: fileA1Id,
        originalName: "A1_Quote.pdf",
        status: "uploaded",
        sentCount: 0,
      },
    ]

    const origQuoteFindOne = Quotation.findOne
    const origQuoteDeleteOne = Quotation.deleteOne
    let quotationDeleteCalls = 0
    Quotation.findOne = (filter = {}) => makeQuery(() => findByFilter(quoteDocs, filter)[0] || null)
    Quotation.deleteOne = () => makeQuery(() => { quotationDeleteCalls++; return { deletedCount: 1 } })

    const app = express()
    app.use(express.json())
    app.use("/api/quotations", quotationRoutes)

    try {
      // Agent B (Tenant B) trying to download Tenant A's quotation -> 404 (not found in B's tenant/workspace)
      const tokB = signJwt({ id: ids.USER_B_ID.toString(), tenantId: ids.TENANT_B, role: "agent", tokenVersion: 1 })
      const crossTenantDl = await runExpressRequest(app, {
        method: "GET",
        path: `/api/quotations/${quoteA1Id.toString()}/download`,
        headers: { Authorization: `Bearer ${tokB}`, "X-Workspace-Id": ids.WS_B1.toString() },
      })
      assert.strictEqual(crossTenantDl.status, 404)

      // Agent B trying to delete Tenant A's quotation -> 404
      const crossTenantDel = await runExpressRequest(app, {
        method: "DELETE",
        path: `/api/quotations/${quoteA1Id.toString()}`,
        headers: { Authorization: `Bearer ${tokB}`, "X-Workspace-Id": ids.WS_B1.toString() },
      })
      assert.strictEqual(crossTenantDel.status, 404)

      // Even a Tenant A Account Admin viewing in strict workspace WS_A2 cannot access WS_A1's quotation
      const adminAId = new mongoose.Types.ObjectId()
      users[adminAId.toString()] = {
        _id: adminAId,
        id: adminAId.toString(),
        tenantId: ids.TENANT_A,
        role: "account_admin",
        name: "Admin A",
        email: "admina@tenanta.test",
        status: "active",
        isActive: true,
        tokenVersion: 1,
      }
      const adminATok = signJwt({ id: adminAId.toString(), tenantId: ids.TENANT_A, role: "account_admin", tokenVersion: 1 })
      const crossWsDl = await runExpressRequest(app, {
        method: "GET",
        path: `/api/quotations/${quoteA1Id.toString()}/download`,
        headers: { Authorization: `Bearer ${adminATok}`, "X-Workspace-Id": ids.WS_A2.toString() },
      })
      assert.strictEqual(crossWsDl.status, 404)

      const crossWsDel = await runExpressRequest(app, {
        method: "DELETE",
        path: `/api/quotations/${quoteA1Id.toString()}`,
        headers: { Authorization: `Bearer ${adminATok}`, "X-Workspace-Id": ids.WS_A2.toString() },
      })
      assert.strictEqual(crossWsDel.status, 404)
      assert.strictEqual(quotationDeleteCalls, 0)
    } finally {
      Quotation.findOne = origQuoteFindOne
      Quotation.deleteOne = origQuoteDeleteOne
    }
  })

  await runCase("8c. mobileController.reportMobileCall scopes existingCall by tenantId & candidateQuery by strict workspaceId", async () => {
    invalidateAccountWorkspaceModeCache()
    const observedCallQueries = []
    const createdCalls = []

    const origCallFindOne = Call.findOne
    const origCallFind = Call.find
    const origCallCreate = Call.create
    const origLeadFindOne = Lead.findOne

    Call.findOne = (q) => {
      observedCallQueries.push({ op: "findOne", q })
      // Only Tenant A already owns shared-client-call-1
      if (q.tenantId === ids.TENANT_A && q.clientCallId === "shared-client-call-1") {
        return makeQuery(() => ({ _id: new mongoose.Types.ObjectId(), tenantId: ids.TENANT_A, clientCallId: "shared-client-call-1" }))
      }
      return makeQuery(() => null)
    }
    Call.find = (q) => {
      observedCallQueries.push({ op: "find", q })
      return makeQuery(() => [])
    }
    Call.create = async (doc) => {
      const rec = { _id: new mongoose.Types.ObjectId(), ...doc }
      createdCalls.push(rec)
      return rec
    }
    Lead.findOne = () => makeQuery(() => null)

    const app = express()
    app.use(express.json())
    const { authenticate } = require("../middleware/authMiddleware")
    app.post("/api/mobile/v1/calls", authenticate, mobileController.reportMobileCall)

    try {
      const tokB = signJwt({ id: ids.USER_B_ID.toString(), tenantId: ids.TENANT_B, role: "agent", tokenVersion: 1 })
      const res = await runExpressRequest(app, {
        method: "POST",
        path: "/api/mobile/v1/calls",
        headers: { Authorization: `Bearer ${tokB}`, "X-Workspace-Id": ids.WS_B1.toString() },
        body: {
          client_call_id: "shared-client-call-1",
          phone_number: "+919999888877",
          call_direction: "OUTGOING",
          start_time_ms: Date.now(),
          duration_seconds: 25,
          workspace_id: ids.WS_B1.toString(),
        },
      })
      assert.strictEqual(res.status, 201)
      const findOneForClientCall = observedCallQueries.find((x) => x.op === "findOne" && x.q.clientCallId === "shared-client-call-1")
      assert.ok(findOneForClientCall, "existingCall lookup must happen")
      assert.strictEqual(findOneForClientCall.q.tenantId, ids.TENANT_B, "existingCall lookup must scope by Tenant B")

      const candQuery = observedCallQueries.find((x) => x.op === "find" && x.q.clientCallId === null)
      assert.ok(candQuery, "candidateQuery must happen")
      assert.strictEqual(String(candQuery.q.workspaceId), ids.WS_B1.toString(), "candidateQuery must enforce strict workspaceId")
      assert.strictEqual(createdCalls[0].tenantId, ids.TENANT_B)
      assert.strictEqual(String(createdCalls[0].workspaceId), ids.WS_B1.toString())
    } finally {
      Call.findOne = origCallFindOne
      Call.find = origCallFind
      Call.create = origCallCreate
      Lead.findOne = origLeadFindOne
    }
  })

  // =========================================================================
  // TEST 9: Telephony, WhatsApp & Meta Webhook Authentication (Fail-Closed)
  // =========================================================================
  console.log("\n[9] Telephony, WhatsApp & Meta Webhook Authentication (Fail-Closed)")

  await runCase("9a. telephonyRoutes authenticates /webhook/status & /webhook/recording (rejects unauthenticated, accepts CallSid + valid secret) and guards cross-tenant CallSid", async () => {
    const app = express()
    app.use(express.json())
    app.use("/api/telephony", telephonyRoutes)

    const origProfileFindOne = TenantBusinessProfile.findOne
    const origCallFindOne = Call.findOne
    const origGetSession = inboundCallRouter.getActiveCallSession
    const origDecryptedCreds = telephonyConfigService.getDecryptedTelephonyCredentials

    let activeProfile = {
      tenantId: ids.TENANT_A,
      provider: "mock",
      telephonyConfig: { authToken: "mock-webhook-secret-A" },
    }
    TenantBusinessProfile.findOne = () => makeQuery(() => activeProfile)
    Call.findOne = () => makeQuery(() => null)
    telephonyConfigService.getDecryptedTelephonyCredentials = async () => ({ authToken: activeProfile?.telephonyConfig?.authToken || "" })

    try {
      // 1. Unauthenticated POST /webhook/status -> 401
      const unauthStatus = await runExpressRequest(app, {
        method: "POST",
        path: "/api/telephony/webhook/status",
        body: { CallSid: "CA_UNAUTH_1", CallStatus: "completed", To: "+911122334455" },
      })
      assert.strictEqual(unauthStatus.status, 401)

      // 2. Unauthenticated POST /webhook/recording -> 401
      const unauthRec = await runExpressRequest(app, {
        method: "POST",
        path: "/api/telephony/webhook/recording",
        body: { CallSid: "CA_UNAUTH_2", RecordingUrl: "https://evil.test/a.mp3", To: "+911122334455" },
      })
      assert.strictEqual(unauthRec.status, 401)

      // 3. Valid mock webhook HMAC signature on /webhook/status/mock -> 200 accepted
      const mockSecret = process.env.MOCK_TELEPHONY_SECRET || "mock-telephony-secret-key-365"
      const validMockBody = { CallSid: "CA_AUTH_1", CallStatus: "ringing", To: "+911122334455" }
      const validMockSig = crypto
        .createHmac("sha256", mockSecret)
        .update(JSON.stringify(validMockBody))
        .digest("hex")
      const authStatus = await runExpressRequest(app, {
        method: "POST",
        path: "/api/telephony/webhook/status/mock",
        headers: { "x-mock-signature": validMockSig },
        body: validMockBody,
      })
      assert.strictEqual(authStatus.status, 200)

      // 4. Missing provider secret for real provider (twilio) -> 401 fail-closed
      activeProfile = {
        tenantId: ids.TENANT_A,
        provider: "twilio",
        telephonyConfig: {},
      }
      const noSecretStatus = await runExpressRequest(app, {
        method: "POST",
        path: "/api/telephony/webhook/status/twilio",
        headers: { "x-twilio-signature": "anything" },
        body: { CallSid: "CA_NOSECRET", CallStatus: "completed", To: "+911122334455" },
      })
      assert.strictEqual(noSecretStatus.status, 401)

      // 5. Cross-tenant CallSid protection in inboundCallRouter.handleLifecycleEvent
      if (typeof inboundCallRouter.handleLifecycleEvent === "function" && typeof inboundCallRouter.getActiveCallSession === "function") {
        const fakeSessionA = { callSid: "CA_LOCKED_A", tenantId: ids.TENANT_A, status: "in-progress" }
        const origGet = inboundCallRouter.getActiveCallSession
        inboundCallRouter.getActiveCallSession = (sid) => (sid === "CA_LOCKED_A" ? fakeSessionA : undefined)
        const lifecycleRes = await inboundCallRouter.handleLifecycleEvent(
          { provider: "mock", eventType: "status", callSid: "CA_LOCKED_A", normalizedStatus: "completed", status: "completed" },
          { tenantId: ids.TENANT_B }
        )
        assert.strictEqual(fakeSessionA.status, "in-progress", "Cross-tenant CallSid event must NOT mutate Tenant A session")
        if (lifecycleRes && lifecycleRes.ignored !== undefined) {
          assert.strictEqual(lifecycleRes.ignored, true)
        }
        inboundCallRouter.getActiveCallSession = origGet
      }
    } finally {
      TenantBusinessProfile.findOne = origProfileFindOne
      Call.findOne = origCallFindOne
      inboundCallRouter.getActiveCallSession = origGetSession
      telephonyConfigService.getDecryptedTelephonyCredentials = origDecryptedCreds
    }
  })

  await runCase("9b. whatsappWebhookController fails closed when App Secret missing or HMAC invalid, succeeds with valid sha256 HMAC", async () => {
    const origGetGlobalConfig = whatsappService.getGlobalConfig
    const origProcessWebhook = whatsappService.processWebhookPayload

    const app = express()
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          req.rawBody = buf
        },
      })
    )
    app.post("/webhook/whatsapp", whatsappWebhookController.handleWhatsAppWebhookNotification)

    let processCalls = 0
    whatsappService.processWebhookPayload = async () => {
      processCalls++
      return { processed: 1 }
    }

    try {
      // 1. Missing appSecret -> 403 fail closed
      whatsappService.getGlobalConfig = async () => ({ appSecret: "" })
      const payload = { object: "whatsapp_business_account", entry: [] }
      const noSecretRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/whatsapp",
        body: payload,
      })
      assert.strictEqual(noSecretRes.status, 403)
      assert.strictEqual(processCalls, 0)

      // 2. Configured appSecret + wrong signature -> 403 fail closed
      const secret = "wa-super-secret-2026"
      whatsappService.getGlobalConfig = async () => ({ appSecret: secret })
      const raw = JSON.stringify(payload)
      const badSigRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/whatsapp",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
        rawBody: raw,
      })
      assert.strictEqual(badSigRes.status, 403)
      assert.strictEqual(processCalls, 0)

      // 3. Valid sha256 HMAC signature -> 200 EVENT_RECEIVED
      const goodSig = "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex")
      const okRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/whatsapp",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": goodSig },
        rawBody: raw,
      })
      assert.strictEqual(okRes.status, 200)
      assert.strictEqual(processCalls, 1)
    } finally {
      whatsappService.getGlobalConfig = origGetGlobalConfig
      whatsappService.processWebhookPayload = origProcessWebhook
    }
  })

  await runCase("9c. metaController fails closed when Meta App Secret missing or HMAC invalid, succeeds with valid sha256 HMAC", async () => {
    const origIntegFindOne = Integration.findOne
    const origIntegFind = Integration.find
    const origDecryptCreds = metaService.decryptCredentials
    const origMetaSecret = process.env.META_APP_SECRET

    const app = express()
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          req.rawBody = buf
        },
      })
    )
    app.post("/webhook/meta", metaController.handleMetaWebhookNotification)

    const payload = { object: "page", entry: [{ id: "PAGE_1", changes: [] }] }
    const raw = JSON.stringify(payload)

    try {
      delete process.env.META_APP_SECRET
      let configuredAppSecret = ""
      const integDoc = {
        _id: new mongoose.Types.ObjectId(),
        tenantId: ids.TENANT_A,
        type: "meta",
        status: "active",
        settings: { pageId: "PAGE_1" },
        getDecryptedCredentials: () => ({ pageId: "PAGE_1", appSecret: configuredAppSecret }),
      }
      Integration.findOne = () => makeQuery(() => integDoc)
      Integration.find = () => makeQuery(() => [integDoc])
      metaService.decryptCredentials = () => ({ appSecret: configuredAppSecret })

      // 1. Missing appSecret -> 403 fail closed
      const noSecretRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/meta",
        headers: { "Content-Type": "application/json" },
        rawBody: raw,
      })
      assert.strictEqual(noSecretRes.status, 403)

      // 2. Configured appSecret + wrong signature -> 403 fail closed
      const secret = "meta-super-secret-2026"
      configuredAppSecret = secret
      metaService.decryptCredentials = () => ({ appSecret: secret })
      const badSigRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/meta",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=badbeef" },
        rawBody: raw,
      })
      assert.strictEqual(badSigRes.status, 403)

      // 3. Valid sha256 HMAC -> 200
      const goodSig = "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex")
      const okRes = await runExpressRequest(app, {
        method: "POST",
        path: "/webhook/meta",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": goodSig },
        rawBody: raw,
      })
      assert.strictEqual(okRes.status, 200)
    } finally {
      Integration.findOne = origIntegFindOne
      Integration.find = origIntegFind
      metaService.decryptCredentials = origDecryptCreds
      if (origMetaSecret !== undefined) process.env.META_APP_SECRET = origMetaSecret
      else delete process.env.META_APP_SECRET
    }
  })

  // =========================================================================
  // TEST 10: Scheduler Tenant/Workspace Context, Plugin, & WhatsApp QR Propagation
  // =========================================================================
  console.log("\n[10] Background Jobs, tenantIsolationPlugin, & WhatsApp QR Workspace Isolation")

  await runCase("10a. aiCallbackScheduling.checkAndDispatchDueReminders enters each record's tenantId + workspaceId context", async () => {
    const origFuFind = FollowUp.find
    const origLeadFindUpd = Lead.findOneAndUpdate
    const origPushRem = pushNotificationService.sendCallbackReminderNotification

    const observedContexts = []
    const leadIdA = new mongoose.Types.ObjectId()
    const leadIdB = new mongoose.Types.ObjectId()

    const mockTasks = [
      {
        _id: new mongoose.Types.ObjectId(),
        tenantId: ids.TENANT_A,
        workspaceId: ids.WS_A1,
        leadId: { _id: leadIdA, workspaceId: ids.WS_A1, assignedTo: "agent" },
        status: "pending",
        assignedAgentId: ids.USER_A_ID,
        save: async () => {
          observedContexts.push({ op: "followUp.save", ctx: getTenantContext() })
        },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        tenantId: ids.TENANT_B,
        workspaceId: ids.WS_B1,
        leadId: { _id: leadIdB, workspaceId: ids.WS_B1, assignedTo: "agent" },
        status: "pending",
        assignedAgentId: ids.USER_B_ID,
        save: async () => {
          observedContexts.push({ op: "followUp.save", ctx: getTenantContext() })
        },
      },
    ]

    let findCall = 0
    FollowUp.find = () =>
      makeQuery(() => {
        findCall++
        // Scan 2 is dueTasks
        return findCall === 2 ? mockTasks : []
      })
    Lead.findOneAndUpdate = () =>
      makeQuery(() => {
        observedContexts.push({ op: "lead.findOneAndUpdate", ctx: getTenantContext() })
        return null
      })
    pushNotificationService.sendCallbackReminderNotification = async () => ({ sent: true })

    try {
      const res = await aiCallbackScheduling.checkAndDispatchDueReminders()
      assert.strictEqual(res.dueNowCount, 2)
      assert.strictEqual(observedContexts.filter((x) => x.op === "followUp.save").length, 2)
      assert.strictEqual(observedContexts[0].ctx.tenantId, ids.TENANT_A)
      assert.strictEqual(String(observedContexts[0].ctx.workspaceId), ids.WS_A1.toString())
      assert.strictEqual(observedContexts[0].ctx.isBackgroundJob, true)
      assert.strictEqual(observedContexts[2].ctx.tenantId, ids.TENANT_B)
      assert.strictEqual(String(observedContexts[2].ctx.workspaceId), ids.WS_B1.toString())
    } finally {
      FollowUp.find = origFuFind
      Lead.findOneAndUpdate = origLeadFindUpd
      pushNotificationService.sendCallbackReminderNotification = origPushRem
    }
  })

  await runCase("10b. recordingStorage.purgeExpiredRecordings enters per-call tenantId & workspaceId context before save", async () => {
    const origCallFind = Call.find
    const origAuditLog = auditService.log
    const origReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState")
    const origDb = Object.getOwnPropertyDescriptor(mongoose.connection, "db")

    const observedSaves = []
    const expiredCalls = [
      {
        _id: new mongoose.Types.ObjectId(),
        tenantId: ids.TENANT_A,
        workspaceId: ids.WS_A1,
        metadata: { storageProvider: "gridfs", fileId: new mongoose.Types.ObjectId().toString() },
        save: async () => {
          observedSaves.push({ id: "callA", ctx: getTenantContext() })
        },
      },
      {
        _id: new mongoose.Types.ObjectId(),
        tenantId: ids.TENANT_B,
        workspaceId: ids.WS_B1,
        metadata: { storageProvider: "gridfs", fileId: new mongoose.Types.ObjectId().toString() },
        save: async () => {
          observedSaves.push({ id: "callB", ctx: getTenantContext() })
        },
      },
    ]

    Call.find = () => makeQuery(() => expiredCalls)
    auditService.log = async () => {}

    const GridFSBucket = mongoose.mongo.GridFSBucket
    const origDelete = GridFSBucket.prototype.delete
    Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true })
    Object.defineProperty(mongoose.connection, "db", {
      value: { s: { options: {} }, collection: () => ({}) },
      configurable: true,
    })
    GridFSBucket.prototype.delete = async () => {}

    try {
      const result = await recordingStorage.purgeExpiredRecordings({ retentionDays: 90 })
      assert.strictEqual(result.purgedCount, 2)
      assert.strictEqual(observedSaves.length, 2)
      assert.strictEqual(observedSaves[0].ctx.tenantId, ids.TENANT_A)
      assert.strictEqual(String(observedSaves[0].ctx.workspaceId), ids.WS_A1.toString())
      assert.strictEqual(observedSaves[1].ctx.tenantId, ids.TENANT_B)
      assert.strictEqual(String(observedSaves[1].ctx.workspaceId), ids.WS_B1.toString())
    } finally {
      Call.find = origCallFind
      auditService.log = origAuditLog
      GridFSBucket.prototype.delete = origDelete
      if (origReadyState) Object.defineProperty(mongoose.connection, "readyState", origReadyState)
      if (origDb) Object.defineProperty(mongoose.connection, "db", origDb)
    }
  })

  await runCase("10c. WhatsAppMessage schema has workspaceId & whatsappQrService binds workspaceId into Lead + WhatsAppMessage", async () => {
    assert.ok(WhatsAppMessage.schema.path("workspaceId"), "WhatsAppMessage schema must declare workspaceId")

    const origSessFindOne = WhatsAppQrSession.findOne
    const origSessFindOneAndUpdate = WhatsAppQrSession.findOneAndUpdate
    const origContactFindOne = TenantPhoneContact.findOne
    const origSuppFindOne = WhatsAppSuppressedNumber.findOne
    const origLeadFindOne = Lead.findOne
    const origLeadSave = Lead.prototype.save
    const origMsgUpdateMany = WhatsAppMessage.updateMany
    const origMsgFindOneAndUpdate = WhatsAppMessage.findOneAndUpdate

    const savedLeads = []
    const savedMessages = []

    const sessionDoc = {
      tenantId: ids.TENANT_A,
      workspaceId: ids.WS_A1,
      phoneNumber: "919999000011",
    }
    WhatsAppQrSession.findOne = () => makeQuery(() => sessionDoc)
    WhatsAppQrSession.findOneAndUpdate = () => makeQuery(() => null)
    TenantPhoneContact.findOne = () => makeQuery(() => null)
    WhatsAppSuppressedNumber.findOne = () => makeQuery(() => null)
    Lead.findOne = () => makeQuery(() => null)
    Lead.prototype.save = async function mockLeadSave() {
      savedLeads.push({ doc: this, ctx: getTenantContext() })
      return this
    }
    WhatsAppMessage.updateMany = () => makeQuery(() => ({ modifiedCount: 0 }))
    WhatsAppMessage.findOneAndUpdate = (_q, doc) =>
      makeQuery(() => {
        const payload = doc?.$setOnInsert || doc
        savedMessages.push({ payload, ctx: getTenantContext() })
        return { _id: new mongoose.Types.ObjectId(), ...payload }
      })

    try {
      await whatsappQrService.handleMessagesUpsert(
        ids.TENANT_A,
        [
          {
            key: {
              id: "WAMSG_SYNTH_1",
              remoteJid: "919876543210@s.whatsapp.net",
              fromMe: false,
            },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: "Synth Customer",
            message: { conversation: "Interested in workspace A1 pricing" },
          },
        ],
        sessionDoc
      )

      assert.ok(savedLeads.length >= 1, "handleMessagesUpsert should create lead")
      assert.strictEqual(savedLeads[0].ctx.tenantId, ids.TENANT_A)
      assert.strictEqual(String(savedLeads[0].ctx.workspaceId), ids.WS_A1.toString())
      assert.strictEqual(String(savedLeads[0].doc.workspaceId), ids.WS_A1.toString())

      assert.ok(savedMessages.length >= 1, "handleMessagesUpsert should persist WhatsAppMessage")
      assert.strictEqual(savedMessages[0].ctx.tenantId, ids.TENANT_A)
      assert.strictEqual(String(savedMessages[0].ctx.workspaceId), ids.WS_A1.toString())
      assert.strictEqual(String(savedMessages[0].payload.workspaceId), ids.WS_A1.toString())
    } finally {
      WhatsAppQrSession.findOne = origSessFindOne
      WhatsAppQrSession.findOneAndUpdate = origSessFindOneAndUpdate
      TenantPhoneContact.findOne = origContactFindOne
      WhatsAppSuppressedNumber.findOne = origSuppFindOne
      Lead.findOne = origLeadFindOne
      Lead.prototype.save = origLeadSave
      WhatsAppMessage.updateMany = origMsgUpdateMany
      WhatsAppMessage.findOneAndUpdate = origMsgFindOneAndUpdate
    }
  })

  await runCase("10d. tenantIsolationPlugin strictly fails closed without tenant context and injects tenantId + strict workspaceId", async () => {
    const schema = new mongoose.Schema({ tenantId: String, workspaceId: mongoose.Schema.Types.ObjectId, title: String })
    schema.plugin(tenantIsolationPlugin, { tenantField: "tenantId", workspaceField: "workspaceId" })
    const ModelName = `SynthPluginProbe_${Date.now()}`
    const ProbeModel = mongoose.model(ModelName, schema)

    // Without context -> pre-find hook rejects
    let blockedWithoutCtx = false
    await ProbeModel.find({}).exec().catch((err) => {
      if (err && /tenant/i.test(err.message)) blockedWithoutCtx = true
    })
    assert.strictEqual(blockedWithoutCtx, true, "Unscoped query without tenantContext must fail closed")

    // With strict workspace context -> pre('save') blocks cross-tenant mutation and auto-populates tenantId/workspaceId on validate
    let stamped = null
    await runWithTenantContext(
      { tenantId: ids.TENANT_A, workspaceId: ids.WS_A1.toString(), mode: "single_workspace", isSuperAdmin: false },
      async () => {
        const doc = new ProbeModel({ tenantId: ids.TENANT_B, title: "Spoof" })
        let crossTenantSaveBlocked = false
        try {
          await doc.save()
        } catch (err) {
          if (err && /Cross-tenant/i.test(err.message)) crossTenantSaveBlocked = true
        }
        assert.strictEqual(crossTenantSaveBlocked, true, "Pre-save hook must block cross-tenant document mutation")

        const autoDoc = new ProbeModel({ title: "Scoped" })
        await autoDoc.validate()
        stamped = { tenantId: autoDoc.tenantId, workspaceId: String(autoDoc.workspaceId) }
      }
    )
    assert.strictEqual(stamped.tenantId, ids.TENANT_A)
    assert.strictEqual(stamped.workspaceId, ids.WS_A1.toString())
  })

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Fatal test runner error:", err)
  process.exit(1)
})
