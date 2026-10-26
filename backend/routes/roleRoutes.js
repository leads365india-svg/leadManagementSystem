const { Router } = require("express")
const {
  getRoles,
  getAvailablePermissions,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} = require("../controllers/roleController")
const {
  authenticate,
  requirePermission,
} = require("../middleware/authMiddleware")

const router = Router()

// All role endpoints require active authentication
router.use(authenticate)

// Available permission modules within Super Admin ceiling
router.get("/permissions/available", getAvailablePermissions)

// List roles for tenant (accessible to users who can view staff or manage roles)
router.get("/", requirePermission(["roles.manage", "staff.view", "staff.manage"]), getRoles)

// Single role details
router.get("/:id", requirePermission("roles.manage"), getRoleById)

// Role management operations (Account Admin or roles.manage permission)
router.post("/", requirePermission("roles.manage"), createRole)
router.put("/:id", requirePermission("roles.manage"), updateRole)
router.delete("/:id", requirePermission("roles.manage"), deleteRole)

module.exports = router
