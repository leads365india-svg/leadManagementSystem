const crypto = require("crypto")
const { IdempotencyReservation } = require("../models/IdempotencyReservation")

/**
 * Deterministically canonicalize a payload for SHA-256 hashing.
 * Sorts object keys recursively to ensure consistent hashing regardless of key order.
 */
function canonicalizePayload(data) {
  if (data === null || data === undefined) return ""
  if (typeof data !== "object") return String(data)

  if (Array.isArray(data)) {
    return `[${data.map(canonicalizePayload).join(",")}]`
  }

  const sortedKeys = Object.keys(data).sort()
  const pairs = []
  for (const key of sortedKeys) {
    // Skip volatile metadata or internal flags that don't affect lead content
    if (key === "_hp_trap" || key === "hp_field" || key === "_lead_hp") continue
    const val = data[key]
    pairs.push(`${JSON.stringify(key)}:${canonicalizePayload(val)}`)
  }
  return `{${pairs.join(",")}}`
}

/**
 * Computes a SHA-256 digest of the canonicalized payload.
 */
function computePayloadHash(payload) {
  const canonical = canonicalizePayload(payload)
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex")
}

/**
 * Attempts to claim an idempotency key atomically via MongoDB unique primary key (_id).
 *
 * @param {Object} params
 * @param {string} params.tenantId - Authenticated tenant ID
 * @param {string} params.idempotencyKey - Raw incoming idempotency key
 * @param {Object} params.payload - Incoming submission payload
 * @returns {Promise<{
 *   action: "claimed" | "cached" | "conflict" | "in_progress",
 *   reservationId?: string,
 *   response?: Object,
 *   status?: number,
 *   error?: string
 * }>}
 */
async function claimIdempotency({ tenantId, integrationId = null, idempotencyKey, payload }) {
  if (!tenantId || !idempotencyKey) {
    return { action: "skipped" }
  }

  const cleanTenantId = String(tenantId).trim()
  const cleanIntegrationId = integrationId ? String(integrationId).trim() : null
  const cleanKey = String(idempotencyKey).trim()
  const keyHash = crypto.createHash("sha256").update(cleanKey, "utf8").digest("hex")
  
  // Scoped to authenticated tenant AND server-side integration identity
  const reservationId = cleanIntegrationId
    ? `${cleanTenantId}:${cleanIntegrationId}:${keyHash}`
    : `${cleanTenantId}:${keyHash}`
  const payloadHash = computePayloadHash(payload)

  const now = new Date()

  // 1. Try to create the reservation atomically
  try {
    await IdempotencyReservation.create({
      _id: reservationId,
      tenantId: cleanTenantId,
      integrationId: cleanIntegrationId,
      keyHash,
      payloadHash,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })

    return {
      action: "claimed",
      reservationId,
    }
  } catch (err) {
    // Duplicate key error (E11000) indicates this idempotency key was already reserved
    if (err.code === 11000 || err.message?.includes("E11000")) {
      let existing = await IdempotencyReservation.findById(reservationId).lean()
      if (!existing && cleanIntegrationId) {
        // Backwards compatibility check for legacy pre-Phase 3A reservations
        existing = await IdempotencyReservation.findById(`${cleanTenantId}:${keyHash}`).lean()
      }

      if (!existing) {
        // In the rare event of concurrent delete, report in_progress
        return {
          action: "in_progress",
          status: 409,
          error: "A request with this idempotency key is currently processing. Please retry shortly.",
        }
      }

      // Requirement B: Same key + different payload => HTTP 409 Conflict
      if (existing.payloadHash !== payloadHash) {
        return {
          action: "conflict",
          status: 409,
          error: "Idempotency conflict: A request with this idempotency key has already been submitted with different payload data.",
        }
      }

      // Requirement A: Same key + same payload, already completed => return cached response
      if (existing.status === "completed") {
        return {
          action: "cached",
          response: existing.response || {
            success: true,
            status: 200,
            idempotent: true,
            message: "Lead already received and processed (idempotent request)",
            data: existing.leadId ? { id: existing.leadId.toString() } : undefined,
          },
        }
      }

      // Requirement C: Same key + same payload, pending => wait briefly or return in_progress
      if (existing.status === "pending") {
        const maxWaitMs = 3500
        const pollInterval = 50
        const startTime = Date.now()

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
          existing = await IdempotencyReservation.findById(reservationId).lean()
          if (!existing) break
          if (existing.status === "completed") {
            return {
              action: "cached",
              response: existing.response,
            }
          }
          if (existing.status === "failed") {
            break
          }
        }

        if (existing && existing.status === "completed") {
          return {
            action: "cached",
            response: existing.response,
          }
        }

        return {
          action: "in_progress",
          status: 409,
          error: "A request with this idempotency key is currently being processed. Please retry shortly.",
        }
      }

      // Requirement D: Failed previous attempt => allow retry by atomically claiming pending
      if (existing.status === "failed") {
        const reclaimed = await IdempotencyReservation.findOneAndUpdate(
          { _id: reservationId, status: "failed" },
          { status: "pending", payloadHash, error: null, updatedAt: new Date() },
          { new: true }
        )
        if (reclaimed) {
          return {
            action: "claimed",
            reservationId,
          }
        } else {
          return {
            action: "in_progress",
            status: 409,
            error: "A retry for this failed request is already in progress.",
          }
        }
      }
    }

    throw err
  }
}

/**
 * Stamped the reservation as successfully completed with the cached response.
 */
async function completeIdempotency({ reservationId, response, leadId }) {
  if (!reservationId) return null
  return IdempotencyReservation.findByIdAndUpdate(
    reservationId,
    {
      status: "completed",
      response,
      leadId: leadId || null,
      updatedAt: new Date(),
    },
    { new: true }
  ).catch((err) => {
    console.warn("[Idempotency] Failed to mark reservation completed:", err.message)
  })
}

/**
 * Marks the reservation as failed to permit safe retry.
 */
async function failIdempotency({ reservationId, error }) {
  if (!reservationId) return null
  return IdempotencyReservation.findByIdAndUpdate(
    reservationId,
    {
      status: "failed",
      error: typeof error === "object" ? error?.message || JSON.stringify(error) : String(error),
      updatedAt: new Date(),
    },
    { new: true }
  ).catch((err) => {
    console.warn("[Idempotency] Failed to mark reservation failed:", err.message)
  })
}

module.exports = {
  canonicalizePayload,
  computePayloadHash,
  claimIdempotency,
  completeIdempotency,
  failIdempotency,
}
