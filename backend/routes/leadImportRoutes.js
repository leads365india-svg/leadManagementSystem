const { Router } = require("express")
const multer = require("multer")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")
const {
  getImportConfig,
  parseImportFileHandler,
  previewImportHandler,
  executeImportHandler,
} = require("../controllers/leadImportController")
const { MAX_IMPORT_FILE_BYTES } = require("../services/leadImportService")

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1,
  },
})

const handleUploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next()
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File size exceeds the 10 MB maximum limit.",
        code: "FILE_TOO_LARGE",
      })
    }
    return res.status(400).json({
      success: false,
      error: err.message || "File upload failed.",
      code: "UPLOAD_ERROR",
    })
  })
}

router.use(authenticate)

router.get("/config", checkPermission("leads.create"), getImportConfig)
router.post("/parse", checkPermission("leads.create"), handleUploadMiddleware, parseImportFileHandler)
router.post("/preview", checkPermission("leads.create"), previewImportHandler)
router.post("/execute", checkPermission("leads.create"), executeImportHandler)

module.exports = router
