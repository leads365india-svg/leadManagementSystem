/**
 * ============================================================================
 * Leads365 — Safe Partial Unique Index Migration & Preflight Script
 * ============================================================================
 * 
 * PURPOSE:
 * Inspect and create hardened, concurrency-safe unique partial indexes for:
 *   1. FollowUp: { tenantId: 1, sourceCallId: 1 }
 *   2. FollowUp: { tenantId: 1, idempotencyKey: 1 }
 *   3. Call:     { tenantId: 1, clientCallId: 1 }
 * 
 * SAFEGUARDS:
 * - Defaults to DRY-RUN mode.
 * - Inspects and reports existing duplicate keys before altering any indexes.
 * - If duplicate keys exist, ABORTS immediately with a report; NEVER deletes
 *   or modifies existing records automatically.
 * - Excludes empty strings (""), null, and missing values from unique partial filters.
 * - Does NOT run on normal application startup.
 * 
 * MANUAL MIGRATION PROCEDURE:
 * Step 1: Run preflight dry-run to inspect existing records and indexes:
 *         node scripts/migrateUniqueIndexes.js --dry-run
 * 
 * Step 2: If duplicates are found, manually review the printed document IDs
 *         with business stakeholders to resolve duplicate records.
 * 
 * Step 3: Once zero duplicate keys are reported, apply the migration:
 *         node scripts/migrateUniqueIndexes.js --apply
 * ============================================================================
 */

const path = require("path")
const mongoose = require("mongoose")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const args = process.argv.slice(2)
const isApply = args.includes("--apply")
const isDryRun = !isApply || args.includes("--dry-run")

const uriArg = args.find((a) => a.startsWith("--uri="))
const mongoUri = uriArg ? uriArg.split("=")[1] : process.env.MONGODB_URI

if (!mongoUri) {
  console.error("ERROR: No MongoDB URI provided. Set MONGODB_URI in .env or pass --uri=<connection_string>")
  process.exit(1)
}

async function scanDuplicates(collection, fieldName, label) {
  const pipeline = [
    {
      $match: {
        [fieldName]: { $type: "string", $gt: "" },
        tenantId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { tenantId: "$tenantId", key: `$${fieldName}` },
        count: { $sum: 1 },
        docIds: { $push: "$_id" },
        createdAts: { $push: "$createdAt" },
      },
    },
    {
      $match: {
        count: { $gt: 1 },
      },
    },
  ]

  const duplicates = await collection.aggregate(pipeline).toArray()
  return duplicates
}

async function runMigration() {
  console.log("================================================================================")
  console.log(`Leads365 Partial Unique Index Migration Tool [Mode: ${isApply ? "APPLY" : "DRY-RUN"}]`)
  console.log("================================================================================")

  console.log(`Connecting to MongoDB...`)
  await mongoose.connect(mongoUri)
  const db = mongoose.connection.db

  const followUpCol = db.collection("followups")
  const callCol = db.collection("calls")

  let totalDuplicateGroups = 0

  // 1. Preflight Duplicate Checks
  console.log("\n--- [Step 1: Preflight Duplicate Key Inspection] ---")

  const fuSourceDuplicates = await scanDuplicates(followUpCol, "sourceCallId", "FollowUp (sourceCallId)")
  if (fuSourceDuplicates.length > 0) {
    console.warn(`[WARNING] Found ${fuSourceDuplicates.length} duplicate groups for FollowUp { tenantId, sourceCallId }:`)
    for (const d of fuSourceDuplicates) {
      console.warn(`  - Tenant: ${d._id.tenantId}, sourceCallId: "${d._id.key}", Count: ${d.count}, IDs: [${d.docIds.join(", ")}]`)
    }
    totalDuplicateGroups += fuSourceDuplicates.length
  } else {
    console.log("  [OK] No duplicate { tenantId, sourceCallId } found in followups.")
  }

  const fuIdempDuplicates = await scanDuplicates(followUpCol, "idempotencyKey", "FollowUp (idempotencyKey)")
  if (fuIdempDuplicates.length > 0) {
    console.warn(`[WARNING] Found ${fuIdempDuplicates.length} duplicate groups for FollowUp { tenantId, idempotencyKey }:`)
    for (const d of fuIdempDuplicates) {
      console.warn(`  - Tenant: ${d._id.tenantId}, idempotencyKey: "${d._id.key}", Count: ${d.count}, IDs: [${d.docIds.join(", ")}]`)
    }
    totalDuplicateGroups += fuIdempDuplicates.length
  } else {
    console.log("  [OK] No duplicate { tenantId, idempotencyKey } found in followups.")
  }

  const callDuplicates = await scanDuplicates(callCol, "clientCallId", "Call (clientCallId)")
  if (callDuplicates.length > 0) {
    console.warn(`[WARNING] Found ${callDuplicates.length} duplicate groups for Call { tenantId, clientCallId }:`)
    for (const d of callDuplicates) {
      console.warn(`  - Tenant: ${d._id.tenantId}, clientCallId: "${d._id.key}", Count: ${d.count}, IDs: [${d.docIds.join(", ")}]`)
    }
    totalDuplicateGroups += callDuplicates.length
  } else {
    console.log("  [OK] No duplicate { tenantId, clientCallId } found in calls.")
  }

  // 2. Existing Index Definitions
  console.log("\n--- [Step 2: Current Collection Indexes] ---")
  const fuIndexes = await followUpCol.indexes()
  console.log("FollowUps collection indexes:")
  for (const idx of fuIndexes) {
    console.log(`  - ${idx.name}: unique=${!!idx.unique}, partialFilter=${JSON.stringify(idx.partialFilterExpression || null)}`)
  }

  const callIndexes = await callCol.indexes()
  console.log("\nCalls collection indexes:")
  for (const idx of callIndexes) {
    console.log(`  - ${idx.name}: unique=${!!idx.unique}, partialFilter=${JSON.stringify(idx.partialFilterExpression || null)}`)
  }

  // 3. Target Index Definitions
  console.log("\n--- [Step 3: Target Unique Partial Index Definitions] ---")
  console.log("Target 1: followups -> { tenantId: 1, sourceCallId: 1 }")
  console.log("          Options: { unique: true, partialFilterExpression: { sourceCallId: { $type: 'string', $gt: '' } } }")
  console.log("Target 2: followups -> { tenantId: 1, idempotencyKey: 1 }")
  console.log("          Options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } } }")
  console.log("Target 3: calls     -> { tenantId: 1, clientCallId: 1 }")
  console.log("          Options: { unique: true, partialFilterExpression: { clientCallId: { $type: 'string', $gt: '' } } }")

  // 4. Execution or Dry-run conclusion
  if (totalDuplicateGroups > 0) {
    console.error(`\n[BLOCKED] Found ${totalDuplicateGroups} duplicate groups among existing documents!`)
    console.error("Unique indexes CANNOT be applied while duplicate keys exist.")
    console.error("Action required: Manually inspect and resolve the reported duplicate IDs before running with --apply.")
    console.error("NO database records or indexes were modified.")
    await mongoose.disconnect()
    process.exit(1)
  }

  if (isDryRun) {
    console.log("\n--- [Step 4: Dry-Run Assessment] ---")
    console.log("[SUCCESS] Preflight passed! Zero duplicate keys detected.")
    console.log("All requirements for unique partial indexes are satisfied.")
    console.log("To apply these changes, re-run with: node scripts/migrateUniqueIndexes.js --apply")
    await mongoose.disconnect()
    process.exit(0)
  }

  // Apply Mode
  console.log("\n--- [Step 4: Applying Index Changes] ---")

  // Reconcile FollowUp Indexes
  for (const idx of fuIndexes) {
    if (idx.name === "tenantId_1_sourceCallId_1" || idx.name === "tenantId_1_idempotencyKey_1") {
      const isCorrect = idx.unique &&
        ((idx.name === "tenantId_1_sourceCallId_1" && idx.partialFilterExpression?.sourceCallId?.$gt) ||
         (idx.name === "tenantId_1_idempotencyKey_1" && idx.partialFilterExpression?.idempotencyKey?.$gt))
      if (!isCorrect) {
        console.log(`Dropping legacy index: followups.${idx.name}`)
        await followUpCol.dropIndex(idx.name).catch(() => {})
      }
    }
  }

  console.log("Creating unique partial index: followups { tenantId: 1, sourceCallId: 1 }")
  await followUpCol.createIndex(
    { tenantId: 1, sourceCallId: 1 },
    { unique: true, partialFilterExpression: { sourceCallId: { $type: "string", $gt: "" } } }
  )

  console.log("Creating unique partial index: followups { tenantId: 1, idempotencyKey: 1 }")
  await followUpCol.createIndex(
    { tenantId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string", $gt: "" } } }
  )

  // Reconcile Call Index
  for (const idx of callIndexes) {
    if (idx.name === "tenantId_1_clientCallId_1") {
      const isCorrect = idx.unique && idx.partialFilterExpression?.clientCallId?.$gt
      if (!isCorrect) {
        console.log(`Dropping legacy index: calls.${idx.name}`)
        await callCol.dropIndex(idx.name).catch(() => {})
      }
    } else if (idx.name === "clientCallId_1") {
      console.log(`Dropping legacy non-tenant-scoped index: calls.${idx.name}`)
      await callCol.dropIndex(idx.name).catch(() => {})
    }
  }

  console.log("Creating unique partial index: calls { tenantId: 1, clientCallId: 1 }")
  await callCol.createIndex(
    { tenantId: 1, clientCallId: 1 },
    { unique: true, partialFilterExpression: { clientCallId: { $type: "string", $gt: "" } } }
  )

  // Verify resulting indexes
  console.log("\n--- [Step 5: Verified Resulting Indexes] ---")
  const verifiedFu = await followUpCol.indexes()
  for (const idx of verifiedFu) {
    if (idx.name.includes("sourceCallId") || idx.name.includes("idempotencyKey")) {
      console.log(`  followups.${idx.name}: unique=${idx.unique}, filter=${JSON.stringify(idx.partialFilterExpression)}`)
    }
  }

  const verifiedCall = await callCol.indexes()
  for (const idx of verifiedCall) {
    if (idx.name.includes("clientCallId")) {
      console.log(`  calls.${idx.name}: unique=${idx.unique}, filter=${JSON.stringify(idx.partialFilterExpression)}`)
    }
  }

  console.log("\n[SUCCESS] All partial unique indexes successfully applied and verified!")
  await mongoose.disconnect()
}

runMigration().catch((err) => {
  console.error("Migration failed with error:", err)
  process.exit(1)
})
