/**
 * Audit Log Sanitizer & Redaction Engine - Phase 8: Audit Log
 * 
 * Enforces strict security by redacting sensitive data (passwords, tokens,
 * secrets, authentication cookies, credit cards, raw API keys) before persistence.
 * Also provides a structured, safe diff generator for before/after snapshots.
 */

// Blacklisted keys that must always be redacted (case-insensitive substring/regex matches)
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /hash/i,
  /auth(orization)?/i,
  /cookie/i,
  /session/i,
  /raw.*key/i,
  /api.*key.*hash/i,
  /credit.?card/i,
  /cvv/i,
  /private.?key/i,
  /jwt/i,
]

// Safe keys that contain "key" or "token" in name but are harmless or required for audit identity
const SAFE_WHITELIST_KEYS = new Set([
  "keyName",
  "apiKeyMasked",
  "maskedKey",
  "tokenType",
  "tokenVersion",
  "ruleKey",
  "idempotencyKey",
])

/**
 * Check if a field key is deemed sensitive.
 */
function isSensitiveKey(key) {
  if (!key || typeof key !== "string") return false
  if (SAFE_WHITELIST_KEYS.has(key)) return false
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Recursively sanitizes any object or array, stripping sensitive credentials
 * and replacing them with "[REDACTED]".
 * 
 * @param {any} value - Value to sanitize
 * @param {number} depth - Current recursion depth
 * @param {WeakSet} seen - Circular reference tracker
 * @returns {any} Sanitized clone of value
 */
function sanitizeAuditDetails(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value
  }

  // Cap recursion depth to prevent stack overflow or DOS via deep nesting
  if (depth > 5) {
    return "[MAX_DEPTH_REACHED]"
  }

  // Primitive types
  if (typeof value !== "object") {
    // If a string looks like a JWT token (3 base64 segments separated by dots), mask it
    if (typeof value === "string" && /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(value)) {
      return "[REDACTED_JWT]"
    }
    return value
  }

  // Date and ObjectId handling
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (value._bsontype === "ObjectID" || (value.constructor && value.constructor.name === "ObjectId")) {
    return value.toString()
  }

  // Circular reference defense
  if (seen.has(value)) {
    return "[CIRCULAR]"
  }
  seen.add(value)

  // Array sanitization
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditDetails(item, depth + 1, seen))
  }

  // Plain object sanitization
  const sanitized = {}
  for (const [k, v] of Object.entries(value)) {
    // Prevent prototype pollution
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      continue
    }

    if (isSensitiveKey(k)) {
      sanitized[k] = "[REDACTED]"
    } else {
      sanitized[k] = sanitizeAuditDetails(v, depth + 1, seen)
    }
  }

  return sanitized
}

/**
 * Computes a sanitized before/after field diff between two objects.
 * Useful for role updates, staff updates, and configuration changes.
 * 
 * @param {Object} oldObj - Previous state
 * @param {Object} newObj - Next state
 * @param {string[]} ignoredKeys - Fields to exclude from diff
 * @returns {{ before: Object, after: Object, changedFields: string[] }|null}
 */
function computeAuditDiff(oldObj = {}, newObj = {}, ignoredKeys = ["updatedAt", "createdAt", "__v", "_id"]) {
  if (!oldObj || !newObj) return null

  const oldSanitized = sanitizeAuditDetails(oldObj)
  const newSanitized = sanitizeAuditDetails(newObj)
  const ignored = new Set([...ignoredKeys, "password", "inviteTokenHash", "tokenVersion"])

  const allKeys = new Set([...Object.keys(oldSanitized || {}), ...Object.keys(newSanitized || {})])
  const changedFields = []
  const before = {}
  const after = {}

  for (const key of allKeys) {
    if (ignored.has(key)) continue

    const oldVal = oldSanitized ? oldSanitized[key] : undefined
    const newVal = newSanitized ? newSanitized[key] : undefined

    const oldStr = JSON.stringify(oldVal)
    const newStr = JSON.stringify(newVal)

    if (oldStr !== newStr) {
      changedFields.push(key)
      if (oldVal !== undefined) before[key] = oldVal
      if (newVal !== undefined) after[key] = newVal
    }
  }

  if (changedFields.length === 0) return null

  return {
    changedFields,
    before,
    after,
  }
}

module.exports = {
  sanitizeAuditDetails,
  computeAuditDiff,
  isSensitiveKey,
}
