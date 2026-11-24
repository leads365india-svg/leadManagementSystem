/**
 * SMTP Index Migration Script - Idempotent & Conflict-Protected
 *
 * Replaces legacy single-field unique index { tenantId: 1 } on TenantEmailConfig
 * with compound unique index { tenantId: 1, workspaceId: 1 } to enable optional
 * workspace-specific SMTP overrides alongside organization-wide defaults.
 *
 * Safety Guards:
 * - Detects duplicate records before dropping or creating indexes.
 * - Runs in DRY-RUN mode by default.
 * - Requires explicit --execute flag to modify database indexes.
 * - Does not alter any SMTP credentials or document contents.
 *
 * Usage:
 *   node backend/scripts/migrateSmtpIndexes.js             # Dry-run audit only
 *   node backend/scripts/migrateSmtpIndexes.js --execute   # Execute index migration
 */

const path = require("path")
const dotenv = require("dotenv")

dotenv.config({ path: path.join(__dirname, "../.env") })

const mongoose = require("mongoose")
const connectDB = require("../db/connection")

async function migrateSmtpIndexes() {
  const isExecute = process.argv.includes("--execute")
  console.log(`=== SMTP INDEX MIGRATION AUDIT (Mode: ${isExecute ? "EXECUTE" : "DRY-RUN"}) ===`)

  await connectDB()
  const db = mongoose.connection.db
  const collection = db.collection("tenantemailconfigs")

  try {
    // 1. Fetch current indexes
    const indexes = await collection.indexes()
    console.log(`Found ${indexes.length} existing index(es) on 'tenantemailconfigs':`)
    indexes.forEach((idx) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${Boolean(idx.unique)})`)
    })

    const hasLegacyUniqueTenant = indexes.some((idx) => idx.name === "tenantId_1" && idx.unique)
    const hasCompoundUnique = indexes.some(
      (idx) => idx.name === "tenantId_1_workspaceId_1" && idx.unique
    )

    console.log(`\nLegacy { tenantId: 1 } unique index present: ${hasLegacyUniqueTenant}`)
    console.log(`Target { tenantId: 1, workspaceId: 1 } unique index present: ${hasCompoundUnique}`)

    // 2. Conflict Detection: Check for duplicate (tenantId, workspaceId) documents
    const duplicateCheck = await collection
      .aggregate([
        {
          $group: {
            _id: { tenantId: "$tenantId", workspaceId: "$workspaceId" },
            count: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()

    if (duplicateCheck.length > 0) {
      console.error("\n❌ CONFLICT DETECTED: Found duplicate configurations for the same (tenantId, workspaceId):")
      duplicateCheck.forEach((dup) => {
        console.error(
          `   Tenant: ${dup._id.tenantId}, Workspace: ${dup._id.workspaceId || "null (default)"} -> ${dup.count} documents [${dup.ids.join(", ")}]`
        )
      })
      console.error("Migration ABORTED: Duplicate records must be manually reconciled before creating compound unique index.")
      process.exit(1)
    }

    console.log("✅ Conflict Check: 0 duplicate (tenantId, workspaceId) pairs detected. Safe to proceed.")

    if (!isExecute) {
      console.log("\n[DRY-RUN] No indexes were modified. Run with --execute to perform migration.")
      process.exit(0)
    }

    // 3. Execution
    if (hasLegacyUniqueTenant) {
      console.log("\nDropping legacy unique index 'tenantId_1'...")
      await collection.dropIndex("tenantId_1")
      console.log("✅ Successfully dropped 'tenantId_1'.")
    }

    if (!hasCompoundUnique) {
      console.log("Creating compound unique index { tenantId: 1, workspaceId: 1 }...")
      await collection.createIndex({ tenantId: 1, workspaceId: 1 }, { unique: true, background: true })
      console.log("✅ Successfully created 'tenantId_1_workspaceId_1'.")
    } else {
      console.log("Compound unique index 'tenantId_1_workspaceId_1' is already in place.")
    }

    console.log("\n=== SMTP INDEX MIGRATION COMPLETED SUCCESSFULLY ===")
    process.exit(0)
  } catch (err) {
    console.error("\n❌ Migration Error:", err.message)
    process.exit(1)
  }
}

migrateSmtpIndexes()
