const mongoose = require("mongoose")
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const { extractCallbackIntent } = require("../utils/callbackTimeExtractor")
const { evaluateProductRelevanceAndGate } = require("../services/aiProductRelevanceGate.service")
const { syncLeadPipelineStatusFromAiCall } = require("../services/leadPipelineSync.service")
const {
  scheduleAutomaticCallbackFromAiCall,
  completeCallbackTask,
  checkAndDispatchDueReminders,
  formatHumanDateTime,
} = require("../services/aiCallbackScheduling.service")
const pushNotificationService = require("../services/pushNotificationService")
const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const Device = require("../models/Device")
const { Activity } = require("../models/Activity")

/**
 * End-to-End Regression Test Suite:
 * Automatic AI Callback Scheduling, CRM Reminders, and Android Push Notifications
 */
async function runTests() {
  console.log("================================================================================")
  console.log("   AUTOMATIC AI CALLBACK SCHEDULING & REMINDERS VERIFICATION SUITE              ")
  console.log("================================================================================")

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI)
  }
  console.log("Connected to MongoDB Atlas\n")

  const tenantA = "ACC-TEST-TENANT-A"
  const tenantB = "ACC-TEST-TENANT-B"
  let passedCount = 0
  let failedCount = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      passedCount++
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      failedCount++
    }
  }

  // Cleanup test artifacts
  await FollowUp.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await Call.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await AICallAnalysis.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await Device.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
  pushNotificationService.clearDispatchedHistory()

  // Register a mock test device for agent in Tenant A
  const testAgentId = new mongoose.Types.ObjectId()
  await Device.create({
    userId: testAgentId,
    tenantId: tenantA,
    fcmToken: "mock-fcm-token-test-agent-12345",
    deviceModel: "Pixel 7 Pro",
    status: "ACTIVE",
    lastActiveAt: new Date(),
  })

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Natural Hindi Callback Extraction
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 1] Natural Hindi Callback Extraction ('Kal subah 11 baje call karna')")
  {
    const ref = new Date("2026-11-20T10:00:00.000Z")
    const res = extractCallbackIntent("Aap kal subah 11 baje call karna mujhe", {
      referenceTimestamp: ref,
      timezone: "Asia/Kolkata",
    })

    assert(res.callbackRequested === true, "Identified callback requested = true")
    assert(Boolean(res.requestedCallbackDateTime), "Extracted valid target date/time")
    assert(res.callbackLanguage === "hi" || res.callbackLanguage === "hinglish", "Detected Hindi / Hinglish language")
    assert(Boolean(res.voiceConfirmation), "Generated voice confirmation text")

    const parsedDate = new Date(res.requestedCallbackDateTime)
    const kolkataHour = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(parsedDate)
    assert(kolkataHour.includes("11"), `Target hour in Asia/Kolkata is 11 AM (got: ${kolkataHour})`)
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1B: Exact Hindi Customer Request ('Aap mujhe kal 11 baje call karo.')
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 1B] Exact Hindi Customer Request ('Aap mujhe kal 11 baje call karo.')")
  {
    const ref = new Date("2026-11-21T08:00:00.000Z")
    const res = extractCallbackIntent("Aap mujhe kal 11 baje call karo.", {
      referenceTimestamp: ref,
      timezone: "Asia/Kolkata",
      segments: [
        { speaker: "Customer", text: "Aap mujhe kal 11 baje call karo." },
      ],
    })

    assert(res.callbackRequested === true, "Identified callback requested = true")
    assert(res.callbackDirection === "AGENT_CALLBACK", `Direction is AGENT_CALLBACK (got: ${res.callbackDirection})`)
    assert(res.taskAction === "Call customer", `Task action is 'Call customer' (got: ${res.taskAction})`)
    const parsedDate = new Date(res.requestedCallbackDateTime)
    const kolkataParts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", day: "numeric", month: "numeric", hour12: false }).formatToParts(parsedDate)
    const pMap = {}
    kolkataParts.forEach((p) => { pMap[p.type] = p.value })
    assert(pMap.day === "22", `Scheduled date is 22 Nov (got: ${pMap.day})`)
    assert(pMap.hour === "11", `Scheduled hour is 11 AM (got: ${pMap.hour})`)
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Natural English Callback Extraction
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 2] Natural English Callback Extraction ('Tomorrow at 2:30 PM')")
  {
    const ref = new Date("2026-11-20T10:00:00.000Z")
    const res = extractCallbackIntent("Could you please call me back tomorrow at 2:30 PM for the demo?", {
      referenceTimestamp: ref,
      timezone: "Asia/Kolkata",
    })

    assert(res.callbackRequested === true, "Identified callback requested = true")
    assert(Boolean(res.requestedCallbackDateTime), "Extracted valid callback date/time")
    assert(res.callbackLanguage === "en", "Detected English language ('en')")
    const parsedDate = new Date(res.requestedCallbackDateTime)
    const kolkataTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "numeric" }).format(parsedDate)
    assert(kolkataTime.includes("2:30") && kolkataTime.toLowerCase().includes("pm"), `Target time is 2:30 PM (got: ${kolkataTime})`)
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Hinglish Relative Time Extraction ('30 minutes baad', 'Parso 10:30 baje')
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 3] Hinglish Relative Time Extraction ('30 minutes baad call karo')")
  {
    const ref = new Date("2026-11-20T10:00:00.000Z")
    const res = extractCallbackIntent("Main abhi meeting me hu, 30 minutes baad call karo", {
      referenceTimestamp: ref,
      timezone: "Asia/Kolkata",
    })

    assert(res.callbackRequested === true, "Identified relative callback requested")
    const parsedDate = new Date(res.requestedCallbackDateTime)
    const diffMins = Math.round((parsedDate.getTime() - ref.getTime()) / (60 * 1000))
    assert(diffMins === 30, `Scheduled exactly 30 minutes in the future (diff: ${diffMins} mins)`)
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: AI Voice Verbal Confirmation Generation
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 4] AI Voice Confirmation Sentence Generation")
  {
    const ref = new Date("2026-11-20T10:00:00.000Z")
    const hindiRes = extractCallbackIntent("Kal shaam 5 baje call karna", { referenceTimestamp: ref })
    assert(hindiRes.voiceConfirmation.includes("schedule") || hindiRes.voiceConfirmation.includes("callback"), "Generated verbal confirmation in customer tongue")

    const engRes = extractCallbackIntent("Call me back tomorrow at 11 AM", { referenceTimestamp: ref })
    assert(engRes.voiceConfirmation.toLowerCase().includes("callback has been scheduled"), "Generated English voice confirmation message")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Strict Product Relevance Gate Integration
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 5] Strict Product Relevance Gate Integration")
  {
    // Part A: Genuine HMS Inquiry + Callback
    const genuineTranscript = {
      transcriptText: "Hello, hume hospital management software aur OPD billing software lagwana hai, pricing demo chahiye. Aap kal subah 11 baje call karna.",
      segments: [
        { speaker: "Customer", text: "Hello, hume hospital management software aur OPD billing software lagwana hai, pricing demo chahiye. Aap kal subah 11 baje call karna." },
        { speaker: "Agent", text: "Bilkul sir, kal subah 11 baje hum aapko connect karenge." },
      ],
    }

    const genuineGate = await evaluateProductRelevanceAndGate({
      transcript: genuineTranscript,
      tenantId: tenantA,
      catalogOverride: {
        approvedKeywords: ["hospital management software", "opd billing", "hms"],
      },
    })

    assert(genuineGate.isProductRelevant === true, "Genuine call recognized as Product Relevant")
    assert(genuineGate.qualificationStatus === "QUALIFIED_FOLLOW_UP", "Status marked QUALIFIED_FOLLOW_UP")
    assert(genuineGate.callOutcome === "CALL_BACK_LATER", "Outcome marked CALL_BACK_LATER")
    assert(genuineGate.callbackRequested === true, "Callback request accepted for qualified call")

    // Part B: Out-of-Scope Recruitment Agency Call + Callback mention
    const outOfScopeTranscript = {
      transcriptText: "Hello Shahzad from Bado AI placement agency. Hiring ke regarding call kiya hai, vacancies chal rahi hain? Agent: Vacancies full hain. Customer: Theek hai hum kal subah 11 baje call karenge.",
      segments: [
        { speaker: "Customer", text: "Hello Shahzad from Bado AI placement agency. Hiring ke regarding call kiya hai, vacancies chal rahi hain?" },
        { speaker: "Agent", text: "Vacancies full hain." },
        { speaker: "Customer", text: "Theek hai hum kal subah 11 baje call karenge." },
      ],
    }

    const outOfScopeGate = await evaluateProductRelevanceAndGate({
      transcript: outOfScopeTranscript,
      tenantId: tenantA,
      catalogOverride: {
        approvedKeywords: ["hospital management software", "opd billing", "hms"],
      },
    })

    assert(outOfScopeGate.isProductRelevant === false, "Recruitment call is NOT product relevant")
    assert(outOfScopeGate.qualificationStatus === "DISQUALIFIED", "Status marked DISQUALIFIED")
    assert(outOfScopeGate.callOutcome === "NOT_INTERESTED", "Outcome marked NOT_INTERESTED")
    assert(outOfScopeGate.callbackRequested === false, "Callback task strictly suppressed for out-of-scope call")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Automatic CRM Lead Synchronization & Timeline Activity
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 6] Automatic CRM Lead Synchronization & Timeline Activity")
  {
    // Create Lead and Call
    const lead1 = await Lead.create({
      tenantId: tenantA,
      name: "Dr. Rakesh Sharma",
      phone: "+919876543210",
      phoneNormalized: "+919876543210",
      status: "New",
      assignedTo: testAgentId,
    })

    const call1 = await Call.create({
      tenantId: tenantA,
      leadId: lead1._id,
      agentId: testAgentId,
      phoneNumber: "+919876543210",
      startTime: new Date("2026-11-20T10:00:00Z"),
      callType: "INCOMING",
      status: "COMPLETED",
    })

    const targetDate = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const analysis1 = await AICallAnalysis.create({
      tenantId: tenantA,
      callId: call1._id,
      transcriptId: new mongoose.Types.ObjectId(),
      analysisVersion: 1,
      status: "COMPLETED",
      isProductRelevant: true,
      qualificationStatus: "QUALIFIED_FOLLOW_UP",
      callOutcome: "CALL_BACK_LATER",
      productInterests: ["Hospital Management Software", "OPD Billing"],
      callbackRequested: true,
      requestedCallbackDateTime: targetDate,
      callbackTimezone: "Asia/Kolkata",
      callbackReason: "HMS quotation and pricing walkthrough",
      voiceConfirmation: "Bilkul sir, callback schedule kar diya gaya hai.",
    })

    const syncResult = await syncLeadPipelineStatusFromAiCall({
      call: call1,
      analysis: analysis1,
      tenantId: tenantA,
    })

    assert(syncResult.success === true, "Pipeline sync returned success")
    assert(syncResult.toStatus === "Engaged", "Lead transitioned to Engaged")
    assert(Boolean(syncResult.followUpId), "Follow-up task created with valid ID")

    const updatedLead = await Lead.findById(lead1._id)
    assert(updatedLead.followUpStatus === "scheduled", "lead.followUpStatus set to 'scheduled'")
    assert(Boolean(updatedLead.nextFollowUpDate), "lead.nextFollowUpDate populated")

    const createdFollowUp = await FollowUp.findById(syncResult.followUpId)
    assert(createdFollowUp.status === "pending", "FollowUp status is 'pending'")
    assert(createdFollowUp.priority === "high", "FollowUp priority is 'high'")
    assert(createdFollowUp.callbackReason === "HMS quotation and pricing walkthrough", "Reason recorded")

    const timelineActivity = await Activity.findOne({
      tenantId: tenantA,
      leadId: lead1._id,
      type: "lead.followup_created",
    })
    assert(Boolean(timelineActivity), "Discrete timeline activity 'lead.followup_created' recorded")

    // Check push notification was dispatched to active agent devices
    const history = pushNotificationService.getDispatchedHistory()
    const scheduledPush = history.find((h) => h.type === "EVENT_CALLBACK_SCHEDULED")
    assert(Boolean(scheduledPush), "Android push notification dispatched: EVENT_CALLBACK_SCHEDULED")
    assert(scheduledPush.payload.data.leadName === "Dr. Rakesh Sharma", "Push payload contains customer name")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Idempotent Single Source of Truth / Smart Rescheduling
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 7] Idempotent Single Source of Truth & Rescheduling")
  {
    const lead1 = await Lead.findOne({ tenantId: tenantA, phone: "+919876543210" })
    const initialFollowUpCount = await FollowUp.countDocuments({ tenantId: tenantA, leadId: lead1._id })
    assert(initialFollowUpCount === 1, "Exactly one follow-up initially exists")

    // Customer calls back requesting a rescheduled time 2 days later
    const newTargetDate = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const call2 = await Call.create({
      tenantId: tenantA,
      leadId: lead1._id,
      agentId: testAgentId,
      phoneNumber: "+919876543210",
      startTime: new Date(),
      callType: "INCOMING",
      status: "COMPLETED",
    })

    const analysis2 = await AICallAnalysis.create({
      tenantId: tenantA,
      callId: call2._id,
      transcriptId: new mongoose.Types.ObjectId(),
      analysisVersion: 1,
      status: "COMPLETED",
      isProductRelevant: true,
      qualificationStatus: "QUALIFIED_FOLLOW_UP",
      callOutcome: "CALL_BACK_LATER",
      productInterests: ["Hospital Management Software"],
      callbackRequested: true,
      requestedCallbackDateTime: newTargetDate,
      callbackTimezone: "Asia/Kolkata",
      callbackReason: "Rescheduled: Customer requested 2 days later",
    })

    const reschedResult = await scheduleAutomaticCallbackFromAiCall({
      call: call2,
      analysis: analysis2,
      tenantId: tenantA,
      lead: lead1,
    })

    assert(reschedResult.isRescheduled === true, "Identified and handled as Reschedule")
    const finalFollowUpCount = await FollowUp.countDocuments({ tenantId: tenantA, leadId: lead1._id })
    assert(finalFollowUpCount === 1, "Single source of truth preserved: No duplicate follow-up created")

    const updatedFollowUp = await FollowUp.findById(reschedResult.followUpId)
    assert(
      Math.abs(updatedFollowUp.scheduledAt.getTime() - newTargetDate.getTime()) < 1000,
      "Follow-up scheduledAt updated to new time"
    )
    assert(updatedFollowUp.reminderSentAt === null, "Reminder sent flags reset after reschedule")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Database-Backed Reminder Scheduler & Server Restart Resilience
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 8] Database-Backed Reminder Scheduler & Restart Resilience")
  {
    pushNotificationService.clearDispatchedHistory()

    const leadUpcoming = await Lead.create({
      tenantId: tenantA,
      name: "Upcoming Prospect",
      phone: "+919888877771",
      status: "Engaged",
      assignedTo: testAgentId,
    })

    const leadDue = await Lead.create({
      tenantId: tenantA,
      name: "Due Now Prospect",
      phone: "+919888877772",
      status: "Engaged",
      assignedTo: testAgentId,
    })

    // Create a task due in 3 minutes (should trigger 5-minute pre-reminder)
    const upcomingTask = await FollowUp.create({
      tenantId: tenantA,
      leadId: leadUpcoming._id,
      assignedTo: testAgentId,
      customerName: "Upcoming Prospect",
      customerPhone: "+919888877771",
      title: "AI Callback: Upcoming Prospect",
      scheduledAt: new Date(Date.now() + 3 * 60 * 1000),
      status: "pending",
      priority: "high",
    })

    // Create a task due 2 minutes ago (should trigger Due Now reminder and status -> due)
    const dueTask = await FollowUp.create({
      tenantId: tenantA,
      leadId: leadDue._id,
      assignedTo: testAgentId,
      customerName: "Due Now Prospect",
      customerPhone: "+919888877772",
      title: "AI Callback: Due Now Prospect",
      scheduledAt: new Date(Date.now() - 2 * 60 * 1000),
      status: "pending",
      priority: "high",
    })

    // Run scheduler check
    const dispatch1 = await checkAndDispatchDueReminders()
    assert(dispatch1.reminder5MinCount >= 1, `Dispatched 5-minute pre-reminder (count: ${dispatch1.reminder5MinCount})`)
    assert(dispatch1.dueNowCount >= 1, `Dispatched Due-Now reminder (count: ${dispatch1.dueNowCount})`)

    const reloadedUpcoming = await FollowUp.findById(upcomingTask._id)
    assert(Boolean(reloadedUpcoming.reminderSentAt), "upcomingTask.reminderSentAt persisted in DB")

    const reloadedDue = await FollowUp.findById(dueTask._id)
    assert(reloadedDue.status === "due", "dueTask status updated to 'due'")
    assert(Boolean(reloadedDue.dueNotificationSentAt), "dueTask.dueNotificationSentAt persisted in DB")

    // Run scheduler check again (simulating immediate next tick or server reboot)
    const dispatch2 = await checkAndDispatchDueReminders()
    assert(dispatch2.reminder5MinCount === 0, "Idempotent: No duplicate 5-minute reminder sent")
    assert(dispatch2.dueNowCount === 0, "Idempotent: No duplicate Due-Now reminder sent")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Task Completion Lifecycle
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 9] Task Completion Lifecycle")
  {
    const lead1 = await Lead.findOne({ tenantId: tenantA, phone: "+919876543210" })
    const pendingFollowUp = await FollowUp.findOne({ tenantId: tenantA, leadId: lead1._id, status: "pending" })

    assert(Boolean(pendingFollowUp), "Found active pending follow-up")

    const completion = await completeCallbackTask({
      followUpId: pendingFollowUp._id,
      completionNotes: "Spoke with Dr. Sharma. Scheduled software walkthrough for Monday.",
      user: { name: "Agent Test", role: "sales_rep" },
      tenantId: tenantA,
    })

    assert(completion.success === true, "Task marked as completed successfully")

    const reloadedFollowUp = await FollowUp.findById(pendingFollowUp._id)
    assert(reloadedFollowUp.status === "completed", "Task status is 'completed'")
    assert(Boolean(reloadedFollowUp.completedAt), "completedAt recorded")

    const reloadedLead = await Lead.findById(lead1._id)
    assert(reloadedLead.followUpStatus === "completed", "lead.followUpStatus updated to 'completed'")
    assert(reloadedLead.nextFollowUpDate === null, "lead.nextFollowUpDate cleared")

    const completedActivity = await Activity.findOne({
      tenantId: tenantA,
      leadId: lead1._id,
      type: "lead.followup_completed",
    })
    assert(Boolean(completedActivity), "Timeline activity 'lead.followup_completed' recorded")
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Multi-Tenant Isolation & Role Scoping
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 10] Multi-Tenant Isolation & Scope Boundaries")
  {
    // Create lead and follow-up in Tenant B
    const leadB = await Lead.create({
      tenantId: tenantB,
      name: "Tenant B Lead",
      phone: "+919999900000",
      status: "New",
    })

    const followUpB = await FollowUp.create({
      tenantId: tenantB,
      leadId: leadB._id,
      customerName: "Tenant B Lead",
      customerPhone: "+919999900000",
      title: "Tenant B Callback",
      scheduledAt: new Date(Date.now() + 3600 * 1000),
      status: "pending",
      priority: "high",
    })

    // Tenant A queries follow-ups
    const tenantAFollowUps = await FollowUp.find({ tenantId: tenantA })
    const hasTenantBLeak = tenantAFollowUps.some((f) => String(f.tenantId) === tenantB)
    assert(!hasTenantBLeak, "Tenant A queries do not contain Tenant B callbacks")

    // Tenant A queries stats
    const tenantAStats = await FollowUp.countDocuments({ tenantId: tenantA, status: "completed" })
    assert(tenantAStats >= 1, "Tenant A stats reflect only Tenant A tasks")

    const tenantBStats = await FollowUp.countDocuments({ tenantId: tenantB, status: "completed" })
    assert(tenantBStats === 0, "Tenant B has 0 completed tasks, strictly isolated")
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================")
  console.log(`TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("================================================================================\n")

  await mongoose.disconnect()
  process.exit(failedCount === 0 ? 0 : 1)
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err)
  process.exit(1)
})
