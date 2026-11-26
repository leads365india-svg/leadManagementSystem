const { AIUsageLedger } = require("../models/AIUsageLedger")

/**
 * AI Usage Tracking Service - Phase 3: AI Call Intelligence
 * 
 * Records and aggregates tenant-scoped resource utilization (audio duration,
 * tokens, processing latency) with strict idempotency and zero metric fabrication.
 */

/**
 * Records a usage event in the ledger.
 * Idempotent: duplicate calls with the same idempotencyKey are safely ignored.
 */
async function recordUsage({
  tenantId,
  callId = null,
  processingType,
  provider = "gemini",
  model = "gemini-3.8-flash",
  audioDurationSeconds = 0,
  inputTokens = null,
  outputTokens = null,
  durationMs = 0,
  status = "SUCCESS",
  idempotencyKey = null,
}) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("A valid tenantId is required to record AI usage.")
  }
  if (!processingType) {
    throw new Error("processingType is required (TRANSCRIPTION, ANALYSIS, TOPIC_MATCHING).")
  }

  const cleanTenantId = tenantId.trim()
  const cleanKey = idempotencyKey ? String(idempotencyKey).trim() : null

  // Idempotency check
  if (cleanKey) {
    const existing = await AIUsageLedger.findOne({
      tenantId: cleanTenantId,
      idempotencyKey: cleanKey,
    }).setOptions({ skipTenantFilter: true })

    if (existing) {
      return { usage: existing, isDuplicate: true }
    }
  }

  const safeInputTokens = typeof inputTokens === "number" && !isNaN(inputTokens) ? inputTokens : null
  const safeOutputTokens = typeof outputTokens === "number" && !isNaN(outputTokens) ? outputTokens : null

  try {
    const usage = new AIUsageLedger({
      tenantId: cleanTenantId,
      callId,
      processingType,
      provider: provider || "gemini",
      model: model || "gemini-3.8-flash",
      audioDurationSeconds: Math.max(0, Number(audioDurationSeconds) || 0),
      inputTokens: safeInputTokens,
      outputTokens: safeOutputTokens,
      durationMs: Math.max(0, Number(durationMs) || 0),
      status: status === "FAILED" ? "FAILED" : "SUCCESS",
      idempotencyKey: cleanKey,
      timestamp: new Date(),
    })

    await usage.save()
    return { usage, isDuplicate: false }
  } catch (err) {
    // If concurrent insert collided on unique idempotencyKey, return existing record
    if (err.code === 11000 && cleanKey) {
      const existing = await AIUsageLedger.findOne({
        tenantId: cleanTenantId,
        idempotencyKey: cleanKey,
      }).setOptions({ skipTenantFilter: true })
      if (existing) {
        return { usage: existing, isDuplicate: true }
      }
    }
    throw err
  }
}

/**
 * Aggregates tenant usage metrics across a given date range.
 */
async function getTenantUsageStats({ tenantId, startDate = null, endDate = null }) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("A valid tenantId is required to query AI usage statistics.")
  }

  const filter = { tenantId: tenantId.trim() }

  if (startDate || endDate) {
    filter.timestamp = {}
    if (startDate) filter.timestamp.$gte = new Date(startDate)
    if (endDate) filter.timestamp.$lte = new Date(endDate)
  }

  const records = await AIUsageLedger.find(filter)
    .sort({ timestamp: -1 })
    .lean()
    .setOptions({ skipTenantFilter: true })

  let totalAudioSeconds = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalDurationMs = 0
  let transcriptionCount = 0
  let analysisCount = 0
  let topicMatchingCount = 0
  let successCount = 0
  let failedCount = 0

  const modelBreakdown = {}

  for (const r of records) {
    if (r.status === "SUCCESS") successCount++
    if (r.status === "FAILED") failedCount++

    if (r.processingType === "TRANSCRIPTION") {
      transcriptionCount++
      totalAudioSeconds += r.audioDurationSeconds || 0
    } else if (r.processingType === "ANALYSIS") {
      analysisCount++
    } else if (r.processingType === "TOPIC_MATCHING") {
      topicMatchingCount++
    }

    if (typeof r.inputTokens === "number") totalInputTokens += r.inputTokens
    if (typeof r.outputTokens === "number") totalOutputTokens += r.outputTokens
    totalDurationMs += r.durationMs || 0

    const modelName = r.model || "unknown"
    modelBreakdown[modelName] = (modelBreakdown[modelName] || 0) + 1
  }

  return {
    totalEvents: records.length,
    successCount,
    failedCount,
    transcriptionCount,
    analysisCount,
    topicMatchingCount,
    totalAudioSeconds,
    totalAudioMinutes: Number((totalAudioSeconds / 60).toFixed(2)),
    totalInputTokens: totalInputTokens > 0 ? totalInputTokens : null,
    totalOutputTokens: totalOutputTokens > 0 ? totalOutputTokens : null,
    totalTokens: (totalInputTokens || 0) + (totalOutputTokens || 0) || null,
    averageLatencyMs: records.length > 0 ? Math.round(totalDurationMs / records.length) : 0,
    modelBreakdown,
  }
}

module.exports = {
  recordUsage,
  getTenantUsageStats,
}
