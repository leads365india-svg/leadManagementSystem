const callIngestionService = require("../services/callIngestionService")

/**
 * Call Ingestion Controller - Roadmap Phase 21: Call Ingestion (Manual Upload)
 * 
 * Provides:
 * - POST /api/calls/ingestion/audio    - Stream single audio recording with filename matching & DNR check
 * - POST /api/calls/ingestion/csv      - Ingest batch call records via CSV text or JSON records
 * - GET  /api/calls/ingestion/review   - Retrieve unmatched manual calls for staff review
 * - POST /api/calls/ingestion/match    - Link an unmatched call to an existing lead or new lead
 * - GET  /api/calls/ingestion/stats    - Get summary counts of manual ingestion
 */

/**
 * Streams an audio file for manual call ingestion.
 */
const ingestAudio = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const mimeType = req.headers["content-type"] || "audio/mp4"
    const filename = req.headers["x-filename"] || req.query.filename || "manual_recording.m4a"
    const explicitPhone = req.headers["x-phone-number"] || req.query.phone || null
    const duration = parseInt(req.headers["x-duration"] || req.query.duration, 10) || 0
    const direction = req.headers["x-direction"] || req.query.direction || "outbound"
    const disposition = req.headers["x-disposition"] || req.query.disposition || "connected"
    const notes = req.headers["x-notes"] || req.query.notes || ""
    const startedAt = req.headers["x-started-at"] || req.query.startedAt || null
    const agentId = req.headers["x-agent-id"] || req.query.agentId || null
    const contentLength = parseInt(req.headers["content-length"], 10) || 0
    const expectedSha256 = req.headers["x-audio-sha256"] || req.headers["x-sha256"] || null

    const result = await callIngestionService.ingestAudioRecording({
      tenantId,
      agentId,
      user,
      readStream: req,
      filename,
      mimeType,
      contentLength,
      expectedSha256,
      explicitPhone,
      duration,
      startedAt,
      direction,
      disposition,
      notes,
    })

    return res.status(201).json({
      success: true,
      message: result.message,
      data: result,
      status: result.status,
      call: result.call,
      lead: result.lead,
    })
  } catch (err) {
    console.error("[CallIngestion IngestAudio Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      code: err.code || "AUDIO_INGESTION_FAILED",
    })
  }
}

/**
 * Ingests batch call records from parsed CSV rows or raw CSV string.
 */
const ingestCsv = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const { records = [], csvText = null, agentId = null } = req.body || {}

    // Support raw text/csv body if sent with content-type text/csv
    let rawCsv = csvText
    if (typeof req.body === "string" && req.headers["content-type"]?.includes("text/csv")) {
      rawCsv = req.body
    }

    const result = await callIngestionService.ingestCsvRecords({
      tenantId,
      agentId,
      user,
      records,
      csvText: rawCsv,
    })

    return res.status(200).json({
      success: true,
      message: `Batch processed: ${result.matched} matched, ${result.unmatched} queued for review, ${result.failed} failed`,
      data: result,
    })
  } catch (err) {
    console.error("[CallIngestion IngestCsv Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      code: err.code || "CSV_INGESTION_FAILED",
    })
  }
}

/**
 * Returns unmatched manual calls for staff review.
 */
const getReviewQueue = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const { page = 1, limit = 50, search = "" } = req.query

    const result = await callIngestionService.getReviewQueue({
      tenantId,
      user,
      page,
      limit,
      search,
    })

    return res.status(200).json({
      success: true,
      data: result,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      calls: result.calls,
    })
  } catch (err) {
    console.error("[CallIngestion ReviewQueue Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    })
  }
}

/**
 * Matches an unmatched call to an existing lead or new quick-created lead.
 */
const matchCall = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user
    const { callId, leadId = null, newLead = null } = req.body || {}

    if (!callId) {
      return res.status(400).json({ success: false, error: "Missing required parameter 'callId'" })
    }

    const result = await callIngestionService.matchUnmatchedCall({
      tenantId,
      user,
      callId,
      leadId,
      newLead,
    })

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result,
      call: result.call,
      lead: result.lead,
    })
  } catch (err) {
    console.error("[CallIngestion MatchCall Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      code: err.code || "MATCH_FAILED",
    })
  }
}

/**
 * Returns manual call ingestion stats.
 */
const getStats = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    const user = req.user

    const result = await callIngestionService.getIngestionStats({ tenantId, user })
    return res.status(200).json({
      success: true,
      data: result.stats,
      stats: result.stats,
    })
  } catch (err) {
    console.error("[CallIngestion Stats Error]:", err.message)
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    })
  }
}

module.exports = {
  ingestAudio,
  ingestCsv,
  getReviewQueue,
  matchCall,
  getStats,
}
