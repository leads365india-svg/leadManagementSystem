package com.leadflow.feasibility

import com.leadflow.feasibility.telephony.PhoneNumberNormalizer
import org.junit.Assert.*
import org.junit.Test

class PhoneNumberNormalizerTest {

    @Test
    fun testExtractDigits() {
        assertEquals("919876543210", PhoneNumberNormalizer.extractDigits("+91 98765-43210"))
        assertEquals("", PhoneNumberNormalizer.extractDigits(null))
        assertEquals("", PhoneNumberNormalizer.extractDigits("   "))
    }

    @Test
    fun testNormalizeIndianMobile() {
        // Standard 10 digit
        assertEquals("9876543210", PhoneNumberNormalizer.normalize("9876543210"))
        // With +91 country prefix
        assertEquals("9876543210", PhoneNumberNormalizer.normalize("+919876543210"))
        assertEquals("9876543210", PhoneNumberNormalizer.normalize("+91 98765 43210"))
        // With trunk 0 prefix
        assertEquals("9876543210", PhoneNumberNormalizer.normalize("09876543210"))
        // With special characters and parentheses
        assertEquals("9876543210", PhoneNumberNormalizer.normalize("+91 (987) 654-3210"))
    }

    @Test
    fun testPhoneNumberMatches() {
        assertTrue(PhoneNumberNormalizer.matches("+919876543210", "9876543210"))
        assertTrue(PhoneNumberNormalizer.matches("09876543210", "+91 98765-43210"))
        assertFalse(PhoneNumberNormalizer.matches("9876543210", "9876543211"))
        assertFalse(PhoneNumberNormalizer.matches(null, "9876543210"))
    }
}
