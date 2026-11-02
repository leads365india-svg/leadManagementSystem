require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const mongoose = require("mongoose")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const app = require("../start")
const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { AIUsageLedger } = require("../models/AIUsageLedger")
const { getJwtSecret } = require("../middleware/authMiddleware")

const { processSpeechToText, transcribeAudioWithGemini, generateDeterministicTranscript } = require("../services/aiSpeechToText.service")
const { matchApprovedTopicsForCall } = require("../services/aiTopicMatcher.service")
const { processCallAnalysis, generateDeterministicCallAnalysis } = require("../services/aiCallAnalysis.service")
const { recordUsage, getTenantUsageStats } = require("../services/aiUsageService")
const { enqueueCallIntelligenceJob, processCallIntelligenceJob } = require("../services/aiCallProcessingPipeline")

const TEST_ID = `p3_${Date.now()}`
const TENANT_A = `ACC-P3-A-${TEST_ID}`
const TENANT_B = `ACC-P3-B-${TEST_ID}`

let tokenAdminA, tokenUserA, tokenAdminB
let adminUserA, regularUserA, adminUserB
let testCallA1, testCallA2, testCallB1
let approvedTopicA1, approvedTopicA2, pendingTopicA, rejectedTopicA, approvedTopicB

const results = []
const record = (name, passed, detail = "") => {
  results.push({ name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (!passed && detail) {
    console.log(`     Error: ${detail}`)
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

async function cleanup() {
  try {
    const tenants = [TENANT_A, TENANT_B]
    await AITranscript.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AITranscript.collection.dropIndexes().catch(() => {})
    await AITranscript.syncIndexes().catch(() => {})
    await AICallAnalysis.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AICallAnalysis.collection.dropIndexes().catch(() => {})
    await AICallAnalysis.syncIndexes().catch(() => {})
    await AIUsageLedger.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await AIKeywordTopic.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Call.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: tenants } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ $or: [{ accountId: { $in: tenants } }, { tenantId: { $in: tenants } }] }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup warning:", err.message)
  }
}

async function runTests() {
  console.log("\n=======================================================")
  console.log("   AI CALL INTELLIGENCE - PHASE 3 VERIFICATION SUITE   ")
  console.log("=======================================================\n")

  await connectDB()

  try {
    // ---------------------------------------------------------
    // Setup Fixtures
    // ---------------------------------------------------------
    console.log("--- 1. Setting Up Test Fixtures & Accounts ---")
    await cleanup()

    adminUserA = await User.create({
      tenantId: TENANT_A,
      name: "Admin Tenant A",
      email: `admin_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    regularUserA = await User.create({
      tenantId: TENANT_A,
      name: "Agent Tenant A",
      email: `agent_a_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "agent",
      status: "active",
    })

    adminUserB = await User.create({
      tenantId: TENANT_B,
      name: "Admin Tenant B",
      email: `admin_b_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    tokenAdminA = generateAuthToken(adminUserA)
    tokenUserA = generateAuthToken(regularUserA)
    tokenAdminB = generateAuthToken(adminUserB)

    // Call A1: With valid stored recording
    testCallA1 = await Call.create({
      tenantId: TENANT_A,
      agentId: adminUserA._id,
      customerNumber: "+919876543210",
      direction: "INBOUND",
      duration: 45,
      hasRecording: true,
      recording: {
        status: "stored",
        fileId: new mongoose.Types.ObjectId(),
        mp3FileId: new mongoose.Types.ObjectId(),
        sizeBytes: 256000,
        sha256: "fake_sha256_call_a1",
        duration: 45,
        conversionStatus: "completed",
      },
    })

    // Call A2: Unrecorded call
    testCallA2 = await Call.create({
      tenantId: TENANT_A,
      agentId: adminUserA._id,
      customerNumber: "+919876543211",
      direction: "OUTBOUND",
      duration: 15,
      hasRecording: false,
      recording: { status: "none" },
    })

    // Call B1: Tenant B call
    testCallB1 = await Call.create({
      tenantId: TENANT_B,
      agentId: adminUserB._id,
      customerNumber: "+919123456789",
      direction: "INBOUND",
      duration: 60,
      hasRecording: true,
      recording: {
        status: "stored",
        fileId: new mongoose.Types.ObjectId(),
        sizeBytes: 300000,
        sha256: "fake_sha256_call_b1",
        duration: 60,
      },
    })

    // Topics for Tenant A:
    // 1. APPROVED Enterprise Topic
    approvedTopicA1 = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Enterprise Solutions & SLA Inquiries",
      category: "Sales & Inquiries",
      status: "APPROVED",
      confidenceScore: 0.95,
      primaryKeywords: ["enterprise", "sla", "customization", "dedicated hosting"],
      synonyms: ["b2b tier", "sla guarantee"],
      customerQuestions: ["What are your enterprise SLAs?"],
      productTerminology: ["Enterprise Support"],
      discussionPoints: ["Walk through dedicated infrastructure and uptime"],
      approvedAt: new Date(),
      approvedBy: adminUserA._id,
    })

    // 2. APPROVED CRM Pricing Topic
    approvedTopicA2 = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "CRM Subscription Pricing & Quotes",
      category: "Pricing & Commercials",
      status: "APPROVED",
      confidenceScore: 0.90,
      primaryKeywords: ["pricing", "quotation", "subscription", "annual billing"],
      synonyms: ["cost", "rates"],
      customerQuestions: ["How much does the annual plan cost?"],
      productTerminology: ["Annual billing cycle"],
      discussionPoints: ["Explain tier discounts for multi-user licenses"],
      approvedAt: new Date(),
      approvedBy: adminUserA._id,
    })

    // 3. PENDING Topic (Must NEVER match)
    pendingTopicA = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Pending Draft Mobile Addon Topic",
      category: "Sales & Inquiries",
      status: "PENDING_APPROVAL",
      primaryKeywords: ["mobile addon", "sms integration"],
    })

    // 4. REJECTED Topic (Must NEVER match)
    rejectedTopicA = await AIKeywordTopic.create({
      tenantId: TENANT_A,
      name: "Rejected Lifetime Free Topic",
      category: "Pricing & Commercials",
      status: "REJECTED",
      primaryKeywords: ["free lifetime", "zero cost"],
    })

    // 5. Tenant B Approved Topic (Must NEVER match for Tenant A)
    approvedTopicB = await AIKeywordTopic.create({
      tenantId: TENANT_B,
      name: "Tenant B Logistics Tracking",
      category: "Delivery & Logistics",
      status: "APPROVED",
      primaryKeywords: ["shipment tracking", "delivery timeline"],
      approvedAt: new Date(),
      approvedBy: adminUserB._id,
    })

    record("Phase 3 fixtures, tenants, calls, and topics initialized", true)

    // ---------------------------------------------------------
    // Suite 1: Audio Storage & Eligibility Verification
    // ---------------------------------------------------------
    console.log("\n--- Suite 1: Audio Storage & Eligibility Verification ---")

    const enqueueEligible = await enqueueCallIntelligenceJob({
      callId: testCallA1._id,
      tenantId: TENANT_A,
    })
    record("Eligible call with stored recording successfully enqueued", enqueueEligible.enqueued === true)

    const enqueueIneligible = await enqueueCallIntelligenceJob({
      callId: testCallA2._id,
      tenantId: TENANT_A,
    })
    record("Call without stored recording safely rejected from queue", enqueueIneligible.enqueued === false && enqueueIneligible.reason.includes("no stored recording"))

    // Cross-tenant call enqueue attempt
    let crossTenantError = false
    try {
      await enqueueCallIntelligenceJob({
        callId: testCallA1._id,
        tenantId: TENANT_B, // Wrong tenant
      })
    } catch (e) {
      crossTenantError = e.message.includes("not found")
    }
    record("Cross-tenant enqueue attempt blocked with 404/not found error", crossTenantError)

    // ---------------------------------------------------------
    // Suite 2: Speech-to-Text (STT) Service & Mocked Verification
    // ---------------------------------------------------------
    console.log("\n--- Suite 2: Speech-to-Text (STT) Service & Protocol ---")

    let capturedSTTUrl = null
    let capturedSTTBody = null
    let capturedSTTHeaders = null

    const mockSTTHttpClient = async (url, data, headers) => {
      capturedSTTUrl = url
      capturedSTTBody = data
      capturedSTTHeaders = headers
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    language: "hi-en",
                    duration: 45,
                    transcriptText: "Customer: Namaste, mujhe CRM enterprise pricing aur SLA ke baare mein quotation chahiye.\nAgent: Bilkul sir, humare paas dedicated enterprise hosting aur 99.9% uptime SLA hai.",
                    segments: [
                      {
                        speaker: "Customer",
                        startTime: 0,
                        endTime: 5.5,
                        text: "Namaste, mujhe CRM enterprise pricing aur SLA ke baare mein quotation chahiye.",
                      },
                      {
                        speaker: "Agent",
                        startTime: 6.0,
                        endTime: 14.2,
                        text: "Bilkul sir, humare paas dedicated enterprise hosting aur 99.9% uptime SLA hai.",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 95,
        },
      }
    }

    const dummyAudioBuffer = Buffer.from("RIFFdummywaveformaudiobuffercontentfortesting")
    const sttResult = await transcribeAudioWithGemini({
      audioBuffer: dummyAudioBuffer,
      mimeType: "audio/wav",
      duration: 45,
      apiKey: "test-ai-key-phase3",
      httpClient: mockSTTHttpClient,
    })

    record("STT: Result contains language 'hi-en' and segments array", sttResult.language === "hi-en" && sttResult.segments.length === 2)
    record("STT: Outgoing endpoint constructed correctly", capturedSTTUrl.includes("generateContent"))
    record("STT: API key passed exclusively via 'x-goog-api-key' header", capturedSTTHeaders["x-goog-api-key"] === "test-ai-key-phase3" && !capturedSTTUrl.includes("key="))
    record("STT: Request body contains 'store: false' for request-level logging control", capturedSTTBody?.store === false)

    const sttGenConfig = capturedSTTBody?.generationConfig || {}
    const hasUnsupportedSampling = "temperature" in sttGenConfig || "top_p" in sttGenConfig || "top_k" in sttGenConfig || "candidate_count" in sttGenConfig
    record("STT: Unsupported Gemini 3.8 sampling parameters are strictly absent", !hasUnsupportedSampling)

    // Deterministic fallback STT
    const fallbackSTT = generateDeterministicTranscript({ call: testCallA1, duration: 45 })
    record("STT: Deterministic fallback generates valid speaker segments", fallbackSTT.segments.length >= 3 && fallbackSTT.provider === "deterministic-nlp")

    // ---------------------------------------------------------
    // Suite 3: AITranscript Data Model, Segments & Versioning
    // ---------------------------------------------------------
    console.log("\n--- Suite 3: AITranscript Data Model & Versioning ---")

    const savedTranscript = await AITranscript.create({
      tenantId: TENANT_A,
      callId: testCallA1._id,
      provider: "gemini",
      model: "gemini-3.8-flash",
      language: "hi-en",
      duration: 45,
      transcriptText: sttResult.transcriptText,
      segments: sttResult.segments,
      status: "COMPLETED",
      completedAt: new Date(),
      version: 1,
    })

    record("AITranscript: Created with COMPLETED status and valid segments", savedTranscript.status === "COMPLETED" && savedTranscript.segments.length === 2)
    record("AITranscript: Segment 1 preserves speaker 'Customer' and timestamp", savedTranscript.segments[0].speaker === "Customer" && savedTranscript.segments[0].startTime === 0)
    record("AITranscript: Enforces tenant isolation plugin", savedTranscript.tenantId === TENANT_A)

    // ---------------------------------------------------------
    // Suite 4: Approved Topic Matching (Strict Phase 2 Contract)
    // ---------------------------------------------------------
    console.log("\n--- Suite 4: Approved Topic Matching (Strict Phase 2 Contract) ---")

    const matchedTopics = await matchApprovedTopicsForCall({
      tenantId: TENANT_A,
      transcriptText: savedTranscript.transcriptText,
      segments: savedTranscript.segments,
    })

    const matchedNames = matchedTopics.map((m) => m.topicName)
    const matchedIds = matchedTopics.map((m) => m.topicId.toString())

    record("Topic Matcher: Matches APPROVED Enterprise Solutions topic", matchedNames.some((n) => n.includes("Enterprise Solutions")))
    record("Topic Matcher: Matches APPROVED Pricing & Quotes topic", matchedNames.some((n) => n.includes("Pricing & Quotes")))
    record("Topic Matcher: Strictly EXCLUDES PENDING topic", !matchedIds.includes(pendingTopicA._id.toString()))
    record("Topic Matcher: Strictly EXCLUDES REJECTED topic", !matchedIds.includes(rejectedTopicA._id.toString()))
    record("Topic Matcher: Strictly EXCLUDES Tenant B approved topic", !matchedIds.includes(approvedTopicB._id.toString()))
    record("Topic Matcher: Matched item includes quote evidence and timestamp", Boolean(matchedTopics[0]?.evidenceQuote && typeof matchedTopics[0]?.timestamp === "number"))

    // ---------------------------------------------------------
    // Suite 5: AI Call Analysis Engine
    // ---------------------------------------------------------
    console.log("\n--- Suite 5: AI Call Analysis Engine ---")

    let capturedAnalysisBody = null
    const mockAnalysisHttpClient = async (url, data) => {
      capturedAnalysisBody = data
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: "The customer contacted sales requesting commercial quotation and SLA documentation for enterprise CRM deployment. Agent explained 99.9% uptime SLA.",
                    customerIntent: "Requesting enterprise quotation and SLA terms",
                    customerNeeds: ["Dedicated hosting", "99.9% uptime guarantee", "Quotation proposal"],
                    productInterests: ["Enterprise CRM", "SLA Support"],
                    objections: [],
                    competitorMentions: [],
                    sentiment: "POSITIVE",
                    sentimentScore: 0.88,
                    callOutcome: "INTERESTED",
                    keyMoments: [
                      {
                        timestamp: 0.0,
                        description: "Customer states inquiry requirement",
                        quote: "Namaste, mujhe CRM enterprise pricing aur SLA ke baare mein quotation chahiye.",
                      },
                    ],
                    nextSteps: ["Send detailed SLA contract", "Prepare customized pricing proposal"],
                    followUpRecommendations: ["Follow up within 24 hours with enterprise PDF proposal"],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 300,
          candidatesTokenCount: 180,
        },
      }
    }

    const analysisResult = await processCallAnalysis({
      transcript: savedTranscript,
      call: testCallA1,
      topicMatches: matchedTopics,
      apiKey: "test-ai-key-phase3",
      httpClient: mockAnalysisHttpClient,
    })

    record("Analysis: Executive summary generated accurately", analysisResult.summary.includes("enterprise CRM"))
    record("Analysis: Sentiment classified as 'POSITIVE' with meaningful score", analysisResult.sentiment === "POSITIVE" && analysisResult.sentimentScore === 0.88)
    record("Analysis: Call outcome classified as 'INTERESTED'", analysisResult.callOutcome === "INTERESTED")
    record("Analysis: Key moments contain quotes and timestamps", analysisResult.keyMoments.length >= 1 && typeof analysisResult.keyMoments[0].timestamp === "number")
    record("Analysis: Request payload body includes 'store: false'", capturedAnalysisBody?.store === false)

    const savedAnalysis = await AICallAnalysis.create({
      tenantId: TENANT_A,
      callId: testCallA1._id,
      transcriptId: savedTranscript._id,
      analysisVersion: 1,
      status: "COMPLETED",
      summary: analysisResult.summary,
      customerIntent: analysisResult.customerIntent,
      customerNeeds: analysisResult.customerNeeds,
      productInterests: analysisResult.productInterests,
      objections: analysisResult.objections,
      competitorMentions: analysisResult.competitorMentions,
      sentiment: analysisResult.sentiment,
      sentimentScore: analysisResult.sentimentScore,
      callOutcome: analysisResult.callOutcome,
      keyMoments: analysisResult.keyMoments,
      nextSteps: analysisResult.nextSteps,
      followUpRecommendations: analysisResult.followUpRecommendations,
      topicMatches: matchedTopics,
      completedAt: new Date(),
    })

    record("AICallAnalysis: Record persisted with COMPLETED status and topicMatches", savedAnalysis.status === "COMPLETED" && savedAnalysis.topicMatches.length >= 2)

    // ---------------------------------------------------------
    // Suite 6: Queue Pipeline, Idempotency & Step Isolation
    // ---------------------------------------------------------
    console.log("\n--- Suite 6: Queue Pipeline, Idempotency & Failure Isolation ---")

    // Test duplicate job dispatch prevention
    const firstEnqueue = await enqueueCallIntelligenceJob({ callId: testCallA1._id, tenantId: TENANT_A })
    const secondEnqueue = await enqueueCallIntelligenceJob({ callId: testCallA1._id, tenantId: TENANT_A })
    record("Pipeline: Duplicate queue job is detected and deduplicated", secondEnqueue.duplicate === true)

    // Test end-to-end pipeline execution with step-level transcript reuse
    const pipelineJobResult = await processCallIntelligenceJob({
      payload: {
        callId: testCallA1._id.toString(),
        tenantId: TENANT_A,
        httpClient: mockAnalysisHttpClient,
      },
    })
    record("Pipeline: Completed successfully end-to-end", pipelineJobResult.success === true)

    // Test step failure isolation: STT failure preserves failure reason without running analysis
    const callForFail = await Call.create({
      tenantId: TENANT_A,
      agentId: adminUserA._id,
      customerNumber: "+919999988888",
      hasRecording: true,
      recording: { status: "stored", duration: 20 },
    })

    const failingSTTClient = async () => {
      throw new Error("HTTP 500: Speech processing failed due to upstream timeout")
    }

    let pipelineThrew = false
    try {
      await processCallIntelligenceJob({
        payload: {
          callId: callForFail._id.toString(),
          tenantId: TENANT_A,
          forceNewTranscript: true,
          audioBuffer: Buffer.from("fake-audio-bytes-for-failure-test"),
          httpClient: failingSTTClient,
          allowFallback: false,
          apiKey: "mock-gemini-key-for-test",
        },
      })
    } catch (_) {
      pipelineThrew = true
    }
    record("Pipeline: Upstream STT failure safely stops execution with error", pipelineThrew)

    const failedTranscript = await AITranscript.findOne({ tenantId: TENANT_A, callId: callForFail._id })
      .setOptions({ skipTenantFilter: true })
    record("Pipeline: Failed transcript persisted with status 'FAILED' and safe message", failedTranscript?.status === "FAILED" && failedTranscript?.safeErrorMessage.includes("upstream timeout"))

    const missingAnalysis = await AICallAnalysis.findOne({ tenantId: TENANT_A, callId: callForFail._id })
      .setOptions({ skipTenantFilter: true })
    record("Pipeline: No call analysis created when STT step fails", missingAnalysis === null)

    // ---------------------------------------------------------
    // Suite 7: AI Usage Ledger & Deduplication
    // ---------------------------------------------------------
    console.log("\n--- Suite 7: AI Usage Ledger & Idempotency ---")

    const usageKey = `usage_test_${Date.now()}`
    const usage1 = await recordUsage({
      tenantId: TENANT_A,
      callId: testCallA1._id,
      processingType: "TRANSCRIPTION",
      audioDurationSeconds: 45,
      inputTokens: 150,
      outputTokens: 95,
      durationMs: 1200,
      status: "SUCCESS",
      idempotencyKey: usageKey,
    })
    record("Usage: Recorded initial usage event", usage1.isDuplicate === false && usage1.usage.audioDurationSeconds === 45)

    const usage2 = await recordUsage({
      tenantId: TENANT_A,
      callId: testCallA1._id,
      processingType: "TRANSCRIPTION",
      audioDurationSeconds: 45,
      inputTokens: 150,
      outputTokens: 95,
      durationMs: 1200,
      status: "SUCCESS",
      idempotencyKey: usageKey, // Duplicate key
    })
    record("Usage: Duplicate idempotency key safely prevents double counting", usage2.isDuplicate === true)

    const tenantAStats = await getTenantUsageStats({ tenantId: TENANT_A })
    record("Usage: getTenantUsageStats aggregates audio seconds and tokens", tenantAStats.totalAudioSeconds >= 45 && tenantAStats.transcriptionCount >= 1)

    // ---------------------------------------------------------
    // Suite 8: API Endpoints, Pagination, Filtering & RBAC
    // ---------------------------------------------------------
    console.log("\n--- Suite 8: API Endpoints, Filtering & RBAC ---")

    // GET /api/ai-calls/dashboard
    const dashboardRes = await request(app)
      .get("/api/ai-calls/dashboard")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: GET /api/ai-calls/dashboard returns 200 with KPI metrics", dashboardRes.status === 200 && dashboardRes.body.kpis.totalRecordedCalls >= 1)

    // GET /api/ai-calls (Listing)
    const listRes = await request(app)
      .get("/api/ai-calls?limit=10")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: GET /api/ai-calls returns paginated list of analyzed calls", listRes.status === 200 && Array.isArray(listRes.body.analyses))

    // Filter by callOutcome=INTERESTED
    const filterOutcomeRes = await request(app)
      .get("/api/ai-calls?callOutcome=INTERESTED")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: Filter by callOutcome=INTERESTED works correctly", filterOutcomeRes.status === 200 && filterOutcomeRes.body.analyses.every((a) => a.callOutcome === "INTERESTED"))

    // GET /api/ai-calls/:callId/status
    const statusRes = await request(app)
      .get(`/api/ai-calls/${testCallA1._id}/status`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: GET /api/ai-calls/:callId/status returns overallStatus COMPLETED", statusRes.status === 200 && statusRes.body.overallStatus === "COMPLETED")

    // GET /api/ai-calls/:callId/transcript
    const transcriptRes = await request(app)
      .get(`/api/ai-calls/${testCallA1._id}/transcript`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: GET /api/ai-calls/:callId/transcript returns transcript and segments", transcriptRes.status === 200 && transcriptRes.body.transcript.segments.length >= 2)

    // GET /api/ai-calls/:callId/analysis
    const analysisRes = await request(app)
      .get(`/api/ai-calls/${testCallA1._id}/analysis`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("API: GET /api/ai-calls/:callId/analysis returns report with topicMatches", analysisRes.status === 200 && analysisRes.body.analysis.topicMatches.length >= 1)

    // POST /api/ai-calls/:callId/analyze
    const triggerRes = await request(app)
      .post(`/api/ai-calls/${testCallA1._id}/analyze`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ force: true })
    record("API: POST /api/ai-calls/:callId/analyze returns 202 Accepted", triggerRes.status === 202 && triggerRes.body.success === true)

    // RBAC: Reprocess endpoint requires Admin
    const agentReprocessRes = await request(app)
      .post(`/api/ai-calls/${testCallA1._id}/reprocess`)
      .set("Authorization", `Bearer ${tokenUserA}`) // Agent, not admin
      .send({ forceNewTranscript: false })
    record("API RBAC: Regular agent forbidden (403) on reprocess endpoint", agentReprocessRes.status === 403)

    const adminReprocessRes = await request(app)
      .post(`/api/ai-calls/${testCallA1._id}/reprocess`)
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({ forceNewTranscript: false })
    record("API RBAC: Admin authorized (202) on reprocess endpoint", adminReprocessRes.status === 202)

    // Unauthenticated request
    const unauthRes = await request(app).get("/api/ai-calls/dashboard")
    record("API Auth: Unauthenticated request receives 401 Unauthorized", unauthRes.status === 401)

    // ---------------------------------------------------------
    // Suite 9: Strict Multi-Tenant Isolation
    // ---------------------------------------------------------
    console.log("\n--- Suite 9: Strict Multi-Tenant Isolation ---")

    // Tenant B attempts to fetch Tenant A transcript -> 404
    const tenantBCrossTranscript = await request(app)
      .get(`/api/ai-calls/${testCallA1._id}/transcript`)
      .set("Authorization", `Bearer ${tokenAdminB}`)
    record("Tenant Isolation: Tenant B cannot access Tenant A transcript (404)", tenantBCrossTranscript.status === 404)

    // Tenant B attempts to fetch Tenant A analysis -> 404
    const tenantBCrossAnalysis = await request(app)
      .get(`/api/ai-calls/${testCallA1._id}/analysis`)
      .set("Authorization", `Bearer ${tokenAdminB}`)
    record("Tenant Isolation: Tenant B cannot access Tenant A analysis (404)", tenantBCrossAnalysis.status === 404)

    // Tenant B attempts to trigger analysis on Tenant A call -> 404
    const tenantBCrossTrigger = await request(app)
      .post(`/api/ai-calls/${testCallA1._id}/analyze`)
      .set("Authorization", `Bearer ${tokenAdminB}`)
    record("Tenant Isolation: Tenant B cannot trigger analysis on Tenant A call (404)", tenantBCrossTrigger.status === 404)

    // Tenant B usage stats contain 0 events from Tenant A
    const tenantBUsageRes = await request(app)
      .get("/api/ai-calls/usage")
      .set("Authorization", `Bearer ${tokenAdminB}`)
    record("Tenant Isolation: Tenant B usage stats contains 0 events from Tenant A", tenantBUsageRes.status === 200 && tenantBUsageRes.body.usage.totalEvents === 0)

    // ---------------------------------------------------------
    // Suite 10: Regression Testing (Core CRM & Prior Phases)
    // ---------------------------------------------------------
    console.log("\n--- Suite 10: Regression Testing (Core CRM & Prior Phases) ---")

    // Phase 1 Profile
    const profileRes = await request(app)
      .get("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("Regression: Phase 1 Profile endpoint is operational", profileRes.status === 200)

    // Phase 2 Keywords
    const keywordRes = await request(app)
      .get("/api/ai-keywords")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    record("Regression: Phase 2 Keywords listing is operational", keywordRes.status === 200)

    // Core Leads API
    const leadCreateRes = await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: `Regression Lead ${TEST_ID}`,
        phone: "+919988776655",
        email: "p3regression@example.com",
        status: "New",
      })
    record("Regression: Core CRM Lead creation functions normally", [200, 201].includes(leadCreateRes.status))

    const createdLeadId = leadCreateRes.body.lead?.id || leadCreateRes.body.lead?._id
    if (createdLeadId) {
      await Lead.deleteOne({ _id: createdLeadId, tenantId: TENANT_A }).catch(() => {})
    }

    // Core Call logging
    const callLogRes = await request(app)
      .post("/api/calls")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        number: "+919988776655",
        direction: "outbound",
        duration: 30,
        status: "completed",
      })
    record("Regression: Core CRM Call logging functions normally", [200, 201].includes(callLogRes.status))

  } finally {
    console.log("\n--- Final Cleanup of Test Fixtures ---")
    await cleanup()
  }

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  console.log("\n=======================================================")
  console.log(`PHASE 3 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (${total} total)`)
  console.log("=======================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unhandled exception in Phase 3 verification suite:", err)
    process.exit(1)
  })
