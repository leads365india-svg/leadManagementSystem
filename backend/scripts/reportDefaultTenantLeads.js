/**
 * One-off script to audit and report leads on 'default-tenant' or missing tenantId.
 * Complies with Roadmap Phase 1: Security leftovers and repo hygiene.
 * 
 * Safety:
 * - Runs in DRY-RUN mode by default (read-only audit).
 * - Never deletes records.
 * - Only migrates if --migrate-to=<targetTenantId> flag is explicitly provided.
 * 
 * Usage:
 *   node scripts/reportDefaultTenantLeads.js             # Dry-run audit
 *   node scripts/reportDefaultTenantLeads.js --migrate-to=ACC-87603BA9 # Reassigns to verified tenant
 */

require("dotenv").config()
const mongoose = require("mongoose")
const connectDB = require("../db/connection")
const Lead = require("../models/Lead")

async function reportDefaultTenantLeads() {
  console.log("=======================================================")
  console.log("   AUDIT: LEADS WITH DEFAULT-TENANT OR UNASSIGNED      ")
  console.log("=======================================================\n")

  const args = process.argv.slice(2)
  const migrateArg = args.find((a) => a.startsWith("--migrate-to="))
  const targetTenantId = migrateArg ? migrateArg.split("=")[1].trim() : null

  await connectDB()

  try {
    const query = {
      $or: [
        { tenantId: "default-tenant" },
        { tenantId: null },
        { tenantId: "" },
        { tenantId: { $exists: false } },
      ],
    }

    const ambiguousLeads = await Lead.find(query).lean()
    const totalCount = await Lead.countDocuments()

    console.log(`📊 Total leads in database: ${totalCount}`)
    console.log(`🔍 Found ${ambiguousLeads.length} leads with 'default-tenant' or missing tenantId.\n`)

    if (ambiguousLeads.length === 0) {
      console.log("✅ All leads have valid tenant assignments. No action needed.")
      process.exit(0)
    }

    console.log("Listing ambiguous records:")
    console.log("--------------------------------------------------------------------------------")
    ambiguousLeads.forEach((lead, index) => {
      console.log(
        `[${index + 1}] ID: ${lead._id} | Name: "${lead.name}" | Email: ${lead.email || "—"} | Phone: ${lead.phone || "—"} | Status: ${lead.status} | Created: ${lead.createdAt ? new Date(lead.createdAt).toISOString() : "—"}`
      )
    })
    console.log("--------------------------------------------------------------------------------\n")

    if (!targetTenantId) {
      console.log("🛡️  DRY-RUN MODE COMPLETE:")
      console.log("   No records were modified.")
      console.log("   To reassign these records to an active tenant, run with:")
      console.log("   node scripts/reportDefaultTenantLeads.js --migrate-to=<TENANT_ID>\n")
    } else {
      console.log(`⚠️  MIGRATION REQUESTED: Reassigning ${ambiguousLeads.length} leads to tenant '${targetTenantId}'...`)
      const result = await Lead.updateMany(query, { $set: { tenantId: targetTenantId } })
      console.log(`✅ Successfully migrated ${result.modifiedCount} records to tenant '${targetTenantId}'.`)
    }
  } catch (error) {
    console.error("❌ Error executing audit script:", error.message)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log("Database connection closed cleanly.")
  }
}

reportDefaultTenantLeads()
