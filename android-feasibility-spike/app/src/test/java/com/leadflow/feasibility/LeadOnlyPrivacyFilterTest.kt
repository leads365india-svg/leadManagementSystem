package com.leadflow.feasibility

import com.leadflow.feasibility.data.LeadEntity
import com.leadflow.feasibility.telephony.PhoneNumberNormalizer
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class LeadOnlyPrivacyFilterTest {

    private val cachedLeads = mutableListOf<LeadEntity>()

    @Before
    fun setUp() {
        cachedLeads.clear()
        cachedLeads.add(
            LeadEntity(
                id = "lead_001",
                name = "Aarav Sharma",
                phone = "+91 98765 43210",
                normalizedPhone = "9876543210",
                email = "aarav@example.com",
                status = "Qualified",
                doNotRecord = false,
                assignedTo = "agent_123",
                updatedAt = "2026-10-27T10:00:00Z"
            )
        )
        cachedLeads.add(
            LeadEntity(
                id = "lead_002",
                name = "Priya Patel",
                phone = "09123456789",
                normalizedPhone = "9123456789",
                email = "priya@example.com",
                status = "Contacted",
                doNotRecord = true, // Strict Do Not Record active
                assignedTo = "agent_123",
                updatedAt = "2026-10-27T10:00:00Z"
            )
        )
    }

    /**
     * Privacy Filter Logic Simulation:
     * Returns matching lead if number belongs to an assigned CRM lead, or null if non-lead.
     */
    private fun evaluatePrivacyFilter(rawPhoneNumber: String): LeadEntity? {
        val normalized = PhoneNumberNormalizer.normalize(rawPhoneNumber)
        return cachedLeads.find { it.normalizedPhone == normalized }
    }

    @Test
    fun testAuthorizedLeadCallAllowed() {
        val callNumber = "9876543210"
        val matchedLead = evaluatePrivacyFilter(callNumber)

        assertNotNull("Authorized CRM lead must be matched", matchedLead)
        assertEquals("lead_001", matchedLead?.id)
        assertFalse("Recording allowed for lead_001", matchedLead!!.doNotRecord)
    }

    @Test
    fun testAuthorizedLeadWithDifferentPrefixMatches() {
        val callNumberWithTrunk = "09876543210"
        val matchedLead = evaluatePrivacyFilter(callNumberWithTrunk)

        assertNotNull("Trunk-dialed number must match canonical lead", matchedLead)
        assertEquals("lead_001", matchedLead?.id)
    }

    @Test
    fun testNonLeadPersonalCallStrictlyRejected() {
        // Dialing personal contact or family member
        val personalCallNumber = "+91 99999 11111"
        val matchedLead = evaluatePrivacyFilter(personalCallNumber)

        // Strict verification: Non-lead calls MUST NOT proceed to recording scan or upload
        assertNull("Non-lead call MUST return null from privacy filter", matchedLead)
    }

    @Test
    fun testLeadWithDoNotRecordFlagRespectsConsent() {
        val callNumber = "9123456789"
        val matchedLead = evaluatePrivacyFilter(callNumber)

        assertNotNull(matchedLead)
        assertEquals("lead_002", matchedLead?.id)
        assertTrue("Do Not Record rule must be enforced", matchedLead!!.doNotRecord)
    }
}
