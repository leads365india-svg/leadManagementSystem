require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const mongoose = require("mongoose")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const { Activity } = require("../models/Activity")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { processCallIntelligenceJob } = require("../services/aiCallProcessingPipeline")
const {
  mapAiOutlineToLeadStatus,
  evaluateStatusTransition,
  resolveLeadForCall,
  syncLeadPipelineStatusFromAiCall,
  markProposalSent,
  markClosedWon,
  OUTCOME_TO_PIPELINE_MAP,
  NON_UPDATING_OUTCOMES,
} = require("../services/leadPipelineSync.service")

const TEST_ID = `sync_${Date.now()}`
const TENANT_A = `ACC-SYNC-A-${TEST_ID}`
const TENANT_B = `ACC-SYNC-B-${TEST_ID}`

let testUserA, testUserB
const results = []

const record = (name, passed, detail = "") => {
  results.push({ name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (!passed && detail) {
    console.log(`     Error: ${detail}`)
  }
}

// Helpers to query tenant-scoped models during test assertion
const findLead = (id) => Lead.findById(id).setOptions({ skipTenantFilter: true })
const findCall = (id) => Call.findById(id).setOptions({ skipTenantFilter: true })
const findActivity = (query) => Activity.findOne(query).setOptions({ skipTenantFilter: true })
const countActivities = (query) => Activity.countDocuments(query).setOptions({ skipTenantFilter: true })

async function cleanup() {
  try {
    const tenants = [TENANT_A, TENANT_B]
    await Lead.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Call.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Activity.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AICallAnalysis.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AITranscript.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runTests() {
  console.log("\n=======================================================")
  console.log("   AI CALL INTELLIGENCE -> CRM PIPELINE STATUS SYNC   ")
  console.log("=======================================================\n")

  await connectDB()

  try {
    await cleanup()

    testUserA = await User.create({
      tenantId: TENANT_A,
      name: "Agent A",
      email: `agent_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    testUserB = await User.create({
      tenantId: TENANT_B,
      name: "Agent B",
      email: `agent_b_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    console.log("--- Suite 1: Mapping & Normalization Unit Rules ---")
    // 1. INTERESTED -> Engaged
    const s1 = mapAiOutlineToLeadStatus("INTERESTED")
    record("Mapping: 'INTERESTED' maps to 'Engaged'", s1 === "Engaged", `Got ${s1}`)

    // 2. POSITIVE -> Engaged
    const s2 = mapAiOutlineToLeadStatus("POSITIVE")
    record("Mapping: 'POSITIVE' maps to 'Engaged'", s2 === "Engaged", `Got ${s2}`)

    // 3. CALL_BACK_LATER -> Engaged (Tushar Chaudhary)
    const s3 = mapAiOutlineToLeadStatus("CALL_BACK_LATER")
    const s3_space = mapAiOutlineToLeadStatus("CALL BACK LATER")
    record(
      "Mapping: 'CALL_BACK_LATER' and 'CALL BACK LATER' map to 'Engaged'",
      s3 === "Engaged" && s3_space === "Engaged",
      `Got ${s3}, ${s3_space}`
    )

    // 4. NOT_INTERESTED -> Closed-Lost (Rahul rawat)
    const s4 = mapAiOutlineToLeadStatus("NOT_INTERESTED")
    const s4_space = mapAiOutlineToLeadStatus("not interested")
    record(
      "Mapping: 'NOT_INTERESTED' and 'not interested' map to 'Closed-Lost'",
      s4 === "Closed-Lost" && s4_space === "Closed-Lost",
      `Got ${s4}, ${s4_space}`
    )

    // 5. DECLINED -> Closed-Lost
    const s5 = mapAiOutlineToLeadStatus("DECLINED")
    record("Mapping: 'DECLINED' maps to 'Closed-Lost'", s5 === "Closed-Lost", `Got ${s5}`)

    // 6. DEAL_CLOSED -> Closed-Won
    const s6 = mapAiOutlineToLeadStatus("DEAL_CLOSED")
    record("Mapping: 'DEAL_CLOSED' maps to 'Closed-Won'", s6 === "Closed-Won", `Got ${s6}`)

    // 7. Non-pipeline / ambiguous outcomes return null
    const ambigOutcomes = ["NO_ANSWER", "UNKNOWN", "VOICEMAIL", "INVALID", "WRONG_NUMBER", "UNRESOLVED", "ESCALATED"]
    const ambigResults = ambigOutcomes.map((o) => mapAiOutlineToLeadStatus(o))
    const allNull = ambigResults.every((r) => r === null)
    record("Mapping: Ambiguous outcomes (NO_ANSWER, UNKNOWN, VOICEMAIL, INVALID, etc.) return null", allNull)

    console.log("\n--- Suite 2: Status Transition Protection Rules ---")
    // 8. New -> Engaged allowed
    const t8 = evaluateStatusTransition("New", "Engaged")
    record("Transition: 'New' -> 'Engaged' is allowed", t8.allowed === true)

    // 9. New -> Closed-Lost allowed
    const t9 = evaluateStatusTransition("New", "Closed-Lost")
    record("Transition: 'New' -> 'Closed-Lost' is allowed", t9.allowed === true)

    // 10. Proposal Sent + Engaged -> PRESERVED (no downgrade)
    const t10 = evaluateStatusTransition("Proposal Sent", "Engaged")
    record(
      "Transition: 'Proposal Sent' + 'Engaged' is BLOCKED and preserved",
      t10.allowed === false && t10.protected === true,
      `allowed=${t10.allowed}, reason=${t10.reason}`
    )

    // 11. Proposal Sent + Closed-Lost -> allowed (explicit rejection)
    const t11 = evaluateStatusTransition("Proposal Sent", "Closed-Lost")
    record(
      "Transition: 'Proposal Sent' + 'Closed-Lost' is allowed",
      t11.allowed === true,
      `allowed=${t11.allowed}`
    )

    // 12. Closed-Won + Engaged/Closed-Lost -> BLOCKED (never downgrade)
    const t12_a = evaluateStatusTransition("Closed-Won", "Engaged")
    const t12_b = evaluateStatusTransition("Closed-Won", "Closed-Lost")
    record(
      "Transition: 'Closed-Won' CANNOT be downgraded to Engaged or Closed-Lost",
      t12_a.allowed === false && t12_a.protected === true && t12_b.allowed === false && t12_b.protected === true,
      `t12_a=${t12_a.reason}, t12_b=${t12_b.reason}`
    )

    // 13. Closed-Lost + Engaged -> BLOCKED (AI cannot reopen)
    const t13 = evaluateStatusTransition("Closed-Lost", "Engaged")
    record(
      "Transition: 'Closed-Lost' CANNOT be reopened automatically by AI",
      t13.allowed === false && t13.protected === true,
      `allowed=${t13.allowed}, reason=${t13.reason}`
    )

    // 14. Idempotency: same status transition rejected as idempotent
    const t14 = evaluateStatusTransition("Engaged", "Engaged")
    record(
      "Transition: Same status ('Engaged' -> 'Engaged') flagged as idempotent",
      t14.allowed === false && t14.idempotent === true
    )

    console.log("\n--- Suite 3: End-to-End AI Analysis -> CRM Lead Status Sync ---")

    // Scenario 1: Tushar Chaudhary test fixture: New Lead + CALL_BACK_LATER -> Engaged
    const leadTushar = await Lead.create({
      tenantId: TENANT_A,
      name: "Tushar Chaudhary",
      phone: "+919876543210",
      phoneNormalized: "+919876543210",
      status: "New",
      source: "Inbound Call",
    })

    const callTushar = await Call.create({
      tenantId: TENANT_A,
      leadId: leadTushar._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543210",
      callOutcome: "Connected",
      direction: "inbound",
      duration: 120,
    })

    const transcriptTushar = await AITranscript.create({
      tenantId: TENANT_A,
      callId: callTushar._id,
      status: "COMPLETED",
      transcriptText: "Customer asked to call back later in the evening.",
    })

    const analysisTushar = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callTushar._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "CALL_BACK_LATER",
      sentiment: "NEUTRAL",
    })

    const syncTushar = await syncLeadPipelineStatusFromAiCall({
      call: callTushar,
      analysis: analysisTushar,
      tenantId: TENANT_A,
    })

    const updatedTushar = await findLead(leadTushar._id)
    const actTushar = await findActivity({ leadId: leadTushar._id, type: "lead.status_changed" })

    record(
      "Scenario 3 (Tushar Chaudhary): New Lead + CALL_BACK_LATER automatically updates status to 'Engaged'",
      syncTushar.success === true &&
      updatedTushar.status === "Engaged" &&
      updatedTushar.metadata?.lastCallOutcome === "CALL_BACK_LATER" &&
      updatedTushar.metadata?.statusHistory?.length === 1 &&
      updatedTushar.metadata?.statusHistory[0].toStatus === "Engaged" &&
      actTushar !== null &&
      actTushar.payload?.toStatus === "Engaged",
      `status=${updatedTushar?.status}, historyCount=${updatedTushar?.metadata?.statusHistory?.length}`
    )

    // Scenario 2: Rahul rawat test fixture: New Lead + NOT_INTERESTED -> Closed-Lost
    const leadRahul = await Lead.create({
      tenantId: TENANT_A,
      name: "Rahul rawat",
      phone: "+919876543211",
      phoneNormalized: "+919876543211",
      status: "New",
      source: "Cold Outreach",
    })

    const callRahul = await Call.create({
      tenantId: TENANT_A,
      leadId: leadRahul._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543211",
      callOutcome: "Connected",
      direction: "outbound",
      duration: 45,
    })

    const analysisRahul = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callRahul._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "NOT_INTERESTED",
      sentiment: "NEGATIVE",
    })

    const syncRahul = await syncLeadPipelineStatusFromAiCall({
      call: callRahul,
      analysis: analysisRahul,
      tenantId: TENANT_A,
    })

    const updatedRahul = await findLead(leadRahul._id)
    record(
      "Scenario 4 (Rahul rawat): New Lead + NOT_INTERESTED automatically updates status to 'Closed-Lost'",
      syncRahul.success === true &&
      updatedRahul.status === "Closed-Lost" &&
      updatedRahul.metadata?.lastCallOutcome === "NOT_INTERESTED",
      `status=${updatedRahul?.status}`
    )

    // Scenario 3: Sentiment Independence Rule
    // Customer was rude or frustrated (NEGATIVE sentiment), but asked to call back later (CALL_BACK_LATER outcome)
    const leadNegativeSentiment = await Lead.create({
      tenantId: TENANT_A,
      name: "Frustrated Customer",
      phone: "+919876543212",
      phoneNormalized: "+919876543212",
      status: "New",
    })

    const callNeg = await Call.create({
      tenantId: TENANT_A,
      leadId: leadNegativeSentiment._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543212",
    })

    const analysisNeg = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callNeg._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "CALL_BACK_LATER",
      sentiment: "NEGATIVE",
      sentimentScore: 0.15,
    })

    const syncNeg = await syncLeadPipelineStatusFromAiCall({
      call: callNeg,
      analysis: analysisNeg,
      tenantId: TENANT_A,
    })

    const updatedNeg = await findLead(leadNegativeSentiment._id)
    record(
      "Rule: NEGATIVE sentiment does NOT override CALL_BACK_LATER; status transitions to 'Engaged'",
      syncNeg.success === true && updatedNeg.status === "Engaged",
      `status=${updatedNeg?.status}`
    )

    // Scenario 4: Non-pipeline outcome (NO_ANSWER / VOICEMAIL) leaves status unchanged
    const leadNoAnswer = await Lead.create({
      tenantId: TENANT_A,
      name: "No Answer Lead",
      phone: "+919876543213",
      phoneNormalized: "+919876543213",
      status: "New",
    })

    const callNoAnswer = await Call.create({
      tenantId: TENANT_A,
      leadId: leadNoAnswer._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543213",
    })

    const analysisNoAnswer = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callNoAnswer._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "UNRESOLVED",
    })

    const syncNoAnswer = await syncLeadPipelineStatusFromAiCall({
      call: callNoAnswer,
      analysis: analysisNoAnswer,
      tenantId: TENANT_A,
    })

    const updatedNoAnswer = await findLead(leadNoAnswer._id)
    record(
      "Rule: Ambiguous/Unresolved outcome skips sync and preserves 'New' status",
      syncNoAnswer.skipped === true && updatedNoAnswer.status === "New",
      `skipped=${syncNoAnswer.skipped}, status=${updatedNoAnswer?.status}`
    )

    // Scenario 5: Incomplete / Failed analysis skips sync
    const analysisFailed = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callNoAnswer._id,
      transcriptId: transcriptTushar._id,
      status: "FAILED",
      callOutcome: "INTERESTED",
    })

    const syncFailed = await syncLeadPipelineStatusFromAiCall({
      call: callNoAnswer,
      analysis: analysisFailed,
      tenantId: TENANT_A,
    })
    record(
      "Rule: FAILED / Incomplete analysis skips sync and preserves status",
      syncFailed.skipped === true && syncFailed.reason.includes("requires 'COMPLETED'")
    )

    // Scenario 6: Proposal Sent stage preserved against downgrade to Engaged
    const leadProposal = await Lead.create({
      tenantId: TENANT_A,
      name: "Proposal Stage Client",
      phone: "+919876543214",
      phoneNormalized: "+919876543214",
      status: "Proposal Sent",
    })

    const callProposal = await Call.create({
      tenantId: TENANT_A,
      leadId: leadProposal._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543214",
    })

    const analysisProposalInterested = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callProposal._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "INTERESTED",
    })

    const syncProposalInterested = await syncLeadPipelineStatusFromAiCall({
      call: callProposal,
      analysis: analysisProposalInterested,
      tenantId: TENANT_A,
    })

    const updatedProposal = await findLead(leadProposal._id)
    record(
      "Rule: 'Proposal Sent' lead with INTERESTED outcome preserves 'Proposal Sent' (no downgrade to Engaged)",
      syncProposalInterested.skipped === true &&
      syncProposalInterested.protected === true &&
      updatedProposal.status === "Proposal Sent",
      `status=${updatedProposal?.status}, reason=${syncProposalInterested.reason}`
    )

    // Scenario 7: Closed-Won protection against AI downgrade
    const leadWon = await Lead.create({
      tenantId: TENANT_A,
      name: "Won Enterprise Client",
      phone: "+919876543215",
      phoneNormalized: "+919876543215",
      status: "Closed-Won",
    })

    const callWon = await Call.create({
      tenantId: TENANT_A,
      leadId: leadWon._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543215",
    })

    const analysisWon = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callWon._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "NOT_INTERESTED",
    })

    const syncWon = await syncLeadPipelineStatusFromAiCall({
      call: callWon,
      analysis: analysisWon,
      tenantId: TENANT_A,
    })

    const updatedWon = await findLead(leadWon._id)
    record(
      "Rule: 'Closed-Won' lead cannot be downgraded by AI to Closed-Lost or Engaged",
      syncWon.skipped === true &&
      syncWon.protected === true &&
      updatedWon.status === "Closed-Won",
      `status=${updatedWon?.status}`
    )

    // Scenario 8: Closed-Lost protection against AI reopening
    const leadLost = await Lead.create({
      tenantId: TENANT_A,
      name: "Lost Lead",
      phone: "+919876543216",
      phoneNormalized: "+919876543216",
      status: "Closed-Lost",
    })

    const callLost = await Call.create({
      tenantId: TENANT_A,
      leadId: leadLost._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876543216",
    })

    const analysisLost = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callLost._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "INTERESTED",
    })

    const syncLost = await syncLeadPipelineStatusFromAiCall({
      call: callLost,
      analysis: analysisLost,
      tenantId: TENANT_A,
    })

    const updatedLost = await findLead(leadLost._id)
    record(
      "Rule: 'Closed-Lost' lead cannot be reopened automatically by AI",
      syncLost.skipped === true &&
      syncLost.protected === true &&
      updatedLost.status === "Closed-Lost",
      `status=${updatedLost?.status}`
    )

    // Scenario 9: Phone number resolution fallback when call.leadId is null
    const leadPhoneMatch = await Lead.create({
      tenantId: TENANT_A,
      name: "Unlinked Contact",
      phone: "9876500001",
      phoneNormalized: "+919876500001",
      status: "New",
    })

    const callUnlinked = await Call.create({
      tenantId: TENANT_A,
      leadId: null, // intentionally null
      agentId: testUserA._id,
      number: "9876500001",
      phoneNormalized: "+919876500001",
      callOutcome: "Connected",
    })

    const analysisUnlinked = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callUnlinked._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "INTERESTED",
    })

    const syncUnlinked = await syncLeadPipelineStatusFromAiCall({
      call: callUnlinked,
      analysis: analysisUnlinked,
      tenantId: TENANT_A,
    })

    const updatedUnlinkedLead = await findLead(leadPhoneMatch._id)
    const updatedUnlinkedCall = await findCall(callUnlinked._id)
    record(
      "Resolution: Matches lead via phone fallback when call.leadId is null & links call",
      syncUnlinked.success === true &&
      syncUnlinked.matchMethod === "phone_exact_unique" &&
      updatedUnlinkedLead.status === "Engaged" &&
      String(updatedUnlinkedCall.leadId) === String(leadPhoneMatch._id),
      `matchMethod=${syncUnlinked.matchMethod}, status=${updatedUnlinkedLead?.status}, callLeadId=${updatedUnlinkedCall?.leadId}`
    )

    // Scenario 10: Ambiguous phone matching protection (multiple leads with same phone in tenant)
    const leadAmbig1 = await Lead.create({
      tenantId: TENANT_A,
      name: "Ambiguous Twin 1",
      phone: "+919876599999",
      phoneNormalized: "+919876599999",
      status: "New",
    })

    const leadAmbig2 = await Lead.create({
      tenantId: TENANT_A,
      name: "Ambiguous Twin 2",
      phone: "+919876599999",
      phoneNormalized: "+919876599999",
      status: "New",
    })

    const callAmbig = await Call.create({
      tenantId: TENANT_A,
      leadId: null,
      agentId: testUserA._id,
      phoneNormalized: "+919876599999",
    })

    const analysisAmbig = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: callAmbig._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "INTERESTED",
    })

    const syncAmbig = await syncLeadPipelineStatusFromAiCall({
      call: callAmbig,
      analysis: analysisAmbig,
      tenantId: TENANT_A,
    })

    const checkTwin1 = await findLead(leadAmbig1._id)
    const checkTwin2 = await findLead(leadAmbig2._id)
    record(
      "Resolution: Multiple matching leads abort automatic status update (both remain 'New')",
      syncAmbig.skipped === true &&
      syncAmbig.ambiguous === true &&
      checkTwin1.status === "New" &&
      checkTwin2.status === "New",
      `twin1=${checkTwin1?.status}, twin2=${checkTwin2?.status}`
    )

    // Scenario 11: Cross-tenant isolation enforcement
    // Call in Tenant B with phone matching Lead in Tenant A
    const leadTenantA = await Lead.create({
      tenantId: TENANT_A,
      name: "Tenant A VIP",
      phone: "+919876511111",
      phoneNormalized: "+919876511111",
      status: "New",
    })

    const callTenantB = await Call.create({
      tenantId: TENANT_B,
      leadId: null,
      agentId: testUserB._id,
      phoneNormalized: "+919876511111",
    })

    const analysisTenantB = await AICallAnalysis.create({
      tenantId: TENANT_B,
      callId: callTenantB._id,
      transcriptId: transcriptTushar._id,
      status: "COMPLETED",
      callOutcome: "INTERESTED",
    })

    const syncCrossTenant = await syncLeadPipelineStatusFromAiCall({
      call: callTenantB,
      analysis: analysisTenantB,
      tenantId: TENANT_B,
    })

    const checkTenantA = await findLead(leadTenantA._id)
    record(
      "Isolation: Tenant B call cannot modify Tenant A lead even with identical phone number",
      syncCrossTenant.skipped === true && checkTenantA.status === "New",
      `syncResult=${JSON.stringify(syncCrossTenant)}, leadStatus=${checkTenantA?.status}`
    )

    // Scenario 12: Idempotency check — second run does not duplicate history or activities
    const preCount = updatedTushar.metadata?.statusHistory?.length || 1
    const preActCount = await countActivities({ leadId: leadTushar._id })

    const syncTusharAgain = await syncLeadPipelineStatusFromAiCall({
      call: callTushar,
      analysis: analysisTushar,
      tenantId: TENANT_A,
    })

    const postTushar = await findLead(leadTushar._id)
    const postActCount = await countActivities({ leadId: leadTushar._id })

    record(
      "Idempotency: Re-processing identical outcome skips update without duplicate history or activities",
      syncTusharAgain.skipped === true &&
      syncTusharAgain.idempotent === true &&
      postTushar.metadata?.statusHistory?.length === preCount &&
      postActCount === preActCount,
      `preActs=${preActCount}, postActs=${postActCount}`
    )

    // Scenario 13: Proposal Sent Workflow Integration (markProposalSent)
    const leadForProposal = await Lead.create({
      tenantId: TENANT_A,
      name: "Quotation Target",
      phone: "+919876522222",
      phoneNormalized: "+919876522222",
      status: "Engaged",
    })

    const propResult1 = await markProposalSent({
      leadId: leadForProposal._id,
      tenantId: TENANT_A,
      user: testUserA,
      details: { quoteNumber: "Q-1049", amount: 75000 },
    })

    const checkPropLead1 = await findLead(leadForProposal._id)
    const propAct = await findActivity({ leadId: leadForProposal._id, type: "lead.status_changed" })

    // Duplicate call to markProposalSent
    const propResult2 = await markProposalSent({
      leadId: leadForProposal._id,
      tenantId: TENANT_A,
      user: testUserA,
      details: { quoteNumber: "Q-1049", amount: 75000 },
    })

    const checkPropLead2 = await findLead(leadForProposal._id)
    record(
      "Proposal Workflow: markProposalSent transitions lead to 'Proposal Sent', records history & is idempotent",
      propResult1.success === true &&
      checkPropLead1.status === "Proposal Sent" &&
      propAct !== null &&
      propAct.payload?.toStatus === "Proposal Sent" &&
      propResult2.idempotent === true &&
      checkPropLead2.metadata?.statusHistory?.length === 1,
      `status=${checkPropLead1?.status}, historyCount=${checkPropLead2?.metadata?.statusHistory?.length}`
    )

    // Scenario 14: Order Placed / Closed-Won Workflow (markClosedWon)
    const wonResult = await markClosedWon({
      leadId: leadForProposal._id,
      tenantId: TENANT_A,
      user: testUserA,
      details: { orderId: "ORD-9912", amount: 75000 },
    })

    const checkWonLead = await findLead(leadForProposal._id)
    record(
      "Order Placed Workflow: markClosedWon transitions lead to 'Closed-Won' and records history",
      wonResult.success === true && checkWonLead.status === "Closed-Won",
      `status=${checkWonLead?.status}`
    )

    // Scenario 15: Full Pipeline Integration through processCallIntelligenceJob
    const pipelineLead = await Lead.create({
      tenantId: TENANT_A,
      name: "Pipeline Full Flow Lead",
      phone: "+919876533333",
      phoneNormalized: "+919876533333",
      status: "New",
    })

    const pipelineCall = await Call.create({
      tenantId: TENANT_A,
      leadId: pipelineLead._id,
      agentId: testUserA._id,
      phoneNormalized: "+919876533333",
      hasRecording: true,
      recording: {
        status: "stored",
        duration: 90,
      },
    })

    // Pre-create transcript with text containing "interested" and "pricing"
    await AITranscript.create({
      tenantId: TENANT_A,
      callId: pipelineCall._id,
      version: 1,
      status: "COMPLETED",
      transcriptText: "Hello, I am very interested in your software. Please share quotation and pricing.",
      duration: 90,
    })

    const pipelineJobResult = await processCallIntelligenceJob({
      payload: {
        callId: pipelineCall._id.toString(),
        tenantId: TENANT_A,
        allowFallback: true,
      },
    })

    const finalPipelineLead = await findLead(pipelineLead._id)
    record(
      "Full Pipeline Integration: processCallIntelligenceJob automatically updates Lead status to 'Engaged'",
      pipelineJobResult.success === true &&
      pipelineJobResult.syncResult?.success === true &&
      finalPipelineLead.status === "Engaged" &&
      finalPipelineLead.metadata?.lastCallOutcome === "INTERESTED",
      `jobSuccess=${pipelineJobResult.success}, leadStatus=${finalPipelineLead?.status}, outcome=${finalPipelineLead?.metadata?.lastCallOutcome}`
    )

    console.log("\n--- Final Cleanup of Test Fixtures ---")
    await cleanup()
  } catch (err) {
    console.error("Test execution fatal error:", err)
    record("Execution completed without fatal errors", false, err.message)
  } finally {
    const passedCount = results.filter((r) => r.passed).length
    const failedCount = results.filter((r) => !r.passed).length
    console.log("\n=======================================================")
    console.log(`AI CALL PIPELINE SYNC SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (${results.length} total)`)
    console.log("=======================================================\n")

    await mongoose.disconnect()
    process.exit(failedCount > 0 ? 1 : 0)
  }
}

runTests()
