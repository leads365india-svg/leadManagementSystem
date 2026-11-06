/**
 * Leads365 AI Receptionist — Phase 6 Verification Test Suite
 * 
 * Verifies CRM Lead, Call, Follow-up & Pipeline Integration:
 *  1. Search existing Lead by phone within tenant.
 *  2. Unknown caller creates a new Lead with E.164 normalization.
 *  3. Existing caller updates customer requirements without duplicate Lead creation.
 *  4. Idempotent execution: duplicate webhook calls return same lead.
 *  5. Schedule tenant-scoped follow-up task.
 *  6. Cross-tenant lead access rejection (Tenant B cannot access Tenant A's lead).
 *  7. Call linkage with duration, outcome, and pipeline synchronization.
 *  8. Status transition rules (e.g. POSITIVE/INTERESTED -> Engaged).
 *  9. Gemini tool call dispatch execution.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const {
  searchLeadByPhone,
  createOrUpdateLead,
  updateLeadRequirements,
  scheduleFollowup,
  linkCallToLead,
  executeCrmTool,
  inMemoryStore,
} = require("../services/telephony/receptionistCrmTools.service")

let passedCount = 0
let failedCount = 0

function test(name, fn) {
  try {
    fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

async function runPhase6Tests() {
  console.log("\n==================================================================")
  console.log("   LEADS365 AI RECEPTIONIST — PHASE 6 CRM INTEGRATION SUITE      ")
  console.log("==================================================================\n")

  inMemoryStore.clear()
  const TENANT_A = "ACC-TENANT-ALPHA"
  const TENANT_B = "ACC-TENANT-BETA"

  // Test 1: Unknown caller creates a new Lead
  await testAsync("1. Unknown caller creates a new Lead with E.164 normalization", async () => {
    const result = await createOrUpdateLead({
      tenantId: TENANT_A,
      phone: "+91 98765 43210",
      name: "Rohan Verma",
      email: "rohan@example.com",
      requirement: "Interested in 5kW solar rooftop installation",
      notes: "Caller sounded keen, requested pricing.",
    })

    assert.strictEqual(result.action, "created")
    assert(result.lead._id)
    assert.strictEqual(result.lead.phoneNormalized, "+919876543210")
    assert.strictEqual(result.lead.status, "New")
    assert.strictEqual(result.lead.source, "AI Receptionist")
    assert(result.lead.requirement.includes("5kW solar"))
  })

  // Test 2: Existing caller matches existing Lead without creating duplicate
  await testAsync("2. Existing caller matches existing Lead and updates requirements", async () => {
    const countBefore = inMemoryStore.leads.size

    const result = await createOrUpdateLead({
      tenantId: TENANT_A,
      phone: "09876543210", // Raw format should resolve to same E.164 +919876543210
      name: "Rohan Verma",
      requirement: "Updated: Also wants battery backup inverter",
      notes: "Follow-up discussion on storage.",
    })

    assert.strictEqual(result.action, "updated")
    assert.strictEqual(inMemoryStore.leads.size, countBefore, "Must not create a new lead document")
    assert(result.lead.notes.includes("battery backup"))
  })

  // Test 3: Search Lead by phone within tenant
  await testAsync("3. searchLeadByPhone finds lead by national or international format", async () => {
    const res1 = await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919876543210" })
    assert.strictEqual(res1.found, true)
    assert.strictEqual(res1.lead.name, "Rohan Verma")

    const res2 = await searchLeadByPhone({ tenantId: TENANT_A, phone: "9876543210" })
    assert.strictEqual(res2.found, true)

    const res3 = await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919999999999" })
    assert.strictEqual(res3.found, false)
  })

  // Test 4: Cross-tenant lead isolation
  await testAsync("4. Cross-tenant isolation: Tenant B cannot search or modify Tenant A lead", async () => {
    // Tenant B searches for Tenant A's lead number
    const res = await searchLeadByPhone({ tenantId: TENANT_B, phone: "+919876543210" })
    assert.strictEqual(res.found, false, "Tenant B must not see Tenant A lead")

    // Tenant B attempts to schedule follow-up on Tenant A's leadId
    const tenantALead = (await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919876543210" })).lead
    let securityErrorCaught = false
    try {
      await scheduleFollowup({
        tenantId: TENANT_B,
        leadId: tenantALead._id,
        scheduledAt: Date.now() + 86400000,
        note: "Hacker follow up",
      })
    } catch (err) {
      if (err.message.includes("not found in current tenant")) securityErrorCaught = true
    }
    assert(securityErrorCaught, "Should reject cross-tenant follow-up scheduling")
  })

  // Test 5: Scheduling tenant-scoped follow-up
  await testAsync("5. Schedules tenant-scoped follow-up task successfully", async () => {
    const tenantALead = (await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919876543210" })).lead
    const followUpDate = Date.now() + 2 * 86400000

    const fuResult = await scheduleFollowup({
      tenantId: TENANT_A,
      leadId: tenantALead._id,
      scheduledAt: followUpDate,
      note: "Call back to discuss 5kW quote with solar subsidy details",
      type: "call",
    })

    assert.strictEqual(fuResult.success, true)
    assert.strictEqual(fuResult.followUp.tenantId, TENANT_A)
    assert.strictEqual(fuResult.followUp.leadId, tenantALead._id)
    assert.strictEqual(fuResult.followUp.scheduledAtEpochMs, followUpDate)
  })

  // Test 6: Call linkage and pipeline sync
  await testAsync("6. Links Call to Lead and synchronizes pipeline stage (Engaged)", async () => {
    const tenantALead = (await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919876543210" })).lead

    const callResult = await linkCallToLead({
      tenantId: TENANT_A,
      callSid: "CA_test_call_6",
      phone: "+919876543210",
      leadId: tenantALead._id,
      durationSeconds: 145,
      callOutcome: "INTERESTED", // Pipeline sync maps INTERESTED -> Engaged
      notes: "Caller confirmed interest in residential subsidy.",
      transcript: "AI: Namaste! Caller: I want 5kW solar rooftop.",
    })

    assert.strictEqual(callResult.success, true)
    assert.strictEqual(callResult.call.clientCallId, "CA_test_call_6")
    assert.strictEqual(callResult.call.duration, 145)

    // Verify lead status transitioned from New to Engaged
    const updatedLead = (await searchLeadByPhone({ tenantId: TENANT_A, phone: "+919876543210" })).lead
    assert.strictEqual(updatedLead.status, "Engaged", "Lead pipeline stage should update to Engaged")
  })

  // Test 7: Controlled tool dispatcher execution
  await testAsync("7. executeCrmTool dispatcher routes function calls safely", async () => {
    const dispatchSearch = await executeCrmTool({
      tenantId: TENANT_A,
      name: "searchLeadByPhone",
      args: { phone: "+919876543210" },
    })
    assert.strictEqual(dispatchSearch.found, true)

    const dispatchUpdateReq = await executeCrmTool({
      tenantId: TENANT_A,
      name: "updateLeadRequirements",
      args: {
        leadId: dispatchSearch.lead._id,
        requirement: "Site survey requested for Saturday morning",
      },
    })
    assert.strictEqual(dispatchUpdateReq.success, true)
    assert(dispatchUpdateReq.lead.requirement.includes("Site survey requested"))

    const unknownTool = await executeCrmTool({
      tenantId: TENANT_A,
      name: "deleteCustomerDatabase",
      args: {},
    })
    assert.strictEqual(unknownTool.status, "unsupported")
  })

  console.log("\n==================================================================")
  console.log(`   PHASE 6 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("==================================================================\n")

  if (failedCount > 0) process.exit(1)
}

runPhase6Tests().catch((err) => {
  console.error("FATAL ERROR IN PHASE 6 TEST:", err)
  process.exit(1)
})

