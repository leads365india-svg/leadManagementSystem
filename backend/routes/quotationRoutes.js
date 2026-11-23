const express = require("express")
const { authenticate } = require("../middleware/authMiddleware")
const {
  upload,
  uploadQuotationHandler,
  sendQuotationHandler,
  listLeadQuotationsHandler,
  downloadQuotationHandler,
  getCommunicationTimelineHandler,
  deleteQuotationHandler,
} = require("../controllers/quotationController")

const router = express.Router()

router.use(authenticate)

router.post("/upload/:leadId", upload.single("file"), uploadQuotationHandler)
router.post("/:id/send", sendQuotationHandler)
router.get("/lead/:leadId", listLeadQuotationsHandler)
router.get("/:id/download", downloadQuotationHandler)
router.delete("/:id", deleteQuotationHandler)
router.get("/lead/:leadId/timeline", getCommunicationTimelineHandler)

module.exports = router
