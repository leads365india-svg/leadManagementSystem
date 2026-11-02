const crypto = require("crypto")
const { LeadConcurrencyLock } = require("../models/LeadConcurrencyLock")

/**
 * Acquires distributed identity locks for concurrent duplicate lead prevention.
 *
 * Rules:
 * 1. Under duplicateHandling === "allow", does NOT acquire locks (preserves intentional duplicates).
 * 2. Under duplicateHandling === "reject" or "update", acquires locks for normalized email and phone.
 * 3. Locks are scoped strictly to tenantId: `${tenantId}:${identityType}:${hash}`.
 * 4. Stale locks (> 12 seconds) can be reclaimed if abandoned.
 * 5. Fencing & Lease Renewal: Uses unique ownerToken per acquisition and auto-renews lease
 *    every 3 seconds so long-running operations never lose their lock while executing.
 * 6. Expired owners can never delete or overwrite locks acquired by subsequent owners.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Tenant partition
 * @param {string} [params.email] - Normalized email
 * @param {string} [params.phone] - Normalized phone
 * @param {string} [params.duplicateHandling] - "reject" | "update" | "allow"
 * @returns {Promise<{ release: () => Promise<void>, ownerToken: string }>}
 */
async function acquireLeadIdentityLock({
  tenantId,
  email,
  phone,
  duplicateHandling = "reject",
}) {
  const cleanTenantId = String(tenantId).trim()

  // 1. If duplicateHandling is "allow", bypass lock completely to permit intentional duplicates
  if (duplicateHandling === "allow") {
    return {
      release: async () => {},
      ownerToken: "allow_bypass",
    }
  }

  const lockKeys = []
  const cleanEmail = email ? String(email).toLowerCase().trim() : ""
  const cleanPhone = phone ? String(phone).replace(/[^\d+]/g, "").trim() : ""

  if (cleanEmail) {
    const emailHash = crypto.createHash("sha256").update(cleanEmail).digest("hex")
    lockKeys.push({
      _id: `${cleanTenantId}:email:${emailHash}`,
      tenantId: cleanTenantId,
      identityType: "email",
      identityHash: emailHash,
    })
  }

  if (cleanPhone) {
    const phoneHash = crypto.createHash("sha256").update(cleanPhone).digest("hex")
    lockKeys.push({
      _id: `${cleanTenantId}:phone:${phoneHash}`,
      tenantId: cleanTenantId,
      identityType: "phone",
      identityHash: phoneHash,
    })
  }

  if (lockKeys.length === 0) {
    return {
      release: async () => {},
      ownerToken: "no_identity",
    }
  }

  const ownerToken = crypto.randomUUID()
  const maxWaitMs = 2500
  const startTime = Date.now()
  const acquiredIds = []

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 12000) // 12-second lease
      const staleThreshold = new Date(now.getTime() - 12000)

      for (const item of lockKeys) {
        if (acquiredIds.includes(item._id)) continue

        try {
          await LeadConcurrencyLock.create({
            _id: item._id,
            tenantId: cleanTenantId,
            identityType: item.identityType,
            identityHash: item.identityHash,
            lockedAt: now,
            expiresAt,
            ownerToken,
          })
          acquiredIds.push(item._id)
        } catch (err) {
          if (err.code === 11000 || err.message?.includes("E11000")) {
            // Check if existing lock is stale (> 12 seconds old)
            const reclaimed = await LeadConcurrencyLock.findOneAndUpdate(
              { _id: item._id, lockedAt: { $lt: staleThreshold } },
              { lockedAt: now, expiresAt, ownerToken },
              { new: true }
            )
            if (reclaimed) {
              acquiredIds.push(item._id)
            } else {
              // Lock actively held by another request
              throw new Error("LOCKED")
            }
          } else {
            throw err
          }
        }
      }

      // If all keys acquired successfully
      if (acquiredIds.length === lockKeys.length) {
        break
      }
    } catch (err) {
      if (err.message === "LOCKED") {
        // Rollback any partially acquired keys before backing off
        if (acquiredIds.length > 0) {
          await LeadConcurrencyLock.deleteMany({ _id: { $in: acquiredIds }, ownerToken }).catch(() => {})
          acquiredIds.length = 0
        }
        // Jittered backoff (40ms - 90ms)
        await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 50))
      } else {
        // Unexpected error; clean up and rethrow
        if (acquiredIds.length > 0) {
          await LeadConcurrencyLock.deleteMany({ _id: { $in: acquiredIds }, ownerToken }).catch(() => {})
        }
        throw err
      }
    }
  }

  // Active lease heartbeat renewal: renews lock lease every 3 seconds while operation executes
  const heartbeatInterval = setInterval(async () => {
    if (acquiredIds.length > 0) {
      try {
        const now = new Date()
        const extendedExpiresAt = new Date(now.getTime() + 12000)
        await LeadConcurrencyLock.updateMany(
          { _id: { $in: acquiredIds }, ownerToken },
          { lockedAt: now, expiresAt: extendedExpiresAt }
        )
      } catch (_) {}
    }
  }, 3000)

  if (typeof heartbeatInterval.unref === "function") {
    heartbeatInterval.unref()
  }

  // Safe release function: terminates heartbeat and deletes locks ONLY matching this ownerToken
  const release = async () => {
    clearInterval(heartbeatInterval)
    if (acquiredIds.length > 0) {
      try {
        await LeadConcurrencyLock.deleteMany({ _id: { $in: acquiredIds }, ownerToken })
      } catch (relErr) {
        console.warn("[ConcurrencyLock] Failed to release lock keys:", relErr.message)
      }
    }
  }

  return { release, ownerToken }
}

module.exports = {
  acquireLeadIdentityLock,
}
