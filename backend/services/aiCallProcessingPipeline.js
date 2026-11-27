const mongoose = require("mongoose")
const crypto = require("crypto")
const Call = require("../models/Call")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const Job = require("../models/Job")
const queue = require("./queueService")
const { processSpeechToText } = require("./aiSpeechToText.service")
const { matchApprovedTopicsForCall } = require("./aiTopicMatcher.service")
const { processCallAnalysis } = require("./aiCallAnalysis.service")
const { recordUsage } = require("./aiUsageService")
const audit = require("./auditService")
const { sanitizeErrorMessage, resolveGeminiModel } = require("./aiProvider.service")

const JOB_NAME = "ai_call.process"
const RECOVER_STALE_JOB_NAME = "ai_call.recover_stale"
const STALE_PROCESSING_MS = Number(process.env.AI_STALE_JOB_TIMEOUT_MS) || 20 * 60 * 1000 // 20 minutes
const AI_JOB_LOCK_TIMEOUT_MS = Number(process.env.AI_JOB_LOCK_TIMEOUT_MS) || 25 * 60 * 1000 // 25 minutes

/**
 * Safely enqueues an AI Call Intelligence job.
 * Deduplicates only while an active non-stale job is currently pending/processing;
 * allows immediate re-run for FAILED/PENDING/completed retries.
 */
async function enqueueCallIntelligenceJob({ callId, tenantId, priority = 0, force = false, forceNewTranscript = false }) {
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

  const callIdStr = call._id.toString()
  const activeCutoff = new Date(Date.now() - STALE_PROCESSING_MS)

  if (!force) {
    const activeJob = await Job.findOne({
      tenantId: cleanTenantId,
      name: JOB_NAME,
      "payload.callId": callIdStr,
      $or: [
        { status: "pending" },
        { status: "processing", lockedAt: { $gte: activeCutoff } },
      ],
    })
    if (activeJob) {
      return {
        enqueued: true,
        jobId: activeJob.jobId,
        duplicate: true,
      }
    }
  }

  const checksum = call.recording?.mp3Sha256 || call.recording?.sha256 || `rec_${callIdStr}`
  const baseKey = `ai_call_${callIdStr}_${checksum}`
  let idempotencyKey = force ? `ai_call_${callIdStr}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}` : baseKey

  if (!force) {
    const previousSameKey = await Job.findOne({ tenantId: cleanTenantId, idempotencyKey: baseKey }).lean()
    if (previousSameKey) {
      // Previous run completed/failed/staled cleanly — allow fresh enqueue under unique retry key
      idempotencyKey = `${baseKey}_rerun_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`
    }
  }

  const result = await queue.addJob({
    name: JOB_NAME,
    payload: {
      callId: callIdStr,
      tenantId: cleanTenantId,
      workspaceId: call.workspaceId ? call.workspaceId.toString() : null,
      forceNewTranscript: Boolean(forceNewTranscript),
    },
    tenantId: cleanTenantId,
    workspaceId: call.workspaceId || null,
    scopeMode: call.workspaceId ? "single_workspace" : "standalone",
    idempotencyKey,
    priority,
    maxAttempts: 2,
    backoffDelayMs: 5000,
    lockTimeoutMs: AI_JOB_LOCK_TIMEOUT_MS,
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
  const {
    callId,
    tenantId,
    forceNewTranscript = false,
    httpClient,
    filesApiClient,
    audioTools,
    audioBuffer = null,
    chunkDurationSec,
    overlapSec,
    chunkTimeoutMs,
    concurrency,
    retryDelayMs,
    useFilesApi,
  } = job.payload || {}
  const allowFallback = job.payload?.allowFallback === true
  const apiKey = job.payload?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null
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

  let transcript = null
  let analysis = null

  try {
    call.metadata = call.metadata || {}
    call.metadata.aiAnalysisStatus = "PROCESSING"
    call.metadata.aiStartedAt = Date.now()
    delete call.metadata.aiErrorMessage
    call.markModified("metadata")
    await call.save().catch(() => {})

    const recordingSizeBytes = call.recording?.mp3SizeBytes || call.recording?.sizeBytes || call.recordingSize || (audioBuffer ? audioBuffer.length : 0)
    const recordingDuration = call.recording?.duration || call.duration || call.durationSeconds || 0

    const hasRecording = Boolean(
      call.hasRecording ||
      call.recording?.status === "stored" ||
      call.recording?.fileId ||
      call.recording?.mp3FileId ||
      call.recordingFileId ||
      call.recordingUrl ||
      audioBuffer
    )

    const hasValidRecording = hasRecording && (recordingSizeBytes > 0 || audioBuffer) && recordingDuration > 0

    if (!hasValidRecording) {
      console.warn(`[AIPipeline] Call ${callId} has incomplete recording (size=${recordingSizeBytes}, duration=${recordingDuration}). Marking UNRESOLVED.`)
      const lastAnalysis = await AICallAnalysis.findOne({ tenantId, callId: callObjId })
        .sort({ analysisVersion: -1 })
        .setOptions({ skipTenantFilter: true })
      const nextAnalysisVersion = lastAnalysis ? lastAnalysis.analysisVersion + 1 : 1

      const unresolvedAnalysis = new AICallAnalysis({
        tenantId,
        workspaceId: call.workspaceId || null,
        callId: callObjId,
        analysisVersion: nextAnalysisVersion,
        status: "COMPLETED",
        callOutcome: "UNRESOLVED",
        qualificationStatus: "UNRESOLVED",
        qualificationReason: "INSUFFICIENT_AUDIO_RECORDING",
        productFit: "UNRESOLVED",
        crmLeadAction: "DO_NOT_UPDATE",
        summary: "Full audio recording missing or incomplete (zero bytes or invalid duration).",
        customerIntent: "Incomplete audio recording",
        productRelevanceScore: 0.0,
        leadQualificationScore: 0.0,
        customerPurchaseIntent: false,
        isProductRelevant: false,
        callbackRequested: false,
        completedAt: new Date(),
      })
      await unresolvedAnalysis.save()

      call.metadata = call.metadata || {}
      call.metadata.aiAnalysisStatus = "COMPLETED"
      call.metadata.aiAnalysisId = unresolvedAnalysis._id
      call.metadata.aiCallOutcome = "UNRESOLVED"
      call.metadata.aiQualificationStatus = "UNRESOLVED"
      call.metadata.aiAnalyzedAt = Date.now()
      call.markModified("metadata")
      await call.save().catch(() => {})

      return { completed: true, analysisId: unresolvedAnalysis._id, callOutcome: "UNRESOLVED", crmLeadAction: "DO_NOT_UPDATE" }
    }

    const startTime = Date.now()
    let isTranscriptReused = false

    // 2. Stage 1: Speech-to-Text Step (chunked for long audio, Files API for >5MB, saved immediately before Stage 2)
    if (!forceNewTranscript) {
      transcript = await AITranscript.findOne({
        tenantId,
        callId: callObjId,
        status: "COMPLETED",
      }).sort({ version: -1 }).setOptions({ skipTenantFilter: true })

      const isFakeFallback = transcript && (
        transcript.provider === "deterministic-nlp" ||
        transcript.model === "offline-rule-engine"
      )

      if (transcript && transcript.transcriptText && transcript.transcriptText.trim() && !isFakeFallback) {
        isTranscriptReused = true
        console.log(`ℹ️ [AIPipeline] Reusing existing completed transcript v${transcript.version} for call ${callId}.`)
      } else if (isFakeFallback) {
        console.log(`ℹ️ [AIPipeline] Bypassing legacy fallback transcript v${transcript?.version} for call ${callId} — requiring fresh live STT.`)
      }
    }

    if (!transcript || !isTranscriptReused) {
      const lastTranscript = await AITranscript.findOne({ tenantId, callId: callObjId })
        .sort({ version: -1 })
        .setOptions({ skipTenantFilter: true })
      const nextVersion = lastTranscript ? lastTranscript.version + 1 : 1

      transcript = new AITranscript({
        tenantId,
        workspaceId: call.workspaceId || null,
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
          filesApiClient,
          audioTools,
          chunkDurationSec,
          overlapSec,
          chunkTimeoutMs,
          concurrency,
          retryDelayMs,
          useFilesApi,
          onProgress: async () => {
            if (job?.jobId) {
              await queue.heartbeatJob(job.jobId).catch(() => {})
            }
            if (transcript?._id) {
              await AITranscript.updateOne({ _id: transcript._id }, { $set: { processingStartedAt: new Date() } }).catch(() => {})
            }
          },
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

        call.metadata = call.metadata || {}
        call.metadata.aiTranscriptId = transcript._id
        call.metadata.aiTranscriptStatus = "COMPLETED"
        call.markModified("metadata")
        await call.save().catch(() => {})

        console.log("✅ [AIPipeline] Gemini STT completed for call " + callId + " (segments=" + transcript.segments.length + ", lang=" + transcript.language + ")")

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
        console.error("❌ [AIPipeline] STT failed for call " + callId + ":", sanitized)
        transcript.status = "FAILED"
        transcript.errorCode = "STT_FAILED"
        transcript.safeErrorMessage = sanitized
        await transcript.save()

        call.metadata = call.metadata || {}
        call.metadata.aiAnalysisStatus = "FAILED"
        call.metadata.aiTranscriptStatus = "FAILED"
        call.metadata.aiErrorMessage = sanitized
        call.markModified("metadata")
        await call.save().catch(() => {})

        await recordUsage({
          tenantId,
          callId: callObjId,
          processingType: "TRANSCRIPTION",
          provider: "gemini",
          model: resolveGeminiModel(),
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

    // 4. Stage 2: Text-Only AI Call Analysis Step
    const lastAnalysis = await AICallAnalysis.findOne({ tenantId, callId: callObjId })
      .sort({ analysisVersion: -1 })
      .setOptions({ skipTenantFilter: true })
    const nextAnalysisVersion = lastAnalysis ? lastAnalysis.analysisVersion + 1 : 1

    const transcriptText = (transcript?.transcriptText || "").trim()
    const hasSpeakerAttribution = (Array.isArray(transcript?.segments) && transcript.segments.length > 0 &&
      transcript.segments.some((s) => s.speaker === "Customer" || s.speaker === "Agent")) ||
      transcriptText.includes("Customer:") || transcriptText.includes("Agent:") ||
      transcriptText.includes("Customer") || transcriptText.includes("Agent") ||
      transcriptText.includes("caller:") || transcriptText.includes("agent:")

    if (!transcript || transcriptText.length < 20 || !hasSpeakerAttribution) {
      console.warn(`[AIPipeline] Call ${callId} transcript incomplete (< 20 chars or missing speaker attribution). Marking UNRESOLVED.`)
      const unresolvedAnalysis = new AICallAnalysis({
        tenantId,
        workspaceId: call.workspaceId || null,
        callId: callObjId,
        transcriptId: transcript?._id || null,
        analysisVersion: nextAnalysisVersion,
        status: "COMPLETED",
        callOutcome: "UNRESOLVED",
        qualificationStatus: "UNRESOLVED",
        qualificationReason: "INSUFFICIENT_CALL_DATA",
        productFit: "UNRESOLVED",
        crmLeadAction: "DO_NOT_UPDATE",
        summary: "Call transcript is insufficient or missing speaker attribution (Customer vs Agent).",
        customerIntent: "Unclear / insufficient transcript",
        productRelevanceScore: 0.0,
        leadQualificationScore: 0.0,
        customerPurchaseIntent: false,
        isProductRelevant: false,
        callbackRequested: false,
        completedAt: new Date(),
      })
      await unresolvedAnalysis.save()

      call.metadata = call.metadata || {}
      call.metadata.aiAnalysisStatus = "COMPLETED"
      call.metadata.aiAnalysisId = unresolvedAnalysis._id
      call.metadata.aiTranscriptId = transcript?._id || null
      call.metadata.aiCallOutcome = "UNRESOLVED"
      call.metadata.aiQualificationStatus = "UNRESOLVED"
      call.metadata.aiAnalyzedAt = Date.now()
      call.markModified("metadata")
      await call.save().catch(() => {})

      return { completed: true, analysisId: unresolvedAnalysis._id, callOutcome: "UNRESOLVED", crmLeadAction: "DO_NOT_UPDATE" }
    }

    analysis = new AICallAnalysis({
      tenantId,
      workspaceId: call.workspaceId || null,
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
        allowFallback,
        tenantId,
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
      analysis.productRelevanceScore = analysisResult.productRelevanceScore ?? 0.0
      analysis.productFit = analysisResult.productFit || "UNRESOLVED"
      analysis.customerRequestedProduct = analysisResult.customerRequestedProduct || ""
      analysis.quotationIntent = analysisResult.quotationIntent || null
      analysis.brochureIntent = analysisResult.brochureIntent || null
      analysis.leadQualificationScore = analysisResult.leadQualificationScore ?? 0.0
      analysis.qualificationStatus = analysisResult.qualificationStatus || "UNRESOLVED"
      analysis.qualificationReason = analysisResult.qualificationReason || null
      analysis.customerPurchaseIntent = Boolean(analysisResult.customerPurchaseIntent)
      analysis.isProductRelevant = Boolean(analysisResult.isProductRelevant)
      analysis.callbackRequested = Boolean(analysisResult.callbackRequested)
      analysis.requestedCallbackDateTime = analysisResult.requestedCallbackDateTime || null
      analysis.callbackTimezone = analysisResult.callbackTimezone || "Asia/Kolkata"
      analysis.callbackTimePrecision = analysisResult.callbackTimePrecision || null
      analysis.callbackReason = analysisResult.callbackReason || null
      analysis.callbackLanguage = analysisResult.callbackLanguage || null
      analysis.voiceConfirmation = analysisResult.voiceConfirmation || null
      analysis.callbackDirection = analysisResult.callbackDirection || null
      analysis.direction = analysisResult.callbackDirection === "AGENT_CALLBACK" ? "OUTBOUND" : (analysisResult.callbackDirection === "EXPECTED_CUSTOMER_CALLBACK" ? "INBOUND" : null)
      analysis.taskAction = analysisResult.taskAction || null
      analysis.directionDescription = analysisResult.directionDescription || null
      analysis.callOutcome = analysisResult.callOutcome
      analysis.keyMoments = analysisResult.keyMoments
      analysis.nextSteps = analysisResult.nextSteps
      analysis.followUpRecommendations = analysisResult.followUpRecommendations
      analysis.topicMatches = analysisResult.topicMatches || matchedTopics
      analysis.provider = analysisResult.provider
      analysis.model = analysisResult.model
      analysis.usage = analysisResult.usage || {}
      analysis.completedAt = new Date()
      await analysis.save()

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

      call.metadata = call.metadata || {}
      call.metadata.aiAnalysisStatus = "COMPLETED"
      call.metadata.aiAnalysisId = analysis._id
      call.metadata.aiTranscriptId = transcript._id
      call.metadata.aiCallOutcome = analysis.callOutcome
      call.metadata.aiSentiment = analysis.sentiment
      call.metadata.aiProductRelevanceScore = analysis.productRelevanceScore
      call.metadata.aiProductFit = analysis.productFit
      call.metadata.aiCustomerRequestedProduct = analysis.customerRequestedProduct
      call.metadata.aiLeadQualificationScore = analysis.leadQualificationScore
      call.metadata.aiQualificationStatus = analysis.qualificationStatus
      call.metadata.aiQualificationReason = analysis.qualificationReason
      call.metadata.aiCallbackRequested = analysis.callbackRequested
      call.metadata.aiRequestedCallbackDateTime = analysis.requestedCallbackDateTime
      call.metadata.aiCallbackDirection = analysis.callbackDirection
      call.metadata.aiDirection = analysis.direction
      call.metadata.aiTaskAction = analysis.taskAction
      call.metadata.aiAnalyzedAt = Date.now()
      delete call.metadata.aiErrorMessage
      call.markModified("metadata")
      await call.save().catch(() => {})

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

      try {
        const { autoSendBrochureEmail } = require("./quotationBrochure.service")
        const Lead = require("../models/Lead")
        const { Activity } = require("../models/Activity")

        const targetLeadId = call.leadId?._id || call.leadId || syncResult?.linkedLeadId
        if (targetLeadId && analysis.productFit === "SUPPORTED") {
          const linkedLead = await Lead.findById(targetLeadId).setOptions({ skipTenantFilter: true })
          if (linkedLead) {
            if (analysis.quotationIntent?.requestedByCustomer || analysis.quotationIntent?.promisedByAgent) {
              linkedLead.quotationRequested = true
              linkedLead.quotationRequestedAt = new Date()
              linkedLead.quotationRequestedEvidence = analysis.quotationIntent.supportingEvidence || ""
              if (linkedLead.quotationStatus === "None") {
                linkedLead.quotationStatus = "Requested"
              }
              await linkedLead.save().catch(() => {})

              await Activity.create({
                tenantId,
                leadId: linkedLead._id,
                type: "quotation.requested",
                actor: { name: "AI Call Intelligence", role: "system" },
                payload: {
                  callId: call._id,
                  requestedByCustomer: analysis.quotationIntent.requestedByCustomer,
                  promisedByAgent: analysis.quotationIntent.promisedByAgent,
                  evidence: analysis.quotationIntent.supportingEvidence,
                  notice: "Quotation Required - Agent follow-up needed to upload and send quotation",
                },
              }).catch(() => {})
            }

            if (analysis.brochureIntent?.requestedByCustomer) {
              await autoSendBrochureEmail({
                lead: linkedLead,
                call,
                productInterest: analysis.customerRequestedProduct || (analysis.productInterests?.[0]) || "",
                customerEmail: analysis.brochureIntent.customerEmail,
                transcriptEvidence: analysis.brochureIntent.supportingEvidence,
                channel: analysis.brochureIntent.channel,
                tenantId,
              }).catch((autoErr) => {
                console.warn(`[AIPipeline] Auto brochure send notice for call ${callId}:`, autoErr.message)
              })
            }
          }
        }
      } catch (docErr) {
        console.warn(`[AIPipeline] Document intent handling notice for call ${callId}:`, sanitizeErrorMessage(docErr.message))
      }

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
      console.error("❌ [AIPipeline] Analysis failed for call " + callId + ":", sanitized)
      analysis.status = "FAILED"
      analysis.errorCode = "ANALYSIS_FAILED"
      analysis.safeErrorMessage = sanitized
      await analysis.save()

      call.metadata = call.metadata || {}
      call.metadata.aiAnalysisStatus = "FAILED"
      call.metadata.aiErrorMessage = sanitized
      call.markModified("metadata")
      await call.save().catch(() => {})

      await recordUsage({
        tenantId,
        callId: callObjId,
        processingType: "ANALYSIS",
        provider: "gemini",
        model: resolveGeminiModel(),
        durationMs: Date.now() - analysisStart,
        status: "FAILED",
        idempotencyKey: `analysis_${callId}_v${nextAnalysisVersion}_fail`,
      })

      throw new Error(`AI Call Analysis step failed: ${sanitized}`)
    }
  } catch (pipelineErr) {
    // Guarantee call and any open PROCESSING/PENDING docs never stay stuck in Pending/Processing
    const sanitized = sanitizeErrorMessage(pipelineErr?.message || "Unexpected AI pipeline error")
    if (transcript && ["PROCESSING", "PENDING"].includes(transcript.status)) {
      transcript.status = "FAILED"
      transcript.errorCode = transcript.errorCode || "PIPELINE_FAILED"
      transcript.safeErrorMessage = transcript.safeErrorMessage || sanitized
      await transcript.save().catch(() => {})
    }
    if (analysis && ["PROCESSING", "PENDING"].includes(analysis.status)) {
      analysis.status = "FAILED"
      analysis.errorCode = analysis.errorCode || "PIPELINE_FAILED"
      analysis.safeErrorMessage = analysis.safeErrorMessage || sanitized
      await analysis.save().catch(() => {})
    }
    call.metadata = call.metadata || {}
    call.metadata.aiAnalysisStatus = "FAILED"
    call.metadata.aiErrorMessage = sanitized
    call.markModified("metadata")
    await call.save().catch(() => {})

    throw pipelineErr
  }
}

/**
 * Startup & recurring cron recovery for any AI calls/transcripts/analyses stuck in
 * PROCESSING or PENDING beyond 20 minutes so they cleanly transition to FAILED and can be retried.
 */
async function recoverStaleAiJobs({ maxAgeMs = STALE_PROCESSING_MS } = {}) {
  const cutoff = new Date(Date.now() - Math.max(60000, Number(maxAgeMs) || STALE_PROCESSING_MS))
  const staleMessage = `AI processing exceeded ${Math.round(maxAgeMs / 60000)} minutes and was marked Failed. Click Retry / Analyze Now to re-run.`

  const staleJobs = await Job.find({
    name: JOB_NAME,
    status: "processing",
    lockedAt: { $lt: cutoff },
  }).lean()

  let staleJobsRecovered = 0
  for (const job of staleJobs) {
    await Job.updateOne(
      { _id: job._id, status: "processing" },
      {
        $set: {
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          failedReason: staleMessage,
        },
      }
    ).catch(() => {})
    staleJobsRecovered++
  }

  const staleTranscripts = await AITranscript.find({
    status: { $in: ["PROCESSING", "PENDING"] },
    updatedAt: { $lt: cutoff },
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  let staleTranscriptsRecovered = 0
  const affectedCallIds = new Set()
  for (const t of staleTranscripts) {
    await AITranscript.updateOne(
      { _id: t._id, status: { $in: ["PROCESSING", "PENDING"] } },
      {
        $set: {
          status: "FAILED",
          errorCode: "STALE_TIMEOUT",
          safeErrorMessage: staleMessage,
        },
      }
    )
      .setOptions({ skipTenantFilter: true })
      .catch(() => {})
    if (t.callId) affectedCallIds.add(t.callId.toString())
    staleTranscriptsRecovered++
  }

  const staleAnalyses = await AICallAnalysis.find({
    status: { $in: ["PROCESSING", "PENDING"] },
    updatedAt: { $lt: cutoff },
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  let staleAnalysesRecovered = 0
  for (const a of staleAnalyses) {
    await AICallAnalysis.updateOne(
      { _id: a._id, status: { $in: ["PROCESSING", "PENDING"] } },
      {
        $set: {
          status: "FAILED",
          errorCode: "STALE_TIMEOUT",
          safeErrorMessage: staleMessage,
        },
      }
    )
      .setOptions({ skipTenantFilter: true })
      .catch(() => {})
    if (a.callId) affectedCallIds.add(a.callId.toString())
    staleAnalysesRecovered++
  }

  const staleCalls = await Call.find({
    "metadata.aiAnalysisStatus": { $in: ["PROCESSING", "PENDING"] },
    $or: [
      { updatedAt: { $lt: cutoff } },
      ...(affectedCallIds.size > 0
        ? [{ _id: { $in: Array.from(affectedCallIds).map((id) => new mongoose.Types.ObjectId(id)) } }]
        : []),
    ],
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  let staleCallsRecovered = 0
  for (const c of staleCalls) {
    const activeQueued = await Job.findOne({
      name: JOB_NAME,
      "payload.callId": c._id.toString(),
      $or: [
        { status: "pending" },
        { status: "processing", lockedAt: { $gte: cutoff } },
      ],
    }).lean()
    if (activeQueued) continue

    await Call.updateOne(
      { _id: c._id },
      {
        $set: {
          "metadata.aiAnalysisStatus": "FAILED",
          "metadata.aiErrorMessage": staleMessage,
        },
      }
    )
      .setOptions({ skipTenantFilter: true })
      .catch(() => {})
    staleCallsRecovered++
  }

  return {
    staleJobsRecovered,
    staleTranscriptsRecovered,
    staleAnalysesRecovered,
    staleCallsRecovered,
  }
}

/**
 * Registers the background job handlers with queueService.
 */
function registerPipelineHandlers() {
  queue.registerHandler(JOB_NAME, processCallIntelligenceJob)
  queue.registerHandler(RECOVER_STALE_JOB_NAME, async (job) => {
    return await recoverStaleAiJobs(job?.payload || {})
  })
}

module.exports = {
  JOB_NAME,
  RECOVER_STALE_JOB_NAME,
  STALE_PROCESSING_MS,
  AI_JOB_LOCK_TIMEOUT_MS,
  enqueueCallIntelligenceJob,
  processCallIntelligenceJob,
  recoverStaleAiJobs,
  registerPipelineHandlers,
}
