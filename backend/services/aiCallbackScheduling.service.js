const mongoose = require("mongoose")
const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { activity } = require("./activityService")
const pushNotificationService = require("./pushNotificationService")
const audit = require("./auditService")
const { resolveLeadForCall } = require("./leadPipelineSync.service")

/**
 * AI Callback Scheduling & CRM Reminders Service
 * 
 * Automates callback creation, lead state synchronization, smart rescheduling,
 * and push notification dispatches for AI Call Intelligence.
 */

/**
 * Helper to format scheduled date/time in human-friendly readable format.
 */
function formatHumanDateTime(date, timezone = "Asia/Kolkata") {
  try {
    const d = new Date(date)
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d)
  } catch (_) {
    return new Date(date).toLocaleString()
  }
}

/**
 * Automatically schedules or reschedules a FollowUp callback task from an analyzed AI call.
 * 
 * Enforces:
 * 1. Strict Product Relevance Gate: Disqualified or out-of-scope calls never create follow-ups.
 * 2. Idempotent single source of truth: Reschedules existing pending follow-up instead of duplicating.
 * 3. CRM Lead synchronization: Updates nextFollowUpDate, followUpStatus, and status ('Engaged').
 * 4. Records discrete timeline activity 'lead.followup_created'.
 * 5. Dispatches FCM push notification to assigned employee's active devices.
 */
async function scheduleAutomaticCallbackFromAiCall({
  call,
  analysis,
  tenantId = null,
  lead = null,
  actor = null,
}) {
  const effectiveTenantId = (
    tenantId ||
    analysis?.tenantId ||
    call?.tenantId ||
    ""
  ).toString().trim()

  if (!effectiveTenantId) {
    return {
      success: false,
      skipped: true,
      reason: "Missing tenantId for callback scheduling",
    }
  }

  if (!analysis) {
    return {
      success: false,
      skipped: true,
      reason: "Missing AI Call Analysis object",
    }
  }

  // 1. Strict Product Relevance Gate Check
  // Disqualified calls (recruitment, unrelated vendor pitches, wrong number, explicit rejection) MUST NOT schedule callbacks
  if (
    analysis.isProductRelevant === false ||
    analysis.qualificationStatus === "DISQUALIFIED" ||
    analysis.callOutcome === "NOT_INTERESTED" ||
    analysis.callOutcome === "OUT_OF_SCOPE"
  ) {
    return {
      success: false,
      skipped: true,
      disqualified: true,
      qualificationStatus: analysis.qualificationStatus,
      reason: "Strict Product Relevance Gate: Out-of-scope or disqualified calls cannot schedule sales callbacks.",
    }
  }

  // 2. Check if a callback was requested
  if (!analysis.callbackRequested || !analysis.requestedCallbackDateTime) {
    return {
      success: false,
      skipped: true,
      reason: "No customer callback was requested during this call.",
    }
  }

  // 3. Resolve Target Lead
  let targetLead = lead
  if (!targetLead) {
    const resolution = await resolveLeadForCall({ call, tenantId: effectiveTenantId })
    targetLead = resolution.lead
  }

  if (!targetLead) {
    return {
      success: false,
      skipped: true,
      reason: "No CRM lead found or matched for callback scheduling",
    }
  }

  const scheduledAt = new Date(analysis.requestedCallbackDateTime)
  if (isNaN(scheduledAt.getTime())) {
    return {
      success: false,
      skipped: true,
      reason: "Invalid requested callback date/time format",
    }
  }

  const timezone = analysis.callbackTimezone || "Asia/Kolkata"
  const humanTime = formatHumanDateTime(scheduledAt, timezone)
  const reason = analysis.callbackReason || "Customer requested callback"
  const productContext = Array.isArray(analysis.productInterests) && analysis.productInterests.length > 0
    ? analysis.productInterests.join(", ")
    : ""
  const customerName = targetLead.name || call.customerName || "Customer"
  const customerPhone = targetLead.phone || call.phoneNumber || call.phoneNormalized || ""
  const assignedTo = targetLead.assignedTo || call.agentName || "Agent"
  const assignedStaffId = targetLead.assignedStaffId || (call.agentId ? call.agentId.toString() : "unassigned")

  const callbackDirection = analysis.callbackDirection || "AGENT_CALLBACK"
  const direction = callbackDirection === "AGENT_CALLBACK"
    ? "OUTBOUND"
    : callbackDirection === "EXPECTED_CUSTOMER_CALLBACK"
    ? "INBOUND"
    : "OUTBOUND"

  const taskAction = analysis.taskAction || (
    callbackDirection === "EXPECTED_CUSTOMER_CALLBACK"
      ? "Check whether the customer called; follow up if they did not."
      : "Call customer"
  )
  const directionDescription = analysis.directionDescription || (
    callbackDirection === "AGENT_CALLBACK"
      ? "Customer requested agent callback"
      : "Customer promised to call at agreed time"
  )

  const callbackTitle = callbackDirection === "EXPECTED_CUSTOMER_CALLBACK"
    ? `Expected Customer Call: ${customerName}`
    : `Call ${customerName}`

  // 4. Check for existing pending or due follow-up for this lead to prevent duplicates
  let followUp = await FollowUp.findOne({
    tenantId: effectiveTenantId,
    leadId: targetLead._id,
    status: { $in: ["pending", "due"] },
    deletedAt: null,
  }).sort({ scheduledAt: 1 }).setOptions({ skipTenantFilter: true })

  // Also check by sourceCallId or idempotencyKey if leadId search misses
  if (!followUp && call._id) {
    followUp = await FollowUp.findOne({
      tenantId: effectiveTenantId,
      sourceCallId: call._id.toString(),
      status: { $in: ["pending", "due"] },
      deletedAt: null,
    }).setOptions({ skipTenantFilter: true })
  }

  let isRescheduled = false
  const previousScheduledAt = followUp ? followUp.scheduledAt : null

  if (followUp) {
    // Intelligently reschedule existing pending callback
    isRescheduled = true
    followUp.scheduledAt = scheduledAt
    followUp.callbackAt = scheduledAt
    followUp.callbackTimezone = timezone
    followUp.callbackReason = reason
    followUp.callbackDirection = callbackDirection
    followUp.direction = direction
    followUp.taskAction = taskAction
    followUp.directionDescription = directionDescription
    followUp.title = callbackTitle
    followUp.status = "pending"
    followUp.priority = "high"
    followUp.reminderSentAt = null
    followUp.dueNotificationSentAt = null
    followUp.productContext = productContext || followUp.productContext
    if (call._id) followUp.sourceCallId = call._id
    if (analysis._id) followUp.aiAnalysisId = analysis._id
    followUp.metadata = {
      ...(followUp.metadata || {}),
      callbackDirection,
      direction,
      taskAction,
      directionDescription,
      rescheduledVia: "AI_CALL_INTELLIGENCE",
    }
    followUp.notes = `Requested via AI Call Intelligence: ${reason}. Action: ${taskAction}${productContext ? " | Product: " + productContext : ""}`
    await followUp.save()
  } else {
    // Create new FollowUp record
    followUp = new FollowUp({
      tenantId: effectiveTenantId,
      leadId: targetLead._id,
      assignedTo: assignedTo && assignedTo !== "unassigned" ? assignedTo : (call.agentName || "Agent"),
      assignedStaffId: assignedStaffId && assignedStaffId !== "unassigned" ? assignedStaffId : (call.agentId ? call.agentId.toString() : "unassigned"),
      title: callbackTitle,
      notes: `Requested via AI Call Intelligence: ${reason}. Action: ${taskAction}${productContext ? " | Product: " + productContext : ""}`,
      scheduledAt,
      callbackAt: scheduledAt,
      callbackTimezone: timezone,
      callbackReason: reason,
      callbackDirection,
      direction,
      taskAction,
      directionDescription,
      productContext,
      customerName,
      customerPhone,
      type: "call",
      priority: "high",
      status: "pending",
      sourceCallId: call._id || null,
      idempotencyKey: `ai_fu_${targetLead._id}_${call._id}`,
      aiAnalysisId: analysis._id || null,
      createdBy: actor?.name || "AI Call Intelligence",
      metadata: {
        callbackDirection,
        direction,
        taskAction,
        directionDescription,
        scheduledVia: "AI_CALL_INTELLIGENCE",
      },
    })
    await followUp.save()
  }

  // 5. Update analysis record with linked followUpId
  if (analysis._id) {
    try {
      await AICallAnalysis.findByIdAndUpdate(analysis._id, {
        scheduledFollowUpId: followUp._id,
      })
    } catch (_) {}
  }

  // 6. Synchronize Lead document fields
  targetLead.nextFollowUpDate = scheduledAt
  targetLead.followUpStatus = "scheduled"

  // Ensure lead status is at least 'Engaged' if it was 'New'
  if (targetLead.status === "New") {
    targetLead.status = "Engaged"
  }

  targetLead.metadata = targetLead.metadata || {}
  targetLead.metadata.lastScheduledCallbackAt = scheduledAt
  targetLead.metadata.lastCallbackReason = reason
  targetLead.markModified("metadata")
  await targetLead.save()

  // 7. Record discrete Activity Timeline event
  try {
    await activity.record({
      tenantId: effectiveTenantId,
      leadId: targetLead._id,
      type: "lead.followup_created",
      actor: {
        name: actor?.name || "AI Call Intelligence",
        role: actor?.role || "system",
        email: actor?.email || "",
        id: actor?.id || null,
      },
      payload: {
        followUpId: followUp._id.toString(),
        title: followUp.title,
        scheduledAt: followUp.scheduledAt,
        callbackAt: followUp.callbackAt,
        callbackTimezone: timezone,
        reason,
        productContext,
        voiceConfirmation: analysis.voiceConfirmation || "",
        isRescheduled,
        previousScheduledAt,
        sourceCallId: call?._id ? call._id.toString() : null,
      },
    })
  } catch (actErr) {
    console.warn("[AICallbackScheduling] Warning recording activity:", actErr.message)
  }

  // 8. Dispatch Push Notification to assigned employee's active mobile devices
  const agentId = (followUp.assignedStaffId && followUp.assignedStaffId !== "unassigned" && mongoose.Types.ObjectId.isValid(followUp.assignedStaffId))
    ? followUp.assignedStaffId
    : (targetLead.assignedStaffId && mongoose.Types.ObjectId.isValid(targetLead.assignedStaffId)
      ? targetLead.assignedStaffId
      : (mongoose.Types.ObjectId.isValid(targetLead.assignedTo) ? targetLead.assignedTo : null))
  let pushResult = null
  if (agentId && agentId !== "unassigned") {
    try {
      pushResult = await pushNotificationService.sendCallbackScheduledNotification({
        followUp,
        lead: targetLead,
        agentId: String(agentId),
        tenantId: effectiveTenantId,
      })
    } catch (pushErr) {
      console.warn("[AICallbackScheduling] Push notification notice:", pushErr.message)
    }
  }

  // 9. Audit Logging
  if (audit && typeof audit.log === "function") {
    audit.log({
      tenantId: effectiveTenantId,
      action: isRescheduled ? "callback.rescheduled" : "callback.scheduled",
      category: "ai_call_intelligence",
      entity: "FollowUp",
      entityId: followUp._id,
      summary: `${isRescheduled ? "Rescheduled" : "Scheduled"} AI Callback for ${customerName} at ${humanTime}`,
      details: {
        followUpId: followUp._id,
        leadId: targetLead._id,
        callId: call?._id || null,
        scheduledAt,
        timezone,
        reason,
        isRescheduled,
        pushDispatched: Boolean(pushResult),
      },
    }).catch(() => {})
  }

  return {
    success: true,
    scheduled: true,
    isRescheduled,
    followUpId: followUp._id,
    scheduledAt,
    timezone,
    humanTime,
    voiceConfirmation: analysis.voiceConfirmation || "",
    leadId: targetLead._id,
    pushDispatched: Boolean(pushResult),
  }
}

/**
 * Completes a callback task and updates the associated lead.
 */
async function completeCallbackTask({
  followUpId,
  completionNotes = "",
  user = null,
  tenantId = null,
}) {
  if (!followUpId) {
    throw new Error("followUpId is required to complete callback task")
  }

  const query = { _id: followUpId }
  if (tenantId) query.tenantId = tenantId

  const followUp = await FollowUp.findOne(query).setOptions({ skipTenantFilter: true })
  if (!followUp) {
    throw new Error(`FollowUp '${followUpId}' not found`)
  }

  followUp.status = "completed"
  followUp.completedAt = new Date()
  followUp.completedBy = user?.name || user?.email || "User"
  followUp.completionNotes = typeof completionNotes === "string" ? completionNotes.trim() : ""
  await followUp.save()

  // Recalculate lead nextFollowUpDate
  if (followUp.leadId) {
    const remainingPending = await FollowUp.findOne({
      tenantId: followUp.tenantId,
      leadId: followUp.leadId,
      status: { $in: ["pending", "due"] },
      deletedAt: null,
    }).sort({ scheduledAt: 1 }).setOptions({ skipTenantFilter: true })

    const updateFields = remainingPending
      ? { nextFollowUpDate: remainingPending.scheduledAt, followUpStatus: remainingPending.status === "due" ? "due" : "scheduled" }
      : { nextFollowUpDate: null, followUpStatus: "completed" }

    await Lead.findByIdAndUpdate(followUp.leadId, updateFields).catch(() => {})

    // Record discrete activity
    try {
      await activity.record({
        tenantId: followUp.tenantId,
        leadId: followUp.leadId,
        type: "lead.followup_completed",
        actor: {
          name: user?.name || "User",
          role: user?.role || "user",
          email: user?.email || "",
          id: user?._id || user?.id || null,
        },
        payload: {
          followUpId: followUp._id.toString(),
          title: followUp.title,
          completionNotes: followUp.completionNotes,
          completedAt: followUp.completedAt,
        },
      })
    } catch (_) {}
  }

  return {
    success: true,
    followUpId: followUp._id,
    status: "completed",
  }
}

/**
 * Resolves the agent's User ID (ObjectId string) for mobile FCM notification dispatch.
 */
async function resolveFollowUpAgentId(task) {
  if (task.assignedStaffId && task.assignedStaffId !== "unassigned" && mongoose.Types.ObjectId.isValid(task.assignedStaffId)) {
    return task.assignedStaffId.toString()
  }
  const nameOrEmail = task.assignedTo || task.leadId?.assignedTo
  if (!nameOrEmail || nameOrEmail === "Unassigned" || nameOrEmail === "unassigned") {
    return null
  }
  if (mongoose.Types.ObjectId.isValid(nameOrEmail)) {
    return nameOrEmail.toString()
  }
  try {
    const User = mongoose.models.User || require("../models/User")
    const query = {
      $or: [{ name: nameOrEmail }, { email: nameOrEmail }],
    }
    if (task.tenantId) query.tenantId = task.tenantId
    const user = await User.findOne(query).select("_id").lean()
    return user ? user._id.toString() : null
  } catch (_) {
    return null
  }
}

/**
 * Scans the database and dispatches upcoming (5-minute), due-now, and overdue reminders.
 * Runs periodically in background queue / scheduler.
 * Database-backed: immune to server restarts, never fires duplicate alerts.
 */
async function checkAndDispatchDueReminders() {
  const now = new Date()
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)

  let reminder5MinCount = 0
  let dueNowCount = 0
  let overdueCount = 0

  try {
    // 1. Scan for 5-minute pre-reminders
    // Status pending, scheduledAt/callbackAt <= now + 5 mins, > now, reminderSentAt is null
    const upcomingTasks = await FollowUp.find({
      status: "pending",
      deletedAt: null,
      $or: [
        { scheduledAt: { $lte: fiveMinutesFromNow, $gt: now } },
        { callbackAt: { $lte: fiveMinutesFromNow, $gt: now } },
      ],
      reminderSentAt: null,
    }).populate("leadId").setOptions({ skipTenantFilter: true })

    for (const task of upcomingTasks) {
      task.reminderSentAt = new Date()
      await task.save()

      const agentId = await resolveFollowUpAgentId(task)
      if (agentId) {
        await pushNotificationService.sendCallbackReminderNotification({
          followUp: task,
          lead: task.leadId || { name: task.customerName, phone: task.customerPhone },
          agentId: String(agentId),
          tenantId: task.tenantId,
          reminderType: "5_MINUTES_BEFORE",
        }).catch(() => {})
      }
      reminder5MinCount++
    }

    // 2. Scan for Due-Now reminders
    // Status pending or due, scheduledAt/callbackAt <= now, >= oneDayAgo, dueNotificationSentAt is null
    const dueTasks = await FollowUp.find({
      status: { $in: ["pending", "due"] },
      deletedAt: null,
      $or: [
        { scheduledAt: { $lte: now, $gte: oneDayAgo } },
        { callbackAt: { $lte: now, $gte: oneDayAgo } },
      ],
      dueNotificationSentAt: null,
    }).populate("leadId").setOptions({ skipTenantFilter: true })

    for (const task of dueTasks) {
      task.status = "due"
      task.dueNotificationSentAt = new Date()
      await task.save()

      // Update lead followUpStatus
      if (task.leadId?._id) {
        await Lead.findByIdAndUpdate(task.leadId._id, { followUpStatus: "due" }).catch(() => {})
      }

      const agentId = await resolveFollowUpAgentId(task)
      if (agentId) {
        await pushNotificationService.sendCallbackReminderNotification({
          followUp: task,
          lead: task.leadId || { name: task.customerName, phone: task.customerPhone },
          agentId: String(agentId),
          tenantId: task.tenantId,
          reminderType: "DUE_NOW",
        }).catch(() => {})
      }
      dueNowCount++
    }

    // 3. Scan for Overdue reminders
    // Status pending or due, scheduledAt/callbackAt <= tenMinutesAgo, >= oneDayAgo, overdueNotificationSentAt is null
    const overdueTasks = await FollowUp.find({
      status: { $in: ["pending", "due"] },
      deletedAt: null,
      $or: [
        { scheduledAt: { $lte: tenMinutesAgo, $gte: oneDayAgo } },
        { callbackAt: { $lte: tenMinutesAgo, $gte: oneDayAgo } },
      ],
      overdueNotificationSentAt: null,
    }).populate("leadId").setOptions({ skipTenantFilter: true })

    for (const task of overdueTasks) {
      task.overdueNotificationSentAt = new Date()
      await task.save()

      const agentId = await resolveFollowUpAgentId(task)
      if (agentId) {
        await pushNotificationService.sendCallbackReminderNotification({
          followUp: task,
          lead: task.leadId || { name: task.customerName, phone: task.customerPhone },
          agentId: String(agentId),
          tenantId: task.tenantId,
          reminderType: "OVERDUE",
        }).catch(() => {})
      }
      overdueCount++
    }
  } catch (err) {
    console.error("[AICallbackScheduling] Error in checkAndDispatchDueReminders:", err.message)
  }

  return {
    reminder5MinCount,
    dueNowCount,
    overdueCount,
  }
}

module.exports = {
  scheduleAutomaticCallbackFromAiCall,
  completeCallbackTask,
  checkAndDispatchDueReminders,
  formatHumanDateTime,
}
