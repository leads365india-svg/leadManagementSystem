const mongoose = require("mongoose")
const dotenv = require("dotenv")
const jwt = require("jsonwebtoken")
const http = require("http")

const path = require("path")
dotenv.config({ path: path.resolve(__dirname, "../.env") })
dotenv.config()

const connectDB = require("../db/connection")
const { getJwtSecret } = require("../middleware/authMiddleware")
const User = require("../models/User")
const Account = require("../models/Account")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const AIKeywordTopic = require("../models/AIKeywordTopic")
const AITranscript = require("../models/AITranscript")
const AICallAnalysis = require("../models/AICallAnalysis")
const AIAgentScorecard = require("../models/AIAgentScorecard")
const AILeadPriority = require("../models/AILeadPriority")
const AIManagerRecommendation = require("../models/AIManagerRecommendation")
const AICoachingReview = require("../models/AICoachingReview")

const { generateCallCoachingReport } = require("../services/aiSalesCoaching.service")
const { computeAgentScorecard, listAgentScorecards } = require("../services/aiSalesScorecard.service")
const {
  evaluateLeadPriority,
  listLeadPriorities,
  acceptLeadPriority,
  dismissLeadPriority,
} = require("../services/aiLeadPriority.service")
const {
  getSalesIntelligenceDashboard,
  getTopicIntelligence,
} = require("../services/aiBusinessInsights.service")
const {
  generateRecommendationsForCall,
  listManagerRecommendations,
  updateRecommendationStatus,
  createCoachingReview,
  listCoachingReviews,
  completeCoachingReview,
} = require("../services/aiRecommendations.service")

const TEST_ID = `p4_${Date.now()}`
const TENANT_A = `ACC-P4-A-${Date.now()}`
const TENANT_B = `ACC-P4-B-${Date.now()}`

let passCount = 0
let failCount = 0

function record(name, condition, extra = "") {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`)
    passCount++
  } else {
    console.error(`  ❌ FAIL: ${name} ${extra}`)
    failCount++
  }
}

function generateAuthToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion || 1,
    },
    getJwtSecret(),
    { expiresIn: "2h" }
  )
}

function makeApiRequest({ method = "GET", path, token, body = null, port = 5000 }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : ""
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = ""
        res.on("data", (chunk) => (raw += chunk))
        res.on("end", () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {}
            resolve({ status: res.statusCode, data: parsed })
          } catch (_) {
            resolve({ status: res.statusCode, data: raw })
          }
        })
      }
    )
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function cleanup() {
  try {
    const tenants = [TENANT_A, TENANT_B]
    await AIAgentScorecard.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AILeadPriority.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AIManagerRecommendation.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AICoachingReview.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AICallAnalysis.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AITranscript.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AIKeywordTopic.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await FollowUp.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Lead.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Call.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ $or: [{ accountId: { $in: tenants } }, { tenantId: { $in: tenants } }] }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runTests() {
  console.log("\n=======================================================")
  console.log("   AI SALES INTELLIGENCE - PHASE 4 VERIFICATION SUITE   ")
  console.log("=======================================================\n")

  await connectDB()

  let adminUserA, regularAgentA, managerUserA, agentUserB
  let testLeadWon, testLeadLost, testLeadActive
  let testCallsA = []
  let testTopicA1, testTopicA2, testTopicPending

  try {
    // ---------------------------------------------------------
    // Setup Fixtures
    // ---------------------------------------------------------
    console.log("--- 1. Setting Up Test Fixtures & Accounts ---")
    await cleanup()

    // Users
    adminUserA = await User.create({
      tenantId: TENANT_A,
      name: "Admin Tenant A",
      email: `admin_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    managerUserA = await User.create({
      tenantId: TENANT_A,
      name: "Manager Tenant A",
      email: `manager_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "manager",
      status: "active",
    })

    regularAgentA = await User.create({
      tenantId: TENANT_A,
      name: "Agent Alice",
      email: `agent_alice_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    agentUserB = await User.create({
      tenantId: TENANT_B,
      name: "Agent Tenant B",
      email: `agent_b_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    // Leads (Real CRM conversion status distinction)
    testLeadWon = await Lead.create({
      tenantId: TENANT_A,
      name: "Enterprise Client Alpha",
      phone: "+919876543210",
      phoneNormalized: "+919876543210",
      status: "Closed-Won", // Actual won sale
      ownerId: regularAgentA._id,
      assignedStaffId: regularAgentA._id,
    })

    testLeadLost = await Lead.create({
      tenantId: TENANT_A,
      name: "Budget Corp Beta",
      phone: "+919876543211",
      phoneNormalized: "+919876543211",
      status: "Closed-Lost", // Actual lost opportunity
      ownerId: regularAgentA._id,
      assignedStaffId: regularAgentA._id,
    })

    testLeadActive = await Lead.create({
      tenantId: TENANT_A,
      name: "Growth Inquiries Gamma",
      phone: "+919876543212",
      phoneNormalized: "+919876543212",
      status: "Engaged", // In pipeline
      ownerId: regularAgentA._id,
      assignedStaffId: regularAgentA._id,
    })

    // Topics (Strict Phase 2 contract)
    testTopicA1 = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Enterprise Pricing & SLA",
      category: "Pricing",
      status: "APPROVED",
      primaryKeywords: ["pricing", "cost", "sla", "budget"],
    })

    testTopicA2 = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Cloud Integration Suite",
      category: "Features",
      status: "APPROVED",
      primaryKeywords: ["api", "integration", "crm", "sync"],
    })

    testTopicPending = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Draft Unapproved Topic",
      category: "Draft",
      status: "PENDING_APPROVAL",
      primaryKeywords: ["unapproved", "draft"],
    })

    // Calls for Agent Alice (3 calls to satisfy sample threshold >= 3)
    for (let i = 1; i <= 3; i++) {
      const call = await Call.create({
        tenantId: TENANT_A,
        agentId: regularAgentA._id,
        leadId: testLeadActive._id,
        customerNumber: `+91987654321${i}`,
        hasRecording: true,
        duration: 120 + i * 30,
        recording: { status: "stored", duration: 120 + i * 30 },
        startedAt: new Date(Date.now() - i * 3600000),
      })
      testCallsA.push(call)

      // Transcripts
      const transcript = await AITranscript.create({
        tenantId: TENANT_A,
        callId: call._id,
        duration: 120 + i * 30,
        status: "COMPLETED",
        language: "hi-en",
        transcriptText: `Agent: Hello, what are your core CRM requirements and budget? Customer: We need cloud integration and pricing details. Our concern is implementation cost. Agent: I understand, our Enterprise Pricing & SLA includes full setup. Let us schedule a follow up meeting tomorrow. Customer: Perfect, thank you.`,
        segments: [
          { speaker: "Agent", startTime: 0, endTime: 4, text: "Hello, what are your core CRM requirements and budget?" },
          { speaker: "Customer", startTime: 4, endTime: 9, text: "We need cloud integration and pricing details. Our concern is implementation cost." },
          { speaker: "Agent", startTime: 9, endTime: 15, text: "I understand, our Enterprise Pricing & SLA includes full setup." },
          { speaker: "Agent", startTime: 15, endTime: 20, text: "Let us schedule a follow up meeting tomorrow to finalize." },
          { speaker: "Customer", startTime: 20, endTime: 24, text: "Perfect, thank you." },
        ],
      })

      // Analyses
      await AICallAnalysis.create({
        tenantId: TENANT_A,
        callId: call._id,
        transcriptId: transcript._id,
        status: "COMPLETED",
        summary: `Call ${i}: Customer requested Enterprise Pricing & SLA and discussed implementation cost. Agreed to follow-up meeting.`,
        customerIntent: "Product Inquiry & Pricing",
        customerNeeds: ["Cloud integration", "CRM connectivity"],
        productInterests: ["Enterprise Pricing & SLA", "Cloud Integration Suite"],
        objections: ["Implementation cost", "Deployment timeline"],
        sentiment: "POSITIVE",
        sentimentScore: 0.85,
        callOutcome: i === 1 ? "INTERESTED" : "FOLLOW_UP_REQUIRED",
        keyMoments: [
          { timestamp: 9, description: "Addressed implementation cost with SLA terms", quote: "our Enterprise Pricing & SLA includes full setup" },
        ],
        nextSteps: ["Schedule follow up meeting tomorrow"],
        topicMatches: [
          {
            topicId: testTopicA1._id,
            topicName: testTopicA1.name,
            confidenceScore: 0.92,
            evidenceQuote: "our Enterprise Pricing & SLA includes full setup",
            timestamp: 9,
          },
        ],
      })
    }

    // Follow-ups
    await FollowUp.create([
      {
        tenantId: TENANT_A,
        leadId: testLeadActive._id,
        title: "Proposal Review Call",
        scheduledAt: new Date(Date.now() - 24 * 3600000), // Overdue!
        status: "pending",
        priority: "high",
        assignedStaffId: regularAgentA._id,
      },
      {
        tenantId: TENANT_A,
        leadId: testLeadWon._id,
        title: "Onboarding Kickoff",
        scheduledAt: new Date(Date.now() - 48 * 3600000),
        status: "completed",
        priority: "medium",
        assignedStaffId: regularAgentA._id,
      },
    ])

    record("Phase 4 test fixtures and sample calls initialized", testCallsA.length === 3)

    // ---------------------------------------------------------
    // Suite 1: Evidence-Backed AI Sales Coaching Engine
    // ---------------------------------------------------------
    console.log("\n--- Suite 1: AI Sales Coaching Engine ---")
    const coachingResult = await generateCallCoachingReport({
      call: testCallsA[0],
      tenantId: TENANT_A,
    })

    record("Coaching: Output contains dimensionScores object", typeof coachingResult.dimensionScores === "object")
    record("Coaching: Requirement discovery score evaluated accurately", coachingResult.dimensionScores.requirementDiscovery >= 70)
    record("Coaching: Next-step discipline evaluated accurately", coachingResult.dimensionScores.nextStepDiscipline >= 80)
    record("Coaching: Strengths include transcript quotes and timestamps", coachingResult.strengths.length > 0 && Boolean(coachingResult.strengths[0].evidenceQuote))
    record("Coaching: Suggested responses generated for objections", coachingResult.suggestedResponses.length > 0)
    record("Coaching: Recommended training topics provided", coachingResult.recommendedTrainingTopics.length > 0)

    // Insufficient evidence test
    const emptyTranscript = await AITranscript.create({
      tenantId: TENANT_A,
      callId: testCallsA[0]._id,
      duration: 5,
      status: "COMPLETED",
      transcriptText: "Agent: Hello.",
      segments: [{ speaker: "Agent", startTime: 0, endTime: 1, text: "Hello." }],
    })
    const insufficientCoaching = await generateCallCoachingReport({
      call: testCallsA[0],
      transcript: emptyTranscript,
      tenantId: TENANT_A,
    })
    record("Coaching: Short/empty transcript safely triggers 'NOT_ENOUGH_EVIDENCE'", insufficientCoaching.evidenceCoverage === "NOT_ENOUGH_EVIDENCE")

    // ---------------------------------------------------------
    // Suite 2: Agent Performance Scorecards
    // ---------------------------------------------------------
    console.log("\n--- Suite 2: Agent Performance Scorecards ---")

    // Test insufficient sample coverage for an agent with 0 calls
    const zeroCallScorecard = await computeAgentScorecard({
      tenantId: TENANT_A,
      agentId: managerUserA._id,
    })
    record("Scorecard: sampleSize < 3 marks sampleCoverage as 'INSUFFICIENT_SAMPLE'", zeroCallScorecard.sampleCoverage === "INSUFFICIENT_SAMPLE")
    record("Scorecard: Insufficient sample does not invent overallScore (remains null)", zeroCallScorecard.metrics.overallScore === null)

    // Test sufficient sample coverage for Agent Alice (sampleSize = 3)
    const aliceScorecard = await computeAgentScorecard({
      tenantId: TENANT_A,
      agentId: regularAgentA._id,
    })
    record("Scorecard: sampleSize >= 3 marks sampleCoverage as 'SUFFICIENT'", aliceScorecard.sampleCoverage === "SUFFICIENT" && aliceScorecard.sampleSize === 3)
    record("Scorecard: Normalized overallScore calculated between 0 and 100", aliceScorecard.metrics.overallScore >= 60 && aliceScorecard.metrics.overallScore <= 100)
    record("Scorecard: Real CRM conversion rate reflects Closed-Won leads", aliceScorecard.metrics.conversionRate !== null)

    const scorecardsList = await listAgentScorecards({ tenantId: TENANT_A })
    record("Scorecard: listAgentScorecards returns array with agent profiles populated", Array.isArray(scorecardsList) && scorecardsList.length >= 2)

    // ---------------------------------------------------------
    // Suite 3: Lead Prioritization & Action Hub
    // ---------------------------------------------------------
    console.log("\n--- Suite 3: Lead Prioritization & Action Hub ---")

    // Active lead with overdue follow-up should be evaluated as AT_RISK or HIGH_INTENT
    const priorityGamma = await evaluateLeadPriority({
      tenantId: TENANT_A,
      leadId: testLeadActive._id,
    })
    record("Lead Priority: Detects overdue follow-up or commercial intent category", priorityGamma.priorityCategory === "AT_RISK" || priorityGamma.priorityCategory === "HIGH_INTENT")
    record("Lead Priority: Factual reason is explainable and grounded", priorityGamma.reason.length > 10)
    record("Lead Priority: Factors array contains evidence", priorityGamma.factors.length > 0)

    // User accept priority recommendation (human in the loop)
    const acceptedPriority = await acceptLeadPriority({
      tenantId: TENANT_A,
      leadId: testLeadActive._id,
      userId: regularAgentA._id,
      actionTaken: "Scheduled priority touchpoint with client",
    })
    record("Lead Priority: User accept marks status 'ACCEPTED'", acceptedPriority.status === "ACCEPTED")

    // Verify lead status was NOT mutated automatically
    const leadAfterAccept = await Lead.findById(testLeadActive._id).setOptions({ skipTenantFilter: true })
    record("Lead Priority: AI recommendation acceptance preserves CRM lead status (no auto-mutation)", leadAfterAccept.status === "Engaged")

    // Closed-Won lead priority
    const priorityWon = await evaluateLeadPriority({
      tenantId: TENANT_A,
      leadId: testLeadWon._id,
    })
    record("Lead Priority: Closed-Won lead accurately categorized without false alerts", priorityWon.reason.includes("Closed-Won"))

    // ---------------------------------------------------------
    // Suite 4: Sales Performance Dashboard & Business Intelligence
    // ---------------------------------------------------------
    console.log("\n--- Suite 4: Sales Performance Dashboard Analytics ---")
    const dashboardData = await getSalesIntelligenceDashboard({ tenantId: TENANT_A })

    record("Dashboard: Returns verified KPI metrics", typeof dashboardData.kpis === "object")
    record("Dashboard: Analyzed calls count matches canonical deduplicated analyses", dashboardData.kpis.analyzedSalesCalls === 3)
    record("Dashboard: Real CRM converted leads counts Closed-Won leads accurately", dashboardData.kpis.convertedLeads === 1)
    record("Dashboard: Real CRM lost opportunities counts Closed-Lost leads accurately", dashboardData.kpis.lostOpportunities === 1)
    record("Dashboard: Average call duration is positive and accurate", dashboardData.kpis.averageCallDuration > 0)
    record("Dashboard: Follow-up completion rate calculated accurately", dashboardData.kpis.followUpCompletionRate === 50)
    record("Dashboard: Conversion funnel stages constructed correctly", dashboardData.conversionFunnel.length === 4)
    record("Dashboard: Objection distribution aggregates recurring customer concerns", dashboardData.objectionDistribution.length > 0)
    record("Dashboard: Approved topic frequency aggregates matched topics", dashboardData.approvedTopicFrequency.length > 0)

    // ---------------------------------------------------------
    // Suite 5: Approved Topic Intelligence (Phase 2 Strict Contract)
    // ---------------------------------------------------------
    console.log("\n--- Suite 5: Approved Topic Intelligence ---")
    const topicIntel = await getTopicIntelligence({ tenantId: TENANT_A })

    record("Topic Intel: Includes total approved topics count", topicIntel.totalApprovedTopics === 2)
    record("Topic Intel: Frequently discussed approved topics detected", topicIntel.frequentlyDiscussed.some((t) => t.name === "Enterprise Pricing & SLA"))
    record("Topic Intel: Rarely discussed approved topics detected", topicIntel.rarelyDiscussed.some((t) => t.name === "Cloud Integration Suite"))
    record("Topic Intel: Strictly EXCLUDES draft/unapproved topics", !topicIntel.frequentlyDiscussed.some((t) => t.name.includes("Draft")) && !topicIntel.rarelyDiscussed.some((t) => t.name.includes("Draft")))

    // ---------------------------------------------------------
    // Suite 6: Manager Recommendations & Alert Center
    // ---------------------------------------------------------
    console.log("\n--- Suite 6: Manager Recommendations & Deduplication ---")
    const callAnalysis1 = await AICallAnalysis.findOne({ tenantId: TENANT_A, callId: testCallsA[0]._id }).setOptions({ skipTenantFilter: true })

    const recs = await generateRecommendationsForCall({
      call: testCallsA[0],
      analysis: callAnalysis1,
      tenantId: TENANT_A,
    })
    record("Recommendations: Creates alerts for high intent and objections", recs.length > 0)

    // Test deduplication
    const duplicateRecs = await generateRecommendationsForCall({
      call: testCallsA[0],
      analysis: callAnalysis1,
      tenantId: TENANT_A,
    })
    const recCount = await AIManagerRecommendation.countDocuments({
      tenantId: TENANT_A,
      callId: testCallsA[0]._id,
    }).setOptions({ skipTenantFilter: true })
    record("Recommendations: Idempotency key prevents duplicate alert creation", recCount === recs.length)

    // Status transition
    const updatedRec = await updateRecommendationStatus({
      tenantId: TENANT_A,
      id: recs[0]._id,
      status: "VIEWED",
      userId: managerUserA._id,
      managerNotes: "Reviewed during morning pipeline standup",
    })
    record("Recommendations: Status update transitions to 'VIEWED' with manager notes", updatedRec.status === "VIEWED" && updatedRec.managerNotes.includes("standup"))

    // ---------------------------------------------------------
    // Suite 7: Formal Manager Coaching Review 1-on-1 Workflow
    // ---------------------------------------------------------
    console.log("\n--- Suite 7: Manager Coaching 1-on-1 Workflow ---")
    const review = await createCoachingReview({
      tenantId: TENANT_A,
      agentId: regularAgentA._id,
      managerId: managerUserA._id,
      callId: testCallsA[0]._id,
      scorecardId: aliceScorecard._id,
      managerNotes: "Great objection handling on SLA terms. Work on locking in calendar invites on the call.",
      strengthsAcknowledged: ["Confidence in Enterprise Pricing", "Clear voice modulation"],
      improvementCommitments: ["Ask for calendar confirmation"],
      agreedActionItems: ["Complete objection handling refresh module"],
    })

    record("Coaching Review: Created with 'DISCUSSED' status and notes", review.status === "DISCUSSED" && review.managerNotes.length > 10)

    const completedReview = await completeCoachingReview({
      tenantId: TENANT_A,
      reviewId: review._id,
    })
    record("Coaching Review: Complete action marks status 'ACTION_COMPLETED'", completedReview.status === "ACTION_COMPLETED")

    // ---------------------------------------------------------
    // Suite 8: API Endpoints, Filters & RBAC Enforcement
    // ---------------------------------------------------------
    console.log("\n--- Suite 8: API Endpoints, Filters & RBAC ---")
    const adminTokenA = generateAuthToken(adminUserA)
    const agentTokenA = generateAuthToken(regularAgentA)
    const agentTokenB = generateAuthToken(agentUserB)

    // Dashboard Endpoint
    const dashRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/dashboard?dateRange=month",
      token: adminTokenA,
    })
    if (dashRes.status !== 200 || !dashRes.data.success) {
      console.log("DEBUG dashRes:", dashRes.status, dashRes.data)
    }
    record("API: GET /api/ai-sales-intelligence/dashboard returns 200 with KPIs", dashRes.status === 200 && dashRes.data.success)

    // Topics Endpoint
    const topicRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/topics",
      token: adminTokenA,
    })
    if (topicRes.status !== 200) {
      console.log("DEBUG topicRes:", topicRes.status, topicRes.data)
    }
    record("API: GET /api/ai-sales-intelligence/topics returns 200 with topic stats", topicRes.status === 200 && topicRes.data?.data?.totalApprovedTopics === 2)

    // Scorecards Endpoint
    const scRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/scorecards",
      token: adminTokenA,
    })
    record("API: GET /api/ai-sales-intelligence/scorecards returns 200", scRes.status === 200 && scRes.data.data.scorecards.length > 0)

    // Lead Priorities Endpoint
    const lpRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/lead-priorities",
      token: adminTokenA,
    })
    record("API: GET /api/ai-sales-intelligence/lead-priorities returns 200 with pagination", lpRes.status === 200 && lpRes.data.data.priorities.length > 0)

    // RBAC: Recommendations Endpoint (Manager/Admin Only)
    const recsAdminRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/recommendations",
      token: adminTokenA,
    })
    record("API RBAC: Admin receives 200 OK on recommendations center", recsAdminRes.status === 200)

    const recsAgentRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/recommendations",
      token: agentTokenA,
    })
    record("API RBAC: Regular agent receives 403 Forbidden on manager recommendations center", recsAgentRes.status === 403)

    // Unauthenticated request receives 401
    const unauthRes = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/dashboard",
      token: null,
    })
    record("API Auth: Unauthenticated request receives 401 Unauthorized", unauthRes.status === 401)

    // ---------------------------------------------------------
    // Suite 9: Strict Multi-Tenant Isolation
    // ---------------------------------------------------------
    console.log("\n--- Suite 9: Strict Multi-Tenant Isolation ---")

    // Tenant B fetching Tenant A's dashboard
    const dashResB = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/dashboard",
      token: agentTokenB,
    })
    if (dashResB.status !== 200 || dashResB.data?.data?.kpis?.analyzedSalesCalls !== 0) {
      console.log("DEBUG dashResB:", dashResB.status, dashResB.data)
    }
    record("Tenant Isolation: Tenant B dashboard reports 0 calls from Tenant A", dashResB.data?.data?.kpis?.analyzedSalesCalls === 0)

    // Tenant B fetching scorecards
    const scResB = await makeApiRequest({
      method: "GET",
      path: `/api/ai-sales-intelligence/scorecards/${regularAgentA._id}`,
      token: agentTokenB,
    })
    record("Tenant Isolation: Tenant B cannot access Tenant A agent scorecard (403/404)", scResB.status === 403 || scResB.status === 404)

    // Tenant B fetching recommendations
    const recResB = await makeApiRequest({
      method: "GET",
      path: "/api/ai-sales-intelligence/recommendations",
      token: agentTokenB,
    })
    record("Tenant Isolation: Tenant B cannot view Tenant A manager recommendations", recResB.status === 403 || recResB.data?.data?.recommendations?.length === 0)

    // ---------------------------------------------------------
    // Suite 10: Regression Testing (Core CRM & Prior Phases)
    // ---------------------------------------------------------
    console.log("\n--- Suite 10: Regression Testing (Core CRM & Prior Phases) ---")
    const phase1Res = await makeApiRequest({ method: "GET", path: "/api/ai-knowledge/profile", token: adminTokenA })
    record("Regression: Phase 1 Profile endpoint is operational", phase1Res.status === 200)

    const phase2Res = await makeApiRequest({ method: "GET", path: "/api/ai-keywords", token: adminTokenA })
    record("Regression: Phase 2 Keywords endpoint is operational", phase2Res.status === 200)

    const phase3Res = await makeApiRequest({ method: "GET", path: "/api/ai-calls/dashboard", token: adminTokenA })
    record("Regression: Phase 3 Call Intelligence dashboard is operational", phase3Res.status === 200)

    const leadCreateRes = await makeApiRequest({
      method: "POST",
      path: "/api/leads",
      token: adminTokenA,
      body: { name: "Phase 4 Regression Lead", phone: "+919999900004", email: "p4regression@example.com", status: "New" },
    })
    record("Regression: Core CRM Lead creation functions normally", leadCreateRes.status === 201)

    console.log("\n--- Final Cleanup of Test Fixtures ---")
    await cleanup()
  } catch (err) {
    console.error("Test execution aborted with error:", err)
    record("Fatal Test Exception", false, err.message)
  }

  console.log("\n=======================================================")
  console.log(`PHASE 4 VERIFICATION SUMMARY: ${passCount} PASSED, ${failCount} FAILED (${passCount + failCount} total)`)
  console.log("=======================================================\n")

  process.exit(failCount > 0 ? 1 : 0)
}

runTests().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
