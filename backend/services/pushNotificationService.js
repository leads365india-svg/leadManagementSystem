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

/**
 * Send AI callback scheduled push notification to the assigned agent's devices
 */
const sendCallbackScheduledNotification = async ({ followUp, lead, agentId, tenantId }) => {
  try {
    if (!followUp || !agentId || agentId === "unassigned") return null

    const query = {
      userId: agentId,
      status: "ACTIVE",
      fcmToken: { $ne: null, $exists: true },
    }
    if (tenantId) query.tenantId = tenantId

    const devices = await Device.find(query).lean()
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean)

    const customerName = (lead && lead.name) || followUp.customerName || "Customer"
    const customerPhone = (lead && lead.phone) || followUp.customerPhone || ""
    const scheduledTimeStr = followUp.scheduledAt ? new Date(followUp.scheduledAt).toISOString() : ""

    const isAgentCall = followUp.callbackDirection === "AGENT_CALLBACK" || followUp.direction === "OUTBOUND"
    const actionText = isAgentCall ? `Call ${customerName}` : (followUp.taskAction || `Follow up with ${customerName}`)
    const notifTitle = isAgentCall ? `Call ${customerName}` : `AI Callback: ${customerName}`
    const notifBody = `${actionText} at ${followUp.scheduledAt ? new Date(followUp.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "agreed time"}${followUp.callbackReason ? ` • ${followUp.callbackReason}` : ""}`

    const payload = {
      notification: {
        title: notifTitle,
        body: notifBody,
      },
      data: {
        eventType: "EVENT_CALLBACK_SCHEDULED",
        type: "EVENT_CALLBACK_SCHEDULED",
        followUpId: followUp._id ? followUp._id.toString() : String(followUp.id || ""),
        leadId: lead && (lead._id || lead.id) ? (lead._id || lead.id).toString() : "",
        leadName: customerName,
        name: customerName,
        phone: customerPhone,
        leadPhone: customerPhone,
        status: (lead && lead.status) || "Engaged",
        notes: followUp.notes || followUp.callbackReason || "",
        title: followUp.title || `Call ${customerName}`,
        callbackDirection: followUp.callbackDirection || (isAgentCall ? "AGENT_CALLBACK" : "EXPECTED_CUSTOMER_CALLBACK"),
        direction: followUp.direction || (isAgentCall ? "OUTBOUND" : "INBOUND"),
        taskAction: followUp.taskAction || (isAgentCall ? "Call customer" : "Check whether the customer called"),
        scheduledAt: scheduledTimeStr,
        callbackAt: scheduledTimeStr,
        callbackTimezone: followUp.callbackTimezone || "Asia/Kolkata",
        productContext: followUp.productContext || "",
        scheduledTimestamp: String(Date.now()),
      },
    }

    const record = {
      type: "EVENT_CALLBACK_SCHEDULED",
      agentId,
      tenantId,
      followUpId: payload.data.followUpId,
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
    console.error("Error sending callback scheduled push:", error.message)
    return null
  }
}

/**
 * Send callback reminder (5 minutes before or due now) push notification
 */
const sendCallbackReminderNotification = async ({ followUp, lead, agentId, tenantId, reminderType = "5_MINUTES_BEFORE" }) => {
  try {
    if (!followUp || !agentId || agentId === "unassigned") return null

    const query = {
      userId: agentId,
      status: "ACTIVE",
      fcmToken: { $ne: null, $exists: true },
    }
    if (tenantId) query.tenantId = tenantId

    const devices = await Device.find(query).lean()
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean)

    const customerName = (lead && lead.name) || followUp.customerName || "Customer"
    const customerPhone = (lead && lead.phone) || followUp.customerPhone || ""
    const isDueNow = reminderType === "DUE_NOW"
    const eventType = isDueNow ? "EVENT_CALLBACK_DUE" : "EVENT_CALLBACK_REMINDER"

    const notificationTitle = isDueNow
      ? `Callback Due Now: ${customerName}`
      : `Upcoming Callback in 5 mins: ${customerName}`

    const notificationBody = `${customerPhone ? customerPhone + " • " : ""}${followUp.callbackReason || followUp.title || "Scheduled Follow-up"}`

    const payload = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        eventType,
        type: eventType,
        reminderType,
        followUpId: followUp._id ? followUp._id.toString() : String(followUp.id || ""),
        leadId: lead && (lead._id || lead.id) ? (lead._id || lead.id).toString() : "",
        leadName: customerName,
        name: customerName,
        phone: customerPhone,
        leadPhone: customerPhone,
        title: followUp.title || `Callback: ${customerName}`,
        notes: followUp.notes || followUp.callbackReason || "",
        scheduledAt: followUp.scheduledAt ? new Date(followUp.scheduledAt).toISOString() : "",
        callbackAt: followUp.callbackAt ? new Date(followUp.callbackAt).toISOString() : "",
        callbackTimezone: followUp.callbackTimezone || "Asia/Kolkata",
        productContext: followUp.productContext || "",
        timestamp: String(Date.now()),
      },
    }

    const record = {
      type: eventType,
      agentId,
      tenantId,
      followUpId: payload.data.followUpId,
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
    console.error("Error sending callback reminder push:", error.message)
    return null
  }
}

/**
 * Send callback rescheduled push notification
 */
const sendCallbackRescheduledNotification = async ({ followUp, lead, agentId, tenantId }) => {
  try {
    if (!followUp || !agentId || agentId === "unassigned") return null

    const query = {
      userId: agentId,
      status: "ACTIVE",
      fcmToken: { $ne: null, $exists: true },
    }
    if (tenantId) query.tenantId = tenantId

    const devices = await Device.find(query).lean()
    const tokens = devices.map((d) => d.fcmToken).filter(Boolean)

    const customerName = (lead && lead.name) || followUp.customerName || "Customer"
    const customerPhone = (lead && lead.phone) || followUp.customerPhone || ""

    const payload = {
      notification: {
        title: `Callback Rescheduled: ${customerName}`,
        body: `Updated to ${followUp.scheduledAt ? new Date(followUp.scheduledAt).toLocaleString() : "new time"}`,
      },
      data: {
        eventType: "EVENT_CALLBACK_RESCHEDULED",
        type: "EVENT_CALLBACK_RESCHEDULED",
        followUpId: followUp._id ? followUp._id.toString() : String(followUp.id || ""),
        leadId: lead && (lead._id || lead.id) ? (lead._id || lead.id).toString() : "",
        leadName: customerName,
        name: customerName,
        phone: customerPhone,
        leadPhone: customerPhone,
        title: followUp.title || `AI Callback: ${customerName}`,
        notes: followUp.notes || followUp.callbackReason || "",
        scheduledAt: followUp.scheduledAt ? new Date(followUp.scheduledAt).toISOString() : "",
        timestamp: String(Date.now()),
      },
    }

    const record = {
      type: "EVENT_CALLBACK_RESCHEDULED",
      agentId,
      tenantId,
      followUpId: payload.data.followUpId,
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
    console.error("Error sending callback rescheduled push:", error.message)
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
  sendCallbackScheduledNotification,
  sendCallbackReminderNotification,
  sendCallbackRescheduledNotification,
  getDispatchedHistory,
  clearDispatchedHistory,
  isConfigured,
}
