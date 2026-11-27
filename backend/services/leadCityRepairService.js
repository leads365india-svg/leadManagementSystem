const Lead = require("../models/Lead")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { parseLeadImportFile, suggestColumnMapping } = require("./leadImportService")

/**
 * Safely repairs missing `Lead.city` values for previously imported batches using
 * an original CSV/Excel/JSON file or source rows, without overwriting any existing
 * non-empty `city`, creating duplicates, or altering tenant/workspace/ownership fields.
 */
async function repairMissingCitiesFromSource({
  tenantId,
  importBatchId = "",
  rows = [],
  mapping = {},
  cityColumns = [],
  dryRun = true,
} = {}) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("tenantId is required for lead city repair")
  }
  const cleanTenantId = tenantId.trim()
  const cleanBatchId = typeof importBatchId === "string" ? importBatchId.trim() : ""

  const candidateCityCols = Array.from(
    new Set([
      ...cityColumns.filter(Boolean),
      ...Object.entries(mapping || {})
        .filter(([, target]) => target === "city")
        .map(([col]) => col),
    ]),
  )

  const emailCol = Object.entries(mapping || {}).find(([, target]) => target === "email")?.[0] || null
  const phoneCol = Object.entries(mapping || {}).find(([, target]) => target === "phone")?.[0] || null

  const scopedQuery = {
    tenantId: cleanTenantId,
    deletedAt: null,
  }
  if (cleanBatchId) {
    scopedQuery["metadata.importBatchId"] = cleanBatchId
  }

  const candidateLeads = await Lead.find(scopedQuery)
    .setOptions({ skipTenantFilter: true })
    .select("_id tenantId workspaceId name email phone phoneNormalized city metadata.importBatchId metadata.idempotencyKey")
    .lean()

  const leadsByRowIdemp = new Map()
  const leadsByEmail = new Map()
  const leadsByPhone = new Map()

  for (const lead of candidateLeads) {
    const idemp = lead?.metadata?.idempotencyKey
    if (idemp) {
      leadsByRowIdemp.set(idemp, lead)
    }
    const em = typeof lead.email === "string" ? lead.email.toLowerCase().trim() : ""
    if (em) {
      if (!leadsByEmail.has(em)) leadsByEmail.set(em, [])
      leadsByEmail.get(em).push(lead)
    }
    const phNorm =
      (typeof lead.phoneNormalized === "string" && lead.phoneNormalized.trim()) ||
      (typeof lead.phone === "string" && lead.phone.trim() ? normalizePhoneE164(lead.phone.trim()) : "")
    if (phNorm) {
      if (!leadsByPhone.has(phNorm)) leadsByPhone.set(phNorm, [])
      leadsByPhone.get(phNorm).push(lead)
    }
  }

  const summary = {
    totalSourceRows: rows.length,
    eligibleRepairs: 0,
    repairedCount: 0,
    alreadyPopulatedCount: 0,
    emptySourceCityCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
    dryRun: Boolean(dryRun),
  }

  const details = {
    eligible: [],
    alreadyPopulated: [],
    unmatched: [],
    ambiguous: [],
  }

  const processedLeadIds = new Set()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {}
    const rowNumber = Number(row.__rowNumber) || i + 1

    // Pick first non-empty city value across mapped/candidate City columns
    let resolvedCity = ""
    for (const cCol of candidateCityCols) {
      const val = row[cCol] !== undefined && row[cCol] !== null ? String(row[cCol]).trim() : ""
      if (val) {
        resolvedCity = val
        break
      }
    }

    if (!resolvedCity) {
      summary.emptySourceCityCount++
      continue
    }

    const rowEmail = emailCol && row[emailCol] ? String(row[emailCol]).toLowerCase().trim() : ""
    const rawPhone = phoneCol && row[phoneCol] ? String(row[phoneCol]).trim() : ""
    const rowPhoneNorm = rawPhone ? normalizePhoneE164(rawPhone) : ""

    let matchedLead = null
    let matchReason = ""

    // 1. Exact idempotency row match within same batch when available & email/phone agrees
    if (cleanBatchId) {
      const batchMatch = leadsByRowIdemp.get(`import:${cleanBatchId}:row:${rowNumber}`)
      if (batchMatch) {
        const emMatches = rowEmail && batchMatch.email === rowEmail
        const phMatches = rowPhoneNorm && batchMatch.phoneNormalized === rowPhoneNorm
        if (emMatches || phMatches || (!rowEmail && !rowPhoneNorm)) {
          matchedLead = batchMatch
          matchReason = emMatches && phMatches ? "batch+email+phone" : emMatches ? "batch+email" : "batch+phone"
        }
      }
    }

    // 2. Confident phone + email match inside tenant/batch scope
    if (!matchedLead) {
      const phoneHits = rowPhoneNorm ? leadsByPhone.get(rowPhoneNorm) || [] : []
      const emailHits = rowEmail ? leadsByEmail.get(rowEmail) || [] : []

      if (phoneHits.length === 1 && emailHits.length <= 1) {
        if (emailHits.length === 0 || String(emailHits[0]._id) === String(phoneHits[0]._id)) {
          matchedLead = phoneHits[0]
          matchReason = emailHits.length === 1 ? "email+phone" : "phone"
        } else {
          summary.ambiguousCount++
          details.ambiguous.push({
            rowNumber,
            email: rowEmail,
            phone: rawPhone,
            reason: "Email and phone matched different lead records",
          })
          continue
        }
      } else if (emailHits.length === 1 && phoneHits.length <= 1) {
        if (phoneHits.length === 0 || String(phoneHits[0]._id) === String(emailHits[0]._id)) {
          matchedLead = emailHits[0]
          matchReason = "email"
        } else {
          summary.ambiguousCount++
          details.ambiguous.push({
            rowNumber,
            email: rowEmail,
            phone: rawPhone,
            reason: "Email and phone matched different lead records",
          })
          continue
        }
      } else if (phoneHits.length > 1 || emailHits.length > 1) {
        summary.ambiguousCount++
        details.ambiguous.push({
          rowNumber,
          email: rowEmail,
          phone: rawPhone,
          reason: `Matched multiple lead records (email=${emailHits.length}, phone=${phoneHits.length})`,
        })
        continue
      }
    }

    if (!matchedLead) {
      summary.unmatchedCount++
      details.unmatched.push({
        rowNumber,
        email: rowEmail,
        phone: rawPhone,
        sourceCity: resolvedCity,
        reason: "No matching lead record found in target scope",
      })
      continue
    }

    const leadIdStr = matchedLead._id.toString()
    if (processedLeadIds.has(leadIdStr)) continue
    processedLeadIds.add(leadIdStr)

    if (matchedLead.city && String(matchedLead.city).trim() !== "") {
      summary.alreadyPopulatedCount++
      details.alreadyPopulated.push({
        leadId: leadIdStr,
        rowNumber,
        existingCity: matchedLead.city,
        sourceCity: resolvedCity,
      })
      continue
    }

    summary.eligibleRepairs++
    details.eligible.push({
      leadId: leadIdStr,
      name: matchedLead.name,
      email: matchedLead.email,
      phone: matchedLead.phone,
      workspaceId: matchedLead.workspaceId ? matchedLead.workspaceId.toString() : null,
      rowNumber,
      newCity: resolvedCity,
      matchedBy: matchReason,
    })

    if (!dryRun) {
      const upd = await Lead.updateOne(
        {
          _id: matchedLead._id,
          tenantId: cleanTenantId,
          $or: [{ city: "" }, { city: null }, { city: { $exists: false } }],
        },
        { $set: { city: resolvedCity } },
      ).setOptions({ skipTenantFilter: true })

      if (upd.modifiedCount > 0) {
        summary.repairedCount++
      }
    }
  }

  return { summary, details }
}

async function repairMissingCitiesFromFileBuffer({
  tenantId,
  importBatchId = "",
  buffer,
  originalName = "import.csv",
  mimetype = "",
  cityColumns = [],
  dryRun = true,
} = {}) {
  const parsed = parseLeadImportFile({ buffer, originalName, mimetype })
  const autoMapping = suggestColumnMapping(parsed.headers, [], {
    nestedColumnMeta: parsed.nestedColumnMeta,
  })

  // Collect any additional headers clearly representing City/Location in case rows switched case/source column
  const detectedCityCols = parsed.headers.filter((h) => {
    const clean = String(h || "").toLowerCase()
    const leaf = clean.includes(".") ? clean.split(".").pop().trim() : clean.trim()
    return ["city", "location", "town", "city name", "your city"].includes(leaf)
  })

  return repairMissingCitiesFromSource({
    tenantId,
    importBatchId,
    rows: parsed.rows,
    mapping: autoMapping,
    cityColumns: [...cityColumns, ...detectedCityCols],
    dryRun,
  })
}

module.exports = {
  repairMissingCitiesFromSource,
  repairMissingCitiesFromFileBuffer,
}
