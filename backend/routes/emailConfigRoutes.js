const express = require("express")
const { authenticate } = require("../middleware/authMiddleware")
const {
  getEmailConfigHandler,
  updateEmailConfigHandler,
  testEmailConnectionHandler,
} = require("../controllers/emailConfigController")

const router = express.Router()

router.use(authenticate)

router.get("/", getEmailConfigHandler)
router.put("/", updateEmailConfigHandler)
router.post("/test", testEmailConnectionHandler)

module.exports = router
