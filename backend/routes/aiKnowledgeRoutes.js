const express = require("express")
const multer = require("multer")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")
const { checkDbConnection } = require("../db/connection")
const {
  // Business Profile
  getBusinessProfile,
  updateBusinessProfile,
  // Products & Services
  listProducts,
  createProduct,
  getProductById,
  updateProduct,
  toggleProductStatus,
  archiveOrDeleteProduct,
  // AI Knowledge Sources
  listKnowledgeSources,
  getKnowledgeSourceById,
  getKnowledgeSourcePreview,
  uploadDocumentSource,
  addWebsiteSource,
  addManualSource,
  retryKnowledgeSource,
  deleteKnowledgeSource,
} = require("../controllers/aiKnowledgeController")

const router = express.Router()

// Multer memory storage configuration for document upload (25MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB ceiling
  },
})

// All endpoints require active DB connection, valid authenticated tenant session, and Account Admin role
router.use(checkDbConnection)
router.use(authenticate)
router.use(requireAccountAdmin)

// 1. Business Profile routes
router.get("/profile", getBusinessProfile)
router.put("/profile", requireAccountAdmin, updateBusinessProfile)

// 2. Product and Service Library routes
router.get("/products", listProducts)
router.post("/products", requireAccountAdmin, createProduct)
router.get("/products/:id", getProductById)
router.put("/products/:id", requireAccountAdmin, updateProduct)
router.patch("/products/:id/status", requireAccountAdmin, toggleProductStatus)
router.delete("/products/:id", requireAccountAdmin, archiveOrDeleteProduct)

// 3. AI Knowledge Source routes
router.get("/sources", listKnowledgeSources)
router.get("/sources/:id", getKnowledgeSourceById)
router.get("/sources/:id/preview", getKnowledgeSourcePreview)
router.post("/sources/upload", requireAccountAdmin, upload.single("document"), uploadDocumentSource)
router.post("/sources/website", requireAccountAdmin, addWebsiteSource)
router.post("/sources/manual", requireAccountAdmin, addManualSource)
router.post("/sources/:id/retry", requireAccountAdmin, retryKnowledgeSource)
router.delete("/sources/:id", requireAccountAdmin, deleteKnowledgeSource)

module.exports = router
