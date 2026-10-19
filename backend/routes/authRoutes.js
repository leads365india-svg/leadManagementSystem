const { Router } = require("express")
const rateLimit = require("express-rate-limit")
const { login, logout, getMe } = require("../controllers/authController")
const { authenticate } = require("../middleware/authMiddleware")

const router = Router()

// Rate limiting specifically for authentication endpoints to protect against brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Please wait 15 minutes and try again.",
  },
})

// POST /api/auth/login
router.post("/login", authLimiter, login)

// POST /api/auth/logout
router.post("/logout", logout)

// GET /api/auth/me
router.get("/me", authenticate, getMe)

module.exports = router
