/**
 * Read-only diagnostic utility to detect suspected duplicate call records
 * across tenants in Leads-365 CRM database.
 * 
 * Safety: STRICTLY READ-ONLY. Does not delete, modify, or merge records.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const Call = require("../models/Call")

async function diagnoseDuplicates() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/leads365"
  console.log("Connecting to database (Read-Only Diagnostic)...")
  await mongoose.connect(mongoUri)
  console.log("Connected successfully.\n")

  const allCalls = await Call.find({})
    .setOptions({ skipTenantFilter: true })
    .sort({ tenantId: 1, phoneNormalized: 1, startTimeMs: 1 })
    .lean()

  console.log(`Total call records scanned: ${allCalls.length}`)

  const duplicateGroups = []
  const visited = new Set()

  for (let i = 0; i < allCalls.length; i++) {
    const c1 = allCalls[i]
    if (visited.has(c1._id.toString())) continue

    const group = [c1]
    const phone1 = c1.phoneNormalized || c1.phoneNumber || c1.number
    const t1 = c1.startTimeMs || (c1.startedAt ? new Date(c1.startedAt).getTime() : 0)
    const dir1 = (c1.callDirection || c1.direction || "").toLowerCase()

    for (let j = i + 1; j < allCalls.length; j++) {
      const c2 = allCalls[j]
      if (visited.has(c2._id.toString())) continue
      if (c1.tenantId !== c2.tenantId) continue

      const phone2 = c2.phoneNormalized || c2.phoneNumber || c2.number
      if (phone1 !== phone2) break // Sorted by tenant and phone

      const t2 = c2.startTimeMs || (c2.startedAt ? new Date(c2.startedAt).getTime() : 0)
      const dir2 = (c2.callDirection || c2.direction || "").toLowerCase()

      // Match criteria: same tenant, same phone, same direction, within +/- 10s start time
      const timeDiffMs = Math.abs(t1 - t2)
      const isSameDirection = dir1 === dir2 || (!dir1 && !dir2)
      if (timeDiffMs <= 10000 && isSameDirection) {
        group.push(c2)
        visited.add(c2._id.toString())
      }
    }

    if (group.length > 1) {
      visited.add(c1._id.toString())
      duplicateGroups.push(group)
    }
  }

  console.log(`\n=======================================================`)
  console.log(`SUSPECTED DUPLICATE CALL GROUPS FOUND: ${duplicateGroups.length}`)
  console.log(`=======================================================\n`)

  duplicateGroups.forEach((group, index) => {
    console.log(`[Group #${index + 1}] Phone: ${group[0].phoneNormalized || group[0].phoneNumber} | Tenant: ${group[0].tenantId} | Count: ${group.length}`)
    group.forEach((call, cIdx) => {
      console.log(`  Entry ${cIdx + 1}:`)
      console.log(`    - ID:            ${call._id}`)
      console.log(`    - clientCallId:  ${call.clientCallId || "(none)"}`)
      console.log(`    - startedAt:     ${call.startedAt || new Date(call.startTimeMs)}`)
      console.log(`    - duration:      ${call.durationSeconds || call.duration}s`)
      console.log(`    - direction:     ${call.callDirection || call.direction}`)
      console.log(`    - outcome:       ${call.callOutcome || call.disposition}`)
      console.log(`    - hasRecording:  ${call.hasRecording}`)
      console.log(`    - recordingFile: ${call.recording?.fileId || "(none)"} (status: ${call.recording?.status || "none"})`)
      console.log(`    - leadId:        ${call.leadId || "(unlinked)"}`)
      console.log(`    - source:        ${call.source || "(default)"}`)
    })
    console.log("-------------------------------------------------------")
  })

  await mongoose.disconnect()
  console.log("\nDiagnostic scan complete. Disconnected from database.")
  return duplicateGroups
}

if (require.main === module) {
  diagnoseDuplicates().catch((err) => {
    console.error("Diagnostic failed:", err)
    process.exit(1)
  })
}

module.exports = { diagnoseDuplicates }
