const queue = require("../services/queueService")
const leadService = require("../services/leadService")
const assignmentService = require("../services/assignmentService")
const auditService = require("../services/auditService")

/**
 * Standard Job Handlers Registry - Phase 9
 */

function registerAllHandlers() {
  // 1. Webhook Post-Processing Handler
  queue.registerHandler("webhook.process", async (job) => {
    const { tenantId, payload, source = "Website Webhook" } = job.payload || {}
    if (!tenantId) {
      throw new Error("Missing required tenantId in webhook.process payload")
    }

    const result = await leadService.createOrMergeLead({
      tenantId,
      source,
      payload,
      options: { duplicateHandling: "merge" },
      actor: { role: "system", name: "Webhook Queue Worker" },
    })

    return {
      action: result.action,
      leadId: result.lead ? (result.lead.id || result.lead._id) : null,
    }
  })

  // 2. Lead Bulk Assignment Handler
  queue.registerHandler("lead.bulk_assign", async (job) => {
    const { leadIds, targetOwnerId, teamId, ruleId, reason, actor, tenantId } = job.payload || {}
    if (!tenantId || !Array.isArray(leadIds) || leadIds.length === 0) {
      throw new Error("Invalid payload for lead.bulk_assign job")
    }

    const result = await assignmentService.bulkAssignLeads({
      leadIds,
      targetOwnerId,
      teamId,
      ruleId,
      reason: reason || "Background queue assignment",
      actor: actor || { role: "system", name: "Queue Worker" },
      tenantId,
    })

    return {
      updatedCount: result.updatedCount,
      failedCount: result.failedCount,
    }
  })

  // 3. Audit Log Retention Cleanup Handler
  queue.registerHandler("audit.retention_cleanup", async (job) => {
    const { tenantId, retentionDays = 90 } = job.payload || {}
    if (!tenantId) {
      throw new Error("tenantId required for audit retention cleanup")
    }

    const result = await auditService.cleanupExpiredLogs(tenantId, retentionDays)
    return result
  })

  // 4. Recording Purge Check Handler (Phase 16 preparation)
  queue.registerHandler("recording.purge_check", async (job) => {
    const { tenantId, retentionDays = 30 } = job.payload || {}
    // Will be populated in Phase 16 GridFS storage purge
    return {
      message: "Recording purge check executed",
      tenantId: tenantId || "__all__",
      retentionDays,
      purgedCount: 0,
    }
  })

  // 5. Sample Recurring Job Handler
  queue.registerHandler("recurring.sample", async (job) => {
    return {
      status: "success",
      executedAt: new Date().toISOString(),
      sampleMessage: job.payload?.message || "Sample recurring job heartbeat verified",
    }
  })
}

module.exports = {
  registerAllHandlers,
}
