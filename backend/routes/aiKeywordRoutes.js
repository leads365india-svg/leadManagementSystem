const express = require("express")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")
const { checkDbConnection } = require("../db/connection")
const {
  generateKeywords,
  listKeywords,
  getKeywordById,
  updateKeyword,
  approveKeyword,
  rejectKeyword,
  bulkApproveKeywords,
  archiveKeyword,
  deleteKeyword,
} = require("../controllers/aiKeywordController")

const router = express.Router()

// All AI Keyword routes require active DB connection, valid JWT session, and Account Admin role
router.use(checkDbConnection)
router.use(authenticate)
router.use(requireAccountAdmin)

// Topic Generation & Bulk Operations
router.post("/generate", generateKeywords)
router.post("/bulk-approve", bulkApproveKeywords)

// Topic Listing & Individual Operations
router.get("/", listKeywords)
router.get("/:id", getKeywordById)
router.put("/:id", updateKeyword)
router.patch("/:id/approve", approveKeyword)
router.patch("/:id/reject", rejectKeyword)
router.patch("/:id/archive", archiveKeyword)
router.delete("/:id", deleteKeyword)

module.exports = router

