const crypto = require("crypto")

/**
 * Leads-365 CRM - Secure Encryption Utilities (Phase 11)
 * 
 * Cryptographic operations:
 * - AES-256-GCM encryption & decryption with 12-byte IV and 16-byte authentication tags.
 * - Secure key derivation (scrypt) with strict environment checks.
 * - Fail-closed security: Rejects unconfigured or predictable keys.
 * - Tamper detection: Verifies GCM auth tags.
 * - Credential masking for safe API responses.
 * - API key generation and SHA-256 hashing.
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12 // 96-bit IV recommended by NIST for AES-GCM
const AUTH_TAG_LENGTH = 16 // 128-bit authentication tag
const DERIVED_KEY_LENGTH = 32 // 256-bit key

const PRIMARY_SALT = "leads365_encryption_salt_v1"
const JWT_FALLBACK_SALT = "leads365_jwt_migration_salt_v1"

// Cache derived keys in memory to minimize scrypt overhead while preserving security
const keyCache = new Map()

/**
 * Derives a 32-byte master key from environment variables or custom secret.
 * Fails closed if no secure key is configured.
 * 
 * @param {string} [customSecret] - Optional explicit secret for testing or rotation
 * @returns {Buffer} 32-byte cryptographic key buffer
 */
function getDerivedKey(customSecret) {
  if (customSecret) {
    if (typeof customSecret !== "string" || customSecret.trim().length < 8) {
      throw new Error("Encryption key derivation error: Custom secret is too short or invalid")
    }
    const cacheKey = `custom:${customSecret}`
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)

    const derived = crypto.scryptSync(customSecret.trim(), PRIMARY_SALT, DERIVED_KEY_LENGTH)
    keyCache.set(cacheKey, derived)
    return derived
  }

  // 1. Primary: ENCRYPTION_KEY environment variable
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (encryptionKey && typeof encryptionKey === "string" && encryptionKey.trim().length >= 16) {
    const cacheKey = `env:encryption_key:${encryptionKey}`
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)

    const derived = crypto.scryptSync(encryptionKey.trim(), PRIMARY_SALT, DERIVED_KEY_LENGTH)
    keyCache.set(cacheKey, derived)
    return derived
  }

  // 2. Migration-compatible fallback: JWT_SECRET environment variable
  const jwtSecret = process.env.JWT_SECRET
  if (jwtSecret && typeof jwtSecret === "string" && jwtSecret.trim().length >= 16) {
    const cacheKey = `env:jwt_secret:${jwtSecret}`
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)

    const derived = crypto.scryptSync(jwtSecret.trim(), JWT_FALLBACK_SALT, DERIVED_KEY_LENGTH)
    keyCache.set(cacheKey, derived)
    return derived
  }

  // 3. Fail closed: Never use hardcoded keys or unverified fallbacks
  throw new Error(
    "Encryption configuration error: Neither ENCRYPTION_KEY nor a secure JWT_SECRET (min 16 chars) is configured in the environment. System failed closed."
  )
}

/**
 * Encrypts arbitrary data (string or serializable object) using AES-256-GCM.
 * 
 * @param {string|object} data - Plaintext or serializable object
 * @param {string} [customSecret] - Optional custom key
 * @returns {{ iv: string, authTag: string, encryptedData: string, v: number, serialized: string }}
 */
function encrypt(data, customSecret) {
  if (data === null || data === undefined) {
    throw new Error("Encryption error: Cannot encrypt null or undefined data")
  }

  const key = getDerivedKey(customSecret)
  const iv = crypto.randomBytes(IV_LENGTH)

  // Serialize objects and non-strings to JSON with a marker
  let plaintext
  let isJson = false
  if (typeof data === "object") {
    plaintext = JSON.stringify(data)
    isJson = true
  } else {
    plaintext = String(data)
  }

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  
  // Set AAD (Additional Authenticated Data) for version and type tagging
  const aad = Buffer.from(isJson ? "v1:json" : "v1:text", "utf8")
  cipher.setAAD(aad)

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  const ivHex = iv.toString("hex")
  const authTagHex = authTag.toString("hex")
  const encryptedHex = encrypted.toString("hex")
  const typeMarker = isJson ? "j" : "s"
  const serialized = `v1:${typeMarker}:${ivHex}:${authTagHex}:${encryptedHex}`

  return {
    iv: ivHex,
    authTag: authTagHex,
    encryptedData: encryptedHex,
    type: isJson ? "json" : "text",
    v: 1,
    serialized,
  }
}

/**
 * Decrypts AES-256-GCM payload. Rejects tampered ciphertext with an explicit error.
 * 
 * @param {string|object} cipherInput - Serialized string "v1:..." or { iv, authTag, encryptedData }
 * @param {string} [customSecret] - Optional custom key
 * @returns {string|object} Decrypted string or parsed object
 */
function decrypt(cipherInput, customSecret) {
  if (!cipherInput) {
    throw new Error("Decryption error: Empty or null cipher input provided")
  }

  let ivHex, authTagHex, encryptedHex, isJson = false

  if (typeof cipherInput === "string") {
    const parts = cipherInput.split(":")
    if (parts.length === 5 && parts[0] === "v1") {
      // v1:type:iv:authTag:encrypted
      isJson = parts[1] === "j"
      ivHex = parts[2]
      authTagHex = parts[3]
      encryptedHex = parts[4]
    } else if (parts.length === 4 && parts[0] === "v1") {
      // v1:iv:authTag:encrypted (legacy)
      ivHex = parts[1]
      authTagHex = parts[2]
      encryptedHex = parts[3]
    } else {
      throw new Error("Decryption error: Malformed serialized cipher string")
    }
  } else if (typeof cipherInput === "object") {
    ivHex = cipherInput.iv
    authTagHex = cipherInput.authTag
    encryptedHex = cipherInput.encryptedData || cipherInput.data
    isJson = cipherInput.type === "json"
  } else {
    throw new Error("Decryption error: Unsupported cipher input format")
  }

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Decryption error: Missing required IV, auth tag, or encrypted data")
  }

  const key = getDerivedKey(customSecret)
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")
  const encrypted = Buffer.from(encryptedHex, "hex")

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Decryption error: Invalid IV or auth tag length")
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    const aad = Buffer.from(isJson ? "v1:json" : "v1:text", "utf8")
    decipher.setAAD(aad)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")

    if (isJson) {
      try {
        return JSON.parse(decrypted)
      } catch (_) {
        return decrypted
      }
    }
    return decrypted
  } catch (err) {
    throw new Error(
      "Decryption failed: Authentication tag verification failed or ciphertext was tampered with."
    )
  }
}

/**
 * Masks a secret string for safe display in UI or logs.
 * 
 * @param {string} secret - Plaintext secret
 * @param {number} [visibleChars=4] - Number of trailing characters to leave unmasked
 * @returns {string} Masked credential
 */
function maskSecret(secret, visibleChars = 4) {
  if (!secret || typeof secret !== "string") return ""
  const trimmed = secret.trim()

  // Standard API key format: lf_live_XXXXX
  if (trimmed.startsWith("lf_live_")) {
    const prefix = "lf_live_"
    const suffix = trimmed.slice(-visibleChars)
    return `${prefix}••••••••••••••••${suffix}`
  }

  // Short strings (under 8 chars)
  if (trimmed.length <= visibleChars * 2) {
    return "••••••••"
  }

  const visibleStart = Math.min(2, Math.floor(visibleChars / 2))
  const start = trimmed.slice(0, visibleStart)
  const end = trimmed.slice(-visibleChars)
  return `${start}••••••••••••${end}`
}

/**
 * Generates a cryptographically secure random API key.
 * 
 * @param {string} [prefix="lf_live_"] - Key prefix
 * @returns {string} Plaintext API key
 */
function generateApiKey(prefix = "lf_live_") {
  const randomBytes = crypto.randomBytes(24).toString("hex")
  return `${prefix}${randomBytes}`
}

/**
 * Computes constant-time SHA-256 hash of an API key for safe database indexing & lookup.
 * 
 * @param {string} apiKey - Plaintext API key
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return ""
  return crypto.createHash("sha256").update(apiKey.trim()).digest("hex")
}

/**
 * Rotates encryption key for an existing ciphertext payload.
 * 
 * @param {string|object} cipherInput - Existing encrypted payload
 * @param {string} oldSecret - Secret previously used
 * @param {string} newSecret - New secret to encrypt with
 * @returns {object} Newly encrypted payload with new key
 */
function rotateEncryptionKey(cipherInput, oldSecret, newSecret) {
  const plaintext = decrypt(cipherInput, oldSecret)
  return encrypt(plaintext, newSecret)
}

module.exports = {
  encrypt,
  decrypt,
  maskSecret,
  generateApiKey,
  hashApiKey,
  getDerivedKey,
  rotateEncryptionKey,
}
