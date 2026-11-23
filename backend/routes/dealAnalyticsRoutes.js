const express = require("express")
const { authenticate } = require("../middleware/authMiddleware")
const { getDealAnalyticsHandler } = require("../controllers/dealAnalyticsController")

const router = express.Router()

router.use(authenticate)

router.get("/", getDealAnalyticsHandler)

module.exports = router
