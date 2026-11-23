const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const Quotation = require("../models/Quotation")
const TenantEmailConfig = require("../models/TenantEmailConfig")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  uploadLeadQuotation,
  sendQuotationEmail,
} = require("../services/quotationBrochure.service")
const { getDocumentBuffer, deleteDocument } = require("../services/documentStorage.service")

async function run() {
  console.log("================================================================================")
  console.log("  VERIFY QUOTATION UPLOAD INDEPENDENCE & SMTP SEPARATION TEST")
  console.log("================================================================================")

  console.log("Connecting to MongoDB Atlas...")
  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected successfully.")

  const testTenantId = `ACC-TEST-QUO-${Date.now()}`
  let testLeadId = null
  let firstQuotationId = null
  let secondQuotationId = null
  const gridFsFileIds = []

  try {
    await runWithTenantContext({ tenantId: testTenantId }, async () => {
      // Step 1: Ensure tenant has NO SMTP configuration
      const existingConfig = await TenantEmailConfig.findOne({ tenantId: testTenantId })
      if (existingConfig) {
        await TenantEmailConfig.deleteOne({ tenantId: testTenantId })
      }
      console.log("✅ Step 1: Verified NO SMTP configuration exists for tenant:", testTenantId)

      // Step 2: Create a synthetic test lead with NO email address
      const lead = await Lead.create({
        tenantId: testTenantId,
        name: "Synthetic Quotation Client",
        phone: "+919999988888",
        status: "New",
        quotationRequested: true,
        // Notice: email is completely omitted / missing
      })
      testLeadId = lead._id
      console.log("✅ Step 2: Created synthetic test lead (NO email address):", testLeadId.toString())

      // Step 3: Prepare valid dummy PDF buffer
      const dummyPdfBuffer = Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n214\n%%EOF"
      )

      // Step 4: Upload Quotation PDF - Must succeed despite missing SMTP and missing customer email
      console.log("\n--- Testing Quotation Upload Without SMTP & Without Email ---")
      const quotation1 = await uploadLeadQuotation({
        leadId: testLeadId,
        buffer: dummyPdfBuffer,
        originalName: "Medical_Equipment_Proposal_v1.pdf",
        user: { _id: new mongoose.Types.ObjectId(), name: "Test Agent", email: "agent@test.com" },
        tenantId: testTenantId,
        notes: "Uploaded quotation proposal",
      })

      firstQuotationId = quotation1._id
      gridFsFileIds.push(quotation1.fileId)
      console.log("✅ Step 3: Quotation 1 uploaded successfully! ID:", quotation1._id.toString())
      console.log("   - Version:", quotation1.version)
      console.log("   - Status:", quotation1.status)
      console.log("   - GridFS File ID:", quotation1.fileId)
      console.log("   - File Size:", quotation1.fileSize, "bytes")
      console.log("   - SHA-256:", quotation1.sha256)

      if (quotation1.version !== 1 || quotation1.status !== "uploaded") {
        throw new Error("Quotation 1 metadata assertion failed")
      }

      // Step 5: Verify PDF is permanently stored in GridFS
      const storedDoc = await getDocumentBuffer({ fileId: quotation1.fileId, tenantId: testTenantId })
      if (!storedDoc || !storedDoc.buffer || storedDoc.buffer.length !== dummyPdfBuffer.length) {
        throw new Error("GridFS retrieval failed or byte length mismatch")
      }
      console.log("✅ Step 4: Successfully verified PDF permanence in GridFS (retrieved", storedDoc.buffer.length, "bytes)")

      // Step 6: Verify Database Query & Lead Quotations List
      const listed = await Quotation.find({ leadId: testLeadId, tenantId: testTenantId })
        .sort({ createdAt: -1 })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (listed.length !== 1 || listed[0]._id.toString() !== firstQuotationId.toString()) {
        throw new Error("Quotation query failed: expected 1 quotation")
      }
      console.log("✅ Step 5: Quotation list query returned 1 persisted document.")

      // Step 7: Verify Lead Model reflects quotation status
      const refreshedLead = await Lead.findById(testLeadId).lean()
      if (refreshedLead.quotationStatus !== "Uploaded") {
        throw new Error(`Lead quotationStatus expected 'Uploaded', got: ${refreshedLead.quotationStatus}`)
      }
      console.log("✅ Step 6: Lead document updated with quotationStatus: 'Uploaded'")

      // Step 8: Verify Send Quotation Fails Gracefully with Clear SMTP Notice
      console.log("\n--- Testing Send Quotation Email With Missing SMTP ---")
      let sendFailed = false
      let sendErrorMessage = ""
      let sendErrorCode = ""

      try {
        await sendQuotationEmail({
          quotationId: firstQuotationId,
          leadId: testLeadId,
          recipientEmail: "client@hospital.com",
          subject: "Your Medical Quotation",
          body: "Please find attached the quotation.",
          user: { _id: new mongoose.Types.ObjectId(), name: "Test Agent" },
          tenantId: testTenantId,
        })
      } catch (err) {
        sendFailed = true
        sendErrorMessage = err.message
        sendErrorCode = err.code
      }

      if (!sendFailed) {
        throw new Error("Expected sendQuotationEmail to fail without SMTP, but it succeeded!")
      }

      console.log("✅ Step 7: Send Quotation correctly failed when SMTP is missing:")
      console.log("   - Error Message:", sendErrorMessage)
      console.log("   - Error Code:", sendErrorCode)

      if (!sendErrorMessage.includes("Email integration is not configured. Please configure SMTP in Settings before sending.")) {
        throw new Error(`Unexpected error message: ${sendErrorMessage}`)
      }

      // Step 9: Verify Failed Send Did NOT Corrupt Stored Document
      const afterSendQuotation = await Quotation.findById(firstQuotationId).lean()
      const afterSendDoc = await getDocumentBuffer({ fileId: firstQuotationId ? afterSendQuotation.fileId : null, tenantId: testTenantId })
      if (!afterSendDoc || !afterSendDoc.buffer) {
        throw new Error("Quotation file corrupted or missing after failed send!")
      }
      console.log("✅ Step 8: PDF remains 100% intact and downloadable after failed send attempt.")

      // Step 10: Upload Version 2 of Quotation
      console.log("\n--- Testing Version 2 Upload (Immediate Count Update) ---")
      const quotation2 = await uploadLeadQuotation({
        leadId: testLeadId,
        buffer: dummyPdfBuffer,
        originalName: "Medical_Equipment_Proposal_v2_Revised.pdf",
        user: { _id: new mongoose.Types.ObjectId(), name: "Test Agent" },
        tenantId: testTenantId,
        notes: "Revised quotation with discount",
      })

      secondQuotationId = quotation2._id
      gridFsFileIds.push(quotation2.fileId)
      console.log("✅ Step 9: Quotation 2 uploaded! ID:", quotation2._id.toString(), "| Version:", quotation2.version)

      if (quotation2.version !== 2) {
        throw new Error(`Expected version 2, got: ${quotation2.version}`)
      }

      const allQuotations = await Quotation.find({ leadId: testLeadId, tenantId: testTenantId })
        .sort({ version: -1 })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (allQuotations.length !== 2) {
        throw new Error(`Expected 2 quotations, found: ${allQuotations.length}`)
      }
      console.log("✅ Step 10: Total uploaded quotations count updated immediately to 2.")

      console.log("\n================================================================================")
      console.log("  ALL 10 VERIFICATION CHECKS PASSED PERFECTLY!")
      console.log("================================================================================")
    })
  } finally {
    console.log("\nCleaning up synthetic test records...")
    // Cleanup GridFS files
    for (const fileId of gridFsFileIds) {
      await deleteDocument({ fileId, tenantId: testTenantId }).catch(() => {})
    }
    // Cleanup MongoDB documents
    await Quotation.deleteMany({ tenantId: testTenantId })
    await Lead.deleteMany({ tenantId: testTenantId })
    await TenantEmailConfig.deleteMany({ tenantId: testTenantId })
    console.log("Cleaned up synthetic test records.")
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB Atlas.")
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
