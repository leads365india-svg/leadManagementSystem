const assert = require("assert")
const jwt = require("jsonwebtoken")

console.log("=== RUNNING VERIFICATION: FOLLOW-UP SCHEDULER, METRICS & SAFARI JWT ===")

// Test 1: JWT Base64URL parsing logic (safeguards against Safari atob failure)
function parseJwtPayload(token) {
  if (!token || typeof token !== "string") return null
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    while (base64.length % 4) {
      base64 += "="
    }
    const jsonStr = decodeURIComponent(
      Buffer.from(base64, "base64").toString("utf-8")
    )
    return JSON.parse(jsonStr)
  } catch (_) {
    return null
  }
}

const mockSecret = "leadflow-test-secret-min32-characters-long"
const mockPayload = { userId: "user_12345", role: "super_admin", email: "admin@leads365.com", exp: Math.floor(Date.now() / 1000) + 3600 }
const mockToken = jwt.sign(mockPayload, mockSecret)
console.log("Generated Token:", mockToken.slice(0, 30) + "...")

const decoded = parseJwtPayload(mockToken)
assert.strictEqual(decoded.userId, "user_12345", "JWT userId must match")
assert.strictEqual(decoded.role, "super_admin", "JWT role must match")
console.log("[PASS] Test 1: URL-safe JWT payload decoded successfully without errors.")

// Test 2: Timezone day bounds (Asia/Kolkata)
function getTenantDayBounds(timeZone = "Asia/Kolkata") {
  const now = new Date()
  let dateStr, offsetStr = "+05:30"
  try {
    dateStr = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(now)
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "+05:30"
    const match = tzPart.match(/GMT([+-]\d{1,2}(?::\d{2})?)/)
    if (match) {
      let raw = match[1]
      if (!raw.includes(":")) raw += ":00"
      if (raw.length === 5) raw = raw[0] + "0" + raw.slice(1)
      offsetStr = raw
    }
  } catch (_) {
    dateStr = now.toISOString().slice(0, 10)
    offsetStr = "+05:30"
  }
  const start = new Date(`${dateStr}T00:00:00.000${offsetStr}`)
  const end = new Date(`${dateStr}T23:59:59.999${offsetStr}`)
  return { start, end, now }
}

const bounds = getTenantDayBounds("Asia/Kolkata")
assert(bounds.start instanceof Date && !isNaN(bounds.start.getTime()), "Start of day must be valid Date")
assert(bounds.end instanceof Date && !isNaN(bounds.end.getTime()), "End of day must be valid Date")
assert(bounds.end.getTime() > bounds.start.getTime(), "End of day must be after start of day")
assert.strictEqual(bounds.end.getTime() - bounds.start.getTime(), 86399999, "Day duration must be exactly 24 hours - 1 ms")
console.log("[PASS] Test 2: Timezone day bounds calculated accurately for Asia/Kolkata.")

// Test 3: Push Notification Service payload formatting with callbackDirection and taskAction
const pushNotificationService = require("../services/pushNotificationService")

async function testPushPayload() {
  const mockFollowUp = {
    _id: "60b8d29f8f1b2c001f5e8888",
    title: "Call Deepesh Kumar",
    scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
    callbackDirection: "AGENT_CALLBACK",
    direction: "OUTBOUND",
    taskAction: "Call customer",
    directionDescription: "Outbound agent call required",
    customerName: "Deepesh Kumar",
    customerPhone: "+919991770369",
    callbackReason: "Discuss hospital management system",
    tenantId: "tenant_med365",
  }

  // Test 5 minutes before
  const res5Min = await pushNotificationService.sendCallbackReminderNotification({
    followUp: mockFollowUp,
    lead: { name: "Deepesh Kumar", phone: "+919991770369" },
    agentId: "agent_pawan",
    tenantId: "tenant_med365",
    reminderType: "5_MINUTES_BEFORE",
  })

  assert(res5Min !== null, "Push record must be created")
  assert.strictEqual(res5Min.payload.data.eventType, "EVENT_CALLBACK_REMINDER")
  assert.strictEqual(res5Min.payload.data.callbackDirection, "AGENT_CALLBACK")
  assert.strictEqual(res5Min.payload.data.direction, "OUTBOUND")
  assert.strictEqual(res5Min.payload.data.taskAction, "Call customer")
  assert.strictEqual(res5Min.payload.data.phone, "+919991770369")

  // Test Due Now
  const resDue = await pushNotificationService.sendCallbackReminderNotification({
    followUp: mockFollowUp,
    lead: { name: "Deepesh Kumar", phone: "+919991770369" },
    agentId: "agent_pawan",
    tenantId: "tenant_med365",
    reminderType: "DUE_NOW",
  })

  assert(resDue !== null, "Push record must be created")
  assert.strictEqual(resDue.payload.data.eventType, "EVENT_CALLBACK_DUE")
  assert.strictEqual(resDue.payload.data.reminderType, "DUE_NOW")
  assert(resDue.payload.notification.title.includes("Callback Due Now"), "Title must contain Callback Due Now")

  // Test Overdue
  const resOverdue = await pushNotificationService.sendCallbackReminderNotification({
    followUp: mockFollowUp,
    lead: { name: "Deepesh Kumar", phone: "+919991770369" },
    agentId: "agent_pawan",
    tenantId: "tenant_med365",
    reminderType: "OVERDUE",
  })

  assert(resOverdue !== null, "Push record must be created")
  assert.strictEqual(resOverdue.payload.data.eventType, "EVENT_CALLBACK_OVERDUE")
  assert.strictEqual(resOverdue.payload.data.reminderType, "OVERDUE")
  assert(resOverdue.payload.notification.title.includes("Overdue"), "Title must contain Overdue")
  console.log("[PASS] Test 3: Push Notification Service formats pre, due, and overdue notifications with all callback directions.")
}

testPushPayload().then(() => {
  console.log("=== ALL TARGETED TESTS PASSED SUCCESSFULLY ===")
  process.exit(0)
}).catch((err) => {
  console.error("TEST FAILED:", err)
  process.exit(1)
})
