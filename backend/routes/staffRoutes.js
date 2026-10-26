const { Router } = require("express")
const {
  getStaff,
  createStaff,
  getStaffById,
  updateStaff,
  toggleStaffStatus,
  getStaffOpenLeads,
  adminResetPassword,
} = require("../controllers/staffController")
const { authenticate, requirePermission } = require("../middleware/authMiddleware")

const router = Router()

// All staff endpoints require active authentication
router.use(authenticate)

// Staff list and single member retrieval
router.get("/", requirePermission("staff.view"), getStaff)
router.get("/:id/open-leads", requirePermission("staff.manage"), getStaffOpenLeads)
router.get("/:id", requirePermission("staff.view"), getStaffById)

// Staff lifecycle management operations
router.post("/", requirePermission("staff.manage"), createStaff)
router.put("/:id", requirePermission("staff.manage"), updateStaff)
router.patch("/:id/deactivate", requirePermission("staff.manage"), toggleStaffStatus)
router.post("/:id/reset-password", requirePermission("staff.manage"), adminResetPassword)

module.exports = router

