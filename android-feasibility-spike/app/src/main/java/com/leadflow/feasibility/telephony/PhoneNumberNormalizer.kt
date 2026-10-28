package com.leadflow.feasibility.telephony

/**
 * PhoneNumberNormalizer - Standardizes telephone numbers for privacy filtering and matching
 * 
 * Supports international formats (e.g., E.164: +919876543210), national formats (09876543210),
 * and punctuated numbers (+91 (987) 654-3210).
 */
object PhoneNumberNormalizer {

    /**
     * Extracts only numeric digits from a raw phone string.
     */
    fun extractDigits(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.filter { it.isDigit() }
    }

    /**
     * Standardizes a phone number to core digits for robust local matching.
     * In India and common 10-digit mobile plans, strips leading country codes (91) or trunk prefixes (0)
     * to obtain the canonical 10-digit national number.
     */
    fun normalize(raw: String?): String {
        val digits = extractDigits(raw)
        return when {
            digits.length == 12 && digits.startsWith("91") -> digits.substring(2)
            digits.length == 11 && digits.startsWith("0") -> digits.substring(1)
            digits.length > 10 -> digits.takeLast(10)
            else -> digits
        }
    }

    /**
     * Checks if two phone numbers refer to the same subscriber.
     */
    fun matches(numA: String?, numB: String?): Boolean {
        val normA = normalize(numA)
        val normB = normalize(numB)
        if (normA.isEmpty() || normB.isEmpty()) return false
        return normA == normB
    }
}
