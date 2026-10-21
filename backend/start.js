const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const cookieParser = require("cookie-parser")
const dotenv = require("dotenv")
const connectDB = require("./db/connection")
const { checkDbConnection } = require("./db/connection")
const leadRoutes = require("./routes/leadRoutes")
const authRoutes = require("./routes/authRoutes")
const superAdminRoutes = require("./routes/superAdminRoutes")
const integrationRoutes = require("./routes/integrationRoutes")
const { verifyCSRF } = require("./middleware/authMiddleware")
const { errorHandler, notFound } = require("./middleware/errorHandler")

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000
app.set("trust proxy", 1)

// Connect to MongoDB & bootstrap Super Admin
connectDB()

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server proxies)
    if (!origin) return callback(null, true)

    // Allow frontend origins and external client websites submitting leads via webhook
    callback(null, true)
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-api-key", "X-Api-Key"],
  credentials: true, // Allow cookies to be sent across origins
  maxAge: 86400, // Cache preflight requests for 24 hours
}

// Apply CORS middleware
app.use(cors(corsOptions))
// Handle preflight OPTIONS requests
app.options("*", cors(corsOptions))

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...allowedOrigins],
      },
    },
  })
)

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: {
    success: false,
    error: "Too many requests from this IP, please try again later",
  },
})
app.use(limiter)

// Body and Cookie parsing middleware
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))
app.use(cookieParser())
app.use(verifyCSRF(allowedOrigins))

// Health check route
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  })
})

// Ensure DB is ready for API calls
app.use("/api", checkDbConnection)

// API routes
app.use("/api/auth", authRoutes)
app.use("/api/super-admin", superAdminRoutes)
app.use("/api/leads", leadRoutes)
app.use("/api/integrations", integrationRoutes)

// Error handling middleware
app.use(notFound)
app.use(errorHandler)

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
  })
}

module.exports = app
