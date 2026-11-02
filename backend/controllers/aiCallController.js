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

    if (!call.hasRecording && call.recording?.status !== "stored") {
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

    const call = await Call.findOne({ _id: callId, tenantId }).setOptions({ skipTenantFilter: true })
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

    let overallStatus = "NOT_STARTED"
    if (!call.hasRecording && call.recording?.status !== "stored") {
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

    return res.status(200).json({
      success: true,
      callId: call._id,
      overallStatus,
      hasRecording: Boolean(call.hasRecording || call.recording?.status === "stored"),
      transcript: latestTranscript
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
        : null,
      analysis: latestAnalysis
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
        : null,
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

    if (!call.hasRecording && call.recording?.status !== "stored") {
      return res.status(400).json({
        success: false,
        message: "Cannot reprocess: Call does not have a stored audio recording.",
      })
    }

    const forceNewTranscript = Boolean(req.body?.forceNewTranscript)

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
      jobId: enqueueResult.jobId,
    })
  } catch (err) {
    console.error("Error in reprocessCall:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to reprocess call" })
  }
}

/**
 * 6. GET /api/ai-calls
 * Lists analyzed calls with pagination, filters, and summary metrics.
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

    const filter = { tenantId }

    if (status && status.toUpperCase() !== "ALL") {
      filter.status = status.toUpperCase()
    }
    if (callOutcome && callOutcome.toUpperCase() !== "ALL") {
      filter.callOutcome = callOutcome.toUpperCase()
    }
    if (sentiment && sentiment.toUpperCase() !== "ALL") {
      filter.sentiment = sentiment.toUpperCase()
    }

    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate) filter.createdAt.$lte = new Date(endDate)
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      filter.$or = [
        { summary: searchRegex },
        { customerIntent: searchRegex },
        { "topicMatches.topicName": searchRegex },
      ]
    }

    const [analyses, total] = await Promise.all([
      AICallAnalysis.find(filter)
        .populate("callId", "customerNumber direction duration agentId clientCallId recording createdAt")
        .populate("transcriptId", "language duration status")
        .populate("topicMatches.topicId", "name category")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .setOptions({ skipTenantFilter: true }),
      AICallAnalysis.countDocuments(filter).setOptions({ skipTenantFilter: true }),
    ])

    return res.status(200).json({
      success: true,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      analyses,
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

    // Parallel fetch: Total recorded calls, analyses, and transcripts
    const [totalRecordedCalls, allAnalyses, allTranscripts] = await Promise.all([
      Call.countDocuments({
        tenantId,
        $or: [{ hasRecording: true }, { "recording.status": "stored" }],
        ...dateFilter,
      }).setOptions({ skipTenantFilter: true }),
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

    return res.status(200).json({
      success: true,
      kpis: {
        totalRecordedCalls,
        analyzedCount,
        pendingCount,
        failedCount,
        totalAudioMinutes: Number((totalAudioSeconds / 60).toFixed(2)),
      },
      outcomeDistribution,
      sentimentDistribution,
      topTopics: Object.entries(topicFrequency)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
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
