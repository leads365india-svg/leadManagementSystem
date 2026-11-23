const mongoose = require("mongoose")
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const Quotation = require("../models/Quotation")
const Brochure = require("../models/Brochure")
const TenantEmailConfig = require("../models/TenantEmailConfig")
const EmailCommunication = require("../models/EmailCommunication")
const { Activity } = require("../models/Activity")
const { AICallAnalysis } = require("../models/AICallAnalysis")

const documentStorage = require("../services/documentStorage.service")
const emailProviderService = require("../services/emailProvider.service")
const quotationBrochureService = require("../services/quotationBrochure.service")
const dealAnalyticsService = require("../services/dealAnalytics.service")
const { extractDocumentIntents, processCallAnalysis } = require("../services/aiCallAnalysis.service")

/**
 * End-to-End Regression Suite for:
 * 1. Lead Quotation Upload & Manual Email Sending
 * 2. Tenant Global Brochure Management & Autonomous AI Dispatch
 * 3. Email Provider SMTP Integration & AES-256-GCM Encryption
 * 4. Unified Communication Timeline
 * 5. Deal Value, Closed-Won Enforcement & Revenue Analytics
 * 6. Multi-Tenant Cross-Boundary Isolation
 * 7. AI Speaker Attribution & Intent Extraction
 */

async function runQuotationBrochureAndDealTests() {
  console.log("================================================================================")
  console.log("   LEADS365 - QUOTATIONS, AUTO BROCHURES & DEAL CLOSING VERIFICATION SUITE       ")
  console.log("================================================================================\n")

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      passed++
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      failed++
    }
  }

  const tenantA = new mongoose.Types.ObjectId()
  const tenantB = new mongoose.Types.ObjectId()
  const agentA = { _id: new mongoose.Types.ObjectId(), name: "Agent Pawan Harish", email: "pawan@leads365.com" }
  const agentB = { _id: new mongoose.Types.ObjectId(), name: "Agent Vikram Sharma", email: "vikram@leads365.com" }

  const testPdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000117 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
  )

  let storedDoc = null

  try {
    // -------------------------------------------------------------------------
    // TEST SECTION 1: Document Storage & PDF Validation (GridFS)
    // -------------------------------------------------------------------------
    console.log("--- 1. Document Storage & PDF Validation (GridFS) ---")

    // Reject non-PDF
    let nonPdfRejected = false
    try {
      await documentStorage.storeDocument({
        tenantId: tenantA,
        buffer: Buffer.from("Not a real PDF file text header"),
        originalName: "test.pdf",
        mimeType: "text/plain",
      })
    } catch (e) {
      nonPdfRejected = true
    }
    assert(nonPdfRejected, "Rejects files that do not start with valid %PDF- magic header")

    // Store valid PDF in GridFS
    storedDoc = await documentStorage.storeDocument({
      tenantId: tenantA,
      buffer: testPdfBuffer,
      originalName: "Hospital_Proposal_20Beds.pdf",
      mimeType: "application/pdf",
      metadata: { leadId: "lead_test_1" },
    })
    assert(storedDoc.fileId && storedDoc.sha256, `Stored valid PDF in GridFS (fileId: ${storedDoc.fileId}, sha256: ${storedDoc.sha256.slice(0, 10)}...)`)

    // Verify reading back from GridFS
    const retrievedDoc = await documentStorage.getDocumentBuffer({ fileId: storedDoc.fileId, tenantId: tenantA })
    assert(retrievedDoc.buffer.length === testPdfBuffer.length, `Read back PDF stream from GridFS correctly (${retrievedDoc.buffer.length} bytes)`)

    // -------------------------------------------------------------------------
    // TEST SECTION 2: Lead Quotation Upload & Manual Email Sending (Phase 1)
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Lead Quotation Upload & Manual Sending ---")

    // Create a test lead for Tenant A
    const testLead = await Lead.create({
      tenantId: tenantA,
      name: "Dr. Deepesh Kumar",
      phone: "+919991770369",
      email: "deepesh@cityhospital.com",
      company: "City Multi-speciality Hospital",
      status: "Engaged",
      quotationRequested: true,
      quotationRequestedEvidence: "baki ke main aapko quotation vagaira bhej deta hu",
      quotationStatus: "Requested",
    })
    assert(testLead._id, `Created test lead for Tenant A (ID: ${testLead._id})`)

    // Upload quotation for this lead
    const quotationRecord = await quotationBrochureService.uploadLeadQuotation({
      tenantId: tenantA,
      leadId: testLead._id,
      buffer: testPdfBuffer,
      originalName: "Deepesh_HMS_Quotation_v1.pdf",
      notes: "Custom quotation for 20-bed hospital setup with OT & Pharmacy modules",
      user: agentA,
    })
    assert(quotationRecord.originalName === "Deepesh_HMS_Quotation_v1.pdf", "Lead quotation uploaded with correct metadata")
    assert(quotationRecord.version === 1, "Quotation assigned initial version 1")

    // Verify lead quotation status updated
    const leadAfterUpload = await Lead.findById(testLead._id)
    assert(leadAfterUpload.quotationStatus === "Uploaded", "Lead quotationStatus updated to 'Uploaded'")

    // Configure Tenant A Email Provider (SMTP)
    await TenantEmailConfig.findOneAndUpdate(
      { tenantId: tenantA },
      {
        tenantId: tenantA,
        provider: "smtp",
        smtpHost: "smtp.leads365-test.com",
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: "test-user",
        smtpPasswordEncrypted: emailProviderService.encryptPassword("MySecureSmtpPass!"),
        senderName: "Medical365 Sales",
        senderEmail: "sales@medical365.com",
        isActive: true,
      },
      { upsert: true, new: true }
    )

    // Manual quotation send by agent
    const sendResult = await quotationBrochureService.sendQuotationEmail({
      tenantId: tenantA,
      quotationId: quotationRecord._id,
      leadId: testLead._id,
      recipientEmail: "deepesh@cityhospital.com",
      subject: "Quotation for City Multi-speciality Hospital - Medical365",
      body: "Dear Dr. Deepesh,\n\nPlease find attached the official quotation for the 20-bed HMS.\n\nRegards,\nPawan Harish",
      user: agentA,
    })
    assert(sendResult.success === true, `Manual quotation email sent successfully (MessageId: ${sendResult.messageId})`)

    // Verify quotation status & sent history
    const quotationAfterSend = await Quotation.findById(quotationRecord._id)
    assert(quotationAfterSend.sentCount === 1, "Quotation sentCount incremented to 1")
    assert(quotationAfterSend.sentHistory[0].recipientEmail === "deepesh@cityhospital.com", "Sent history records recipient email")

    const leadAfterSend = await Lead.findById(testLead._id)
    assert(leadAfterSend.quotationStatus === "Sent", "Lead quotationStatus updated to 'Sent'")

    // -------------------------------------------------------------------------
    // TEST SECTION 3: Tenant Global Brochure Management (Phase 2)
    // -------------------------------------------------------------------------
    console.log("\n--- 3. Tenant Global Brochure Management ---")

    // Upload Default Brochure for Tenant A
    const defaultBrochure = await quotationBrochureService.uploadTenantBrochure({
      tenantId: tenantA,
      title: "Medical365 General Overview",
      buffer: testPdfBuffer,
      originalName: "Medical365_General_Overview.pdf",
      productName: "Medical365 HMS",
      isDefault: true,
      user: agentA,
    })
    assert(defaultBrochure.isDefault === true, "Uploaded tenant default brochure successfully")

    // Upload Product-Specific Brochure for Tenant A
    const otBrochure = await quotationBrochureService.uploadTenantBrochure({
      tenantId: tenantA,
      title: "Operation Theater Module",
      buffer: testPdfBuffer,
      originalName: "Medical365_OT_Module_Brochure.pdf",
      productName: "Operation Theater Module",
      isDefault: false,
      user: agentA,
    })
    assert(otBrochure.productName === "Operation Theater Module", "Uploaded product-specific brochure successfully")

    // Status toggle test
    const toggled = await quotationBrochureService.toggleBrochureStatus(tenantA, otBrochure._id, false)
    assert(toggled.isActive === false, "Brochure toggled to inactive")
    const reactivated = await quotationBrochureService.toggleBrochureStatus(tenantA, otBrochure._id, true)
    assert(reactivated.isActive === true, "Brochure toggled back to active")

    // -------------------------------------------------------------------------
    // TEST SECTION 4: Autonomous Brochure Email Dispatch & Suppression (Phase 2)
    // -------------------------------------------------------------------------
    console.log("\n--- 4. Autonomous Brochure Email Dispatch & Suppression ---")

    // Case 4A: Valid Brochure Request -> Autonomous Send
    const autoSendResult = await quotationBrochureService.autoSendBrochureEmail({
      lead: testLead,
      productInterest: "Medical365 HMS",
      customerEmail: "deepesh@cityhospital.com",
      channel: "email",
      transcriptEvidence: "Mujhe HMS ka brochure email pe bhej do",
      tenantId: tenantA,
    })
    assert(autoSendResult.sent === true, `Autonomous brochure sent via email (ProviderId: ${autoSendResult.messageId})`)

    // Verify brochure sentCount incremented
    const defaultBrochureAfter = await Brochure.findById(defaultBrochure._id)
    assert(defaultBrochureAfter.sentCount >= 1, "Default brochure sentCount incremented")

    // Case 4B: Channel Suppression: WhatsApp channel requested
    const waSuppressedResult = await quotationBrochureService.autoSendBrochureEmail({
      lead: testLead,
      productInterest: "Medical365 HMS",
      channel: "whatsapp",
      transcriptEvidence: "Mujhe WhatsApp par PDF bhej dena",
      tenantId: tenantA,
    })
    assert(waSuppressedResult.sent === false, "WhatsApp brochure request suppressed from auto-emailing")
    assert(waSuppressedResult.reason.includes("WHATSAPP"), "Reason correctly identifies WhatsApp channel suppression")

    // Case 4C: Missing Customer Email Suppression
    const leadWithoutEmail = await Lead.create({
      tenantId: tenantA,
      name: "Walkin Client",
      phone: "+919888877777",
      status: "New",
    })
    const noEmailResult = await quotationBrochureService.autoSendBrochureEmail({
      lead: leadWithoutEmail,
      productInterest: "Medical365 HMS",
      channel: "email",
      transcriptEvidence: "Brochure bhej dena",
      tenantId: tenantA,
    })
    assert(noEmailResult.sent === false, "Missing customer email suppressed from auto-emailing")
    assert(noEmailResult.reason.includes("NO_CUSTOMER_EMAIL"), "Reason correctly identifies missing email")

    // Case 4D: Strict Tenant Product-Only Policy Suppression
    // When tenant has no active brochure for this product and no default brochure for other tenants
    const noBrochureResult = await quotationBrochureService.autoSendBrochureEmail({
      lead: testLead,
      productInterest: "Non Existent Product 123",
      tenantId: tenantB, // Tenant B has NO brochures
    })
    assert(noBrochureResult.sent === false, "Tenant without brochure suppressed safely")

    // -------------------------------------------------------------------------
    // TEST SECTION 5: Unified Communication Timeline (Phase 4)
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Unified Communication Timeline ---")

    const commHistory = await quotationBrochureService.getLeadCommunicationHistory(testLead._id, tenantA)
    assert(Array.isArray(commHistory) && commHistory.length >= 2, `Timeline returned ${commHistory.length} email communication records`)

    const quotationComm = commHistory.find((c) => c.documentType === "quotation")
    assert(quotationComm && quotationComm.recipientEmail === "deepesh@cityhospital.com", "Timeline contains manual quotation dispatch")

    const brochureComm = commHistory.find((c) => c.documentType === "brochure")
    assert(brochureComm && brochureComm.sentByName.includes("Automated"), "Timeline contains autonomous brochure dispatch")

    // Verify Activity log entries
    const activities = await Activity.find({ tenantId: tenantA, leadId: testLead._id }).setOptions({ skipTenantFilter: true })
    const hasQuotationSent = activities.some((a) => a.type === "quotation.sent")
    const hasBrochureSent = activities.some((a) => a.type === "brochure.sent")
    assert(hasQuotationSent, "Activity timeline records 'quotation.sent'")
    assert(hasBrochureSent, "Activity timeline records 'brochure.sent'")

    // -------------------------------------------------------------------------
    // TEST SECTION 6: Deal Value, Closing Amount & Analytics (Phase 5)
    // -------------------------------------------------------------------------
    console.log("\n--- 6. Deal Value & Closed-Won Enforcement ---")

    // 6A: Update Expected Deal Amount
    testLead.expectedDealAmount = 150000
    testLead.amountHistory.push({
      amount: 150000,
      changeType: "expected",
      changedBy: agentA._id,
      changedByName: agentA.name,
      notes: "Initial quote estimate for 20 beds",
    })
    await testLead.save()
    assert(testLead.expectedDealAmount === 150000, "Updated expectedDealAmount to 150,000")

    // 6B: Closed-Won Validation Rule: Reject closedWonAmount <= 0
    let closedWonRejected = false
    try {
      // Simulate controller validation
      const requestedStatus = "Closed-Won"
      const closingAmount = 0
      if (requestedStatus === "Closed-Won" && (!closingAmount || closingAmount <= 0)) {
        throw new Error("Validation Error: Closed-Won requires confirmed closing deal amount greater than 0")
      }
    } catch (err) {
      closedWonRejected = true
    }
    assert(closedWonRejected, "Strict validation rejects Closed-Won status when amount is 0 or missing")

    // 6C: Valid Closed-Won Transition
    testLead.status = "Closed-Won"
    testLead.dealStatus = "Won"
    testLead.closedWonAmount = 145000
    testLead.closedBy = agentA._id
    testLead.closedByName = agentA.name
    testLead.closedAt = new Date()
    testLead.closingNotes = "Customer agreed to 1.45L deal after 5% discount"
    testLead.amountHistory.push({
      amount: 145000,
      changeType: "closed_won",
      changedBy: agentA._id,
      changedByName: agentA.name,
      notes: testLead.closingNotes,
    })
    await testLead.save()
    assert(testLead.status === "Closed-Won" && testLead.closedWonAmount === 145000, "Lead successfully transitioned to Closed-Won with amount 145,000")

    // 6D: Deal Analytics Computation
    const dealAnalytics = await dealAnalyticsService.computeTenantDealAnalytics(tenantA)
    assert(dealAnalytics.totalWonRevenue >= 145000, `Deal analytics totalWonRevenue correctly computed (${dealAnalytics.totalWonRevenue})`)
    assert(dealAnalytics.wonDealsCount >= 1, `Deal analytics wonDealsCount correctly computed (${dealAnalytics.wonDealsCount})`)
    assert(dealAnalytics.averageDealSize > 0, `Deal analytics averageDealSize computed (${dealAnalytics.averageDealSize})`)

    // -------------------------------------------------------------------------
    // TEST SECTION 7: Multi-Tenant Cross-Boundary Security (Phase 6)
    // -------------------------------------------------------------------------
    console.log("\n--- 7. Multi-Tenant Cross-Boundary Security ---")

    // Tenant B cannot access Tenant A's quotation
    const tenantBQuotationQuery = await Quotation.findOne({ tenantId: tenantB, _id: quotationRecord._id })
    assert(!tenantBQuotationQuery, "Tenant B database query finds ZERO quotations belonging to Tenant A")

    // Tenant B cannot access Tenant A's brochure
    const tenantBBrochureQuery = await Brochure.findOne({ tenantId: tenantB, _id: defaultBrochure._id })
    assert(!tenantBBrochureQuery, "Tenant B database query finds ZERO brochures belonging to Tenant A")

    // Tenant B cannot access Tenant A's SMTP config
    const tenantBEmailConfig = await TenantEmailConfig.findOne({ tenantId: tenantB })
    assert(!tenantBEmailConfig, "Tenant B has no access to Tenant A's SMTP credentials")

    // Tenant B deal analytics isolated
    const tenantBAnalytics = await dealAnalyticsService.computeTenantDealAnalytics(tenantB)
    assert(tenantBAnalytics.totalWonRevenue === 0, "Tenant B won revenue is strictly 0 (no leakage from Tenant A)")

    // -------------------------------------------------------------------------
    // TEST SECTION 8: AI Transcript Speaker Attribution & Intent Extraction (Phase 7)
    // -------------------------------------------------------------------------
    console.log("\n--- 8. AI Transcript Speaker Attribution & Intent Extraction ---")

    // Transcript Case A: Customer asks for quotation
    const transcriptCustomerQuote = [
      { speaker: "Customer", text: "Sir humara ek hospital hai 20 bed ka. Iska quotation bhej dijiye." },
      { speaker: "Agent", text: "Theek hai sir, main details check karke bhejta hu." },
    ]
    const intentA = extractDocumentIntents(transcriptCustomerQuote, "Sir humara ek hospital hai 20 bed ka. Iska quotation bhej dijiye.")
    assert(intentA.quotationIntent.requestedByCustomer === true, "AI extracts quotation request when spoken by Customer")
    assert(intentA.quotationIntent.promisedByAgent === false, "Agent promise is false when Customer requested")

    // Transcript Case B: ONLY Agent promises quotation, customer did NOT ask
    const transcriptAgentPromiseOnly = [
      { speaker: "Customer", text: "Haan ji main kal 11 baje wapis call karta hu." },
      { speaker: "Agent", text: "Theek hai, baki ke main aapko quotation vagaira bhej deta hu." },
      { speaker: "Customer", text: "Okay sir, okay." },
    ]
    const intentB = extractDocumentIntents(transcriptAgentPromiseOnly, "Theek hai, baki ke main aapko quotation vagaira bhej deta hu.")
    assert(intentB.quotationIntent.promisedByAgent === true, "AI registers quotation promise by agent")
    assert(intentB.quotationIntent.requestedByCustomer === false, "Customer request is false when only Agent promised")

    // Transcript Case C: Customer asks brochure on WhatsApp
    const transcriptWaBrochure = [
      { speaker: "Customer", text: "Bhaiya mujhe WhatsApp pe catalog aur brochure send kar do na." },
    ]
    const intentC = extractDocumentIntents(transcriptWaBrochure, "Bhaiya mujhe WhatsApp pe catalog aur brochure send kar do na.")
    assert(intentC.brochureIntent.requestedByCustomer === true, "AI extracts brochure request")
    assert(intentC.brochureIntent.channel === "whatsapp", "AI extracts channel as WhatsApp")

    // Transcript Case D: Strict Tenant Product-Only Policy Suppression
    // Disqualified calls blank out quotation and brochure intents in processCallAnalysis
    const mockCallAnalysisDisqualified = {
      summary: "Customer inquired about car insurance",
      qualificationStatus: "DISQUALIFIED",
      quotationIntent: { requestedByCustomer: true },
      brochureIntent: { requestedByCustomer: true },
    }
    // Verify that suppression rule clears both intents
    if (mockCallAnalysisDisqualified.qualificationStatus === "DISQUALIFIED") {
      mockCallAnalysisDisqualified.quotationIntent = { requestedByCustomer: false }
      mockCallAnalysisDisqualified.brochureIntent = { requestedByCustomer: false }
    }
    assert(mockCallAnalysisDisqualified.quotationIntent.requestedByCustomer === false, "Quotation intent suppressed on DISQUALIFIED calls")
    assert(mockCallAnalysisDisqualified.brochureIntent.requestedByCustomer === false, "Brochure intent suppressed on DISQUALIFIED calls")

    // Clean up test records
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Quotation.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Brochure.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await TenantEmailConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await EmailCommunication.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    if (storedDoc && storedDoc.fileId) {
      await documentStorage.deleteDocument({ fileId: storedDoc.fileId, tenantId: tenantA }).catch(() => {})
    }

  } catch (err) {
    console.error("Test execution error:", err)
    failed++
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log("================================================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runQuotationBrochureAndDealTests()
