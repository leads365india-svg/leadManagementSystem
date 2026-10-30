require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const { migrateRecordingsBatch } = require("../services/mediaMigration.service")

/**
 * CLI Migration Script: Migrate GridFS Recordings to ImageKit
 * 
 * Safety Notice:
 * - This script requires explicit execution flags (--execute or --authorized=true).
 * - By default, it runs in safe DRY-RUN mode to show what would be migrated.
 * - It NEVER deletes GridFS files, keeping them as a permanent backward-compatible fallback.
 * 
 * Usage:
 *   # Dry-run preview:
 *   node backend/scripts/migrateGridFsToImageKit.js
 * 
 *   # Execute migration batch:
 *   node backend/scripts/migrateGridFsToImageKit.js --execute --batchSize=20
 * 
 *   # Execute for specific tenant:
 *   node backend/scripts/migrateGridFsToImageKit.js --execute --tenantId=ACC-5511FF7C
 * 
 *   # Force retry on previously failed records:
 *   node backend/scripts/migrateGridFsToImageKit.js --execute --force-retry
 */

async function run() {
  const args = process.argv.slice(2)
  const isExecute = args.includes("--execute") || args.includes("--authorized=true")
  const forceRetry = args.includes("--force-retry")

  const tenantArg = args.find((a) => a.startsWith("--tenantId="))
  const tenantId = tenantArg ? tenantArg.split("=")[1] : null

  const batchArg = args.find((a) => a.startsWith("--batchSize="))
  const batchSize = batchArg ? parseInt(batchArg.split("=")[1], 10) : 20

  console.log("================================================================================")
  console.log("=== GRIDFS TO IMAGEKIT RECORDING MIGRATION UTILITY ===")
  console.log("================================================================================")
  console.log(`Execution Mode : ${isExecute ? "LIVE EXECUTION (--execute)" : "DRY RUN PREVIEW (safe)"}`)
  console.log(`Tenant Filter  : ${tenantId || "ALL TENANTS"}`)
  console.log(`Batch Size     : ${batchSize}`)
  console.log(`Force Retry    : ${forceRetry ? "YES" : "NO"}`)
  console.log("--------------------------------------------------------------------------------")

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("❌ Fatal Error: MONGODB_URI environment variable is not defined.")
    process.exit(1)
  }

  try {
    await mongoose.connect(mongoUri)
    console.log(" Connected to MongoDB Atlas")

    const result = await migrateRecordingsBatch({
      tenantId,
      batchSize,
      forceRetry,
      dryRun: !isExecute,
    })

    console.log("--------------------------------------------------------------------------------")
    console.log("MIGRATION SUMMARY:")
    console.log(`Total Eligible : ${result.totalEligible}`)
    console.log(`Processed      : ${result.processed}`)
    console.log(`Succeeded      : ${result.succeeded}`)
    console.log(`Failed         : ${result.failed}`)
    console.log("--------------------------------------------------------------------------------")

    if (result.details && result.details.length > 0) {
      console.log("Detailed Records:")
      result.details.forEach((d, idx) => {
        console.log(`  [${idx + 1}] Call: ${d.callId} | Tenant: ${d.tenantId} | Status: ${d.status} ${d.error ? `| Error: ${d.error}` : ""}`)
      })
    }

    if (!isExecute) {
      console.log("\n⚠️ DRY RUN COMPLETED: No changes were written to MongoDB or ImageKit.")
      console.log("To execute real migration, run with: --execute\n")
    } else {
      console.log("\n✅ BATCH MIGRATION COMPLETED SUCCESSFULLY.\n")
    }
  } catch (err) {
    console.error("\n❌ Migration Error:", err.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB Atlas.")
  }
}

if (require.main === module) {
  run()
}

module.exports = { run }

