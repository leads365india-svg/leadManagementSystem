/**
 * Phone Normalizer Utility - Phase 6: Lead Model v2
 * 
 * Normalizes incoming phone numbers into strict E.164 format (+[country code][subscriber number]).
 * Defaults to India (+91) as mandated by LEADS365_NEXT_ROADMAP.md, while preserving international numbers.
 */

const DEFAULT_COUNTRY_CODE = "+91"

/**
 * Normalizes any phone number into E.164 format (+[country][digits]).
 * 
 * Handles:
 * - 10-digit Indian mobile numbers (e.g. "9876543210" -> "+919876543210")
 * - 11-digit numbers with leading 0 (e.g. "09876543210" -> "+919876543210")
 * - 12-digit numbers starting with 91 (e.g. "919876543210" -> "+919876543210")
 * - Formatted strings with dashes, spaces, parentheses, dots (e.g. "+91 98765-43210" -> "+919876543210")
 * - International numbers starting with "+" or "00" (e.g. "+1 (555) 019-2834" -> "+15550192834")
 * 
 * @param {string} phone Raw phone input
 * @param {string} [defaultPrefix="+91"] Default country calling code
 * @returns {string} Normalized E.164 string (e.g. "+919876543210") or empty string if invalid
 */
function normalizePhoneE164(phone, defaultPrefix = DEFAULT_COUNTRY_CODE) {
  if (!phone || typeof phone !== "string") {
    return ""
  }

  const trimmed = phone.trim()
  if (!trimmed) {
    return ""
  }

  // Check if international prefix "+" is present
  const hasPlus = trimmed.startsWith("+")
  const hasDoubleZero = trimmed.startsWith("00")

  // Extract all digits
  const digitsOnly = trimmed.replace(/\D/g, "")

  if (!digitsOnly || digitsOnly.length < 5) {
    return ""
  }

  // 1. Explicit "+" prefix passed: preserve country code
  if (hasPlus) {
    // E.164 allows 7 to 15 digits
    if (digitsOnly.length >= 6 && digitsOnly.length <= 15) {
      return `+${digitsOnly}`
    }
    return `+${digitsOnly}`
  }

  // 2. Explicit "00" international dialing prefix
  if (hasDoubleZero && digitsOnly.length >= 7) {
    const withoutDoubleZero = digitsOnly.replace(/^00/, "")
    return `+${withoutDoubleZero}`
  }

  // 3. Indian phone rules (defaultPrefix is "+91")
  if (defaultPrefix === "+91" || defaultPrefix === "91" || defaultPrefix === "IN") {
    // 10-digit mobile number: e.g. 9876543210 -> +919876543210
    if (digitsOnly.length === 10) {
      return `+91${digitsOnly}`
    }

    // 11-digit starting with 0: e.g. 09876543210 -> +919876543210
    if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
      return `+91${digitsOnly.slice(1)}`
    }

    // 12-digit starting with 91: e.g. 919876543210 -> +919876543210
    if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      return `+${digitsOnly}`
    }
  }

  // 4. US / North American phone rules (if 10 digits and prefix is US)
  if (defaultPrefix === "+1" || defaultPrefix === "1" || defaultPrefix === "US") {
    if (digitsOnly.length === 10) {
      return `+1${digitsOnly}`
    }
    if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
      return `+${digitsOnly}`
    }
  }

  // 5. Generic fallback: if 10 digits, prepend defaultPrefix
  if (digitsOnly.length === 10) {
    const cleanPrefix = defaultPrefix.startsWith("+") ? defaultPrefix : `+${defaultPrefix}`
    return `${cleanPrefix}${digitsOnly}`
  }

  // 6. Generic international with >= 11 digits: assume leading country code
  if (digitsOnly.length >= 11 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`
  }

  // Fallback with prefix if length is valid subscriber number
  const prefix = defaultPrefix.startsWith("+") ? defaultPrefix : `+${defaultPrefix}`
  return `${prefix}${digitsOnly}`
}

/**
 * Validates whether a phone number matches standard E.164 pattern:
 * + followed by 7 to 15 digits, starting with a non-zero digit.
 * 
 * @param {string} phone
 * @returns {boolean}
 */
function isValidE164(phone) {
  if (!phone || typeof phone !== "string") return false
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

module.exports = {
  normalizePhoneE164,
  isValidE164,
  DEFAULT_COUNTRY_CODE,
}
