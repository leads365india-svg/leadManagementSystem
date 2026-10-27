const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")
const crypto = require("crypto")
const jwt = require("jsonwebtoken")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Call = require("../models/Call")
const Device = require("../models/Device")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Team = require("../models/Team")
const Role = require("../models/Role")
const { Activity } = require("../models/Activity")

const deviceAuthService = require("../services/deviceAuthService")
const mobileSyncService = require("../services/mobileSyncService")
const pushService = require("../services/pushService")
const queue = require("../services/queueService")
const {
  authenticateDevice,
  checkAppVersion,
  mobileRateLimiter,
} = require("../middleware/deviceAuthMiddleware")
const { runWithTenantContext } = require("../middleware/tenantContext")
const mobileController = require("../controllers/mobileController")

// Helper to simulate express req/res
function createMockReqRes({ method = "GET", url = "/", headers = {}, body = {}, query = {}, params = {}, user = null, device = null, tenantId = null, ip = "127.0.0.1" } = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body: { ...body },
    query: { ...query },
    params: { ...params },
    user,
    device,
    tenantId,
    ip,
    connection: { remoteAddress: ip },
    get(headerName) {
      return this.headers[headerName.toLowerCase()] || this.headers[headerName]
    },
  }

  let statusCode = 200
  let responseData = null

  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(data) {
      responseData = data
      return this
    },
    send(data) {
      responseData = data
      return this
    },
    setHeader() {},
    getStatusCode: () => statusCode,
    getData: () => responseData,
  }

  return { req, res }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 15: DEVICE AUTHENTICATION & MOBILE SYNC API - VERIFICATION SUITE   ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passed++
    } else {
      console.error(`  [FAIL] ${message}`)
      failed++
    }
  }

  const tenantA = "TEST-TENANT-P15-ALPHA"
  const tenantB = "TEST-TENANT-P15-BETA"

  try {
    // 0. Clean previous test artifacts
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Device.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Team.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Role.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

    // 1. Create Roles and Users
    const agentRoleA = await Role.create({
      tenantId: tenantA,
      name: "Sales Agent",
      slug: "agent",
      description: "Field Agent",
      permissions: ["leads.view.own", "calls.manage"],
      isSystem: true,
    })

    const agent1A = await User.create({
      tenantId: tenantA,
      name: "Agent Alice",
      email: "alice@tenant-a.com",
      password: "Password123!",
      role: "agent",
      roleId: agentRoleA._id,
      isActive: true,
    })

    const agent2A = await User.create({
      tenantId: tenantA,
      name: "Agent Bob",
      email: "bob@tenant-a.com",
      password: "Password123!",
      role: "agent",
      roleId: agentRoleA._id,
      isActive: true,
    })

    const agentRoleB = await Role.create({
      tenantId: tenantB,
      name: "Tenant B Agent",
      slug: "agent",
      description: "Agent B",
      permissions: ["leads.view.own"],
      isSystem: true,
    })

    const agent1B = await User.create({
      tenantId: tenantB,
      name: "Agent Charlie",
      email: "charlie@tenant-b.com",
      password: "Password123!",
      role: "agent",
      roleId: agentRoleB._id,
      isActive: true,
    })

    console.log("=== 1. DEVICE REGISTRATION & AUTHENTICATION ===")

    const deviceUuid1 = "uuid-samsung-galaxy-s24-001"
    const loginResult = await deviceAuthService.loginDevice({
      email: "alice@tenant-a.com",
      password: "Password123!",
      deviceUuid: deviceUuid1,
      deviceModel: "Samsung Galaxy S24",
      osVersion: "Android 14",
      appVersion: "1.2.0",
      pushToken: "fcm-alice-token-initial",
      ipAddress: "192.168.1.50",
    })

    assert(Boolean(loginResult.accessToken), "Login returned valid accessToken")
    assert(Boolean(loginResult.refreshToken), "Login returned valid refreshToken")
    assert(loginResult.expiresIn === 7200, "Access token expiry is 7200s (2h)")
    assert(loginResult.tokenType === "Bearer", "Token type is Bearer")
    assert(loginResult.user.email === "alice@tenant-a.com", "User email correctly bound in response")

    // Verify Device record in DB
    const deviceInDb = await Device.findOne({ deviceUuid: deviceUuid1, tenantId: tenantA })
    assert(Boolean(deviceInDb), "Device record created in MongoDB")
    assert(deviceInDb.status === "active", "Device status is active")
    assert(deviceInDb.userId.toString() === agent1A._id.toString(), "Device bound to Agent Alice")
    assert(deviceInDb.pushToken === "fcm-alice-token-initial", "Device push token stored")
    assert(Boolean(deviceInDb.refreshTokenHash), "Refresh token hash stored in database")
    assert(deviceInDb.refreshTokenHash !== loginResult.refreshToken, "Refresh token is hashed, not plaintext")

    // Verify safe toJSON strips refreshTokenHash
    const deviceJson = deviceInDb.toJSON()
    assert(deviceJson.refreshTokenHash === undefined, "Device toJSON excludes refreshTokenHash from serialization")

    console.log("\n=== 2. ACCESS TOKEN VERIFICATION & AMBIENT CONTEXT ===")

    const { req: authReq, res: authRes } = createMockReqRes({
      headers: {
        authorization: `Bearer ${loginResult.accessToken}`,
      },
    })

    let nextCalled = false
    await authenticateDevice(authReq, authRes, () => {
      nextCalled = true
    })

    assert(nextCalled === true, "authenticateDevice passed successfully with valid token")
    assert(authReq.user._id.toString() === agent1A._id.toString(), "req.user bound to Agent Alice")
    assert(authReq.device._id.toString() === deviceInDb._id.toString(), "req.device bound to device document")
    assert(authReq.tenantId === tenantA, "req.tenantId set to Tenant A")

    // Test rejection with invalid token
    const { req: badReq, res: badRes } = createMockReqRes({
      headers: {
        authorization: "Bearer invalid.token.payload",
      },
    })
    await authenticateDevice(badReq, badRes, () => {})
    assert(badRes.getStatusCode() === 401, "Invalid JWT access token rejected with HTTP 401")
    assert(badRes.getData()?.code === "INVALID_TOKEN", "Rejection returned INVALID_TOKEN code")

    console.log("\n=== 3. IMMEDIATE REVOCATION ENFORCEMENT ===")

    // Admin revokes the device
    await Device.updateOne({ _id: deviceInDb._id }, { status: "revoked" })

    // Immediate rejection of access token
    const { req: revokedReq, res: revokedRes } = createMockReqRes({
      headers: {
        authorization: `Bearer ${loginResult.accessToken}`,
      },
    })
    let revokedNext = false
    await authenticateDevice(revokedReq, revokedRes, () => {
      revokedNext = true
    })
    assert(revokedNext === false, "Revoked device cannot pass authenticateDevice")
    assert(revokedRes.getStatusCode() === 403, "Revoked device immediately rejected with HTTP 403")
    assert(revokedRes.getData()?.code === "DEVICE_REVOKED", "Error code is DEVICE_REVOKED")

    // Immediate rejection of token refresh for revoked device
    let refreshErr = null
    try {
      await deviceAuthService.refreshDeviceToken({
        refreshToken: loginResult.refreshToken,
        deviceUuid: deviceUuid1,
      })
    } catch (err) {
      refreshErr = err
    }
    assert(Boolean(refreshErr), "Token refresh on revoked device throws error")
    assert(refreshErr?.status === 403 || refreshErr?.statusCode === 403, "Token refresh on revoked device returns HTTP 403")
    assert(refreshErr?.code === "DEVICE_REVOKED", "Token refresh error code is DEVICE_REVOKED")

    // Restore device to active for subsequent tests
    await Device.updateOne({ _id: deviceInDb._id }, { status: "active" })

    console.log("\n=== 4. REFRESH TOKEN ROTATION & EXPIRATION ===")

    const refreshedTokens = await deviceAuthService.refreshDeviceToken({
      refreshToken: loginResult.refreshToken,
      deviceUuid: deviceUuid1,
    })

    assert(Boolean(refreshedTokens.accessToken), "Token refresh issued new accessToken")
    assert(Boolean(refreshedTokens.refreshToken), "Token refresh issued new rotated refreshToken")
    assert(refreshedTokens.refreshToken !== loginResult.refreshToken, "Rotated refreshToken differs from previous")

    // Ensure the old refresh token cannot be reused
    let reuseErr = null
    try {
      await deviceAuthService.refreshDeviceToken({
        refreshToken: loginResult.refreshToken,
        deviceUuid: deviceUuid1,
      })
    } catch (err) {
      reuseErr = err
    }
    assert(Boolean(reuseErr), "Previous refresh token reuse strictly rejected")
    assert(reuseErr?.status === 401 || reuseErr?.statusCode === 401, "Token reuse rejected with HTTP 401")

    // Device Logout
    const logoutRes = await deviceAuthService.logoutDevice(deviceInDb._id, tenantA)
    assert(logoutRes.success === true, "Device logout succeeded")
    const loggedOutDev = await Device.findOne({ _id: deviceInDb._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
    assert(!loggedOutDev?.refreshTokenHash, "Device logout cleared refreshTokenHash in DB")

    // Re-login Alice to get fresh working token pair
    const freshLogin = await deviceAuthService.loginDevice({
      email: "alice@tenant-a.com",
      password: "Password123!",
      deviceUuid: deviceUuid1,
      pushToken: "fcm-alice-active",
    })
    const aliceToken = freshLogin.accessToken

    console.log("\n=== 5. APP VERSION CHECK & MOBILE RATE LIMITER ===")

    // Outdated version (0.9.0 < 1.0.0)
    const { req: outReq, res: outRes } = createMockReqRes({
      headers: { "x-app-version": "0.9.0" },
    })
    let outNext = false
    checkAppVersion(outReq, outRes, () => {
      outNext = true
    })
    assert(outNext === false, "Outdated mobile app version halted")
    assert(outRes.getStatusCode() === 426, "Outdated app version returns HTTP 426 UPGRADE_REQUIRED")
    assert(outRes.getData()?.code === "UPGRADE_REQUIRED", "Code is UPGRADE_REQUIRED")

    // Compatible version (1.0.0 and 1.5.0)
    const { req: okReq, res: okRes } = createMockReqRes({
      headers: { "x-app-version": "1.2.0" },
    })
    let okNext = false
    checkAppVersion(okReq, okRes, () => {
      okNext = true
    })
    assert(okNext === true, "Compatible mobile app version passed successfully")

    // Rate limiter allows normal traffic
    const { req: rlReq, res: rlRes } = createMockReqRes({
      ip: "10.0.0.1",
      headers: {},
    })
    let rlNext = false
    mobileRateLimiter(rlReq, rlRes, () => {
      rlNext = true
    })
    assert(rlNext === true, "Mobile rate limiter allows legitimate requests")

    console.log("\n=== 6. AGENT-SCOPED INCREMENTAL LEAD SYNC ===")

    // Create 3 leads for Alice and 2 leads for Bob in Tenant A
    const leadA1 = await Lead.create({
      tenantId: tenantA,
      name: "Lead Alpha 1",
      phone: "+919876543210",
      phoneNormalized: "+919876543210",
      status: "New",
      ownerId: agent1A._id,
      assignedStaffId: agent1A._id.toString(),
      assignedTo: agent1A.name,
      deletedAt: null,
    })

    const leadA2 = await Lead.create({
      tenantId: tenantA,
      name: "Lead Alpha 2",
      phone: "+919876543211",
      phoneNormalized: "+919876543211",
      status: "Engaged",
      ownerId: agent1A._id,
      assignedStaffId: agent1A._id.toString(),
      assignedTo: agent1A.name,
      deletedAt: null,
    })

    const leadA3 = await Lead.create({
      tenantId: tenantA,
      name: "Lead Alpha 3",
      phone: "+919876543212",
      phoneNormalized: "+919876543212",
      status: "Proposal Sent",
      ownerId: agent1A._id,
      assignedStaffId: agent1A._id.toString(),
      assignedTo: agent1A.name,
      deletedAt: null,
    })

    const leadBob = await Lead.create({
      tenantId: tenantA,
      name: "Bob Lead",
      phone: "+919876543299",
      phoneNormalized: "+919876543299",
      status: "New",
      ownerId: agent2A._id,
      assignedStaffId: agent2A._id.toString(),
      assignedTo: agent2A.name,
      deletedAt: null,
    })

    // Initial full sync for Alice
    const initialSync = await mobileSyncService.syncAgentLeads({
      tenantId: tenantA,
      agentId: agent1A._id,
    })

    assert(initialSync.leads.length === 3, `Initial sync returned exactly 3 leads for Alice (found ${initialSync.leads.length})`)
    const aliceLeadIds = initialSync.leads.map((l) => l.id.toString())
    assert(aliceLeadIds.includes(leadA1._id.toString()), "Lead Alpha 1 included in sync")
    assert(aliceLeadIds.includes(leadA2._id.toString()), "Lead Alpha 2 included in sync")
    assert(aliceLeadIds.includes(leadA3._id.toString()), "Lead Alpha 3 included in sync")
    assert(!aliceLeadIds.includes(leadBob._id.toString()), "Bob's lead is strictly excluded from Alice's sync")
    assert(initialSync.removedLeadIds.length === 0, "No removed leads on initial sync")

    // Small delay to ensure timestamp separation
    await new Promise((r) => setTimeout(r, 100))
    const checkpointTimestamp = new Date()
    await new Promise((r) => setTimeout(r, 100))

    // Delta changes:
    // 1. Lead Alpha 1 status updated
    await Lead.updateOne({ _id: leadA1._id }, { status: "Proposal Sent", updatedAt: new Date() })

    // 2. Lead Alpha 2 reassigned away from Alice to Bob + activity recorded
    await Lead.updateOne({ _id: leadA2._id }, { ownerId: agent2A._id, assignedTo: agent2A.name, updatedAt: new Date() })
    await Activity.create({
      tenantId: tenantA,
      leadId: leadA2._id,
      type: "lead.owner_changed",
      actor: { name: "System", role: "system" },
      payload: {
        fromOwnerId: agent1A._id,
        toOwnerId: agent2A._id,
        reason: "Reassigned to Bob",
      },
    })

    // 3. Lead Alpha 3 soft-deleted
    await Lead.updateOne({ _id: leadA3._id }, { deletedAt: new Date(), updatedAt: new Date() })

    // Perform delta sync using checkpointTimestamp
    const deltaSync = await mobileSyncService.syncAgentLeads({
      tenantId: tenantA,
      agentId: agent1A._id,
      since: checkpointTimestamp.toISOString(),
    })

    assert(deltaSync.leads.length === 1, `Delta sync returned exactly 1 modified active lead (found ${deltaSync.leads.length})`)
    assert(deltaSync.leads[0].id.toString() === leadA1._id.toString(), "Modified Lead Alpha 1 returned in delta leads")
    assert(deltaSync.leads[0].status === "Proposal Sent", "Updated status reflected in delta lead")
    
    assert(deltaSync.removedLeadIds.length === 2, `Delta sync returned 2 removed leads (found ${deltaSync.removedLeadIds.length})`)
    assert(deltaSync.removedLeadIds.includes(leadA2._id.toString()), "Reassigned Lead Alpha 2 returned in removedLeadIds")
    assert(deltaSync.removedLeadIds.includes(leadA3._id.toString()), "Soft-deleted Lead Alpha 3 returned in removedLeadIds")

    console.log("\n=== 7. MOBILE CALL REPORTING & IDEMPOTENCY ===")

    const clientCallId1 = "client-call-uuid-1001"
    const callStartTime = new Date(Date.now() - 120000)
    const callEndTime = new Date(Date.now() - 30000)

    const callReport1 = await mobileSyncService.reportMobileCall({
      tenantId: tenantA,
      agentId: agent1A._id,
      deviceId: deviceInDb._id,
      callData: {
        clientCallId: clientCallId1,
        leadId: leadA1._id.toString(),
        phoneNumber: "9876543210", // Raw phone without country code
        direction: "outbound",
        callType: "outbound",
        callOutcome: "connected",
        duration: 90,
        startedAt: callStartTime.toISOString(),
        endedAt: callEndTime.toISOString(),
        simSlot: 1,
      },
    })

    assert(callReport1.isDuplicate === false, "Initial call submission is not duplicate")
    assert(callReport1.call.phoneNormalized === "+919876543210" || callReport1.call.phoneNumberNormalized === "+919876543210", "Phone normalized to E.164")
    assert(callReport1.call.leadId.toString() === leadA1._id.toString(), "Call matched and linked to Lead Alpha 1")
    assert(callReport1.call.duration === 90, "Call duration recorded as 90s")
    assert(callReport1.call.deviceId.toString() === deviceInDb._id.toString(), "Device ID attached to call log")

    // Check that lead lastContactedAt was updated
    const refreshedLeadA1 = await Lead.findById(leadA1._id)
    assert(Boolean(refreshedLeadA1.lastContactedAt), "Lead lastContactedAt updated by mobile call report")

    // Check timeline activity entry was created
    const callActivity = await Activity.findOne({
      tenantId: tenantA,
      leadId: leadA1._id,
      type: "call.logged",
    })
    assert(Boolean(callActivity), "Timeline activity 'call.logged' created")
    assert(callActivity.payload.callId.toString() === callReport1.call._id.toString(), "Activity payload references callId")

    // Idempotency: Re-submitting the exact same clientCallId
    const duplicateCallReport = await mobileSyncService.reportMobileCall({
      tenantId: tenantA,
      agentId: agent1A._id,
      deviceId: deviceInDb._id,
      callData: {
        clientCallId: clientCallId1,
        phoneNumber: "9876543210",
        direction: "outbound",
        duration: 90,
      },
    })

    assert(duplicateCallReport.isDuplicate === true, "Replayed call submission flagged as duplicate")
    assert(duplicateCallReport.call._id.toString() === callReport1.call._id.toString(), "Duplicate submission returned existing call record without creating duplicate")

    const totalCallsCount = await Call.countDocuments({ tenantId: tenantA, clientCallId: clientCallId1 })
    assert(totalCallsCount === 1, "Only 1 call document exists in database for this clientCallId")

    console.log("\n=== 8. PRE-FLIGHT RECORDING UPLOAD TICKET ===")

    // Valid ticket generation for lead-linked call
    const ticketResult = await mobileSyncService.issueRecordingTicket({
      tenantId: tenantA,
      agentId: agent1A._id,
      callId: callReport1.call._id,
    })

    assert(Boolean(ticketResult.ticket), "Recording ticket issued successfully")
    assert(ticketResult.callId.toString() === callReport1.call._id.toString(), "Ticket references correct callId")
    assert(Boolean(ticketResult.expiresAt), "Ticket contains expiry timestamp")

    // Ticket validation: verify JWT
    const decodedTicket = jwt.decode(ticketResult.ticket)
    assert(decodedTicket.sub === "recording_upload_ticket", "Ticket subject is recording_upload_ticket")
    assert(decodedTicket.callId === callReport1.call._id.toString(), "Ticket JWT contains callId")
    assert(decodedTicket.tenantId === tenantA, "Ticket JWT contains tenantId")

    // Rejection on non-lead personal call
    const personalCall = await Call.create({
      tenantId: tenantA,
      agentId: agent1A._id,
      deviceId: deviceInDb._id,
      leadId: null,
      isPersonal: true,
      direction: "outbound",
      number: "+919999999999",
      phoneNormalized: "+919999999999",
      duration: 30,
      startedAt: new Date(),
    })

    let personalTicketErr = null
    try {
      await mobileSyncService.issueRecordingTicket({
        tenantId: tenantA,
        agentId: agent1A._id,
        callId: personalCall._id,
      })
    } catch (err) {
      personalTicketErr = err
    }
    assert(Boolean(personalTicketErr), "Recording ticket denied for personal non-lead call")
    assert(personalTicketErr?.status === 403, "Personal call recording ticket returns HTTP 403")

    // Rejection on Lead with DNR (Do Not Record)
    const dnrLead = await Lead.create({
      tenantId: tenantA,
      name: "DNR Lead",
      phone: "+919876500000",
      phoneNormalized: "+919876500000",
      status: "New",
      ownerId: agent1A._id,
      tags: ["vip", "dnr"],
    })

    const dnrCall = await Call.create({
      tenantId: tenantA,
      agentId: agent1A._id,
      deviceId: deviceInDb._id,
      leadId: dnrLead._id,
      direction: "outbound",
      number: "+919876500000",
      phoneNormalized: "+919876500000",
      duration: 45,
      startedAt: new Date(),
    })

    let dnrTicketErr = null
    try {
      await mobileSyncService.issueRecordingTicket({
        tenantId: tenantA,
        agentId: agent1A._id,
        callId: dnrCall._id,
      })
    } catch (err) {
      dnrTicketErr = err
    }
    assert(Boolean(dnrTicketErr), "Recording ticket denied when lead has DNR active")
    assert(dnrTicketErr?.code === "RECORDING_FORBIDDEN_DNR", "Error code is RECORDING_FORBIDDEN_DNR")

    console.log("\n=== 9. MOBILE PUSH NOTIFICATIONS & QUEUE DISPATCH ===")

    // Update push token
    const pushUpdate = await deviceAuthService.updateDevicePushToken(deviceInDb._id, "fcm-alice-updated-token", tenantA)
    assert(pushUpdate.pushToken === "fcm-alice-updated-token", "Device push token updated successfully")

    // Enqueue push lead assigned notification
    const pushJobResult = await pushService.sendLeadAssignedPush({
      tenantId: tenantA,
      agentId: agent1A._id,
      lead: leadA1,
    })
    assert(pushJobResult.enqueued === true, "Lead assigned push notification job enqueued")

    // Execute push dispatch handler
    const pushDelivery = await pushService.executePushLeadAssigned({
      tenantId: tenantA,
      agentId: agent1A._id,
      leadId: leadA1._id.toString(),
      leadName: leadA1.name,
      leadPhone: leadA1.phone,
    })

    assert(pushDelivery.success === true, "Push execution handler completed successfully")
    assert(pushDelivery.tokensTargeted >= 1, "Push targeted active agent device token")
    assert(pushDelivery.pushPayload.title === "New Lead Assigned", "Push title is 'New Lead Assigned'")
    assert(pushDelivery.pushPayload.body.includes("Lead Alpha 1"), "Push body includes lead name")

    console.log("\n=== 10. MULTI-TENANT ISOLATION & PERMISSION GUARDS ===")

    // Agent B device login in Tenant B
    const deviceUuidB = "uuid-device-tenant-b-001"
    const loginB = await deviceAuthService.loginDevice({
      email: "charlie@tenant-b.com",
      password: "Password123!",
      deviceUuid: deviceUuidB,
    })

    // Try accessing Alice's call ticket with Charlie's credentials (cross-tenant)
    let crossTenantTicketErr = null
    try {
      await mobileSyncService.issueRecordingTicket({
        tenantId: tenantB,
        agentId: agent1B._id,
        callId: callReport1.call._id,
      })
    } catch (err) {
      crossTenantTicketErr = err
    }
    assert(Boolean(crossTenantTicketErr), "Cross-tenant call ticket request strictly rejected")
    assert(crossTenantTicketErr?.status === 404, "Cross-tenant object not found in tenant context")

    // Try syncLeads in Tenant B - should return 0 leads from Tenant A
    const syncB = await mobileSyncService.syncAgentLeads({
      tenantId: tenantB,
      agentId: agent1B._id,
    })
    assert(syncB.leads.length === 0, "Tenant B agent sees 0 leads from Tenant A")

    // Device from Tenant A cannot refresh against Tenant B
    let crossRefreshErr = null
    try {
      await deviceAuthService.refreshDeviceToken({
        refreshToken: freshLogin.refreshToken,
        deviceUuid: deviceUuidB, // mismatched UUID
      })
    } catch (err) {
      crossRefreshErr = err
    }
    assert(Boolean(crossRefreshErr), "Device UUID mismatch on refresh strictly rejected")

    console.log("\n=== 11. CONTROLLER ENDPOINTS INTEGRATION ===")

    // Test POST /api/mobile/auth/login via controller
    const { req: cLoginReq, res: cLoginRes } = createMockReqRes({
      method: "POST",
      body: {
        email: "alice@tenant-a.com",
        password: "Password123!",
        deviceUuid: "controller-device-uuid-99",
      },
    })
    await mobileController.login(cLoginReq, cLoginRes)
    assert(cLoginRes.getStatusCode() === 200, "POST /api/mobile/auth/login returns 200")
    assert(Boolean(cLoginRes.getData()?.accessToken), "Controller login returns accessToken")

    // Test GET /api/mobile/status via controller
    const { req: cStatusReq, res: cStatusRes } = createMockReqRes({
      method: "GET",
      user: agent1A,
      device: deviceInDb,
      tenantId: tenantA,
    })
    await mobileController.getDeviceStatus(cStatusReq, cStatusRes)
    assert(cStatusRes.getStatusCode() === 200, "GET /api/mobile/status returns 200")
    assert(cStatusRes.getData()?.user.email === "alice@tenant-a.com", "Controller status returns agent email")

    // Test POST /api/mobile/calls via controller with duplicate check
    const { req: cCallReq, res: cCallRes } = createMockReqRes({
      method: "POST",
      user: agent1A,
      device: deviceInDb,
      tenantId: tenantA,
      body: {
        clientCallId: "controller-call-id-500",
        phoneNumber: "+919876543210",
        direction: "outbound",
        duration: 40,
      },
    })
    await mobileController.reportCall(cCallReq, cCallRes)
    assert(cCallRes.getStatusCode() === 201, "POST /api/mobile/calls returns 201 on new call")
    assert(cCallRes.getData()?.isDuplicate === false, "First submission isDuplicate is false")

    // Resubmit same call
    const { req: cCallDupReq, res: cCallDupRes } = createMockReqRes({
      method: "POST",
      user: agent1A,
      device: deviceInDb,
      tenantId: tenantA,
      body: {
        clientCallId: "controller-call-id-500",
        phoneNumber: "+919876543210",
        direction: "outbound",
        duration: 40,
      },
    })
    await mobileController.reportCall(cCallDupReq, cCallDupRes)
    assert(cCallDupRes.getStatusCode() === 200, "POST /api/mobile/calls returns 200 on duplicate call")
    assert(cCallDupRes.getData()?.isDuplicate === true, "Resubmission isDuplicate is true")

    // Clean up test data
    await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Device.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Team.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Role.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

  } catch (err) {
    console.error("Test Suite Error:", err)
    failed++
  } finally {
    await mongoose.disconnect()
    console.log("\nDisconnected from MongoDB Atlas")
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 15 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("================================================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runTests()
