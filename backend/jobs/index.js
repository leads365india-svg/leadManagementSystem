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

  // Phase 11: Common Integration Intake Handler
  queue.registerHandler("integration.intake", async (job) => {
    const { eventId, tenantId, integrationId, body, headers, ip, rawApiKey } = job.payload || {}
    if (!tenantId) {
      throw new Error("Missing required tenantId in integration.intake payload")
    }

    const { Integration } = require("../models/Integration")
    const { IntegrationEvent } = require("../models/IntegrationEvent")
    const integrationService = require("../services/integrationService")

    let event = null
    if (eventId) {
      event = await IntegrationEvent.findOne({ _id: eventId, tenantId }).setOptions({ skipTenantFilter: true })
    }

    let integration = null
    if (integrationId) {
      integration = await Integration.findOne({ _id: integrationId, tenantId }).setOptions({ skipTenantFilter: true })
    }

    if (!integration) {
      throw new Error("Integration not found for background intake processing")
    }

    const result = await integrationService.processIntakePayload({
      event,
      integration,
      tenantId,
      body,
      headers,
      ip,
      rawApiKey,
      idempotencyKey: job.idempotencyKey,
    })

    if (!result.success && result.status >= 500) {
      throw new Error(result.error || "Background integration intake failed with server error")
    }

    return result
  })

  // Phase 12: Meta Lead Ads Background Processing Handler
  queue.registerHandler("meta.lead_process", async (job) => {
    const metaService = require("../services/metaService")
    return await metaService.processMetaLeadIntake(job.payload)
  })

  // Phase 12: Meta Form Leads Reconciliation Handler
  queue.registerHandler("meta.reconcile_leads", async (job) => {
    const metaService = require("../services/metaService")
    const { integrationId, options } = job.payload || {}
    if (!integrationId) {
      throw new Error("Missing integrationId for meta.reconcile_leads job")
    }
    return await metaService.reconcileMetaLeads(integrationId, options)
  })

  // Phase 13: IndiaMART Lead Manager Sync Handler
  queue.registerHandler("indiamart.sync_leads", async (job) => {
    const indiamartService = require("../services/indiamartService")
    const { integrationId, options } = job.payload || {}
    if (!integrationId) {
      throw new Error("Missing integrationId for indiamart.sync_leads job")
    }
    return await indiamartService.syncIndiaMartLeads(integrationId, options)
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

  // 5. Phase 15: Mobile Lead Assignment Push Notification Handler
  queue.registerHandler("mobile.push_lead_assigned", async (job) => {
    const pushService = require("../services/pushService")
    return await pushService.executePushLeadAssigned(job.payload)
  })

  // 6. Sample Recurring Job Handler
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
