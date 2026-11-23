const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")
const assert = require("assert")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const Quotation = require("../models/Quotation")
const { Activity } = require("../models/Activity")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  uploadLeadQuotation,
  deleteLeadQuotation,
} = require("../services/quotationBrochure.service")
const { getDocumentBuffer, deleteDocument } = require("../services/documentStorage.service")

async function run() {
  console.log("================================================================================")
  console.log("  VERIFY QUOTATION DELETION, VOID/ARCHIVE & SECURITY SUITE")
  console.log("================================================================================")

  console.log("Connecting to MongoDB Atlas...")
  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected successfully.")

  const tenantA = `ACC-TEST-DEL-A-${Date.now()}`
  const tenantB = `ACC-TEST-DEL-B-${Date.now()}`
  const userA = { _id: new mongoose.Types.ObjectId(), name: "Agent Pawan", email: "pawan@tenanta.com", role: "account_admin" }
  const userB = { _id: new mongoose.Types.ObjectId(), name: "Agent Rohit", email: "rohit@tenantb.com", role: "account_admin" }

  const dummyPdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources <<>> /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n214\n%%EOF"
  )

  const cleanupFiles = []

  try {
    await runWithTenantContext({ tenantId: tenantA }, async () => {
      // -----------------------------------------------------------------------
      // PART 1: DRAFT / NOT SENT QUOTATION DELETION
      // -----------------------------------------------------------------------
      console.log("\n--- Part 1: Draft / Not Sent Quotation Deletion ---")
      const lead1 = await Lead.create({
        tenantId: tenantA,
        name: "Test Hospital Alpha",
        phone: "+919876543210",
        status: "New",
        quotationRequested: true,
      })

      const quo1 = await uploadLeadQuotation({
        leadId: lead1._id,
        buffer: dummyPdfBuffer,
        originalName: "Proposal_Alpha_v1.pdf",
        user: userA,
        tenantId: tenantA,
      })
      cleanupFiles.push(quo1.fileId)

      assert(quo1.version === 1, "Uploaded version 1")
      const leadAfterUp1 = await Lead.findById(lead1._id)
      assert(leadAfterUp1.quotationStatus === "Uploaded", "Lead status updated to 'Uploaded'")

      // Verify file exists in GridFS
      const gridFile = await getDocumentBuffer({ fileId: quo1.fileId, tenantId: tenantA })
      assert(gridFile && gridFile.buffer.length > 0, "File exists in GridFS")
      console.log("  ✅ PASS: Draft quotation v1 uploaded and stored in GridFS")

      // Delete draft quotation
      const delResult1 = await deleteLeadQuotation({
        quotationId: quo1._id,
        user: userA,
        tenantId: tenantA,
      })

      assert(delResult1.success === true, "deleteLeadQuotation returned success")
      assert(delResult1.isVoided === false, "Draft quotation was deleted, not voided")
      assert(delResult1.status === "deleted", "Status reported as 'deleted'")

      // Verify removed from MongoDB
      const quoInDb = await Quotation.findById(quo1._id)
      assert(!quoInDb, "Quotation record removed from MongoDB collection")
      console.log("  ✅ PASS: Quotation record deleted from MongoDB")

      // Verify removed from GridFS
      let gridFsDeleted = false
      try {
        await getDocumentBuffer({ fileId: quo1.fileId, tenantId: tenantA })
      } catch (err) {
        gridFsDeleted = true
      }
      assert(gridFsDeleted, "GridFS document was permanently deleted")
      console.log("  ✅ PASS: Associated GridFS binary file permanently removed")

      // Verify Lead status updated
      const leadAfterDel1 = await Lead.findById(lead1._id)
      assert(leadAfterDel1.quotationStatus === "Requested", "Lead quotationStatus reverted to 'Requested' when 0 quotes remain")
      console.log("  ✅ PASS: Lead quotationStatus updated correctly after deletion")

      // Verify Activity logged
      const delActivity = await Activity.findOne({
        leadId: lead1._id,
        type: "quotation.deleted",
      })
      assert(delActivity, "Activity record 'quotation.deleted' created")
      console.log("  ✅ PASS: Audit activity 'quotation.deleted' recorded")

      // -----------------------------------------------------------------------
      // PART 2: MULTI-VERSION INDEPENDENT DELETION (v1, v2, v3)
      // -----------------------------------------------------------------------
      console.log("\n--- Part 2: Multi-Version Independent Deletion (v1, v2, v3) ---")
      const lead2 = await Lead.create({
        tenantId: tenantA,
        name: "Test Hospital Beta",
        phone: "+919876543211",
        status: "New",
      })

      const v1 = await uploadLeadQuotation({ leadId: lead2._id, buffer: dummyPdfBuffer, originalName: "Beta_v1.pdf", user: userA, tenantId: tenantA })
      const v2 = await uploadLeadQuotation({ leadId: lead2._id, buffer: dummyPdfBuffer, originalName: "Beta_v2.pdf", user: userA, tenantId: tenantA })
      const v3 = await uploadLeadQuotation({ leadId: lead2._id, buffer: dummyPdfBuffer, originalName: "Beta_v3.pdf", user: userA, tenantId: tenantA })
      cleanupFiles.push(v1.fileId, v2.fileId, v3.fileId)

      assert(v1.version === 1 && v2.version === 2 && v3.version === 3, "Versions 1, 2, 3 assigned sequentially")
      console.log("  ✅ PASS: Uploaded 3 sequential versions (v1, v2, v3)")

      // Delete v2 independently
      await deleteLeadQuotation({ quotationId: v2._id, user: userA, tenantId: tenantA })
      const remainingAfterV2 = await Quotation.find({ leadId: lead2._id, tenantId: tenantA }).sort({ version: 1 })
      assert(remainingAfterV2.length === 2, "2 versions remain after deleting v2")
      assert(remainingAfterV2[0].version === 1, "v1 remains intact")
      assert(remainingAfterV2[1].version === 3, "v3 remains intact")
      console.log("  ✅ PASS: Deleted v2 independently; v1 and v3 remain untouched")

      // Delete v3 (latest version)
      await deleteLeadQuotation({ quotationId: v3._id, user: userA, tenantId: tenantA })
      const remainingAfterV3 = await Quotation.find({ leadId: lead2._id, tenantId: tenantA })
      assert(remainingAfterV3.length === 1 && remainingAfterV3[0].version === 1, "v1 is now the sole remaining version")
      const leadAfterV3 = await Lead.findById(lead2._id)
      assert(leadAfterV3.quotationStatus === "Uploaded", "Lead quotationStatus remains 'Uploaded' while v1 exists")
      console.log("  ✅ PASS: Deleted latest version v3; v1 correctly remains active")

      // Delete v1 (all versions deleted)
      await deleteLeadQuotation({ quotationId: v1._id, user: userA, tenantId: tenantA })
      const remainingAfterV1 = await Quotation.find({ leadId: lead2._id, tenantId: tenantA })
      assert(remainingAfterV1.length === 0, "0 quotations remain")
      const leadAfterAll = await Lead.findById(lead2._id)
      assert(leadAfterAll.quotationStatus === "None", "Lead quotationStatus reset to 'None' when all versions deleted")
      console.log("  ✅ PASS: Deleted all versions; active count is 0 and empty state triggered")

      // -----------------------------------------------------------------------
      // PART 3: SENT QUOTATION PROTECTION (VOID / ARCHIVE)
      // -----------------------------------------------------------------------
      console.log("\n--- Part 3: Sent Quotation Protection (Void / Archive) ---")
      const lead3 = await Lead.create({
        tenantId: tenantA,
        name: "Test Hospital Gamma",
        phone: "+919876543212",
        status: "New",
      })

      const sentQuo = await uploadLeadQuotation({
        leadId: lead3._id,
        buffer: dummyPdfBuffer,
        originalName: "Sent_Proposal_Gamma.pdf",
        user: userA,
        tenantId: tenantA,
      })
      cleanupFiles.push(sentQuo.fileId)

      // Simulate document was dispatched via email
      sentQuo.status = "sent"
      sentQuo.sentCount = 1
      sentQuo.lastSentAt = new Date()
      sentQuo.sentHistory.push({
        sentAt: new Date(),
        sentBy: userA._id,
        sentByName: userA.name,
        recipientEmail: "director@gammahospital.com",
        subject: "Gamma HMS Quotation",
        body: "Please find attached the official proposal.",
        messageId: "<msg_gamma_test_123@leads365.local>",
        provider: "smtp",
        status: "sent",
      })
      await sentQuo.save()

      // Attempt to delete sent quotation
      const voidResult = await deleteLeadQuotation({
        quotationId: sentQuo._id,
        user: userA,
        tenantId: tenantA,
      })

      assert(voidResult.success === true, "Operation succeeded")
      assert(voidResult.isVoided === true, "Reported as voided (not destroyed)")
      assert(voidResult.status === "voided", "Status reported as 'voided'")

      // Verify Quotation record STILL EXISTS in MongoDB with status voided
      const quoInDbVoided = await Quotation.findById(sentQuo._id)
      assert(quoInDbVoided, "Quotation record was NOT destroyed from MongoDB")
      assert(quoInDbVoided.status === "voided", "Quotation status is 'voided'")
      assert(quoInDbVoided.voidedAt !== null, "voidedAt timestamp recorded")
      assert(quoInDbVoided.voidedByName === userA.name, "voidedByName recorded")
      assert(quoInDbVoided.sentCount === 1, "sentCount preserved")
      assert(quoInDbVoided.sentHistory.length === 1, "sentHistory preserved")
      assert(quoInDbVoided.sentHistory[0].recipientEmail === "director@gammahospital.com", "Recipient preserved")
      assert(quoInDbVoided.sentHistory[0].messageId === "<msg_gamma_test_123@leads365.local>", "MessageId preserved")
      console.log("  ✅ PASS: Sent quotation preserved in MongoDB with status: 'voided'")
      console.log("  ✅ PASS: Delivery history, recipient email and MessageId preserved 100%")

      // Verify GridFS file STILL EXISTS so audit copies can be downloaded
      const auditFile = await getDocumentBuffer({ fileId: quoInDbVoided.fileId, tenantId: tenantA })
      assert(auditFile && auditFile.buffer.length > 0, "Audit PDF file remains downloadable from GridFS")
      console.log("  ✅ PASS: GridFS file preserved for audit verification")

      // Verify Activity logged
      const voidActivity = await Activity.findOne({
        leadId: lead3._id,
        type: "quotation.voided",
      })
      assert(voidActivity, "Activity record 'quotation.voided' created")
      console.log("  ✅ PASS: Audit activity 'quotation.voided' recorded")

      // -----------------------------------------------------------------------
      // PART 4: MULTI-TENANT CROSS-BOUNDARY SECURITY
      // -----------------------------------------------------------------------
      console.log("\n--- Part 4: Multi-Tenant Cross-Boundary Security ---")
      let crossTenantBlocked = false
      try {
        // Tenant B attempts to delete Tenant A's quotation
        await deleteLeadQuotation({
          quotationId: sentQuo._id,
          user: userB,
          tenantId: tenantB, // Cross-tenant attempt!
        })
      } catch (err) {
        crossTenantBlocked = true
        assert(err.statusCode === 404 || err.statusCode === 403, "Cross-tenant attempt blocked with 404/403")
      }
      assert(crossTenantBlocked, "Cross-tenant deletion was strictly blocked")

      // Verify Tenant A's quotation is completely untouched
      const quoAfterCrossAttempt = await Quotation.findById(sentQuo._id)
      assert(quoAfterCrossAttempt.tenantId === tenantA, "Tenant A document untouched")
      console.log("  ✅ PASS: Cross-tenant deletion strictly prohibited and blocked")
    })

    console.log("\n================================================================================")
    console.log("  ALL QUOTATION DELETION & VOID ASSERTIONS PASSED PERFECTLY!")
    console.log("================================================================================")
  } finally {
    console.log("\nCleaning up synthetic test data...")
    for (const fId of cleanupFiles) {
      await deleteDocument({ fileId: fId, tenantId: tenantA }).catch(() => {})
    }
    await Quotation.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    console.log("Cleaned up synthetic test records.")
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB Atlas.")
  }
}

run().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
