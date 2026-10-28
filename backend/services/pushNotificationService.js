const Device = require("../models/Device")

/**
 * Phase 10: Push Notification Service for Lead Assignment and Reassignment
 */

// In-memory record of dispatched notifications for audit and testing
const dispatchedHistory = []

let firebaseAdmin = null
let isFirebaseInitialized = false

// Try to safely load firebase-admin if configured
try {
  const admin = require("firebase-admin")
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
    firebaseAdmin = admin
    isFirebaseInitialized = true
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp()
    firebaseAdmin = admin
    isFirebaseInitialized = true
  }
} catch (e) {
  // Graceful fallback when firebase-admin package or credentials are not yet configured
  firebaseAdmin = null
  isFirebaseInitialized = false
}

/**
 * Send lead assigned push notification to the assigned agent's active devices
 */
const sendLeadAssignedNotification = async ({ lead, agentId, tenantId }) => {
  try {
    if (!lead || !agentId || agentId === "unassigned") return null

    const query = {
      userId: agentId,
      status: "ACTIVE",
      fcmToken: { $ne: null, $exists: true },
    }
    if (tenantId) query.tenantId = tenantId

    const devices = await Device.find(query).lean()
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean)

    const payload = {
      notification: {
        title: "New Lead Assigned",
        body: `${lead.name || "New Lead"} - ${lead.status || "New"}`,
      },
      data: {
        eventType: "LEAD_ASSIGNED",
        leadId: lead._id ? lead._id.toString() : String(lead.id || ""),
        name: lead.name || "",
        phone: lead.phone || "",
        status: lead.status || "New",
        notes: lead.message || (lead.metadata && lead.metadata.notes) || "",
        assignedAt: String(Date.now()),
      },
    }

    const record = {
      type: "LEAD_ASSIGNED",
      agentId,
      tenantId,
      leadId: payload.data.leadId,
      deviceCount: tokens.length,
      tokens,
      payload,
      timestamp: Date.now(),
      sentViaFirebase: false,
    }

    if (isFirebaseInitialized && firebaseAdmin && tokens.length > 0) {
      try {
        await firebaseAdmin.messaging().sendEachForMulticast({
          tokens,
          notification: payload.notification,
          data: payload.data,
        })
        record.sentViaFirebase = true
      } catch (err) {
        record.firebaseError = err.message
      }
    }

    dispatchedHistory.push(record)
    if (dispatchedHistory.length > 100) dispatchedHistory.shift()
    return record
  } catch (error) {
    console.error("Error sending lead assigned push:", error.message)
    return null
  }
}

/**
 * Send lead reassigned-away push notification to the previous agent's devices
 */
const sendLeadReassignedAwayNotification = async ({ leadId, previousAgentId, tenantId }) => {
  try {
    if (!leadId || !previousAgentId || previousAgentId === "unassigned") return null

    const query = {
      userId: previousAgentId,
      status: "ACTIVE",
      fcmToken: { $ne: null, $exists: true },
    }
    if (tenantId) query.tenantId = tenantId

    const devices = await Device.find(query).lean()
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean)

    const payload = {
      notification: {
        title: "Lead Reassigned",
        body: "A lead was reassigned away from your queue",
      },
      data: {
        eventType: "LEAD_REASSIGNED_AWAY",
        leadId: String(leadId),
        timestamp: String(Date.now()),
      },
    }

    const record = {
      type: "LEAD_REASSIGNED_AWAY",
      agentId: previousAgentId,
      tenantId,
      leadId: String(leadId),
      deviceCount: tokens.length,
      tokens,
      payload,
      timestamp: Date.now(),
      sentViaFirebase: false,
    }

    if (isFirebaseInitialized && firebaseAdmin && tokens.length > 0) {
      try {
        await firebaseAdmin.messaging().sendEachForMulticast({
          tokens,
          notification: payload.notification,
          data: payload.data,
        })
        record.sentViaFirebase = true
      } catch (err) {
        record.firebaseError = err.message
      }
    }

    dispatchedHistory.push(record)
    if (dispatchedHistory.length > 100) dispatchedHistory.shift()
    return record
  } catch (error) {
    console.error("Error sending lead reassigned away push:", error.message)
    return null
  }
}

const getDispatchedHistory = () => [...dispatchedHistory]
const clearDispatchedHistory = () => {
  dispatchedHistory.length = 0
}

const isConfigured = () => isFirebaseInitialized

module.exports = {
  sendLeadAssignedNotification,
  sendLeadReassignedAwayNotification,
  getDispatchedHistory,
  clearDispatchedHistory,
  isConfigured,
}
