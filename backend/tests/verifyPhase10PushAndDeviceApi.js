const request = require("supertest")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

process.env.NODE_ENV = "test"
dotenv.config({ path: path.join(__dirname, "../.env") })

const app = require("../start")
const User = require("../models/User")
const Account = require("../models/Account")
const Device = require("../models/Device")
const Lead = require("../models/Lead")
const MobileSyncTombstone = require("../models/MobileSyncTombstone")
const {
  getDispatchedHistory,
  clearDispatchedHistory,
} = require("../services/pushNotificationService")

const JWT_SECRET = process.env.JWT_SECRET || "leadflow-dev-secret-key-min32-chars-for-local-only"

const results = []

const recordTest = (name, passed, error) => {
  results.push({ name, passed, error })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (error) {
    console.log(`     Error: ${error}`)
  }
}

async function runPhase10Tests() {
  console.log("\n=======================================================")
  console.log("   PHASE 10 PUSH NOTIFICATIONS & DEVICE SUITE          ")
  console.log("=======================================================\n")

  if (mongoose.connection.readyState !== 1) {
    const mongoURI = process.env.MONGODB_URI
    if (!mongoURI) {
      throw new Error("MONGODB_URI not defined in environment variables")
    }
    await mongoose.connect(mongoURI)
  }

  const TEST_ID = `p10_${Date.now()}`
  const TENANT_A = `ACC-P10-A-${TEST_ID}`
  const TENANT_B = `ACC-P10-B-${TEST_ID}`

  let userA1, userA2, userB
  let tokenA1, tokenA2, tokenB
  let deviceA1

  try {
    // 1. Setup users
    userA1 = await User.create({
      name: `Agent A1 ${TEST_ID}`,
      email: `agenta1_${TEST_ID}@leads365.test`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })

    userA2 = await User.create({
      name: `Agent A2 ${TEST_ID}`,
      email: `agenta2_${TEST_ID}@leads365.test`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: TENANT_A,
      status: "active",
    })

    userB = await User.create({
      name: `Agent B ${TEST_ID}`,
      email: `agentb_${TEST_ID}@leads365.test`,
      password: "HashedPassword123!",
      role: "agent",
      tenantId: TENANT_B,
      status: "active",
    })

    // 2. Setup accounts with required fields
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: `Agency A ${TEST_ID}`,
        displayName: `Agency A ${TEST_ID}`,
        adminUserId: userA1._id,
        adminName: userA1.name,
        adminEmail: userA1.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: `Agency B ${TEST_ID}`,
        displayName: `Agency B ${TEST_ID}`,
        adminUserId: userB._id,
        adminName: userB.name,
        adminEmail: userB.email,
        status: "active",
      },
    ])

    tokenA1 = jwt.sign(
      { id: userA1._id.toString(), email: userA1.email, role: userA1.role, tenantId: TENANT_A },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    tokenA2 = jwt.sign(
      { id: userA2._id.toString(), email: userA2.email, role: userA2.role, tenantId: TENANT_A },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    tokenB = jwt.sign(
      { id: userB._id.toString(), email: userB.email, role: userB.role, tenantId: TENANT_B },
      JWT_SECRET,
      { expiresIn: "1h" }
    )

    // Test 1: Unauthenticated POST /api/mobile/v1/push-token returns 401
    const unauthPushRes = await request(app).post("/api/mobile/v1/push-token").send({ token: "fcm_test_1" })
    recordTest("POST /api/mobile/v1/push-token returns 401 unauthenticated", unauthPushRes.status === 401)

    // Test 2: Missing token returns 400
    const missingTokenRes = await request(app)
      .post("/api/mobile/v1/push-token")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({})
    recordTest("POST /api/mobile/v1/push-token returns 400 for empty token", missingTokenRes.status === 400)

    // Test 3: Device Registration with FCM token (POST /api/mobile/v1/devices/register)
    const initialDevId = `dev_p10_${TEST_ID}_1`
    const regRes = await request(app)
      .post("/api/mobile/v1/devices/register")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({
        deviceId: initialDevId,
        deviceModel: "Pixel 8 Pro",
        manufacturer: "Google",
        osVersion: "15",
        sdkInt: 35,
        appVersionCode: 1,
        appVersionName: "1.0.0",
        fcmToken: "fcm_initial_token_a1",
      })

    const regPass =
      regRes.status === 200 &&
      regRes.body.success === true &&
      regRes.body.data.deviceId === initialDevId &&
      regRes.body.data.fcmToken === "fcm_initial_token_a1"
    recordTest("POST /api/mobile/v1/devices/register creates active device with FCM token", regPass)

    // Test 4: Idempotent device registration updates existing device instead of duplicating
    const reregRes = await request(app)
      .post("/api/mobile/v1/devices/register")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({
        deviceId: initialDevId,
        deviceModel: "Pixel 8 Pro Updated",
        fcmToken: "fcm_updated_token_a1",
      })

    const countDevices = await Device.countDocuments({ deviceId: initialDevId })
    const reregPass =
      reregRes.status === 200 &&
      countDevices === 1 &&
      reregRes.body.data.fcmToken === "fcm_updated_token_a1"
    recordTest("POST /api/mobile/v1/devices/register is idempotent and updates existing device record", reregPass)

    // Test 5: Authenticated POST /api/mobile/v1/push-token updates push token
    const pushTokenRes = await request(app)
      .post("/api/mobile/v1/push-token")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({
        deviceId: initialDevId,
        token: "fcm_refreshed_token_a1",
      })

    const pushPass =
      pushTokenRes.status === 200 &&
      pushTokenRes.body.success === true &&
      pushTokenRes.body.data.fcmToken === "fcm_refreshed_token_a1"
    recordTest("POST /api/mobile/v1/push-token updates FCM token for device", pushPass)

    // Test 6: Cross-tenant device token isolation
    const crossTenantRes = await request(app)
      .post("/api/mobile/v1/push-token")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({
        deviceId: initialDevId,
        token: "fcm_attacker_token",
      })

    // Agent B cannot overwrite Agent A's device token
    const agentADeviceAfter = await Device.findOne({ deviceId: initialDevId })
    const isolationPass =
      agentADeviceAfter &&
      agentADeviceAfter.fcmToken === "fcm_refreshed_token_a1" &&
      agentADeviceAfter.userId.toString() === userA1._id.toString()
    recordTest("Enforces cross-tenant and agent isolation on device and push token updates", isolationPass)

    // Test 7: Logout clears FCM token
    const logoutRes = await request(app)
      .post("/api/mobile/v1/auth/logout")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({ deviceId: initialDevId })

    const devAfterLogout = await Device.findOne({ deviceId: initialDevId })
    const logoutPass = logoutRes.status === 200 && devAfterLogout.fcmToken === null
    recordTest("POST /api/mobile/v1/auth/logout safely clears device FCM token to avoid leaks", logoutPass)

    // Restore token for assignment tests
    await Device.updateOne({ deviceId: initialDevId }, { $set: { fcmToken: "fcm_active_token_a1" } })

    // Test 8: Lead Assignment triggers push notification dispatch
    clearDispatchedHistory()
    const leadCreateRes = await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({
        name: "Vikram Malhotra",
        email: `vikram_${TEST_ID}@example.com`,
        phone: "+919876543210",
        assignedStaffId: userA1._id.toString(),
        assignedTo: userA1.name,
        status: "New",
      })

    const dispatched = getDispatchedHistory()
    const assignPush = dispatched.find(
      (d) => d.type === "LEAD_ASSIGNED" && d.agentId === userA1._id.toString()
    )
    const assignPass =
      leadCreateRes.status === 201 &&
      assignPush !== undefined &&
      assignPush.payload.data.name === "Vikram Malhotra" &&
      assignPush.tokens.includes("fcm_active_token_a1")
    recordTest("Lead assignment automatically dispatches push notification to assigned agent devices", assignPass)

    // Test 9: Lead Reassignment triggers reassigned-away push and sync tombstone
    clearDispatchedHistory()
    const createdLeadId = leadCreateRes.body.data?._id || leadCreateRes.body.data?.id || leadCreateRes.body._id
    const reassignRes = await request(app)
      .put(`/api/leads/${createdLeadId}`)
      .set("Authorization", `Bearer ${tokenA1}`)
      .send({
        assignedStaffId: userA2._id.toString(),
        assignedTo: userA2.name,
      })

    const dispatchedAfterReassign = getDispatchedHistory()
    const reassignAwayPush = dispatchedAfterReassign.find(
      (d) => d.type === "LEAD_REASSIGNED_AWAY" && d.agentId === userA1._id.toString()
    )
    const reassignNewPush = dispatchedAfterReassign.find(
      (d) => d.type === "LEAD_ASSIGNED" && d.agentId === userA2._id.toString()
    )
    const tombstone = await MobileSyncTombstone.findOne({
      leadId: createdLeadId,
      assignedStaffId: userA1._id.toString(),
    })

    const reassignPass =
      reassignRes.status === 200 &&
      reassignAwayPush !== undefined &&
      reassignNewPush !== undefined &&
      tombstone !== null
    recordTest(
      "Lead reassignment sends LEAD_REASSIGNED_AWAY to previous agent and creates sync tombstone",
      reassignPass
    )
  } catch (err) {
    console.error("Test execution failed with error:", err)
    recordTest("Test suite execution", false, err.message)
  } finally {
    // Cleanup test data
    try {
      await User.deleteMany({ email: { $regex: TEST_ID } })
      await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
      await Device.deleteMany({ deviceId: { $regex: TEST_ID } })
      await Lead.deleteMany({ email: { $regex: TEST_ID } })
      await MobileSyncTombstone.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    } catch (_) {}
  }

  const passedCount = results.filter((r) => r.passed).length
  const totalCount = results.length
  console.log(`\nResults: ${passedCount}/${totalCount} tests passed\n`)

  if (passedCount !== totalCount) {
    process.exit(1)
  }
}

runPhase10Tests()
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
