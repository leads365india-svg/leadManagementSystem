const { Router } = require("express")
const { authenticate, requireSuperAdmin } = require("../middleware/authMiddleware")
const {
  getAccounts,
  getAccountStats,
  getAccountById,
  createAccount,
  updateAccount,
  updateAccountStatus,
  switchTenantContext,
  deleteAccount,
  verifyAccountDomain,
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
router.delete("/accounts/:id", deleteAccount)
router.post("/switch-tenant", switchTenantContext)
router.post("/accounts/:id/verify-domain", verifyAccountDomain)

// Roles & Permissions Configuration
router.get("/permissions", getPermissions)
router.put("/permissions", updatePermissions)

// WhatsApp Cloud API Super Admin Control Endpoints
const {
  getWhatsAppGlobalConfig,
  updateWhatsAppGlobalConfig,
  listTenantWhatsAppConfigs,
  getTenantWhatsAppConfig,
  saveTenantWhatsAppConfig,
  deleteTenantWhatsAppConfig,
} = require("../controllers/whatsappAdminController")

router.get("/whatsapp/config", getWhatsAppGlobalConfig)
router.put("/whatsapp/config", updateWhatsAppGlobalConfig)
router.get("/whatsapp/tenants", listTenantWhatsAppConfigs)
router.get("/whatsapp/tenants/:tenantId", getTenantWhatsAppConfig)
router.post("/whatsapp/tenants/:tenantId", saveTenantWhatsAppConfig)
router.delete("/whatsapp/tenants/:tenantId", deleteTenantWhatsAppConfig)

module.exports = router
