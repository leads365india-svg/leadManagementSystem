const { Router } = require("express")
const { authenticate, requireSuperAdmin } = require("../middleware/authMiddleware")
const {
  getAccounts,
  getAccountStats,
  getAccountById,
  createAccount,
  updateAccount,
  updateAccountStatus,
} = require("../controllers/accountController")
const { getPermissions, updatePermissions } = require("../controllers/permissionController")

const router = Router()

// Apply authentication and Super Admin authorization to all routes in this router
router.use(authenticate, requireSuperAdmin)

// Dashboard Stats & Accounts
router.get("/stats", getAccountStats)
router.get("/accounts", getAccounts)
router.get("/accounts/:id", getAccountById)
router.post("/accounts", createAccount)
router.put("/accounts/:id", updateAccount)
router.patch("/accounts/:id/status", updateAccountStatus)

// Roles & Permissions Configuration
router.get("/permissions", getPermissions)
router.put("/permissions", updatePermissions)

module.exports = router
