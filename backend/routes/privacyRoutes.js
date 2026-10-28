const { Router } = require("express")
const {
  getDnrRules,
  addDnrRule,
  removeDnrRule,
  updateLeadPrivacy,
  getMobilePrivacyRules,
} = require("../controllers/privacyController")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")
const { authenticateDevice } = require("../middleware/deviceAuthMiddleware")

const router = Router()

// Do-Not-Record Management Routes
router.get("/dnr", authenticate, checkPermission("leads.view"), getDnrRules)
router.post("/dnr", authenticate, checkPermission("donotrecord.manage"), addDnrRule)
router.delete("/dnr/:id", authenticate, checkPermission("donotrecord.manage"), removeDnrRule)

// Per-lead privacy & consent route
router.patch("/leads/:id", authenticate, checkPermission("leads.edit"), updateLeadPrivacy)

// Mobile privacy rules route
router.get("/mobile/rules", authenticateDevice, getMobilePrivacyRules)

module.exports = router
