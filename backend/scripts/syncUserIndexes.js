const mongoose = require("mongoose")
const dotenv = require("dotenv")
const connectDB = require("../db/connection")
const User = require("../models/User")

dotenv.config()

/**
 * Migration Script: Sync User Indexes
 * Complies with Roadmap Phase 3: Tenant Isolation Layer.
 * 
 * Replaces global unique email index with:
 * 1. Compound unique index: { tenantId: 1, email: 1 } for tenant accounts
 * 2. Partial unique index: { email: 1 } where role === 'super_admin'
 * 
 * Safe migration with dry-run support.
 */

const runMigration = async () => {
  const isDryRun = process.argv.includes("--dry-run")
  console.log(`\n=== User Index Migration (${isDryRun ? "DRY-RUN MODE" : "EXECUTE MODE"}) ===\n`)

  try {
    await connectDB()
    const collection = mongoose.connection.collection("users")
    const existingIndexes = await collection.indexes()

    console.log("Existing Indexes on 'users' collection:")
    for (const idx of existingIndexes) {
      console.log(` - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${Boolean(idx.unique)})`)
    }

    const legacyEmailIndex = existingIndexes.find(
      (idx) => idx.name === "email_1" && idx.unique === true && !idx.partialFilterExpression
    )

    if (legacyEmailIndex) {
      console.log("\n⚠️ Found legacy global unique index 'email_1' without partialFilterExpression.")
      if (isDryRun) {
        console.log("   [DRY-RUN] Would drop index 'email_1'.")
      } else {
        console.log("   Dropping legacy index 'email_1'...")
        await collection.dropIndex("email_1")
        console.log("   ✅ Legacy index 'email_1' dropped successfully.")
      }
    } else {
      console.log("\n✅ No legacy unconditional 'email_1' index found.")
    }

    if (isDryRun) {
      console.log("\n[DRY-RUN] Would call User.syncIndexes() to create compound and partial indexes.")
    } else {
      console.log("\nSyncing Mongoose schema indexes...")
      await User.syncIndexes()
      console.log("✅ User indexes synced.")

      const updatedIndexes = await collection.indexes()
      console.log("\nUpdated Indexes on 'users' collection:")
      for (const idx of updatedIndexes) {
        console.log(
          ` - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${Boolean(idx.unique)}${
            idx.partialFilterExpression ? `, partial: ${JSON.stringify(idx.partialFilterExpression)}` : ""
          })`
        )
      }
    }

    console.log("\n✅ User index migration completed successfully.")
  } catch (err) {
    console.error("❌ Migration failed:", err.message)
    process.exit(1)
  } finally {
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  }
}

runMigration()
