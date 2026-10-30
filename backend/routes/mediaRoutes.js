const express = require("express")
const multer = require("multer")
const router = express.Router()
const { authenticate } = require("../middleware/authMiddleware")
const { checkDbConnection } = require("../db/connection")
const mediaController = require("../controllers/mediaController")

// Multer memory storage configuration with 50MB hard limit (individual categories have strict sub-limits)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max ceiling
  },
})

// All media endpoints require DB readiness and authenticated access
router.use(checkDbConnection)
router.use(authenticate)

// Upload any media file (documents, profile-images, attachments, call-attachments)
router.post("/upload", upload.single("file"), mediaController.uploadMedia)

// Get metadata for specific media file
router.get("/:mediaId", mediaController.getMediaDetails)

// Get short-lived authenticated signed URL for private media delivery
router.get("/:mediaId/signed-url", mediaController.getMediaSignedUrl)

// Delete media file from ImageKit and DB
router.delete("/:mediaId", mediaController.deleteMedia)

// List all media files attached to a specific lead
router.get("/lead/:leadId", mediaController.getLeadMedia)

module.exports = router

