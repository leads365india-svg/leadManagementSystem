const crypto = require("crypto")

/**
 * Stream Authorization Service
 * 
 * Generates and validates cryptographically signed, single-use, short-lived tokens
 * for WebSocket voice stream connections.
 * 
 * Security guarantees:
 * - Binds token to provider, callSid, and tenantId.
 * - Single-use: nonces are recorded upon consumption to prevent replay attacks.
 * - Expired tokens (> 60s default TTL) are strictly rejected.
 * - Tampered tokens are rejected with constant-time HMAC check.
 * - Zero credentials leaked in token or logs.
 */

const TOKEN_PREFIX = "st_v1"
const DEFAULT_TTL_SECONDS = 60

// Replay prevention: consumed nonces Set with timestamp for pruning
const consumedNonces = new Map() // nonce -> expiryTimestamp

// Periodic cleanup of expired nonces (every 60 seconds)
setInterval(() => {
  const now = Date.now()
  for (const [nonce, expiry] of consumedNonces.entries()) {
    if (now > expiry) {
      consumedNonces.delete(nonce)
    }
  }
}, 60000).unref?.()

/**
 * Derives secret key for stream tokens.
 */
function getStreamTokenSecret() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "leads365_stream_auth_master_key_2026"
  return crypto.scryptSync(secret, "leads365_stream_salt_v1", 32)
}

/**
 * Generates a signed, single-use stream authorization token.
 * 
 * @param {Object} params
 * @param {string} params.callSid - Carrier or mock CallSid
 * @param {string} params.tenantId - Verified owning tenant ID
 * @param {string} params.provider - 'twilio' | 'exotel' | 'mock'
 * @param {number} [params.ttlSeconds=60] - Validity duration
 * @returns {string} Serialized stream token
 */
function generateStreamToken({ callSid, tenantId, provider, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!callSid || !tenantId || !provider) {
    throw new Error("Cannot generate stream token: callSid, tenantId, and provider are required")
  }

  const nonce = crypto.randomBytes(12).toString("hex")
  const expiresAt = Date.now() + ttlSeconds * 1000

  const payload = {
    c: callSid,
    t: tenantId,
    p: provider.toLowerCase(),
    n: nonce,
    x: expiresAt,
  }

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const secret = getStreamTokenSecret()

  // Sign: callSid:tenantId:provider:nonce:expiresAt
  const dataToSign = `${callSid}:${tenantId}:${provider.toLowerCase()}:${nonce}:${expiresAt}`
  const signatureHex = crypto.createHmac("sha256", secret).update(dataToSign, "utf8").digest("hex")

  return `${TOKEN_PREFIX}.${payloadBase64}.${signatureHex}`
}

/**
 * Validates and consumes a stream authorization token.
 * 
 * @param {string} tokenString - The stream token to verify
 * @param {Object} [expectedParams] - Optional parameters to enforce
 * @param {string} [expectedParams.callSid]
 * @param {string} [expectedParams.tenantId]
 * @param {string} [expectedParams.provider]
 * @returns {Object} Validated token payload: { callSid, tenantId, provider, expiresAt }
 */
function verifyAndConsumeStreamToken(tokenString, expectedParams = {}) {
  if (!tokenString || typeof tokenString !== "string") {
    throw new Error("STREAM_AUTH_ERROR: Missing stream token")
  }

  const parts = tokenString.trim().split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new Error("STREAM_AUTH_ERROR: Malformed stream token structure")
  }

  const [, payloadBase64, providedSigHex] = parts

  // 1. Parse Payload
  let payload
  try {
    const jsonStr = Buffer.from(payloadBase64, "base64url").toString("utf8")
    payload = JSON.parse(jsonStr)
  } catch (_) {
    throw new Error("STREAM_AUTH_ERROR: Invalid token payload encoding")
  }

  const { c: callSid, t: tenantId, p: provider, n: nonce, x: expiresAt } = payload

  if (!callSid || !tenantId || !provider || !nonce || !expiresAt) {
    throw new Error("STREAM_AUTH_ERROR: Incomplete token payload")
  }

  // 2. Validate Signature (Constant-Time HMAC check)
  const secret = getStreamTokenSecret()
  const dataToSign = `${callSid}:${tenantId}:${provider}:${nonce}:${expiresAt}`
  const expectedSigHex = crypto.createHmac("sha256", secret).update(dataToSign, "utf8").digest("hex")

  const sigBuf = Buffer.from(providedSigHex, "hex")
  const expBuf = Buffer.from(expectedSigHex, "hex")

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("STREAM_AUTH_ERROR: Invalid stream token signature")
  }

  // 3. Expiration Check
  if (Date.now() > expiresAt) {
    throw new Error("STREAM_AUTH_ERROR: Stream token has expired")
  }

  // 4. Replay Prevention Check (Single-Use Token)
  if (consumedNonces.has(nonce)) {
    throw new Error("STREAM_AUTH_ERROR: Stream token already consumed (replay detected)")
  }

  // 5. Parameter Matching (Enforce binding)
  if (expectedParams.callSid && expectedParams.callSid !== callSid) {
    throw new Error(`STREAM_AUTH_ERROR: Token callSid mismatch (${callSid} !== ${expectedParams.callSid})`)
  }
  if (expectedParams.tenantId && expectedParams.tenantId !== tenantId) {
    throw new Error("STREAM_AUTH_ERROR: Cross-tenant token access rejected")
  }
  if (expectedParams.provider && expectedParams.provider.toLowerCase() !== provider.toLowerCase()) {
    throw new Error(`STREAM_AUTH_ERROR: Token provider mismatch (${provider} !== ${expectedParams.provider})`)
  }

  // Consume token (mark single-use)
  consumedNonces.set(nonce, expiresAt + 30000)

  return {
    callSid,
    tenantId,
    provider,
    expiresAt,
    nonce,
  }
}

/**
 * Resets consumed nonces cache (for test isolation).
 */
function clearConsumedTokens() {
  consumedNonces.clear()
}

module.exports = {
  generateStreamToken,
  verifyAndConsumeStreamToken,
  clearConsumedTokens,
}

