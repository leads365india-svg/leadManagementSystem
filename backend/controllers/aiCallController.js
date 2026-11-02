const mongoose = require("mongoose")
const Call = require("../models/Call")
const { AITranscript } = require("../models/AITranscript")
const { AICallAnalysis } = require("../models/AICallAnalysis")
const { AIUsageLedger } = require("../models/AIUsageLedger")
const { enqueueCallIntelligenceJob, processCallIntelligenceJob } = require("../services/aiCallProcessingPipeline")
const { getTenantUsageStats } = require("../services/aiUsageService")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const audit = require("../services/auditService")

/**
 * AI Call Intelligence Controller - Phase 3
 * 
 * Provides authenticated, tenant-isolated endpoints for:
 * - Triggering analysis for recorded calls
 * - Polling processing status
 * - Fetching transcript and intelligence analysis
 * - Reprocessing calls
 * - Querying dashboard metrics and usage summaries
 */

function getTenantId(req) {
  const effective = getEffectiveTenant ? getEffectiveTenant(req) : {}
  return effective.tenantId || req.tenantId || req.user?.tenantId
}

/**
 * 1. POST /api/ai-calls/:callId/analyze
 * Triggers or enqueues AI Call Intelligence processing for an eligible recorded call.
 */
async function triggerCallAnalysis(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: "Invalid callId format" })
    }

    const call = await Call.findOne({ _id: callId, tenantId }).setOptions({ skipTenantFilter: true })
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" })
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
      return res.status(400).json({
        success: false,
        message: "This call does not have an available audio recording for AI analysis.",
      })
    }

    const force = Boolean(req.body?.force)
    const enqueueResult = await enqueueCallIntelligenceJob({
      callId: call._id,
      tenantId,
      force,
    })

    return res.status(202).json({
      success: true,
      message: enqueueResult.duplicate
        ? "AI intelligence job already queued or in progress."
        : "AI Call Intelligence job enqueued successfully.",
      data: {
        callId: call._id,
        enqueued: enqueueResult.enqueued,
        duplicate: enqueueResult.duplicate,
        jobId: enqueueResult.jobId,
      },
    })
  } catch (err) {
    console.error("Error in triggerCallAnalysis:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to trigger analysis" })
  }
}

/**
 * 2. GET /api/ai-calls/:callId/status
 * Retrieves real-time processing status of transcript and analysis for a given call.
 */
async function getCallStatus(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: "Invalid callId format" })
    }

    const call = await Call.findOne({ _id: callId, tenantId })
      .populate("agentId", "name email")
      .populate("leadId", "name phone email")
      .setOptions({ skipTenantFilter: true })
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" })
    }

    const [latestTranscript, latestAnalysis] = await Promise.all([
      AITranscript.findOne({ tenantId, callId: call._id })
        .sort({ version: -1 })
        .setOptions({ skipTenantFilter: true }),
      AICallAnalysis.findOne({ tenantId, callId: call._id })
        .sort({ analysisVersion: -1 })
        .setOptions({ skipTenantFilter: true }),
    ])

    const hasRecording = Boolean(
      call.hasRecording ||
      call.recording?.status === "stored" ||
      call.recording?.fileId ||
      call.recording?.mp3FileId ||
      call.recordingFileId ||
      call.recordingUrl
    )

    let overallStatus = "NOT_STARTED"
    if (!hasRecording) {
      overallStatus = "NOT_RECORDED"
    } else if (latestAnalysis?.status === "COMPLETED") {
      overallStatus = "COMPLETED"
    } else if (latestAnalysis?.status === "PROCESSING" || latestTranscript?.status === "PROCESSING") {
      overallStatus = "PROCESSING"
    } else if (latestAnalysis?.status === "FAILED" || latestTranscript?.status === "FAILED") {
      overallStatus = "FAILED"
    } else if (latestTranscript?.status === "PENDING" || latestAnalysis?.status === "PENDING") {
      overallStatus = "PENDING"
    }

    const transcriptPayload = latestTranscript
      ? {
          id: latestTranscript._id,
          status: latestTranscript.status,
          version: latestTranscript.version,
          language: latestTranscript.language,
          duration: latestTranscript.duration,
          completedAt: latestTranscript.completedAt,
          errorCode: latestTranscript.errorCode,
          safeErrorMessage: latestTranscript.safeErrorMessage,
        }
      : null

    const analysisPayload = latestAnalysis
      ? {
          id: latestAnalysis._id,
          status: latestAnalysis.status,
          analysisVersion: latestAnalysis.analysisVersion,
          callOutcome: latestAnalysis.callOutcome,
          sentiment: latestAnalysis.sentiment,
          completedAt: latestAnalysis.completedAt,
          errorCode: latestAnalysis.errorCode,
          safeErrorMessage: latestAnalysis.safeErrorMessage,
        }
      : null

    const callSummary = {
      _id: call._id,
      id: call._id,
      customerNumber: call.customerNumber || call.phoneNumber,
      direction: call.direction,
      duration: call.duration,
      durationSeconds: call.durationSeconds || call.duration,
      agentId: call.agentId,
      leadId: call.leadId,
      disposition: call.disposition,
      notes: call.notes,
      hasRecording,
      recording: call.recording,
      createdAt: call.createdAt,
      startedAt: call.startedAt || call.createdAt,
    }

    const statusData = {
      callId: call._id,
      call: callSummary,
      overallStatus,
      hasRecording,
      transcript: transcriptPayload,
      analysis: analysisPayload,
    }

    return res.status(200).json({
      success: true,
      data: statusData,
      ...statusData,
    })
  } catch (err) {
    console.error("Error in getCallStatus:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch status" })
  }
}

/**
 * 3. GET /api/ai-calls/:callId/transcript
 * Fetches the transcript and segment timeline for a call.
 */
async function getCallTranscript(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: "Invalid callId format" })
    }

    const transcript = await AITranscript.findOne({ tenantId, callId })
      .sort({ version: -1 })
      .setOptions({ skipTenantFilter: true })

    if (!transcript) {
      return res.status(404).json({ success: false, message: "Transcript not found for this call" })
    }

    return res.status(200).json({
      success: true,
      data: { transcript },
      transcript,
    })
  } catch (err) {
    console.error("Error in getCallTranscript:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch transcript" })
  }
}

/**
 * 4. GET /api/ai-calls/:callId/analysis
 * Fetches the detailed AI Call Intelligence report.
 */
async function getCallAnalysis(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: "Invalid callId format" })
    }

    const analysis = await AICallAnalysis.findOne({ tenantId, callId })
      .sort({ analysisVersion: -1 })
      .populate("topicMatches.topicId", "name category primaryKeywords")
      .setOptions({ skipTenantFilter: true })

    if (!analysis) {
      return res.status(404).json({ success: false, message: "Analysis report not found for this call" })
    }

    return res.status(200).json({
      success: true,
      data: { analysis },
      analysis,
    })
  } catch (err) {
    console.error("Error in getCallAnalysis:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch analysis" })
  }
}

/**
 * 5. POST /api/ai-calls/:callId/reprocess
 * Admin/authorized user triggers re-analysis with optional new transcript generation.
 */
async function reprocessCall(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { callId } = req.params
    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ success: false, message: "Invalid callId format" })
    }

    const call = await Call.findOne({ _id: callId, tenantId }).setOptions({ skipTenantFilter: true })
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" })
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
      return res.status(400).json({
        success: false,
        message: "Cannot reprocess: Call does not have an available audio recording.",
      })
    }

    const forceNewTranscript = Boolean(req.body?.forceNewTranscript || req.body?.force)

    const enqueueResult = await enqueueCallIntelligenceJob({
      callId: call._id,
      tenantId,
      force: true,
    })

    await audit.log({
      req,
      action: "ai_call.reprocess_requested",
      entity: "Call",
      summary: `Requested re-processing for call ${call._id} (forceNewTranscript: ${forceNewTranscript})`,
      details: { callId: call._id, forceNewTranscript },
    }).catch(() => {})

    return res.status(202).json({
      success: true,
      message: "Reprocessing job enqueued successfully.",
      data: {
        jobId: enqueueResult.jobId,
        callId: call._id,
        enqueued: enqueueResult.enqueued,
        duplicate: enqueueResult.duplicate,
      },
      jobId: enqueueResult.jobId,
    })
  } catch (err) {
    console.error("Error in reprocessCall:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to reprocess call" })
  }
}

/**
 * 6. GET /api/ai-calls
 * Lists recorded calls and their associated AI intelligence status with pagination and filters.
 */
async function listAnalyzedCalls(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const {
      page = 1,
      limit = 20,
      status,
      callOutcome,
      sentiment,
      agentId,
      search,
      startDate,
      endDate,
    } = req.query

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const callFilter = {
      tenantId,
      $or: [
        { hasRecording: true },
        { "recording.status": "stored" },
        { "recording.fileId": { $exists: true, $ne: null } },
        { "recording.mp3FileId": { $exists: true, $ne: null } },
        { recordingFileId: { $exists: true, $ne: null } },
        { recordingUrl: { $exists: true, $ne: null, $ne: "" } },
      ],
    }

    if (startDate || endDate) {
      callFilter.createdAt = {}
      if (startDate) callFilter.createdAt.$gte = new Date(startDate)
      if (endDate) callFilter.createdAt.$lte = new Date(endDate)
    }

    if (agentId) {
      callFilter.agentId = agentId
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      callFilter.$or = [
        { customerNumber: searchRegex },
        { notes: searchRegex },
      ]
    }

    // Parallel fetch: calls with recordings and total count
    const [calls, total] = await Promise.all([
      Call.find(callFilter)
        .populate("leadId", "name phone email")
        .populate("agentId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .setOptions({ skipTenantFilter: true }),
      Call.countDocuments(callFilter).setOptions({ skipTenantFilter: true }),
    ])

    const callIds = calls.map((c) => c._id)

    // Fetch corresponding latest analyses for these calls
    const analyses = await AICallAnalysis.find({
      tenantId,
      callId: { $in: callIds },
    })
      .populate("topicMatches.topicId", "name category primaryKeywords")
      .sort({ analysisVersion: -1 })
      .lean()
      .setOptions({ skipTenantFilter: true })

    const analysisMap = new Map()
    for (const a of analyses) {
      const cIdStr = a.callId ? a.callId.toString() : null
      if (cIdStr && !analysisMap.has(cIdStr)) {
        analysisMap.set(cIdStr, a)
      }
    }

    // Map into unified call objects with attached aiAnalysis
    let mappedCalls = calls.map((c) => {
      const cIdStr = c._id.toString()
      const analysis = analysisMap.get(cIdStr) || null
      return {
        ...c,
        id: c._id,
        aiAnalysis: analysis,
        intelligenceStatus: analysis ? analysis.status : "NOT_ANALYZED",
      }
    })

    // Filter by analysis status/outcome/sentiment if specified
    if (status && status.toUpperCase() !== "ALL") {
      const targetStatus = status.toUpperCase()
      mappedCalls = mappedCalls.filter((c) => c.intelligenceStatus === targetStatus)
    }
    if (callOutcome && callOutcome.toUpperCase() !== "ALL") {
      const targetOutcome = callOutcome.toUpperCase()
      mappedCalls = mappedCalls.filter((c) => c.aiAnalysis?.callOutcome === targetOutcome)
    }
    if (sentiment && sentiment.toUpperCase() !== "ALL") {
      const targetSentiment = sentiment.toUpperCase()
      mappedCalls = mappedCalls.filter((c) => c.aiAnalysis?.sentiment === targetSentiment)
    }

    const mappedAnalyses = mappedCalls.map((c) => c.aiAnalysis).filter(Boolean)

    return res.status(200).json({
      success: true,
      data: {
        calls: mappedCalls,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      calls: mappedCalls,
      analyses: mappedAnalyses,
    })
  } catch (err) {
    console.error("Error in listAnalyzedCalls:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to list analyzed calls" })
  }
}

/**
 * 7. GET /api/ai-calls/dashboard
 * Aggregates high-level KPI metrics, outcome charts, sentiment distribution, and topic frequency.
 */
async function getDashboardMetrics(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { startDate, endDate } = req.query
    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate)
    }

    const recordingQuery = {
      tenantId,
      $or: [
        { hasRecording: true },
        { "recording.status": "stored" },
        { "recording.fileId": { $exists: true, $ne: null } },
        { "recording.mp3FileId": { $exists: true, $ne: null } },
        { recordingFileId: { $exists: true, $ne: null } },
        { recordingUrl: { $exists: true, $ne: null, $ne: "" } },
      ],
      ...dateFilter,
    }

    // Parallel fetch: Total recorded calls, analyses, and transcripts
    const [totalRecordedCalls, allAnalyses, allTranscripts] = await Promise.all([
      Call.countDocuments(recordingQuery).setOptions({ skipTenantFilter: true }),
      AICallAnalysis.find({ tenantId, ...dateFilter }).lean().setOptions({ skipTenantFilter: true }),
      AITranscript.find({ tenantId, ...dateFilter }).select("duration status").lean().setOptions({ skipTenantFilter: true }),
    ])

    let analyzedCount = 0
    let pendingCount = 0
    let failedCount = 0

    const outcomeDistribution = {}
    const sentimentDistribution = {}
    const topicFrequency = {}

    for (const a of allAnalyses) {
      if (a.status === "COMPLETED") {
        analyzedCount++
        outcomeDistribution[a.callOutcome] = (outcomeDistribution[a.callOutcome] || 0) + 1
        sentimentDistribution[a.sentiment] = (sentimentDistribution[a.sentiment] || 0) + 1

        for (const tm of a.topicMatches || []) {
          const tName = tm.topicName || "Unknown"
          topicFrequency[tName] = (topicFrequency[tName] || 0) + 1
        }
      } else if (a.status === "PROCESSING" || a.status === "PENDING") {
        pendingCount++
      } else if (a.status === "FAILED") {
        failedCount++
      }
    }

    let totalAudioSeconds = 0
    for (const t of allTranscripts) {
      if (t.status === "COMPLETED") {
        totalAudioSeconds += t.duration || 0
      }
    }

    const topTopicsList = Object.entries(topicFrequency)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const kpis = {
      totalRecordedCalls,
      analyzedCount,
      pendingCount,
      failedCount,
      totalAudioMinutes: Number((totalAudioSeconds / 60).toFixed(2)),
    }

    const data = {
      eligibleRecordedCalls: totalRecordedCalls,
      analyzedCalls: analyzedCount,
      processingCalls: pendingCount,
      failedCalls: failedCount,
      pendingCalls: pendingCount,
      totalAudioSeconds,
      analysisRate: totalRecordedCalls > 0 ? Number(((analyzedCount / totalRecordedCalls) * 100).toFixed(1)) : 0,
      outcomeDistribution,
      sentimentDistribution,
      topTopics: topTopicsList,
    }

    return res.status(200).json({
      success: true,
      data,
      kpis,
      outcomeDistribution,
      sentimentDistribution,
      topTopics: topTopicsList,
    })
  } catch (err) {
    console.error("Error in getDashboardMetrics:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch dashboard metrics" })
  }
}

/**
 * 8. GET /api/ai-calls/usage
 * Aggregates AI resource consumption for the authenticated tenant.
 */
async function getUsageMetrics(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { startDate, endDate } = req.query
    const usageStats = await getTenantUsageStats({ tenantId, startDate, endDate })

    return res.status(200).json({
      success: true,
      usage: usageStats,
    })
  } catch (err) {
    console.error("Error in getUsageMetrics:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch usage metrics" })
  }
}

module.exports = {
  triggerCallAnalysis,
  getCallStatus,
  getCallTranscript,
  getCallAnalysis,
  reprocessCall,
  listAnalyzedCalls,
  getDashboardMetrics,
  getUsageMetrics,
}
