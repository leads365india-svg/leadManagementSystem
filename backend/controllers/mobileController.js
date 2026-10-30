const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const FollowUp = require("../models/FollowUp")
const MobileSyncTombstone = require("../models/MobileSyncTombstone")
const User = require("../models/User")
const Account = require("../models/Account")
const Device = require("../models/Device")
const { getJwtSecret } = require("../middleware/authMiddleware")

// Mask sensitive phone number for server-side logging
const maskPhone = (phone) => {
  if (!phone || typeof phone !== "string") return "***"
  const cleaned = phone.trim()
  if (cleaned.length <= 4) return "****"
  return `${cleaned.slice(0, 2)}****${cleaned.slice(-2)}`
}

/**
 * GET /api/mobile/v1/leads/sync
 * Mobile delta-sync API delivering only leads assigned to the authenticated agent.
 */
const syncMobileLeads = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to sync leads.",
      })
    }

    const tenantId = user.tenantId
    const isTenantAdmin = user.role === "account_admin" || user.role === "super_admin"

    // Parse 'since' watermark query parameter (milliseconds epoch)
    const sinceParam = req.query.since
    let sinceDate = null
    if (sinceParam) {
      const sinceMs = parseInt(sinceParam, 10)
      if (!isNaN(sinceMs) && sinceMs > 0) {
        sinceDate = new Date(sinceMs)
      }
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500)

    // Build lead query strictly scoped to tenant and agent assignment
    const leadQuery = { isTest: { $ne: true } }
    if (user.role !== "super_admin" && tenantId) {
      leadQuery.tenantId = tenantId
    }

    if (!isTenantAdmin) {
      // Regular agent: only retrieve leads assigned to their user ID or agent name
      leadQuery.$or = [
        { assignedStaffId: user.id },
        { assignedTo: user.name }
      ]
    }

    if (sinceDate) {
      leadQuery.updatedAt = { $gte: sinceDate }
    }

    const leads = await Lead.find(leadQuery)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()

    // Map to MobileLeadDto matching Android expectation
    const mappedLeads = leads.map((lead) => {
      const updatedAtMs = lead.updatedAt ? new Date(lead.updatedAt).getTime() : Date.now()
      return {
        id: lead._id.toString(),
        name: lead.name || "",
        phone: lead.phone || "",
        normalized_phone: lead.metadata?.normalizedPhone || lead.phone || "",
        status: lead.status || "New",
        next_followup_at: lead.metadata?.nextFollowUpAt || null,
        notes: lead.message || lead.metadata?.notes || "",
        is_do_not_record: Boolean(lead.metadata?.isDoNotRecord),
        assigned_to_agent_id: lead.assignedStaffId || user.id,
        updated_at: updatedAtMs,
      }
    })

    // Resolve deleted or reassigned lead IDs if delta sync
    let deletedLeadIds = []
    if (sinceDate) {
      const tombstoneQuery = { timestamp: { $gte: sinceDate } }
      if (user.role !== "super_admin" && tenantId) {
        tombstoneQuery.tenantId = tenantId
      }
      if (!isTenantAdmin) {
        tombstoneQuery.$or = [
          { assignedStaffId: user.id },
          { assignedStaffId: user.name },
          { assignedStaffId: "all" },
        ]
      }

      const tombstones = await MobileSyncTombstone.find(tombstoneQuery).select("leadId").lean()
      deletedLeadIds = [...new Set(tombstones.map((t) => t.leadId))]
    }

    return res.status(200).json({
      success: true,
      server_time: Date.now(),
      has_more: false,
      leads: mappedLeads,
      tombstones: deletedLeadIds,
      data: {
        leads: mappedLeads,
        deleted_lead_ids: deletedLeadIds,
        full_sync_required: false,
      },
    })
  } catch (error) {
    console.error("Error in syncMobileLeads:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error during lead synchronization",
    })
  }
}

/**
 * POST /api/mobile/v1/calls
 * Mobile call-reporting API with strict agent/lead ownership and clientCallId idempotency.
 */
const reportMobileCall = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to report calls.",
      })
    }

    const {
      client_call_id,
      lead_id,
      phone_number,
      call_direction,
      start_time_ms,
      duration_seconds,
      call_outcome,
      notes,
      next_followup_at,
      sim_id,
    } = req.body

    // 1. Validate required fields
    if (!client_call_id || typeof client_call_id !== "string" || !client_call_id.trim()) {
      return res.status(400).json({
        success: false,
        error: "client_call_id is required for idempotency",
      })
    }

    const isUnlinkedInbound = (!lead_id || lead_id === "unlinked") && (call_direction === "INCOMING" || !call_direction)

    if (!isUnlinkedInbound && (!lead_id || !mongoose.Types.ObjectId.isValid(lead_id))) {
      return res.status(400).json({
        success: false,
        error: "Valid lead_id is required for outgoing or linked calls",
      })
    }

    if (!phone_number || typeof phone_number !== "string" || !phone_number.trim()) {
      return res.status(400).json({
        success: false,
        error: "phone_number is required",
      })
    }

    if (!start_time_ms || typeof start_time_ms !== "number") {
      return res.status(400).json({
        success: false,
        error: "Valid start_time_ms timestamp is required",
      })
    }

    // 2. Idempotency Check: if clientCallId already processed, return existing record
    const existingCall = await Call.findOne({ clientCallId: client_call_id.trim() })
    if (existingCall) {
      return res.status(200).json({
        success: true,
        call_id: existingCall._id.toString(),
        message: "Call report already received (idempotent)",
      })
    }

    // 3. Lead Verification & Ownership Enforcement (or Unlinked Inbound DNR check)
    let lead = null
    if (!isUnlinkedInbound) {
      lead = await Lead.findById(lead_id)
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead not found",
        })
      }

      // Tenant boundary check
      if (user.role !== "super_admin" && lead.tenantId !== user.tenantId) {
        return res.status(403).json({
          success: false,
          error: "Access denied. Cross-tenant lead call reporting is prohibited.",
        })
      }

      // Agent assignment verification
      const isTenantAdmin = user.role === "account_admin" || user.role === "super_admin"
      const isAssignedAgent =
        (lead.assignedStaffId && lead.assignedStaffId === user.id) ||
        (lead.assignedTo && lead.assignedTo.toLowerCase() === user.name.toLowerCase())

      if (!isTenantAdmin && !isAssignedAgent) {
        return res.status(403).json({
          success: false,
          error: "Access denied: Lead is not assigned to this agent.",
        })
      }

      // Do-Not-Record (DNR) Policy Check
      if (lead.metadata?.isDoNotRecord === true) {
        return res.status(400).json({
          success: false,
          error: "Call reporting rejected: Lead is marked Do-Not-Record (DNR).",
        })
      }
    } else {
      // Check if this incoming number is in tenant DNR list
      const dnrMatch = await Lead.findOne({
        tenantId: user.tenantId,
        $or: [{ phone: phone_number.trim() }, { "metadata.normalizedPhone": phone_number.trim() }],
        "metadata.isDoNotRecord": true,
      }).lean()
      if (dnrMatch) {
        return res.status(400).json({
          success: false,
          error: "Call reporting rejected: Phone number is marked Do-Not-Record (DNR).",
        })
      }
    }

    const targetTenantId = (lead ? lead.tenantId : user.tenantId) || "default"

    // 4. Create and Persist Call Record
    const newCall = await Call.create({
      clientCallId: client_call_id.trim(),
      leadId: lead ? lead._id : null,
      isUnlinked: !lead,
      tenantId: targetTenantId,
      agentId: user.id,
      agentName: user.name || "Agent",
      phoneNumber: phone_number.trim(),
      callDirection: call_direction || (isUnlinkedInbound ? "INCOMING" : "OUTGOING"),
      startTimeMs: start_time_ms,
      durationSeconds: duration_seconds || 0,
      callOutcome: call_outcome || "Connected",
      notes: notes ? notes.trim() : (isUnlinkedInbound ? "Unlinked Incoming Call (Website Call attribution unverified)" : ""),
      nextFollowUpAt: next_followup_at || null,
      simId: sim_id ? sim_id.trim() : null,
      metadata: {
        reportedVia: "android_app",
        reportedAt: Date.now(),
        isUnlinked: !lead,
        attribution: isUnlinkedInbound ? "unverified" : "lead",
      },
    })

    // 5. Update CRM Lead State & Create FollowUp if applicable
    if (lead) {
      const validCrmStatuses = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]
      if (call_outcome && validCrmStatuses.includes(call_outcome)) {
        lead.status = call_outcome
      }

      lead.metadata = lead.metadata || {}
      lead.metadata.lastCallOutcome = call_outcome || "Connected"
      lead.metadata.lastCallAt = new Date(start_time_ms)
      if (notes && notes.trim()) {
        lead.metadata.lastCallNotes = notes.trim()
      }

      if (next_followup_at && typeof next_followup_at === "number") {
        lead.metadata.nextFollowUpAt = next_followup_at

        // Automatically create a scheduled CRM FollowUp
        try {
          await FollowUp.create({
            leadId: lead._id,
            tenantId: lead.tenantId,
            title: `Call Follow-up: ${call_outcome || "Follow-up"}`,
            type: "call",
            scheduledAt: new Date(next_followup_at),
            status: "pending",
            priority: "medium",
            notes: notes ? notes.trim() : "Scheduled from mobile call summary",
            assignedTo: user.name || "Agent",
            assignedStaffId: user.id,
            createdBy: user.name || "Mobile Agent",
          })
        } catch (followUpErr) {
          console.warn("Could not create follow-up task:", followUpErr.message)
        }
      }

      lead.markModified("metadata")
      await lead.save()
    }

    return res.status(201).json({
      success: true,
      call_id: newCall._id.toString(),
      message: "Call recorded and synced successfully",
    })
  } catch (error) {
    // Handle unique constraint collision in race conditions
    if (error.code === 11000 && error.keyPattern?.clientCallId) {
      const existing = await Call.findOne({ clientCallId: req.body.client_call_id })
      if (existing) {
        return res.status(200).json({
          success: true,
          call_id: existing._id.toString(),
          message: "Call report already received (idempotent)",
        })
      }
    }

    console.error("Error in reportMobileCall:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error while reporting call",
    })
  }
}

/**
 * GET /api/mobile/v1/calls
 * Retrieve calls for the authenticated agent
 */
const getMobileCalls = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to view calls.",
      })
    }

    const query = {}
    if (user.role !== "super_admin" && user.tenantId) {
      query.tenantId = user.tenantId
    }

    const isTenantAdmin = user.role === "account_admin" || user.role === "super_admin"
    if (!isTenantAdmin) {
      query.agentId = user.id
    }

    const calls = await Call.find(query)
      .sort({ startTimeMs: -1 })
      .limit(50)
      .lean()

    return res.status(200).json({
      success: true,
      data: calls,
    })
  } catch (error) {
    console.error("Error in getMobileCalls:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error retrieving calls",
    })
  }
}

/**
 * POST /api/mobile/v1/auth/login
 * Mobile agent authentication endpoint delivering accessToken, refreshToken, user & agency metadata.
 */
const mobileLogin = async (req, res) => {
  try {
    const { email, password, deviceId } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    const invalidCreds = () =>
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password")
    if (!user) {
      return invalidCreds()
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        error: "Account has been suspended. Please contact support.",
      })
    }

    // Check tenant account status
    let account = null
    if (user.tenantId) {
      account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account && account.status === "suspended") {
        return res.status(403).json({
          success: false,
          error: `Your Agency (${account.companyName}) is currently suspended. Please contact your administrator.`,
        })
      }
    }

    // Check device revocation status if deviceId provided
    if (deviceId && typeof deviceId === "string" && deviceId.trim()) {
      const dev = await Device.findOne({ deviceId: deviceId.trim() }).lean()
      if (dev && dev.status === "REVOKED") {
        return res.status(200).json({
          success: true,
          data: {
            accessToken: "",
            refreshToken: "",
            expiresInSec: 0,
            user: {
              id: user._id.toString(),
              name: user.name,
              email: user.email,
              role: user.role,
              status: user.status,
            },
            agency: {
              id: account?._id.toString() || user.tenantId || "default",
              name: account?.companyName || account?.displayName || "Leads365 Agency",
              accountId: user.tenantId,
            },
            minVersionCode: 1,
            isUpdateRequired: false,
            isRevoked: true,
          },
          message: "Device session has been revoked by agency administrator.",
        })
      }
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return invalidCreds()
    }

    const secret = getJwtSecret()
    const accessToken = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        type: "access",
      },
      secret,
      { expiresIn: "24h" }
    )

    const refreshToken = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        tenantId: user.tenantId,
        type: "refresh",
      },
      secret,
      { expiresIn: "30d" }
    )

    return res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        expiresInSec: 86400,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
        agency: {
          id: account?._id.toString() || user.tenantId || "default",
          name: account?.companyName || account?.displayName || "Leads365 Agency",
          accountId: user.tenantId,
        },
        minVersionCode: 1,
        isUpdateRequired: false,
        isRevoked: false,
      },
      message: "Login successful",
    })
  } catch (error) {
    console.error("Error in mobileLogin:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error during mobile login",
    })
  }
}

/**
 * POST /api/mobile/v1/auth/refresh
 * Token refresh endpoint generating new accessToken and refreshToken pair.
 */
const mobileRefreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({
        success: false,
        error: "refreshToken is required",
      })
    }

    const secret = getJwtSecret()
    let decoded
    try {
      decoded = jwt.verify(refreshToken.trim(), secret)
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired refresh token",
      })
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        error: "Malformed refresh token",
      })
    }

    const user = await User.findById(decoded.id)
    if (!user || user.status === "suspended") {
      return res.status(401).json({
        success: false,
        error: "User session revoked or suspended",
      })
    }

    if (user.tenantId) {
      const account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account && account.status === "suspended") {
        return res.status(403).json({
          success: false,
          error: "Agency account is suspended",
        })
      }
    }

    const newAccessToken = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        type: "access",
      },
      secret,
      { expiresIn: "24h" }
    )

    const newRefreshToken = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        tenantId: user.tenantId,
        type: "refresh",
      },
      secret,
      { expiresIn: "30d" }
    )

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresInSec: 86400,
    })
  } catch (error) {
    console.error("Error in mobileRefreshToken:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error refreshing token",
    })
  }
}

/**
 * POST /api/mobile/v1/devices/register
 * Mobile device registration endpoint.
 */
const mobileRegisterDevice = async (req, res) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to register device",
      })
    }

    const {
      deviceId,
      deviceModel,
      manufacturer,
      osVersion,
      sdkInt,
      appVersionCode,
      appVersionName,
      fcmToken,
    } = req.body

    let device
    if (deviceId && typeof deviceId === "string" && deviceId.trim()) {
      device = await Device.findOne({
        deviceId: deviceId.trim(),
        userId: user.id,
        ...(user.tenantId && user.role !== "super_admin" ? { tenantId: user.tenantId } : {}),
      })
    }

    if (device) {
      if (deviceModel !== undefined) device.deviceModel = String(deviceModel).trim()
      if (manufacturer !== undefined) device.manufacturer = String(manufacturer).trim()
      if (osVersion !== undefined) device.osVersion = String(osVersion).trim()
      if (typeof sdkInt === "number") device.sdkInt = sdkInt
      if (typeof appVersionCode === "number") device.appVersionCode = appVersionCode
      if (appVersionName !== undefined) device.appVersionName = String(appVersionName).trim()
      if (fcmToken !== undefined) device.fcmToken = fcmToken ? String(fcmToken).trim() : null
      device.lastSeenAt = new Date()
      device.status = "ACTIVE"
      await device.save()
    } else {
      const targetDeviceId =
        deviceId && typeof deviceId === "string" && deviceId.trim()
          ? deviceId.trim()
          : `dev_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`

      device = await Device.create({
        deviceId: targetDeviceId,
        userId: user.id,
        tenantId: user.tenantId || "default-tenant",
        deviceModel: deviceModel ? String(deviceModel).trim() : "",
        manufacturer: manufacturer ? String(manufacturer).trim() : "",
        osVersion: osVersion ? String(osVersion).trim() : "",
        sdkInt: typeof sdkInt === "number" ? sdkInt : 0,
        appVersionCode: typeof appVersionCode === "number" ? appVersionCode : 0,
        appVersionName: appVersionName ? String(appVersionName).trim() : "",
        fcmToken: fcmToken ? String(fcmToken).trim() : null,
        status: "ACTIVE",
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        deviceId: device.deviceId,
        status: device.status,
        registeredAt: device.registeredAt ? device.registeredAt.getTime() : Date.now(),
        fcmToken: device.fcmToken,
      },
      message: "Device registered successfully",
    })
  } catch (error) {
    console.error("Error in mobileRegisterDevice:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error registering device",
    })
  }
}

/**
 * POST /api/mobile/v1/push-token
 * Phase 10: Authenticated FCM device token registration and refresh.
 */
const updateMobilePushToken = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to update push token",
      })
    }

    const token = req.body.token || req.body.fcmToken
    const deviceId = req.body.deviceId

    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({
        success: false,
        error: "Push token is required",
      })
    }

    const trimmedToken = token.trim()

    // 1. If deviceId is provided, query by deviceId and enforce agent/tenant ownership
    let device = null
    if (deviceId && typeof deviceId === "string" && deviceId.trim()) {
      const existingAny = await Device.findOne({ deviceId: deviceId.trim() })
      if (existingAny) {
        if (
          existingAny.userId.toString() !== user.id.toString() ||
          (user.tenantId && user.role !== "super_admin" && existingAny.tenantId !== user.tenantId)
        ) {
          return res.status(403).json({
            success: false,
            error: "Device belongs to another agent or agency account",
          })
        }
        device = existingAny
      }
    }

    // 2. Fallback to the latest active device for this agent
    if (!device) {
      const query = { userId: user.id, status: "ACTIVE" }
      if (user.role !== "super_admin" && user.tenantId) {
        query.tenantId = user.tenantId
      }
      device = await Device.findOne(query).sort({ updatedAt: -1 })
    }

    // 3. Upsert if no device record exists yet
    if (!device) {
      const generatedDeviceId =
        deviceId && typeof deviceId === "string" && deviceId.trim()
          ? deviceId.trim()
          : `dev_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`

      device = await Device.create({
        deviceId: generatedDeviceId,
        userId: user.id,
        tenantId: user.tenantId || "default-tenant",
        fcmToken: trimmedToken,
        status: "ACTIVE",
        registeredAt: new Date(),
        lastSeenAt: new Date(),
      })
    } else {
      device.fcmToken = trimmedToken
      device.lastSeenAt = new Date()
      await device.save()
    }

    return res.status(200).json({
      success: true,
      data: {
        deviceId: device.deviceId,
        fcmToken: device.fcmToken,
        lastSeenAt: device.lastSeenAt.getTime(),
      },
      message: "Push token registered successfully",
    })
  } catch (error) {
    console.error("Error in updateMobilePushToken:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error updating push token",
    })
  }
}

/**
 * POST /api/mobile/v1/auth/logout
 * Mobile agent logout endpoint. Cleans up push token to avoid token leaks across agents.
 */
const mobileLogout = async (req, res) => {
  try {
    const user = req.user
    const { deviceId } = req.body || {}

    if (user && deviceId && typeof deviceId === "string") {
      await Device.updateOne(
        { deviceId: deviceId.trim(), userId: user.id },
        { $set: { fcmToken: null, lastSeenAt: new Date() } }
      )
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    })
  } catch (error) {
    console.error("Error in mobileLogout:", error.message)
    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    })
  }
}

/**
 * POST /api/mobile/v1/devices/:deviceId/revoke
 * Agency admin device revocation endpoint.
 */
const mobileRevokeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId is required" })
    }

    const device = await Device.findOneAndUpdate(
      { deviceId: deviceId.trim() },
      { status: "REVOKED", lastSeenAt: new Date() },
      { new: true }
    )

    if (!device) {
      return res.status(404).json({ success: false, error: "Device not found" })
    }

    return res.status(200).json({
      success: true,
      data: {
        deviceId: device.deviceId,
        status: device.status,
      },
      message: "Device revoked successfully",
    })
  } catch (error) {
    console.error("Error in mobileRevokeDevice:", error.message)
    return res.status(500).json({ success: false, error: "Internal server error revoking device" })
  }
}

/**
 * PUT /api/calls/:callId/recording & /api/mobile/v1/calls/:callId/recording
 * Phase 8: Streaming call recording upload with checksum verification and lead/agent eligibility checks.
 */
const uploadMobileRecording = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to upload recordings.",
      })
    }

    const { callId } = req.params
    if (!callId || !callId.trim()) {
      return res.status(400).json({
        success: false,
        error: "callId parameter is required",
      })
    }

    // 1. Locate Call Record by clientCallId or _id
    const trimmedCallId = callId.trim()
    const callQuery = {
      $or: [
        { clientCallId: trimmedCallId },
        ...(mongoose.Types.ObjectId.isValid(trimmedCallId) ? [{ _id: trimmedCallId }] : [])
      ]
    }
    const call = await Call.findOne(callQuery).setOptions({ skipTenantFilter: true })
    if (!call) {
      return res.status(404).json({
        success: false,
        error: "Call record not found",
      })
    }

    // 2. Tenant Boundary & Agent Assignment Verification
    if (user.role !== "super_admin" && call.tenantId !== user.tenantId) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Cross-tenant recording upload is prohibited.",
      })
    }

    const isTenantAdmin = user.role === "account_admin" || user.role === "super_admin"
    const currentUserId = (user._id || user.id || "").toString()
    const isCallAgent = call.agentId && currentUserId && (call.agentId.toString() === currentUserId)
    if (!isTenantAdmin && !isCallAgent) {
      return res.status(403).json({
        success: false,
        error: "Access denied: Recording upload is restricted to the assigned agent or admin.",
      })
    }

    // 3. Lead Verification & DNR Gate
    if (call.leadId) {
      const lead = await Lead.findById(call.leadId)
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Associated lead not found",
        })
      }

      const isDnr = Boolean(lead.metadata?.isDoNotRecord || lead.isDoNotRecord)
      if (isDnr) {
        return res.status(403).json({
          success: false,
          error: "Recording upload prohibited: Lead is designated Do-Not-Record (DNR).",
        })
      }
    } else {
      // Unlinked incoming call: check phone against tenant DNR list
      const dnrMatch = await Lead.findOne({
        tenantId: call.tenantId,
        $or: [{ phone: call.phoneNumber }, { "metadata.normalizedPhone": call.phoneNumber }],
        "metadata.isDoNotRecord": true,
      }).lean()
      if (dnrMatch) {
        return res.status(403).json({
          success: false,
          error: "Recording upload prohibited: Phone number is designated Do-Not-Record (DNR).",
        })
      }
    }

    // 4. Validate Content-Type (MIME)
    const rawContentType = req.headers["content-type"] || ""
    const mimeType = rawContentType.split(";")[0].trim().toLowerCase()
    const validMimeTypes = [
      "audio/m4a",
      "audio/mp4",
      "audio/aac",
      "audio/mpeg",
      "audio/mp3",
      "audio/amr",
      "audio/3gpp",
      "audio/wav",
      "audio/ogg",
      "audio/x-m4a",
      "application/octet-stream"
    ]
    if (!validMimeTypes.includes(mimeType)) {
      return res.status(415).json({
        success: false,
        error: `Unsupported Media Type: ${mimeType}. Permitted audio formats: m4a, mp3, aac, amr, wav, 3gpp.`,
      })
    }

    // 5. Check Content-Length (Max 50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
    const contentLength = parseInt(req.headers["content-length"], 10)
    if (contentLength && contentLength > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        error: `File size exceeds the 50MB maximum permitted limit (Content-Length: ${contentLength} bytes).`,
      })
    }

    // 6. Idempotency Check: if call already has confirmed recording with matching SHA-256
    const clientProvidedSha = (req.headers["x-content-sha256"] || req.headers["x-audio-sha256"] || "").trim().toLowerCase()
    if (call.hasRecording && call.metadata?.recordingSha256) {
      if (!clientProvidedSha || clientProvidedSha === call.metadata.recordingSha256.toLowerCase()) {
        return res.status(200).json({
          success: true,
          message: "Recording already uploaded (idempotent)",
          callId: call.clientCallId || call._id.toString(),
          recordingUrl: call.metadata.recordingUrl,
          checksum: call.metadata.recordingSha256,
          alreadyUploaded: true
        })
      }
    }

    // 7. Persistent Streaming Storage to MongoDB GridFS with SHA-256 verification
    const recordingStorage = require("../services/recordingStorage")
    const extMap = {
      "audio/m4a": "m4a",
      "audio/x-m4a": "m4a",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/amr": "amr",
      "audio/3gpp": "3gp",
      "audio/wav": "wav",
      "audio/ogg": "ogg",
      "application/octet-stream": "m4a"
    }
    const ext = extMap[mimeType] || "m4a"
    const safeFilename = `${call.clientCallId || call._id}_${Date.now()}.${ext}`

    const result = await recordingStorage.streamUpload({
      callId: call._id.toString(),
      tenantId: call.tenantId,
      user,
      readStream: req,
      mimeType,
      filename: safeFilename,
      contentLength,
      expectedSha256: clientProvidedSha,
      retentionDays: 30,
    })

    return res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      message: result.message || "Recording uploaded successfully",
      callId: call.clientCallId || call._id.toString(),
      recordingUrl: `/api/calls/${call._id}/recording`,
      checksum: result.sha256,
      sizeBytes: result.sizeBytes,
      status: result.status,
      alreadyUploaded: Boolean(result.isDuplicate),
    })
  } catch (error) {
    if (error.message === "FILE_TOO_LARGE") {
      return res.status(413).json({
        success: false,
        error: "File size exceeded the 50MB maximum permitted limit during streaming.",
      })
    }
    console.error("Error in uploadMobileRecording:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error during recording upload: " + error.message,
    })
  }
}

/**
 * GET /api/mobile/v1/policy
 * Retrieve agency privacy policy, consent requirements, and DNR configuration.
 */
const getMobilePolicy = async (req, res) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to retrieve agency policy.",
      })
    }

    let agencyName = "Leads365 Agency"
    let recordingSyncPaused = false
    let requireConsentReminder = true
    let consentNoticeText =
      "In compliance with telecom regulations and agency policy, calls with assigned leads may be recorded for quality and training purposes. Calls with non-lead contacts and Do-Not-Record (DNR) designated leads are never recorded or uploaded."
    let allowRecordingPause = true
    let enforceStrictDnr = true

    if (user.tenantId) {
      const account = await Account.findOne({ accountId: user.tenantId }).lean()
      if (account) {
        agencyName = account.displayName || account.companyName || agencyName
        if (account.metadata?.recordingSyncPaused !== undefined) {
          recordingSyncPaused = Boolean(account.metadata.recordingSyncPaused)
        }
        if (account.metadata?.requireConsentReminder !== undefined) {
          requireConsentReminder = Boolean(account.metadata.requireConsentReminder)
        }
        if (account.metadata?.consentNoticeText) {
          consentNoticeText = account.metadata.consentNoticeText
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        agency_id: user.tenantId || "default_agency",
        agency_name: agencyName,
        require_consent_reminder: requireConsentReminder,
        consent_notice_text: consentNoticeText,
        allow_recording_pause: allowRecordingPause,
        recording_sync_paused: recordingSyncPaused,
        enforce_strict_dnr: enforceStrictDnr,
        server_time: Date.now(),
      },
    })
  } catch (error) {
    console.error("Error in getMobilePolicy:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error retrieving agency policy: " + error.message,
    })
  }
}

/**
 * POST /api/mobile/v1/policy/pause
 * Toggle recording sync pause state for the authenticated agency/user.
 */
const setMobileRecordingSyncPause = async (req, res) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      })
    }

    const { paused } = req.body
    if (typeof paused !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'paused' boolean parameter.",
      })
    }

    if (user.tenantId) {
      const account = await Account.findOne({ accountId: user.tenantId })
      if (account) {
        if (!account.metadata) account.metadata = {}
        account.metadata.recordingSyncPaused = paused
        account.markModified("metadata")
        await account.save()
      }
    }

    return res.status(200).json({
      success: true,
      message: paused ? "Recording synchronization paused." : "Recording synchronization resumed.",
      recording_sync_paused: paused,
    })
  } catch (error) {
    console.error("Error in setMobileRecordingSyncPause:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error setting pause state: " + error.message,
    })
  }
}

/**
 * Streams an audio file with HTTP 206 Partial Content (Range) support for seeking
 */
const streamAudioFile = (req, res, filePath, mimeType) => {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.range

  const ext = path.extname(filePath).toLowerCase()
  const mime = mimeType || (ext === ".m4a" ? "audio/m4a" : ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : "audio/m4a")

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    if (isNaN(start) || start >= fileSize || (parts[1] && end >= fileSize) || start > end) {
      res.status(416).set("Content-Range", `bytes */${fileSize}`)
      return res.end()
    }
    const chunkSize = end - start + 1
    const fileStream = fs.createReadStream(filePath, { start, end })

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mime,
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    })
    fileStream.pipe(res)
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    })
    fs.createReadStream(filePath).pipe(res)
  }
}

/**
 * GET /api/calls/:callId/recording & GET /api/mobile/v1/calls/:callId/recording
 * Secure playback of a call recording with tenant and agent ownership checks.
 */
const streamCallRecording = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to stream recordings.",
      })
    }

    const { callId } = req.params
    if (!callId || !callId.trim()) {
      return res.status(400).json({
        success: false,
        error: "callId parameter is required",
      })
    }

    const recordingStorage = require("../services/recordingStorage")
    const trimmedCallId = callId.trim()
    const isObjectId = mongoose.Types.ObjectId.isValid(trimmedCallId)
    const callQuery = {
      $or: [
        { clientCallId: trimmedCallId },
        ...(isObjectId ? [{ _id: trimmedCallId }] : [])
      ]
    }
    const call = await Call.findOne(callQuery).setOptions({ skipTenantFilter: true })
    if (!call) {
      return res.status(404).json({
        success: false,
        error: "Call record not found",
      })
    }

    const tenantId = user.role === "super_admin" ? call.tenantId : user.tenantId
    return await recordingStorage.streamPlayback({
      callId: trimmedCallId,
      tenantId,
      user,
      rangeHeader: req.headers.range,
      res,
      query: req.query,
    })
  } catch (error) {
    console.error("Error in streamCallRecording:", error.message)
    if (!res.headersSent) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || "Internal server error while streaming recording",
      })
    }
  }
}

/**
 * GET /uploads/recordings/:tenantId/:fileName
 * Authenticated handler for storage URLs ensuring no unauthenticated public access.
 */
const streamRecordingByPath = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required to stream recordings.",
      })
    }

    const { tenantId, fileName } = req.params
    const safeTenantId = (tenantId || "").replace(/[^a-zA-Z0-9_-]/g, "")
    const safeFileName = path.basename(fileName || "")

    if (user.role !== "super_admin" && user.tenantId !== safeTenantId) {
      return res.status(403).json({
        success: false,
        error: "Access denied. Cross-tenant recording access is prohibited.",
      })
    }

    // Check ownership if call is registered
    const recordingUrlPattern = `/uploads/recordings/${safeTenantId}/${safeFileName}`
    const call = await Call.findOne({
      tenantId: safeTenantId,
      "metadata.recordingUrl": recordingUrlPattern,
    })

    if (call) {
      const isTenantAdmin = user.role === "account_admin" || user.role === "super_admin"
      const isCallAgent = call.agentId && call.agentId.toString() === user.id.toString()
      if (!isTenantAdmin && !isCallAgent) {
        const lead = call.leadId ? await Lead.findById(call.leadId).lean() : null
        const isLeadAgent = lead && (
          (lead.assignedStaffId && lead.assignedStaffId.toString() === user.id.toString()) ||
          (lead.assignedTo && lead.assignedTo.toLowerCase() === user.name.toLowerCase())
        )
        if (!isLeadAgent) {
          return res.status(403).json({
            success: false,
            error: "Access denied. Recording playback is restricted to assigned agents or administrators.",
          })
        }
      }
    }

    const baseUploadDir = path.resolve(__dirname, "../uploads/recordings")
    const filePath = path.resolve(baseUploadDir, safeTenantId, safeFileName)
    if (!filePath.startsWith(baseUploadDir) || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: "Recording file not found",
      })
    }

    return streamAudioFile(req, res, filePath, call?.metadata?.recordingMimeType)
  } catch (error) {
    console.error("Error in streamRecordingByPath:", error.message)
    return res.status(500).json({
      success: false,
      error: "Internal server error streaming recording by path",
    })
  }
}

/**
 * PATCH /api/mobile/v1/calls/:callId/link-lead
 * Link an unlinked incoming call to an existing CRM lead without losing recording or call history.
 */
const linkCallToLead = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }
    const { callId } = req.params
    const { lead_id } = req.body

    if (!lead_id || !mongoose.Types.ObjectId.isValid(lead_id)) {
      return res.status(400).json({ success: false, error: "Valid lead_id is required" })
    }

    const trimmedCallId = (callId || "").trim()
    const callQuery = {
      $or: [
        { clientCallId: trimmedCallId },
        ...(mongoose.Types.ObjectId.isValid(trimmedCallId) ? [{ _id: trimmedCallId }] : [])
      ]
    }
    const call = await Call.findOne(callQuery)
    if (!call) {
      return res.status(404).json({ success: false, error: "Call not found" })
    }

    if (user.role !== "super_admin" && call.tenantId !== user.tenantId) {
      return res.status(403).json({ success: false, error: "Access denied. Cross-tenant operation prohibited." })
    }

    const lead = await Lead.findById(lead_id)
    if (!lead || (user.role !== "super_admin" && lead.tenantId !== user.tenantId)) {
      return res.status(404).json({ success: false, error: "Target lead not found in this tenant" })
    }

    call.leadId = lead._id
    call.isUnlinked = false
    call.metadata = call.metadata || {}
    call.metadata.linkedAt = Date.now()
    call.metadata.linkedBy = user.id
    call.markModified("metadata")
    await call.save()

    return res.status(200).json({
      success: true,
      message: "Call successfully linked to lead",
      call_id: call._id.toString(),
      lead_id: lead._id.toString(),
    })
  } catch (error) {
    console.error("Error in linkCallToLead:", error.message)
    return res.status(500).json({ success: false, error: "Internal server error linking call to lead" })
  }
}

/**
 * POST /api/mobile/v1/heartbeat
 * Device health ingestion endpoint reporting permissions, sync health, pending uploads, and missing recordings.
 */
const mobileHeartbeat = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({ success: false, error: "Authentication required for heartbeat" })
    }

    const {
      device_id,
      app_version,
      battery_optimization_ignored,
      permissions_all_granted,
      storage_access_granted,
      auto_record_verified,
      missing_recordings_count,
      pending_uploads_count,
      last_sync_epoch_ms,
      last_successful_upload_epoch_ms,
      health_state,
    } = req.body

    let device = null
    if (device_id) {
      device = await Device.findOne({
        deviceId: device_id.trim(),
        tenantId: user.tenantId,
      })
    } else {
      device = await Device.findOne({
        userId: user.id,
        tenantId: user.tenantId,
        status: "ACTIVE",
      }).sort({ updatedAt: -1 })
    }

    if (device) {
      // Validate device ownership if device has assigned agent
      if (device.userId && device.userId.toString() !== user.id.toString() && user.role !== "super_admin") {
        return res.status(403).json({ success: false, error: "Device is registered to a different agent" })
      }

      device.lastSeenAt = new Date()
      device.lastHeartbeatAt = new Date()
      if (app_version) device.appVersionName = app_version

      device.healthSummary = {
        batteryOptimizationIgnored: typeof battery_optimization_ignored === "boolean" ? battery_optimization_ignored : device.healthSummary?.batteryOptimizationIgnored,
        permissionsAllGranted: typeof permissions_all_granted === "boolean" ? permissions_all_granted : device.healthSummary?.permissionsAllGranted,
        storageAccessGranted: typeof storage_access_granted === "boolean" ? storage_access_granted : device.healthSummary?.storageAccessGranted,
        autoRecordVerified: typeof auto_record_verified === "boolean" ? auto_record_verified : device.healthSummary?.autoRecordVerified,
        missingRecordingsCount: typeof missing_recordings_count === "number" ? missing_recordings_count : (device.healthSummary?.missingRecordingsCount || 0),
        pendingUploadsCount: typeof pending_uploads_count === "number" ? pending_uploads_count : (device.healthSummary?.pendingUploadsCount || 0),
        lastSyncEpochMs: last_sync_epoch_ms || device.healthSummary?.lastSyncEpochMs,
        lastSuccessfulUploadEpochMs: last_successful_upload_epoch_ms || device.healthSummary?.lastSuccessfulUploadEpochMs,
        healthState: health_state || device.healthSummary?.healthState || "HEALTHY",
      }

      if (typeof device.markModified === "function") device.markModified("healthSummary")
      if (typeof device.save === "function") await device.save()
    }

    return res.status(200).json({
      success: true,
      message: "Heartbeat ingested successfully",
      device_status: device ? device.status : "ACTIVE",
      revoked: device ? device.status === "REVOKED" : false,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error("Error in mobileHeartbeat:", error.message)
    return res.status(500).json({ success: false, error: "Internal server error ingesting heartbeat" })
  }
}

/**
 * POST /api/mobile/v1/diagnostics
 * Ingest sanitized diagnostics payload with no PII, tokens, or audio contents.
 */
const mobileDiagnostics = async (req, res) => {
  try {
    const user = req.user
    if (!user || (!user.tenantId && user.role !== "super_admin")) {
      return res.status(401).json({ success: false, error: "Authentication required for diagnostics ingestion" })
    }

    const { device_id, report_timestamp, diagnostics } = req.body

    // Basic sanitization audit: ensure no sensitive keys are passed
    if (diagnostics && typeof diagnostics === "object") {
      delete diagnostics.token
      delete diagnostics.accessToken
      delete diagnostics.refreshToken
      delete diagnostics.password
      delete diagnostics.audio
      delete diagnostics.audioBytes
    }

    // Touch device last seen
    if (device_id) {
      await Device.updateOne(
        { deviceId: device_id.trim(), tenantId: user.tenantId },
        { $set: { lastSeenAt: new Date() } }
      ).catch(() => {})
    }

    return res.status(200).json({
      success: true,
      message: "Diagnostics report ingested successfully",
      report_id: `diag_${Date.now()}`,
    })
  } catch (error) {
    console.error("Error in mobileDiagnostics:", error.message)
    return res.status(500).json({ success: false, error: "Internal server error ingesting diagnostics" })
  }
}


// --- Phase 15 Services & Controller Functions ---
let deviceAuthService;
let mobileSyncService;
try {
  deviceAuthService = require("../services/deviceAuthService");
  mobileSyncService = require("../services/mobileSyncService");
} catch (_) {}

async function login(req, res) {
  try {
    const { email, password, deviceUuid, deviceModel, osVersion, appVersion, pushToken } = req.body || {}

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        code: "CREDENTIALS_REQUIRED",
      })
    }

    if (!deviceUuid) {
      return res.status(400).json({
        success: false,
        error: "Device UUID is required for mobile authentication",
        code: "DEVICE_UUID_REQUIRED",
      })
    }

    const result = await deviceAuthService.loginDevice({
      email,
      password,
      deviceUuid,
      deviceModel,
      osVersion,
      appVersion: appVersion || req.headers["x-app-version"],
      pushToken,
      ipAddress: req.ip || req.connection?.remoteAddress,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "AUTH_FAILED",
    })
  }
}

/**
 * Device token rotation and refresh
 * POST /api/mobile/auth/refresh
 */
async function refresh(req, res) {
  try {
    const { refreshToken, deviceUuid } = req.body || {}

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: "Refresh token is required",
        code: "REFRESH_TOKEN_REQUIRED",
      })
    }

    const result = await deviceAuthService.refreshDeviceToken({
      refreshToken,
      deviceUuid,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 401
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "REFRESH_FAILED",
    })
  }
}

/**
 * Device logout (clears active refresh token)
 * POST /api/mobile/auth/logout
 */
async function logout(req, res) {
  try {
    const deviceId = req.device?._id || req.device?.id
    const tenantId = req.tenantId

    if (!deviceId || !tenantId) {
      return res.status(400).json({
        success: false,
        error: "Authenticated device context required for logout",
        code: "INVALID_DEVICE_CONTEXT",
      })
    }

    await deviceAuthService.logoutDevice(deviceId, tenantId)

    return res.status(200).json({
      success: true,
      message: "Device logged out successfully",
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "LOGOUT_FAILED",
    })
  }
}

/**
 * Update FCM / APNS push token for authenticated device
 * POST /api/mobile/push-token
 */
async function updatePushToken(req, res) {
  try {
    const { pushToken } = req.body || {}
    const deviceId = req.device?._id || req.device?.id
    const tenantId = req.tenantId

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        error: "pushToken is required",
        code: "PUSH_TOKEN_REQUIRED",
      })
    }

    const updatedDevice = await deviceAuthService.updateDevicePushToken(deviceId, pushToken, tenantId)

    return res.status(200).json({
      success: true,
      message: "Push token updated successfully",
      deviceId: updatedDevice._id,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "UPDATE_FAILED",
    })
  }
}

/**
 * Incremental agent-scoped lead synchronization
 * GET /api/mobile/leads
 */
async function syncLeads(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const { since, limit, cursor } = req.query

    const result = await mobileSyncService.syncAgentLeads({
      tenantId,
      agentId,
      since,
      limit,
      cursor,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "SYNC_FAILED",
    })
  }
}

/**
 * Report mobile call log with clientCallId idempotency
 * POST /api/mobile/calls
 */
async function reportCall(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const deviceId = req.device?._id || req.device?.id

    const result = await mobileSyncService.reportMobileCall({
      tenantId,
      agentId,
      deviceId,
      callData: req.body || {},
    })

    const httpStatus = result.isDuplicate ? 200 : 201
    return res.status(httpStatus).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "REPORT_CALL_FAILED",
    })
  }
}

/**
 * Issue pre-flight recording upload ticket
 * POST /api/mobile/calls/:id/recording-ticket
 */
async function getRecordingTicket(req, res) {
  try {
    const tenantId = req.tenantId
    const agentId = req.user?._id || req.user?.id
    const callId = req.params.id

    const result = await mobileSyncService.issueRecordingTicket({
      tenantId,
      agentId,
      callId,
    })

    return res.status(200).json({
      success: true,
      ...result,
    })
  } catch (err) {
    const status = err.status || 500
    return res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || "TICKET_DENIED",
    })
  }
}

/**
 * Get authenticated device and agent profile status
 * GET /api/mobile/status
 */
async function getDeviceStatus(req, res) {
  try {
    return res.status(200).json({
      success: true,
      device: {
        id: req.device?._id,
        deviceUuid: req.device?.deviceUuid,
        deviceModel: req.device?.deviceModel,
        osVersion: req.device?.osVersion,
        appVersion: req.device?.appVersion,
        status: req.device?.status,
        lastSyncAt: req.device?.lastSyncAt,
      },
      user: {
        id: req.user?._id,
        name: req.user?.name,
        email: req.user?.email,
        role: req.user?.role,
      },
      tenantId: req.tenantId,
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    })
  }
}


module.exports = {
  // Mobile v1 / Android Client API
  syncMobileLeads,
  reportMobileCall,
  linkCallToLead,
  getMobileCalls,
  uploadMobileRecording,
  streamCallRecording,
  streamRecordingByPath,
  streamAudioFile,
  getMobilePolicy,
  setMobileRecordingSyncPause,
  mobileLogin,
  mobileRefreshToken,
  mobileRegisterDevice,
  updateMobilePushToken,
  mobileLogout,
  mobileRevokeDevice,
  mobileHeartbeat,
  mobileDiagnostics,
  maskPhone,
  // Phase 15 DeviceAuth & MobileSync Methods
  login,
  refresh,
  logout,
  updatePushToken,
  syncLeads,
  reportCall,
  getRecordingTicket,
  getDeviceStatus,
};
