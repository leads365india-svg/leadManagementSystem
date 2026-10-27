const { Router } = require("express")
const {
  login,
  logout,
  getMe,
  getTenantInfo,
  acceptInvite,
  resetPasswordWithToken,
  logoutAll,
} = require("../controllers/authController")
const { authenticate } = require("../middleware/authMiddleware")
const { authLimiter } = require("../middleware/rateLimiters")

const router = Router()

// POST /api/auth/login
router.post("/login", authLimiter, login)

// POST /api/auth/logout
router.post("/logout", logout)

// POST /api/auth/logout-all (Revoke all sessions)
router.post("/logout-all", authenticate, logoutAll)

// POST /api/auth/accept-invite (Invited staff set password)
router.post("/accept-invite", authLimiter, acceptInvite)

// POST /api/auth/reset-password (Reset password with one-time token)
router.post("/reset-password", authLimiter, resetPasswordWithToken)

// GET /api/auth/me
router.get("/me", authenticate, getMe)

// GET /api/auth/tenant-info?tenantId=ACC-XXXX
router.get("/tenant-info", getTenantInfo)

module.exports = router
