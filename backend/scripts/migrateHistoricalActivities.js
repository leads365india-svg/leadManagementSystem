/**
 * Historical Activity Migration Script - Roadmap Phase 10: Lead Detail Drawer & Activity Timeline
 * 
 * Backfills legacy metadata.statusHistory and assignmentHistory records
 * into the centralized Activity collection.
 * 
 * Safety & Invariant Guarantees:
 * - Dry-run by default: Simulates migration without mutating database.
 * - Explicit --apply flag required to commit writes.
 * - Strict tenant isolation: Retains lead.tenantId on every migrated activity.
 * - Idempotent duplicate prevention: Safe to run repeatedly.
 * - Non-destructive: Never modifies, overwrites, or deletes original lead data.
 * 
 * CLI Usage:
 *   node scripts/migrateHistoricalActivities.js             # Dry-run
 *   node scripts/migrateHistoricalActivities.js --apply     # Commit changes
 *   node scripts/migrateHistoricalActivities.js --tenantId=TENANT_ID --apply
 */

const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const { Activity } = require("../models/Activity")
const connectDB = require("../db/connection")

/**
 * Executes historical activity migration.
 * 
 * @param {Object} options
 * @param {boolean} [options.apply=false] - When true, writes activities to DB.
 * @param {string} [options.tenantId=null] - Optional tenant filter.
 * @param {boolean} [options.quiet=false] - Suppress console output.
 * @returns {Promise<Object>} Migration statistics summary.
 */
async function migrateHistoricalActivities({ apply = false, tenantId = null, quiet = false } = {}) {
  const stats = {
    mode: apply ? "LIVE (--apply)" : "DRY-RUN (read-only)",
    leadsScanned: 0,
    eventsProcessed: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  const log = (...args) => {
    if (!quiet) console.log(...args)
  }

  log(`\n======================================================`)
  log(`   LEADS-365: HISTORICAL ACTIVITY TIMELINE MIGRATION  `)
  log(`   Mode: ${stats.mode}                                `)
  log(`======================================================\n`)

  const leadQuery = { deletedAt: null }
  if (tenantId && typeof tenantId === "string" && tenantId.trim()) {
    leadQuery.tenantId = tenantId.trim()
  }

  const cursor = Lead.find(leadQuery).cursor()

  for await (const lead of cursor) {
    stats.leadsScanned++
    const cleanTenantId = (lead.tenantId || "").trim()

    if (!cleanTenantId) {
      stats.skipped++
      continue
    }

    // --- 1. Migrate Lead Creation Event ---
    try {
      stats.eventsProcessed++
      const leadCreatedDate = lead.createdAt ? new Date(lead.createdAt) : new Date()

      // Check if lead.created event already exists
      const existingCreated = await Activity.findOne({
        tenantId: cleanTenantId,
        leadId: lead._id,
        type: "lead.created",
      })

      if (existingCreated) {
        stats.skipped++
      } else {
        if (apply) {
          await Activity.create({
            tenantId: cleanTenantId,
            leadId: lead._id,
            type: "lead.created",
            actor: {
              name: lead.metadata?.receivedVia ? "Webhook / Intake API" : "System / Direct",
              role: "system",
            },
            payload: {
              source: lead.source || "Website Form",
              assignedTo: lead.assignedTo || "Unassigned",
              status: "New",
              company: lead.company || "",
              landingPage: lead.landingPage || "",
              migrated: true,
            },
            createdAt: leadCreatedDate,
          })
        }
        stats.inserted++
      }
    } catch (err) {
      stats.failed++
      stats.errors.push(`Lead ${lead._id} creation migration failed: ${err.message}`)
    }

    // --- 2. Migrate metadata.statusHistory ---
    const statusHistory = Array.isArray(lead.metadata?.statusHistory) ? lead.metadata.statusHistory : []
    for (const item of statusHistory) {
      if (!item) continue
      stats.eventsProcessed++

      const fromStatus = item.fromStatus || "New"
      const toStatus = item.toStatus || item.status
      if (!toStatus) {
        stats.skipped++
        continue
      }

      const transitionedAt = item.transitionedAt || item.changedAt || lead.createdAt || new Date()
      const transitionedDate = new Date(transitionedAt)

      try {
        // Idempotency: verify if matching status transition activity already exists
        const existingStatusAct = await Activity.findOne({
          tenantId: cleanTenantId,
          leadId: lead._id,
          type: "lead.status_changed",
          "payload.fromStatus": fromStatus,
          "payload.toStatus": toStatus,
          createdAt: {
            $gte: new Date(transitionedDate.getTime() - 2000),
            $lte: new Date(transitionedDate.getTime() + 2000),
          },
        })

        if (existingStatusAct) {
          stats.skipped++
        } else {
          if (apply) {
            await Activity.create({
              tenantId: cleanTenantId,
              leadId: lead._id,
              type: "lead.status_changed",
              actor: {
                name: item.transitionedBy || item.changedBy || "User",
                role: "user",
              },
              payload: {
                fromStatus,
                toStatus,
                note: item.note || undefined,
                migrated: true,
              },
              createdAt: transitionedDate,
            })
          }
          stats.inserted++
        }
      } catch (err) {
        stats.failed++
        stats.errors.push(`Lead ${lead._id} status history migration failed: ${err.message}`)
      }
    }

    // --- 3. Migrate assignmentHistory ---
    const assignmentHistory = Array.isArray(lead.assignmentHistory) ? lead.assignmentHistory : []
    for (const item of assignmentHistory) {
      if (!item) continue
      stats.eventsProcessed++

      const toOwnerName = item.toOwnerName || "Staff"
      const assignedAt = item.assignedAt || lead.createdAt || new Date()
      const assignedDate = new Date(assignedAt)

      try {
        // Idempotency check: verify if matching assignment activity already exists
        const existingAssignAct = await Activity.findOne({
          tenantId: cleanTenantId,
          leadId: lead._id,
          type: "lead.owner_changed",
          "payload.toOwnerName": toOwnerName,
          createdAt: {
            $gte: new Date(assignedDate.getTime() - 2000),
            $lte: new Date(assignedDate.getTime() + 2000),
          },
        })

        if (existingAssignAct) {
          stats.skipped++
        } else {
          if (apply) {
            await Activity.create({
              tenantId: cleanTenantId,
              leadId: lead._id,
              type: "lead.owner_changed",
              actor: {
                id: item.assignedBy || null,
                name: item.assignedByName || "System",
                role: "system",
              },
              payload: {
                fromOwnerId: item.fromOwnerId ? String(item.fromOwnerId) : null,
                fromOwnerName: item.fromOwnerName || "Unassigned",
                toOwnerId: item.toOwnerId ? String(item.toOwnerId) : null,
                toOwnerName: item.toOwnerName || "Unassigned",
                reason: item.reason || "Historical assignment record",
                migrated: true,
              },
              createdAt: assignedDate,
            })
          }
          stats.inserted++
        }
      } catch (err) {
        stats.failed++
        stats.errors.push(`Lead ${lead._id} assignment history migration failed: ${err.message}`)
      }
    }
  }

  log(`\n======================================================`)
  log(`               MIGRATION EXECUTION REPORT             `)
  log(`======================================================`)
  log(` Mode:               ${stats.mode}`)
  log(` Leads Scanned:      ${stats.leadsScanned}`)
  log(` Events Evaluated:   ${stats.eventsProcessed}`)
  log(` Inserted (or Dry):  ${stats.inserted}`)
  log(` Skipped (Existing): ${stats.skipped}`)
  log(` Failed:             ${stats.failed}`)
  log(`======================================================\n`)

  if (stats.errors.length > 0) {
    log(`⚠️ Errors encountered during migration:`)
    stats.errors.slice(0, 10).forEach((err) => log(`  - ${err}`))
    if (stats.errors.length > 10) log(`  ...and ${stats.errors.length - 10} more`)
  }

  return stats
}

// CLI Entrypoint
if (require.main === module) {
  const args = process.argv.slice(2)
  const isApply = args.includes("--apply")
  const tenantArg = args.find((a) => a.startsWith("--tenantId="))
  const tenantId = tenantArg ? tenantArg.split("=")[1] : null

  ;(async () => {
    try {
      await connectDB()
      const stats = await migrateHistoricalActivities({ apply: isApply, tenantId })
      if (!isApply) {
        console.log("ℹ️ Dry-run completed. No changes written. Run with '--apply' to execute.")
      } else {
        console.log("✅ Live migration applied successfully.")
      }
      process.exit(stats.failed > 0 ? 1 : 0)
    } catch (err) {
      console.error("❌ Fatal error during activity migration:", err)
      process.exit(1)
    }
  })()
}

module.exports = {
  migrateHistoricalActivities,
}
