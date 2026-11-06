const mongoose = require("mongoose")
const Call = require("../models/Call")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const queue = require("./queueService")
const { processSpeechToText } = require("./aiSpeechToText.service")
const { matchApprovedTopicsForCall } = require("./aiTopicMatcher.service")
const { processCallAnalysis } = require("./aiCallAnalysis.service")
const { recordUsage } = require("./aiUsageService")
const audit = require("./auditService")
const { sanitizeErrorMessage } = require("./aiProvider.service")

/**
 * AI Call Processing Pipeline - Phase 3: AI Call Intelligence
 * 
 * Orchestrates the end-to-end recording-to-intelligence pipeline:
 * 1. Verification of tenant ownership and recording metadata.
 * 2. Idempotent queue dispatch (no duplicate transcription jobs).
 * 3. Speech-to-Text (STT) execution and AITranscript persistence.
 * 4. Grounded semantic topic matching against APPROVED topics only.
 * 5. Structured Call Analysis extraction and AICallAnalysis persistence.
 * 6. Non-fabricating usage tracking and audit logging.
 * 7. Step-level failure isolation (STT failure prevents analysis; analysis failure preserves transcript).
 */

const JOB_NAME = "ai_call.process"

/**
 * Safely enqueues an AI Call Intelligence job.
 * Idempotent: multiple calls for the same call and recording will not spawn duplicates.
 */
async function enqueueCallIntelligenceJob({ callId, tenantId, priority = 0, force = false }) {
  if (!callId) {
    throw new Error("callId is required to enqueue AI call intelligence job.")
  }

  const cleanTenantId = tenantId ? String(tenantId).trim() : "__system__"
  const callObjId = typeof callId === "string" ? new mongoose.Types.ObjectId(callId) : callId

  // Fetch call to verify recording existence
  const call = await Call.findOne({ _id: callObjId, tenantId: cleanTenantId })
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    throw new Error(`Call '${callId}' not found for tenant '${cleanTenantId}'.`)
  }

  const hasRecording = Boolean(
    call.hasRecording ||
    call.recording?.status === "stored" ||
    call.recording?.fileId ||
    call.recording?.mp3FileId ||
    call.recordingFileId ||
    call.recordingUrl
  )

  if (!hasRecording) {
    return {
      enqueued: false,
      reason: "Call has no stored recording available for AI processing.",
    }
  }

  const checksum = call.recording?.mp3Sha256 || call.recording?.sha256 || `rec_${call._id.toString()}`
  const idempotencyKey = force
    ? `ai_call_${call._id.toString()}_${Date.now()}`
    : `ai_call_${call._id.toString()}_${checksum}`

  const result = await queue.addJob({
    name: JOB_NAME,
    payload: {
      callId: call._id.toString(),
      tenantId: cleanTenantId,
      forceNewTranscript: force,
    },
    tenantId: cleanTenantId,
    idempotencyKey,
    priority,
    maxAttempts: 3,
  })

  return {
    enqueued: true,
    jobId: result.job?.jobId,
    duplicate: result.duplicate,
  }
}

/**
 * Primary worker handler for the AI Call Intelligence pipeline.
 */
async function processCallIntelligenceJob(job, workerContext = {}) {
  const { callId, tenantId, forceNewTranscript = false, httpClient, allowFallback = true, apiKey = null, audioBuffer = null } = job.payload || {}
  if (!callId || !tenantId) {
    throw new Error("Missing callId or tenantId in ai_call.process job payload.")
  }

  const callObjId = new mongoose.Types.ObjectId(callId)

  // 1. Fetch Call ensuring tenant isolation
  const call = await Call.findOne({ _id: callObjId, tenantId })
    .setOptions({ skipTenantFilter: true })

  if (!call) {
    throw new Error(`Call '${callId}' does not exist for tenant '${tenantId}'.`)
  }

  const hasRecording = Boolean(
    call.hasRecording ||
    call.recording?.status === "stored" ||
    call.recording?.fileId ||
    call.recording?.mp3FileId ||
    call.recordingFileId ||
    call.recordingUrl
  )

  if (!hasRecording) {
    console.warn(`[AIPipeline] Call ${callId} has no stored recording. Skipping intelligence job.`)
    return { skipped: true, reason: "No stored recording" }
  }

  const startTime = Date.now()
  let transcript = null
  let isTranscriptReused = false

  // 2. Speech-to-Text Step (with step-level idempotency)
  if (!forceNewTranscript) {
    // Check if valid completed transcript already exists for this call
    transcript = await AITranscript.findOne({
      tenantId,
      callId: callObjId,
      status: "COMPLETED",
    }).sort({ version: -1 }).setOptions({ skipTenantFilter: true })

    if (transcript && transcript.transcriptText && transcript.transcriptText.trim()) {
      isTranscriptReused = true
      console.log(`ℹ️ [AIPipeline] Reusing existing completed transcript v${transcript.version} for call ${callId}.`)
    }
  }

  if (!transcript || !isTranscriptReused) {
    // Determine next version
    const lastTranscript = await AITranscript.findOne({ tenantId, callId: callObjId })
      .sort({ version: -1 })
      .setOptions({ skipTenantFilter: true })
    const nextVersion = lastTranscript ? lastTranscript.version + 1 : 1

    // Initialize transcript in PROCESSING state
    transcript = new AITranscript({
      tenantId,
      callId: callObjId,
      recordingReference: {
        fileId: call.recording?.fileId,
        mp3FileId: call.recording?.mp3FileId,
        sizeBytes: call.recording?.mp3SizeBytes || call.recording?.sizeBytes || 0,
        storageProvider: call.recording?.provider || "gridfs",
      },
      recordingChecksum: call.recording?.mp3Sha256 || call.recording?.sha256 || "",
      duration: call.recording?.duration || 0,
      status: "PROCESSING",
      processingStartedAt: new Date(),
      version: nextVersion,
    })
    await transcript.save()

    const sttStart = Date.now()
    try {
      const sttResult = await processSpeechToText({
        call,
        audioBuffer,
        apiKey,
        httpClient,
        allowFallback,
      })

      transcript.status = "COMPLETED"
      transcript.provider = sttResult.provider
      transcript.model = sttResult.model
      transcript.language = sttResult.language || "auto"
      transcript.transcriptText = sttResult.transcriptText
      transcript.segments = sttResult.segments || []
      transcript.duration = sttResult.duration || call.recording?.duration || 0
      transcript.completedAt = new Date()
      await transcript.save()

      // Record STT usage
      await recordUsage({
        tenantId,
        callId: callObjId,
        processingType: "TRANSCRIPTION",
        provider: sttResult.provider,
        model: sttResult.model,
        audioDurationSeconds: transcript.duration,
        inputTokens: sttResult.usage?.inputTokens,
        outputTokens: sttResult.usage?.outputTokens,
        durationMs: Date.now() - sttStart,
        status: "SUCCESS",
        idempotencyKey: `stt_${callId}_v${nextVersion}`,
      })
    } catch (sttErr) {
      const sanitized = sanitizeErrorMessage(sttErr.message)
      transcript.status = "FAILED"
      transcript.errorCode = "STT_FAILED"
      transcript.safeErrorMessage = sanitized
      await transcript.save()

      await recordUsage({
        tenantId,
        callId: callObjId,
        processingType: "TRANSCRIPTION",
        provider: "gemini",
        model: "gemini-3.8-flash",
        audioDurationSeconds: call.recording?.duration || 0,
        durationMs: Date.now() - sttStart,
        status: "FAILED",
        idempotencyKey: `stt_${callId}_v${nextVersion}_fail`,
      })

      throw new Error(`Speech-to-Text step failed: ${sanitized}`)
    }
  }

  // 3. Semantic Approved Topic Matching Step
  const topicMatchingStart = Date.now()
  let matchedTopics = []
  try {
    matchedTopics = await matchApprovedTopicsForCall({
      tenantId,
      transcriptText: transcript.transcriptText,
      segments: transcript.segments,
    })

    await recordUsage({
      tenantId,
      callId: callObjId,
      processingType: "TOPIC_MATCHING",
      provider: "deterministic-nlp",
      model: "topic-matcher-v1",
      durationMs: Date.now() - topicMatchingStart,
      status: "SUCCESS",
      idempotencyKey: `topic_match_${callId}_v${transcript.version}`,
    })
  } catch (matchErr) {
    console.warn(`[AIPipeline] Topic matching notice for call ${callId}:`, sanitizeErrorMessage(matchErr.message))
    matchedTopics = []
  }

  // 4. AI Call Analysis Step
  const lastAnalysis = await AICallAnalysis.findOne({ tenantId, callId: callObjId })
    .sort({ analysisVersion: -1 })
    .setOptions({ skipTenantFilter: true })
  const nextAnalysisVersion = lastAnalysis ? lastAnalysis.analysisVersion + 1 : 1

  const analysis = new AICallAnalysis({
    tenantId,
    callId: callObjId,
    transcriptId: transcript._id,
    analysisVersion: nextAnalysisVersion,
    status: "PROCESSING",
    topicMatches: matchedTopics,
  })
  await analysis.save()

  const analysisStart = Date.now()
  try {
    const analysisResult = await processCallAnalysis({
      transcript,
      call,
      topicMatches: matchedTopics,
      apiKey,
      httpClient,
      allowFallback: true,
    })

    analysis.status = "COMPLETED"
    analysis.summary = analysisResult.summary
    analysis.customerIntent = analysisResult.customerIntent
    analysis.customerNeeds = analysisResult.customerNeeds
    analysis.productInterests = analysisResult.productInterests
    analysis.objections = analysisResult.objections
    analysis.competitorMentions = analysisResult.competitorMentions
    analysis.sentiment = analysisResult.sentiment
    analysis.sentimentScore = analysisResult.sentimentScore
    analysis.callOutcome = analysisResult.callOutcome
    analysis.keyMoments = analysisResult.keyMoments
    analysis.nextSteps = analysisResult.nextSteps
    analysis.followUpRecommendations = analysisResult.followUpRecommendations
    analysis.topicMatches = matchedTopics
    analysis.provider = analysisResult.provider
    analysis.model = analysisResult.model
    analysis.usage = analysisResult.usage || {}
    analysis.completedAt = new Date()
    await analysis.save()

    // Record Analysis usage
    await recordUsage({
      tenantId,
      callId: callObjId,
      processingType: "ANALYSIS",
      provider: analysisResult.provider,
      model: analysisResult.model,
      audioDurationSeconds: transcript.duration,
      inputTokens: analysisResult.usage?.inputTokens,
      outputTokens: analysisResult.usage?.outputTokens,
      durationMs: Date.now() - analysisStart,
      status: "SUCCESS",
      idempotencyKey: `analysis_${callId}_v${nextAnalysisVersion}`,
    })

    // Update Call metadata flags
    call.metadata = call.metadata || {}
    call.metadata.aiAnalysisStatus = "COMPLETED"
    call.metadata.aiAnalysisId = analysis._id
    call.metadata.aiTranscriptId = transcript._id
    call.metadata.aiCallOutcome = analysis.callOutcome
    call.metadata.aiSentiment = analysis.sentiment
    call.metadata.aiAnalyzedAt = Date.now()
    call.markModified("metadata")
    await call.save().catch(() => {})

    // Automatic CRM Lead Pipeline Status Synchronization
    let syncResult = null
    try {
      const { syncLeadPipelineStatusFromAiCall } = require("./leadPipelineSync.service")
      syncResult = await syncLeadPipelineStatusFromAiCall({
        call,
        analysis,
        tenantId,
        actor: { name: "AI Call Intelligence", role: "system" },
      })
      if (syncResult?.linkedLeadId && (!call.leadId || String(call.leadId._id || call.leadId) !== String(syncResult.linkedLeadId))) {
        call.leadId = syncResult.linkedLeadId
        await call.save().catch(() => {})
      }
    } catch (syncErr) {
      console.warn(`[AIPipeline] Lead pipeline status sync notice for call ${callId}:`, sanitizeErrorMessage(syncErr.message))
    }

    // 5. Audit Logging
    if (audit && typeof audit.log === "function") {
      await audit.log({
        tenantId,
        action: "ai_call.analyzed",
        category: "ai_call_intelligence",
        entity: "Call",
        entityId: callObjId,
        summary: `Generated AI Call Intelligence report (Outcome: ${analysis.callOutcome}, Topics: ${matchedTopics.length})`,
        details: {
          transcriptId: transcript._id,
          analysisId: analysis._id,
          callOutcome: analysis.callOutcome,
          sentiment: analysis.sentiment,
          matchedTopicsCount: matchedTopics.length,
          durationMs: Date.now() - startTime,
        },
      }).catch(() => {})
    }

    // Phase 4: Non-blocking asynchronous lead priority & manager alert generation
    try {
      const { generateRecommendationsForCall } = require("./aiRecommendations.service")
      const { evaluateLeadPriority } = require("./aiLeadPriority.service")

      generateRecommendationsForCall({ call, analysis, tenantId }).catch((recErr) => {
        console.warn(`[AIPipeline] Recommendation notice for call ${callId}:`, sanitizeErrorMessage(recErr.message))
      })

      if (call.leadId) {
        evaluateLeadPriority({ tenantId, leadId: call.leadId._id || call.leadId }).catch((priErr) => {
          console.warn(`[AIPipeline] Priority notice for lead ${call.leadId}:`, sanitizeErrorMessage(priErr.message))
        })
      }
    } catch (_) {}

    return {
      success: true,
      callId,
      transcriptId: transcript._id,
      analysisId: analysis._id,
      callOutcome: analysis.callOutcome,
      sentiment: analysis.sentiment,
      matchedTopicsCount: matchedTopics.length,
      durationMs: Date.now() - startTime,
      syncResult,
    }
  } catch (analysisErr) {
    const sanitized = sanitizeErrorMessage(analysisErr.message)
    analysis.status = "FAILED"
    analysis.errorCode = "ANALYSIS_FAILED"
    analysis.safeErrorMessage = sanitized
    await analysis.save()

    await recordUsage({
      tenantId,
      callId: callObjId,
      processingType: "ANALYSIS",
      provider: "gemini",
      model: "gemini-3.8-flash",
      durationMs: Date.now() - analysisStart,
      status: "FAILED",
      idempotencyKey: `analysis_${callId}_v${nextAnalysisVersion}_fail`,
    })

    throw new Error(`AI Call Analysis step failed: ${sanitized}`)
  }
}

/**
 * Registers the background job handler with queueService.
 */
function registerPipelineHandlers() {
  queue.registerHandler(JOB_NAME, processCallIntelligenceJob)
}

module.exports = {
  JOB_NAME,
  enqueueCallIntelligenceJob,
  processCallIntelligenceJob,
  registerPipelineHandlers,
}
