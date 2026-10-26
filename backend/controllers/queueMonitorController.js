const queue = require("../services/queueService")
const scheduler = require("../services/schedulerService")
const Job = require("../models/Job")
const DeadLetterJob = require("../models/DeadLetterJob")

/**
 * Queue Monitor Controller - Phase 9: Admin-Only Queue Monitor
 * 
 * Provides administrative visibility and control over queue health,
 * active jobs, retry workflows, dead-letter records, and scheduler runs.
 * Strictly restricted to Super Admins.
 */

/**
 * GET /api/admin/queues/metrics
 */
const getMetrics = async (req, res) => {
  try {
    const tenantId = req.query.tenantId || null
    const metrics = await queue.getQueueMetrics(tenantId)
    const schedules = scheduler.getSchedules()

    res.status(200).json({
      success: true,
      data: {
        metrics,
        schedules,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Error retrieving queue metrics:", error)
    res.status(500).json({ success: false, error: "Failed to fetch queue metrics" })
  }
}

/**
 * GET /api/admin/queues/jobs
 */
const listJobs = async (req, res) => {
  try {
    const {
      status,
      name,
      tenantId,
      page = 1,
      limit = 20,
    } = req.query

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20))
    const skip = (pageNum - 1) * limitNum

    const query = {}
    if (status && status !== "all") query.status = status
    if (name && name !== "all") query.name = name
    if (tenantId && tenantId !== "all") query.tenantId = tenantId

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Job.countDocuments(query),
    ])

    res.status(200).json({
      success: true,
      data: jobs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    })
  } catch (error) {
    console.error("Error listing queue jobs:", error)
    res.status(500).json({ success: false, error: "Failed to list queue jobs" })
  }
}

/**
 * GET /api/admin/queues/dead-letter
 */
const listDeadLetterJobs = async (req, res) => {
  try {
    const { page = 1, limit = 20, tenantId } = req.query
    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20))
    const skip = (pageNum - 1) * limitNum

    const query = {}
    if (tenantId && tenantId !== "all") query.tenantId = tenantId

    const [records, total] = await Promise.all([
      DeadLetterJob.find(query)
        .sort({ failedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      DeadLetterJob.countDocuments(query),
    ])

    res.status(200).json({
      success: true,
      data: records,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    })
  } catch (error) {
    console.error("Error listing dead letter jobs:", error)
    res.status(500).json({ success: false, error: "Failed to list dead letter jobs" })
  }
}

/**
 * POST /api/admin/queues/dead-letter/:id/retry
 */
const retryDeadLetter = async (req, res) => {
  try {
    const { id } = req.params
    const result = await queue.retryDeadLetterJob(id, req.user?.email || "admin")

    res.status(200).json({
      success: true,
      message: `Dead-letter job '${result.requeuedJob.name}' (${result.requeuedJob.jobId}) re-enqueued successfully`,
      data: result,
    })
  } catch (error) {
    console.error("Error retrying dead letter job:", error)
    res.status(400).json({ success: false, error: error.message || "Failed to retry dead letter job" })
  }
}

/**
 * POST /api/admin/queues/schedules/:id/trigger
 */
const triggerSchedule = async (req, res) => {
  try {
    const { id } = req.params
    const result = await scheduler.triggerNow(id)

    res.status(200).json({
      success: true,
      message: `Scheduled job '${id}' triggered manually`,
      data: result,
    })
  } catch (error) {
    console.error("Error triggering schedule:", error)
    res.status(400).json({ success: false, error: error.message || "Failed to trigger schedule" })
  }
}

module.exports = {
  getMetrics,
  listJobs,
  listDeadLetterJobs,
  retryDeadLetter,
  triggerSchedule,
}
