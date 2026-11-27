/**
 * Safe City Repair Utility for Previously Imported Lead Batches (Dry-Run by Default).
 *
 * Usage:
 *   node backend/scripts/repairImportedLeadCities.js --tenant ACC-F372B78C --batch imp_1795774545838_qbbpuf --file path/to/leads.csv
 *   node backend/scripts/repairImportedLeadCities.js --tenant ACC-F372B78C --batch imp_1795774545838_qbbpuf --file path/to/leads.csv --apply
 */

const fs = require("fs")
const path = require("path")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
dotenv.config({ path: path.join(__dirname, "../.env") })

const { repairMissingCitiesFromFileBuffer } = require("../services/leadCityRepairService")

function parseArgs(argv) {
  const args = { dryRun: true, cityCols: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") args.dryRun = false
    else if (a === "--tenant") args.tenantId = argv[++i]
    else if (a === "--batch") args.importBatchId = argv[++i]
    else if (a === "--file") args.filePath = argv[++i]
    else if (a === "--city-col") args.cityCols.push(argv[++i])
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.tenantId || !args.filePath) {
    console.error("Usage: node repairImportedLeadCities.js --tenant <TENANT_ID> [--batch <BATCH_ID>] --file <CSV/XLSX/JSON_PATH> [--city-col <COL>] [--apply]")
    process.exit(1)
  }

  const absPath = path.resolve(args.filePath)
  if (!fs.existsSync(absPath)) {
    console.error(`Source file not found: ${absPath}`)
    process.exit(1)
  }

  const buffer = fs.readFileSync(absPath)
  await mongoose.connect(process.env.MONGODB_URI)

  try {
    const result = await repairMissingCitiesFromFileBuffer({
      tenantId: args.tenantId,
      importBatchId: args.importBatchId || "",
      buffer,
      originalName: path.basename(absPath),
      cityColumns: args.cityCols,
      dryRun: args.dryRun,
    })

    console.log("=== LEAD CITY REPAIR REPORT ===")
    console.log(JSON.stringify(result.summary, null, 2))
    if (result.details.eligible.length > 0) {
      console.log("Sample eligible repairs (first 20):", JSON.stringify(result.details.eligible.slice(0, 20), null, 2))
    }
    if (result.details.ambiguous.length > 0) {
      console.log("Ambiguous records skipped:", JSON.stringify(result.details.ambiguous.slice(0, 20), null, 2))
    }
    if (result.details.unmatched.length > 0) {
      console.log("Unmatched source rows:", JSON.stringify(result.details.unmatched.slice(0, 20), null, 2))
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((err) => {
  console.error("Repair failed:", err)
  process.exit(1)
})
