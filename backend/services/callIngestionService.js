const mongoose = require("mongoose")
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const User = require("../models/User")
const recordingStorage = require("./recordingStorage")
const callService = require("./callService")
const privacyService = require("./privacyService")
const audit = require("./auditService")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")
const { activity } = require("./activityService")

/**
 * Phase 21: Call Ingestion Service (Manual Upload & Review Queue)
 * 
 * Provides:
 * 1. Audio recording manual ingestion with filename phone extraction, lead matching & DNR checks.
 * 2. CSV batch call records ingestion with phone normalization and duplicate prevention.
 * 3. Unmatched manual calls review queue for staff verification and assignment.
 * 4. Manual lead linking and quick-create lead resolution.
 */

/**
 * Sanitizes a filename, stripping directory traversal and non-safe characters.
 */
function sanitizeFilename(filename = "") {
  if (!filename) return `manual_${Date.now()}.m4a`
  return String(filename)
    .replace(/^.*[\\\/]/, "") // Strip directory path
    .replace(/[^a-zA-Z0-9._\-+]/g, "_") // Safe characters only
    .substring(0, 150)
}

/**
 * Extracts a candidate phone number from an audio filename or text.
 * Handles formats like:
 * - 9876543210_call_20261027.m4a
 * - call_+919876543210_12345.mp3
 * - 09876543210.wav
 */
function extractPhoneFromFilename(filename = "") {
  if (!filename) return null

  const clean = sanitizeFilename(filename)
  
  // 1. Look for explicit +91 or country-code formatted numbers
  const ccMatch = clean.match(/(?:\+?91|0)?[6-9]\d{9}/)
  if (ccMatch) {
    return ccMatch[0]
  }

  // 2. Generic 10 to 12 digit sequence
  const genericMatch = clean.match(/\d{10,12}/)
  if (genericMatch) {
    return genericMatch[0]
  }

  return null
}

/**
 * Ingests a single audio recording file directly into GridFS.
 * Matches to an active Lead or queues for manual review if unmatched.
 */
async function ingestAudioRecording({
  tenantId,
  agentId,
  user,
  readStream,
  filename = "manual_call.m4a",
  mimeType = "audio/mp4",
  contentLength = 0,
  expectedSha256 = null,
  explicitPhone = null,
  duration = 0,
  startedAt = null,
  direction = "outbound",
  disposition = "connected",
  notes = "",
}) {
  if (!tenantId) {
    const err = new Error("Tenant ID is required for call ingestion")
    err.statusCode = 400
    throw err
  }

  const safeName = sanitizeFilename(filename)
  const phoneCandidate = explicitPhone || extractPhoneFromFilename(safeName)

  if (!phoneCandidate) {
    const err = new Error("No valid phone number found in filename or parameters. Include phone number in filename (e.g., 9876543210_call.mp3) or provide x-phone-number header.")
    err.statusCode = 400
    err.code = "PHONE_NUMBER_NOT_DETECTED"
    throw err
  }

  const phoneNormalized = normalizePhoneE164(phoneCandidate, "+91")
  if (!phoneNormalized) {
    const err = new Error(`Invalid phone number format: '${phoneCandidate}'`)
    err.statusCode = 400
    err.code = "INVALID_PHONE_NUMBER"
    throw err
  }

  // Determine accountable agent
  let assignedAgentId = user?._id
  if (agentId && (user?.role === "account_admin" || user?.role === "super_admin") && mongoose.Types.ObjectId.isValid(agentId)) {
    assignedAgentId = agentId
  }

  // 1. Lead Matching (agent-first with tenant fallback)
  const lead = await callService.findLeadByPhoneNumber(phoneNormalized, tenantId, assignedAgentId)

  // 2. Privacy & Do-Not-Record (DNR) Policy Verification
  const privacyCheck = await privacyService.evaluateRecordingEligibility({
    tenantId,
    lead: lead || null,
    phoneNumber: phoneNormalized,
  })

  if (!privacyCheck.allowed) {
    const err = new Error(privacyCheck.message || "Recording forbidden: Lead or phone number has active Do-Not-Record rule")
    err.statusCode = 403
    err.code = privacyCheck.reason || "RECORDING_FORBIDDEN_DNR"
    throw err
  }

  // 3. Create Call record in DB
  const call = new Call({
    tenantId,
    leadId: lead ? lead._id : null,
    agentId: assignedAgentId,
    direction: ["inbound", "outbound"].includes(direction) ? direction : "outbound",
    number: phoneCandidate,
    phoneNormalized,
    startedAt: startedAt ? new Date(startedAt) : new Date(),
    duration: Math.max(0, parseInt(duration, 10) || 0),
    status: "completed",
    disposition: disposition || "connected",
    notes: notes || (lead ? `Manual audio upload: ${safeName}` : `Unmatched manual upload: ${safeName}`),
    source: "manual",
    recording: {
      status: "pending",
      sizeBytes: contentLength || 0,
    },
  })

  await call.save()

  // 4. Stream recording directly into GridFS
  let uploadResult = null
  try {
    uploadResult = await recordingStorage.streamUpload({
      callId: call._id.toString(),
      tenantId,
      user,
      readStream,
      mimeType,
      filename: safeName,
      contentLength,
      expectedSha256,
      allowUnmatchedReview: true, // Allow review queue staging
    })
  } catch (uploadErr) {
    // If upload fails, mark recording status as failed
    call.recording.status = "failed"
    await call.save()
    throw uploadErr
  }

  // Reload fresh Call document with updated GridFS recording status and fileId
  const freshCall = await Call.findById(call._id).setOptions({ skipTenantFilter: true })

  // 5. Activity log and Lead lastContactedAt update if matched
  if (lead) {
    lead.lastContactedAt = new Date()
    await lead.save()

    try {
      await activity.record({
        tenantId,
        leadId: lead._id,
        type: "call.logged",
        actor: {
          id: user?._id || assignedAgentId,
          name: user?.name || "Agent",
          email: user?.email || "",
          role: user?.role || "agent",
        },
        payload: {
          callId: freshCall._id.toString(),
          duration: freshCall.duration,
          direction: freshCall.direction,
          status: freshCall.status,
          hasRecording: true,
          source: "manual",
        },
      })
    } catch (actErr) {
      console.warn("[CallIngestion] Activity logging warning:", actErr.message)
    }
  }

  // Audit log
  await audit.log({
    tenantId,
    actor: { id: user?._id, name: user?.name, email: user?.email, role: user?.role },
    action: "call.manual_ingestion_audio",
    entity: "Call",
    entityId: freshCall._id,
    summary: `Ingested manual call audio ${safeName} (${lead ? "Matched to " + lead.name : "Unmatched - Queued for review"})`,
    details: { callId: freshCall._id, leadId: lead?._id || null, phone: phoneNormalized, status: lead ? "matched" : "unmatched" },
  })

  return {
    success: true,
    status: lead ? "matched" : "unmatched",
    call: freshCall,
    lead: lead ? { id: lead._id, name: lead.name, phone: lead.phone, status: lead.status } : null,
    recording: uploadResult,
    filename: safeName,
    message: lead 
      ? `Audio successfully ingested and linked to lead ${lead.name}`
      : "Audio uploaded. No matching lead found; call placed in Review Queue for manual matching.",
  }
}

/**
 * Parses raw CSV string into an array of normalized object records.
 */
function parseCsvString(csvText = "") {
  if (!csvText || typeof csvText !== "string") return []

  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headerLine = lines[0]
  // Parse header columns
  const headers = headerLine.split(",").map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase())

  const results = []
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row) continue

    // Handle standard CSV commas with quotes support
    const values = []
    let inQuotes = false
    let curVal = ""
    for (let c = 0; c < row.length; c++) {
      const char = row[c]
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes
      } else if (char === "," && !inQuotes) {
        values.push(curVal.trim().replace(/^["']|["']$/g, ""))
        curVal = ""
      } else {
        curVal += char
      }
    }
    values.push(curVal.trim().replace(/^["']|["']$/g, ""))

    const item = {}
    headers.forEach((h, idx) => {
      item[h] = values[idx] || ""
    })
    results.push(item)
  }

  return results
}

/**
 * Ingests a batch of call records from CSV or JSON records.
 */
async function ingestCsvRecords({ tenantId, agentId, user, records = [], csvText = null }) {
  if (!tenantId) {
    const err = new Error("Tenant ID is required for CSV call ingestion")
    err.statusCode = 400
    throw err
  }

  let rows = Array.isArray(records) && records.length > 0 ? records : []
  if (csvText) {
    const parsed = parseCsvString(csvText)
    rows = [...rows, ...parsed]
  }

  if (rows.length === 0) {
    const err = new Error("No call records provided. Please supply parsed records array or csvText.")
    err.statusCode = 400
    throw err
  }

  const results = {
    total: rows.length,
    matched: 0,
    unmatched: 0,
    failed: 0,
    skippedDuplicates: 0,
    items: [],
  }

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    const rawPhone = row.phone || row.number || row.mobile || row["phone number"] || ""
    const clientCallId = row.clientcallid || row.idempotencykey || row.id || null
    const direction = ["inbound", "outbound"].includes((row.direction || "").toLowerCase()) ? row.direction.toLowerCase() : "outbound"
    const duration = parseInt(row.duration, 10) || 0
    const disposition = row.disposition || "connected"
    const notes = row.notes || row.note || ""
    const startedAt = row.date || row.startedat || row.time ? new Date(row.date || row.startedat || row.time) : new Date()

    if (!rawPhone) {
      results.failed++
      results.items.push({ row: idx + 1, status: "failed", error: "Missing required phone number" })
      continue
    }

    const phoneNormalized = normalizePhoneE164(rawPhone, "+91")
    if (!phoneNormalized) {
      results.failed++
      results.items.push({ row: idx + 1, phone: rawPhone, status: "failed", error: "Invalid phone number format" })
      continue
    }

    // Idempotency check: Skip if clientCallId already exists in tenant
    if (clientCallId) {
      const existing = await Call.findOne({ tenantId, clientCallId }).setOptions({ skipTenantFilter: true })
      if (existing) {
        results.skippedDuplicates++
        results.items.push({
          row: idx + 1,
          phone: phoneNormalized,
          status: "skipped_duplicate",
          callId: existing._id,
          message: "Call already recorded (idempotent)",
        })
        continue
      }
    }

    // Determine agent for this row
    let rowAgentId = user?._id
    if (row.agentid && (user?.role === "account_admin" || user?.role === "super_admin") && mongoose.Types.ObjectId.isValid(row.agentid)) {
      rowAgentId = row.agentid
    }

    // Lead matching
    const lead = await callService.findLeadByPhoneNumber(phoneNormalized, tenantId, rowAgentId)

    // Evaluate DNR
    const privacyCheck = await privacyService.evaluateRecordingEligibility({
      tenantId,
      lead: lead || null,
      phoneNumber: phoneNormalized,
    })

    const call = new Call({
      tenantId,
      leadId: lead ? lead._id : null,
      agentId: rowAgentId,
      clientCallId: clientCallId || null,
      direction,
      number: rawPhone,
      phoneNormalized,
      startedAt: isNaN(startedAt.getTime()) ? new Date() : startedAt,
      duration,
      status: "completed",
      disposition,
      notes,
      source: "manual",
      recording: {
        status: privacyCheck.allowed ? "none" : "skipped_dnr",
      },
    })

    await call.save()

    if (lead) {
      results.matched++
      lead.lastContactedAt = new Date()
      await lead.save()

      try {
        await activity.callLogged({
          tenantId,
          leadId: lead._id,
          actor: {
            id: user?._id || rowAgentId,
            name: user?.name || "Agent",
            email: user?.email || "",
            role: user?.role || "agent",
          },
          callId: call._id,
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          hasRecording: false,
        })
      } catch (e) {
        // Continue on activity log failure
      }

      results.items.push({
        row: idx + 1,
        phone: phoneNormalized,
        status: "matched",
        callId: call._id,
        leadId: lead._id,
        leadName: lead.name,
      })
    } else {
      results.unmatched++
      results.items.push({
        row: idx + 1,
        phone: phoneNormalized,
        status: "unmatched",
        callId: call._id,
        message: "Logged as unmatched call. Added to review queue.",
      })
    }
  }

  // Audit log summary
  await audit.log({
    tenantId,
    actor: { id: user?._id, name: user?.name, email: user?.email, role: user?.role },
    action: "call.csv_batch_ingestion",
    entity: "Call",
    summary: `CSV Ingestion: ${results.matched} matched, ${results.unmatched} unmatched, ${results.failed} failed`,
    details: { total: results.total, matched: results.matched, unmatched: results.unmatched, failed: results.failed },
  })

  return results
}

/**
 * Retrieves unmatched manual calls awaiting manual lead resolution.
 */
async function getReviewQueue({ tenantId, user, page = 1, limit = 50, search = "" }) {
  if (!tenantId) {
    throw new Error("Tenant ID is required to access review queue")
  }

  const query = {
    tenantId,
    source: "manual",
    leadId: null,
  }

  // RBAC scope: agents see only their own unmatched uploads unless admin
  if (user && user.role !== "account_admin" && user.role !== "super_admin") {
    query.agentId = user._id
  }

  if (search && search.trim()) {
    const s = search.trim()
    query.$or = [
      { number: { $regex: s, $options: "i" } },
      { phoneNormalized: { $regex: s, $options: "i" } },
      { notes: { $regex: s, $options: "i" } },
    ]
  }

  const p = Math.max(1, parseInt(page, 10) || 1)
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
  const skip = (p - 1) * l

  const [calls, total] = await Promise.all([
    Call.find(query)
      .populate("agentId", "name email role")
      .sort({ startedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(l)
      .setOptions({ skipTenantFilter: true })
      .lean(),
    Call.countDocuments(query).setOptions({ skipTenantFilter: true }),
  ])

  return {
    success: true,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l) || 1,
    calls: calls.map(c => ({
      _id: c._id,
      number: c.number,
      phoneNormalized: c.phoneNormalized,
      startedAt: c.startedAt,
      duration: c.duration,
      direction: c.direction,
      disposition: c.disposition,
      notes: c.notes,
      source: c.source,
      recording: c.recording,
      agent: c.agentId ? {
        _id: c.agentId._id,
        name: c.agentId.name,
        email: c.agentId.email,
      } : null,
    })),
  }
}

/**
 * Matches an unmatched manual call to an existing lead or newly created lead.
 */
async function matchUnmatchedCall({ tenantId, user, callId, leadId = null, newLead = null }) {
  if (!tenantId) throw new Error("Tenant ID is required")
  if (!mongoose.Types.ObjectId.isValid(callId)) {
    const err = new Error("Invalid Call ID format")
    err.statusCode = 400
    throw err
  }

  // 1. Fetch Call ensuring tenant isolation
  const call = await Call.findOne({ _id: callId, tenantId }).setOptions({ skipTenantFilter: true })
  if (!call) {
    const err = new Error("Call not found or does not belong to this tenant")
    err.statusCode = 404
    throw err
  }

  if (call.leadId) {
    const err = new Error("Call is already matched to a Lead")
    err.statusCode = 409
    throw err
  }

  let targetLead = null

  // 2. Either link to existing lead or create quick new lead
  if (leadId) {
    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      const err = new Error("Invalid target Lead ID format")
      err.statusCode = 400
      throw err
    }
    targetLead = await Lead.findOne({ _id: leadId, tenantId }).setOptions({ skipTenantFilter: true })
    if (!targetLead) {
      const err = new Error("Target Lead not found in this tenant")
      err.statusCode = 404
      throw err
    }
  } else if (newLead && (newLead.name || newLead.phone)) {
    const leadName = (newLead.name || "Lead " + call.number).trim()
    const leadPhone = (newLead.phone || call.number).trim()
    const norm = normalizePhoneE164(leadPhone, "+91")

    targetLead = new Lead({
      tenantId,
      name: leadName,
      phone: leadPhone,
      phoneNormalized: norm,
      email: newLead.email ? String(newLead.email).trim() : "",
      source: "Manual Call Ingestion",
      ownerId: call.agentId || user._id,
      status: "New",
    })
    await targetLead.save()
  } else {
    const err = new Error("Must provide either 'leadId' or 'newLead' details (name/phone)")
    err.statusCode = 400
    throw err
  }

  // 3. Evaluate DNR on target lead
  const privacyCheck = await privacyService.evaluateRecordingEligibility({
    tenantId,
    lead: targetLead,
    phoneNumber: call.number,
  })

  // 4. Update Call
  call.leadId = targetLead._id
  if (!privacyCheck.allowed && call.recording && call.recording.status === "stored") {
    // If target lead has DNR, mark as skipped_dnr
    call.recording.status = "skipped_dnr"
  }
  await call.save()

  // 5. If call has a stored GridFS file, update metadata.leadId
  if (call.recording && call.recording.fileId && mongoose.connection.readyState === 1) {
    try {
      const db = mongoose.connection.db
      await db.collection("recordings.files").updateOne(
        { _id: call.recording.fileId, "metadata.tenantId": tenantId },
        { $set: { "metadata.leadId": targetLead._id } }
      )
    } catch (gErr) {
      console.warn("[CallIngestion] GridFS metadata update warning:", gErr.message)
    }
  }

  // 6. Update lead's lastContactedAt & activity
  targetLead.lastContactedAt = new Date()
  await targetLead.save()

  try {
    await activity.callLogged({
      tenantId,
      leadId: targetLead._id,
      actor: {
        id: user?._id || call.agentId,
        name: user?.name || "Agent",
        email: user?.email || "",
        role: user?.role || "agent",
      },
      callId: call._id,
      duration: call.duration,
      direction: call.direction,
      status: call.status,
      hasRecording: Boolean(call.recording?.fileId),
    })
  } catch (actErr) {
    // Activity warning ignored
  }

  // Audit log
  await audit.log({
    tenantId,
    actor: { id: user?._id, name: user?.name, email: user?.email, role: user?.role },
    action: "call.manual_match_lead",
    entity: "Call",
    entityId: call._id,
    summary: `Matched manual call ${call.number} to lead ${targetLead.name}`,
    details: { callId: call._id, leadId: targetLead._id, leadName: targetLead.name },
  })

  return {
    success: true,
    message: `Call matched successfully to ${targetLead.name}`,
    call,
    lead: {
      id: targetLead._id,
      name: targetLead.name,
      phone: targetLead.phone,
      status: targetLead.status,
    },
  }
}

/**
 * Gets aggregated ingestion metrics.
 */
async function getIngestionStats({ tenantId, user }) {
  if (!tenantId) throw new Error("Tenant ID is required")

  const baseFilter = { tenantId, source: "manual" }
  if (user && user.role !== "account_admin" && user.role !== "super_admin") {
    baseFilter.agentId = user._id
  }

  const [totalManual, matched, unmatched, withRecording] = await Promise.all([
    Call.countDocuments(baseFilter).setOptions({ skipTenantFilter: true }),
    Call.countDocuments({ ...baseFilter, leadId: { $ne: null } }).setOptions({ skipTenantFilter: true }),
    Call.countDocuments({ ...baseFilter, leadId: null }).setOptions({ skipTenantFilter: true }),
    Call.countDocuments({ ...baseFilter, "recording.status": "stored" }).setOptions({ skipTenantFilter: true }),
  ])

  return {
    success: true,
    stats: {
      totalManual,
      matched,
      unmatched, // Pending review queue
      withRecording,
    },
  }
}

module.exports = {
  sanitizeFilename,
  extractPhoneFromFilename,
  ingestAudioRecording,
  ingestCsvRecords,
  getReviewQueue,
  matchUnmatchedCall,
  getIngestionStats,
}
