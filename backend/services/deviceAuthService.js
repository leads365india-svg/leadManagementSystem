const jwt = require("jsonwebtoken")
const crypto = require("crypto")
const mongoose = require("mongoose")
const Device = require("../models/Device")
const User = require("../models/User")
const Account = require("../models/Account")
const { getJwtSecret } = require("../middleware/authMiddleware")
const cryptoUtils = require("../utils/cryptoUtils")
const audit = require("./auditService")

/**
 * Leads-365 CRM - Mobile Device Authentication Service (Phase 15)
 * 
 * Provides:
 * - Device registration and device-bound token pair issuance (access + refresh)
 * - Immediate rejection of revoked devices
 * - Refresh token verification and rotation
 * - FCM push token registration
 */

const ACCESS_TOKEN_EXPIRY = "2h"
const ACCESS_TOKEN_TTL_SECONDS = 7200
const REFRESH_TOKEN_EXPIRY = "30d"

/**
 * Authenticates agent credentials and registers/updates device hardware.
 * Returns device-bound access and refresh tokens.
 */
async function loginDevice({
  email,
  password,
  tenantId = null,
  deviceUuid,
  label = "",
  model = "",
  osVersion = "",
  appVersion = "",
  pushToken = "",
}) {
  if (!email || !password) {
    const err = new Error("Email and password are required")
    err.statusCode = 400
    throw err
  }

  if (!deviceUuid || typeof deviceUuid !== "string" || !deviceUuid.trim()) {
    const err = new Error("Unique deviceUuid is required for mobile hardware registration")
    err.statusCode = 400
    throw err
  }

  const cleanEmail = email.trim().toLowerCase()
  const cleanDeviceUuid = deviceUuid.trim()

  // 1. Resolve user
  const userQuery = { email: cleanEmail }
  if (tenantId) userQuery.tenantId = tenantId

  const user = await User.findOne(userQuery).select("+password")
  if (!user) {
    const err = new Error("Invalid credentials")
    err.statusCode = 401
    err.code = "INVALID_CREDENTIALS"
    throw err
  }

  // 2. Verify password
  const isMatch = user.comparePassword
    ? await user.comparePassword(password)
    : user.matchPassword
      ? await user.matchPassword(password)
      : false
  if (!isMatch) {
    const err = new Error("Invalid credentials")
    err.statusCode = 401
    err.code = "INVALID_CREDENTIALS"
    throw err
  }

  // 3. Verify user status
  if (user.status === "suspended" || user.isActive === false) {
    const err = new Error("User account is deactivated. Contact your CRM administrator.")
    err.statusCode = 403
    err.code = "USER_DEACTIVATED"
    throw err
  }

  // 4. Verify tenant account status
  if (user.tenantId && user.role !== "super_admin") {
    const account = await Account.findOne({ accountId: user.tenantId }).lean()
    if (account && account.status === "suspended") {
      const err = new Error(`Account (${account.companyName}) is suspended. Contact administrator.`)
      err.statusCode = 403
      err.code = "ACCOUNT_SUSPENDED"
      throw err
    }
  }

  const effectiveTenantId = user.tenantId

  // 5. Lookup or register Device
  let device = await Device.findOne({
    tenantId: effectiveTenantId,
    deviceUuid: cleanDeviceUuid,
  }).setOptions({ skipTenantFilter: true })

  if (device) {
    // If device was revoked, reject immediately
    if (device.status === "revoked") {
      const err = new Error("Device access has been revoked by an administrator")
      err.statusCode = 403
      err.code = "DEVICE_REVOKED"
      throw err
    }

    // Update hardware specs and ownership if needed
    device.userId = user._id
    if (label) device.label = String(label).trim()
    if (model) device.model = String(model).trim()
    if (osVersion) device.osVersion = String(osVersion).trim()
    if (appVersion) device.appVersion = String(appVersion).trim()
    if (pushToken) device.pushToken = String(pushToken).trim()
    device.lastSeenAt = new Date()
    device.status = "active"
  } else {
    // Create new device registration
    device = new Device({
      tenantId: effectiveTenantId,
      userId: user._id,
      deviceUuid: cleanDeviceUuid,
      label: label ? String(label).trim() : model || "Android Device",
      model: model ? String(model).trim() : "Unknown Model",
      osVersion: osVersion ? String(osVersion).trim() : "Android",
      appVersion: appVersion ? String(appVersion).trim() : "1.0.0",
      pushToken: pushToken ? String(pushToken).trim() : "",
      status: "active",
      lastSeenAt: new Date(),
    })
  }

  // 6. Generate device-bound Token Pair
  const jwtSecret = getJwtSecret()

  const accessTokenPayload = {
    id: user._id.toString(),
    userId: user._id.toString(),
    tenantId: effectiveTenantId,
    deviceId: device._id.toString(),
    deviceUuid: cleanDeviceUuid,
    role: user.role,
    tokenType: "device_access",
    tokenVersion: user.tokenVersion || 0,
  }

  const accessToken = jwt.sign(accessTokenPayload, jwtSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  })

  const refreshTokenPayload = {
    id: user._id.toString(),
    userId: user._id.toString(),
    tenantId: effectiveTenantId,
    deviceId: device._id.toString(),
    deviceUuid: cleanDeviceUuid,
    tokenType: "device_refresh",
    nonce: crypto.randomBytes(16).toString("hex"),
  }

  const refreshToken = jwt.sign(refreshTokenPayload, jwtSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  })

  // Hash refresh token for safe storage on Device record
  device.refreshTokenHash = cryptoUtils.hashApiKey(refreshToken)
  await device.save()

  // 7. Audit log device authentication
  try {
    await audit.log({
      tenantId: effectiveTenantId,
      actor: { id: user._id, name: user.name, email: user.email, role: user.role },
      action: "device.login",
      entity: "Device",
      entityId: device._id,
      summary: `Mobile agent ${user.name} logged in from device ${device.label || device.model}`,
      details: { deviceId: device._id, deviceUuid: cleanDeviceUuid, model: device.model, appVersion: device.appVersion },
    })
  } catch (auditErr) {
    console.warn("[DeviceAuthService] Non-blocking audit failure:", auditErr.message)
  }

  return {
    success: true,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    tokenType: "Bearer",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    device: {
      id: device._id,
      label: device.label,
      model: device.model,
      status: device.status,
      lastSeenAt: device.lastSeenAt,
    },
  }
}

/**
 * Validates refresh token, checks device revocation status, and rotates tokens.
 */
async function refreshDeviceToken({ refreshToken, deviceUuid = null }) {
  if (!refreshToken || typeof refreshToken !== "string") {
    const err = new Error("Valid refreshToken is required")
    err.statusCode = 400
    err.code = "MISSING_REFRESH_TOKEN"
    throw err
  }

  const jwtSecret = getJwtSecret()
  let decoded = null

  try {
    decoded = jwt.verify(refreshToken.trim(), jwtSecret)
  } catch (jwtErr) {
    const err = new Error("Refresh token expired or invalid")
    err.status = 401
    err.statusCode = 401
    err.code = "INVALID_REFRESH_TOKEN"
    throw err
  }

  if (decoded.tokenType !== "device_refresh") {
    const err = new Error("Invalid token type. Expected device_refresh.")
    err.status = 401
    err.statusCode = 401
    err.code = "INVALID_TOKEN_TYPE"
    throw err
  }

  const { tenantId, deviceId, userId } = decoded

  // 1. Find device
  const device = await Device.findOne({ _id: deviceId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!device) {
    const err = new Error("Device record not found")
    err.status = 401
    err.statusCode = 401
    err.code = "DEVICE_NOT_FOUND"
    throw err
  }

  // 2. Immediate revocation check
  if (device.status === "revoked") {
    const err = new Error("Device access has been revoked by an administrator")
    err.status = 403
    err.statusCode = 403
    err.code = "DEVICE_REVOKED"
    throw err
  }

  // 2b. Device UUID verification
  if (deviceUuid && device.deviceUuid && deviceUuid.trim() !== device.deviceUuid.trim()) {
    const err = new Error("Device UUID does not match token binding")
    err.status = 401
    err.statusCode = 401
    err.code = "DEVICE_MISMATCH"
    throw err
  }

  // 3. Verify refresh token hash matches stored active token
  const incomingHash = cryptoUtils.hashApiKey(refreshToken.trim())
  if (!device.refreshTokenHash || device.refreshTokenHash !== incomingHash) {
    const err = new Error("Refresh token has been invalidated or rotated")
    err.status = 401
    err.statusCode = 401
    err.code = "REFRESH_TOKEN_INVALIDATED"
    throw err
  }

  // 4. Verify user active status
  const user = await User.findOne({ _id: userId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!user || user.status === "suspended" || user.isActive === false) {
    const err = new Error("User account is inactive or not found")
    err.status = 403
    err.statusCode = 403
    err.code = "USER_INACTIVE"
    throw err
  }

  // 5. Rotate Token Pair
  const newAccessTokenPayload = {
    id: user._id.toString(),
    userId: user._id.toString(),
    tenantId,
    deviceId: device._id.toString(),
    deviceUuid: device.deviceUuid,
    role: user.role,
    tokenType: "device_access",
    tokenVersion: user.tokenVersion || 0,
  }

  const newAccessToken = jwt.sign(newAccessTokenPayload, jwtSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  })

  const newRefreshTokenPayload = {
    id: user._id.toString(),
    userId: user._id.toString(),
    tenantId,
    deviceId: device._id.toString(),
    deviceUuid: device.deviceUuid,
    tokenType: "device_refresh",
    nonce: crypto.randomBytes(16).toString("hex"),
  }

  const newRefreshToken = jwt.sign(newRefreshTokenPayload, jwtSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  })

  // Update hash and last seen
  device.refreshTokenHash = cryptoUtils.hashApiKey(newRefreshToken)
  device.lastSeenAt = new Date()
  await device.save()

  return {
    success: true,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    tokenType: "Bearer",
  }
}

/**
 * Invalidates device active session on logout.
 */
async function logoutDevice(deviceIdOrPayload, tenantIdParam = null) {
  let deviceId = null
  let tenantId = null

  if (
    deviceIdOrPayload &&
    typeof deviceIdOrPayload === "object" &&
    !mongoose.Types.ObjectId.isValid(deviceIdOrPayload) &&
    ("deviceId" in deviceIdOrPayload || "tenantId" in deviceIdOrPayload)
  ) {
    deviceId = deviceIdOrPayload.deviceId || deviceIdOrPayload.id || deviceIdOrPayload._id
    tenantId = deviceIdOrPayload.tenantId
  } else {
    deviceId = deviceIdOrPayload
    tenantId = tenantIdParam
  }

  if (!deviceId || !tenantId) return { success: true }

  await Device.updateOne(
    { _id: deviceId, tenantId },
    { $set: { refreshTokenHash: null } },
  ).setOptions({ skipTenantFilter: true })

  return {
    success: true,
    message: "Device session terminated successfully",
  }
}

/**
 * Registers or updates FCM push notification token for device.
 */
async function updateDevicePushToken(deviceIdOrPayload, pushTokenParam = null, tenantIdParam = null) {
  let deviceId = null
  let tenantId = null
  let pushToken = null

  if (
    deviceIdOrPayload &&
    typeof deviceIdOrPayload === "object" &&
    !mongoose.Types.ObjectId.isValid(deviceIdOrPayload) &&
    ("pushToken" in deviceIdOrPayload || "deviceId" in deviceIdOrPayload)
  ) {
    deviceId = deviceIdOrPayload.deviceId || deviceIdOrPayload.id || deviceIdOrPayload._id
    tenantId = deviceIdOrPayload.tenantId
    pushToken = deviceIdOrPayload.pushToken
  } else {
    deviceId = deviceIdOrPayload
    pushToken = pushTokenParam
    tenantId = tenantIdParam
  }

  if (!deviceId || !tenantId) {
    const err = new Error("Missing deviceId or tenantId")
    err.status = 400
    err.statusCode = 400
    throw err
  }

  const device = await Device.findOne({ _id: deviceId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!device) {
    const err = new Error("Device not found")
    err.status = 404
    err.statusCode = 404
    throw err
  }

  if (device.status === "revoked") {
    const err = new Error("Device access has been revoked")
    err.status = 403
    err.statusCode = 403
    err.code = "DEVICE_REVOKED"
    throw err
  }

  device.pushToken = pushToken ? String(pushToken).trim() : ""
  device.lastSeenAt = new Date()
  await device.save()

  return device
}

module.exports = {
  loginDevice,
  refreshDeviceToken,
  logoutDevice,
  updateDevicePushToken,
}
