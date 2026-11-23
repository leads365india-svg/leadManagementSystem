const express = require("express")
const { authenticate } = require("../middleware/authMiddleware")
const {
  upload,
  uploadBrochureHandler,
  listBrochuresHandler,
  toggleBrochureStatusHandler,
  downloadBrochureHandler,
} = require("../controllers/brochureController")

const router = express.Router()

router.use(authenticate)

router.post("/upload", upload.single("file"), uploadBrochureHandler)
router.get("/", listBrochuresHandler)
router.patch("/:id/status", toggleBrochureStatusHandler)
router.get("/:id/download", downloadBrochureHandler)

module.exports = router
