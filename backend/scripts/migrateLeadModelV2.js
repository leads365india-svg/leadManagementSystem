const mongoose = require("mongoose")
const dotenv = require("dotenv")
const connectDB = require("../db/connection")
const Lead = require("../models/Lead")
const User = require("../models/User")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { runWithTenantContext } = require("../middleware/tenantContext")

dotenv.config()

/**
 * Migration Script: Migrate Lead Model to v2
 * Phase 6: Lead Model v2 & Shared Lead Service
 * 
 * Safely backfills:
 * 1. phoneNormalized: E.164 normalized phone from lead.phone
 * 2. company: Promoted from metadata.company or metadata.companyName if top-level is empty
 * 3. ownerId: Populated from valid assignedStaffId if matching User exists or valid ObjectId
 * 4. attribution.firstTouch & attribution.lastTouch: Initialized if missing
 * 5. deletedAt: Explicitly set to null if undefined
 * 
 * Safe migration with dry-run support.
 * Usage:
 *   node backend/scripts/migrateLeadModelV2.js --dry-run
 *   node backend/scripts/migrateLeadModelV2.js
 */

async function migrateLeadModelV2(options = {}) {
  const isDryRun = options.dryRun !== undefined ? options.dryRun : process.argv.includes("--dry-run")
  console.log(`\n=== Lead Model v2 Migration (${isDryRun ? "DRY-RUN MODE" : "EXECUTE MODE"}) ===\n`)

  if (mongoose.connection.readyState === 0) {
    await connectDB()
  }

  return runWithTenantContext({ isSuperAdmin: true }, async () => {
    // Ensure compound indexes from Lead model are synchronized
    if (!isDryRun) {
      try {
        console.log("Synchronizing Lead collection indexes...")
        await Lead.syncIndexes()
        console.log("✅ Lead collection indexes synchronized.")
      } catch (idxErr) {
        console.warn("⚠️ Warning during index synchronization:", idxErr.message)
      }
    }

    const cursor = Lead.find({}).cursor()
  let scannedCount = 0
  let modifiedCount = 0
  let skippedCount = 0
  const sampleUpdates = []

  for await (const lead of cursor) {
    scannedCount++
    const updateFields = {}

    // 1. phoneNormalized
    if (!lead.phoneNormalized && lead.phone) {
      const normalized = normalizePhoneE164(lead.phone)
      if (normalized) {
        updateFields.phoneNormalized = normalized
      }
    }

    // 2. company promotion
    if (!lead.company && (lead.metadata?.company || lead.metadata?.companyName)) {
      updateFields.company = String(lead.metadata.company || lead.metadata.companyName).trim()
    }

    // 3. ownerId mapping
    if (!lead.ownerId && lead.assignedStaffId && lead.assignedStaffId !== "unassigned" && mongoose.Types.ObjectId.isValid(lead.assignedStaffId)) {
      updateFields.ownerId = new mongoose.Types.ObjectId(lead.assignedStaffId)
    }

    // 4. attribution initialization
    if (!lead.attribution || !lead.attribution.firstTouch || !lead.attribution.firstTouch.source) {
      const defaultTouch = {
        source: lead.source || "Direct",
        medium: "",
        campaign: "",
        term: "",
        content: "",
        gclid: "",
        fbclid: "",
        adId: "",
        adSetId: "",
        campaignId: "",
        landingPage: lead.landingPage || "",
        referrer: "",
        timestamp: lead.createdAt || new Date(),
      }
      updateFields.attribution = {
        firstTouch: lead.attribution?.firstTouch?.source ? lead.attribution.firstTouch : defaultTouch,
        lastTouch: lead.attribution?.lastTouch?.source ? lead.attribution.lastTouch : defaultTouch,
      }
    }

    // 5. deletedAt initialization
    if (lead.deletedAt === undefined) {
      updateFields.deletedAt = null
    }

    if (Object.keys(updateFields).length > 0) {
      modifiedCount++
      if (sampleUpdates.length < 5) {
        sampleUpdates.push({
          id: lead._id.toString(),
          name: lead.name,
          updates: updateFields,
        })
      }

      if (!isDryRun) {
        await Lead.updateOne({ _id: lead._id }, { $set: updateFields })
      }
    } else {
      skippedCount++
    }
  }

  console.log(`Migration Complete:`)
  console.log(` - Scanned:  ${scannedCount}`)
  console.log(` - Modified: ${modifiedCount}`)
  console.log(` - Skipped:  ${skippedCount}`)
  console.log(` - Mode:     ${isDryRun ? "DRY-RUN (No changes applied)" : "LIVE EXECUTE (Changes committed)"}`)

  if (sampleUpdates.length > 0) {
    console.log(`\nSample Updates (${sampleUpdates.length}):`)
    for (const sample of sampleUpdates) {
      console.log(` Lead: ${sample.id} (${sample.name}) =>`, JSON.stringify(sample.updates))
    }
  }

    return {
      scannedCount,
      modifiedCount,
      skippedCount,
      isDryRun,
      sampleUpdates,
    }
  })
}

if (require.main === module) {
  migrateLeadModelV2()
    .then(() => {
      console.log("\nLead Model v2 migration completed successfully.")
      process.exit(0)
    })
    .catch((err) => {
      console.error("\n❌ Lead Model v2 migration failed:", err)
      process.exit(1)
    })
}

module.exports = {
  migrateLeadModelV2,
}
