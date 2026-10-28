const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const cookieParser = require("cookie-parser")
const dotenv = require("dotenv")
const mongoose = require("mongoose")
const connectDB = require("./db/connection")
const { checkDbConnection } = require("./db/connection")
const leadRoutes = require("./routes/leadRoutes")
const authRoutes = require("./routes/authRoutes")
const superAdminRoutes = require("./routes/superAdminRoutes")
const integrationRoutes = require("./routes/integrationRoutes")
const followUpRoutes = require("./routes/followUpRoutes")
const path = require("path")
const staffRoutes = require("./routes/staffRoutes")
const teamRoutes = require("./routes/teamRoutes")
const roleRoutes = require("./routes/roleRoutes")
const assignmentRuleRoutes = require("./routes/assignmentRuleRoutes")
const auditRoutes = require("./routes/auditRoutes")
const queueMonitorRoutes = require("./routes/queueMonitorRoutes")
const callRoutes = require("./routes/callRoutes")
const mobileRoutes = require("./routes/mobileRoutes")
const privacyRoutes = require("./routes/privacyRoutes")
const { getJwtSecret, verifyCSRF } = require("./middleware/authMiddleware")
const { tenantContextMiddleware } = require("./middleware/tenantContext")
const { errorHandler, notFound } = require("./middleware/errorHandler")

// Load environment variables
dotenv.config()

// Validate critical security environment variables on startup
try {
  getJwtSecret()
} catch (configErr) {
  console.error("❌ Fatal Configuration Error:", configErr.message)
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT || 5000
app.set("trust proxy", 1)

// CORS configuration supporting comma-separated FRONTEND_URL or local defaults
const configuredFrontendUrls = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)

const defaultLocalOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
]

const allowedOrigins = [
  ...new Set([
    ...configuredFrontendUrls,
    ...defaultLocalOrigins,
  ]),
]

// Specific CORS for public integration webhook (allows external client websites without credentials)
const webhookCors = cors({
  origin: "*",
  methods: ["POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "X-Api-Key",
    "x-site-key",
    "X-Site-Key",
    "x-idempotency-key",
    "X-Idempotency-Key",
    "idempotency-key",
    "X-Content-SHA256",
    "x-content-sha256",
    "X-Audio-SHA256",
    "x-audio-sha256",
    "X-File-Name",
    "x-file-name",
  ],
})
app.use("/api/integrations/leads/website", webhookCors)
app.options("/api/integrations/leads/website", webhookCors)

const isDevelopment = process.env.NODE_ENV !== "production"

const isAllowedOrigin = (origin) => {
  if (!origin) return true
  if (allowedOrigins.includes(origin)) return true
  // In development, dynamically allow any localhost / 127.0.0.1 port
  if (isDevelopment && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true
  }
  return false
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server proxies)
    if (!origin) return callback(null, true)

    if (isAllowedOrigin(origin)) {
      return callback(null, true)
    }

    callback(null, false)
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-api-key",
    "X-Api-Key",
    "x-site-key",
    "X-Site-Key",
    "x-idempotency-key",
    "X-Idempotency-Key",
    "idempotency-key",
    "X-Content-SHA256",
    "x-content-sha256",
    "X-Audio-SHA256",
    "x-audio-sha256",
    "X-File-Name",
    "x-file-name",
  ],
  credentials: true, // Allow cookies to be sent across origins
  maxAge: 86400, // Cache preflight requests for 24 hours
}

// Apply CORS middleware
app.use(cors(corsOptions))
// Handle preflight OPTIONS requests
app.options("*", cors(corsOptions))

// Enforce HTTPS in production behind reverse proxies / balancers
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      return next()
    }
    return res.redirect(301, `https://${req.headers.host}${req.url}`)
  })
}

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

// Rate limiting middleware
const { dashboardLimiter, integrationLimiter } = require("./middleware/rateLimiters")
app.use("/api", dashboardLimiter)

// Body and Cookie parsing middleware (hardened 2mb request-size limit)
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true, limit: "2mb" }))
app.use(cookieParser())
app.use(verifyCSRF(allowedOrigins))

// Health check route - accurately reports service and database readiness without leaking details
app.get("/health", (_req, res) => {
  const isDbReady = mongoose.connection && mongoose.connection.readyState === 1
  if (!isDbReady) {
    return res.status(503).json({
      status: "degraded",
      database: "disconnected",
      message: "Database service unavailable",
      timestamp: new Date().toISOString(),
    })
  }

  res.status(200).json({
    status: "healthy",
    database: "connected",
    message: "Service is operational",
    timestamp: new Date().toISOString(),
  })
})

// Ensure DB is ready for API calls
app.use("/api", checkDbConnection)
app.use("/api", tenantContextMiddleware)

// API routes
app.use("/api/auth", authRoutes)
app.use("/api/super-admin", superAdminRoutes)
app.use("/api/leads", leadRoutes)
app.use("/api/follow-ups", followUpRoutes)
app.use("/api/followups", followUpRoutes)
app.use("/api/staff", staffRoutes)
app.use("/api/teams", teamRoutes)
app.use("/api/roles", roleRoutes)
app.use("/api/assignment-rules", assignmentRuleRoutes)
app.use("/api/audit-logs", auditRoutes)
app.use("/api/admin/queues", queueMonitorRoutes)
app.use("/api/integrations", integrationLimiter, integrationRoutes)

// Secure Call Recording Streaming & Playback endpoints (Phase 8 + Final Integration)
const {
  uploadMobileRecording,
  mobileRefreshToken,
  streamCallRecording,
  streamRecordingByPath,
} = require("./controllers/mobileController")
const { authenticate } = require("./middleware/authMiddleware")

// Strictly authenticated recording access — prevents unauthenticated streaming or cross-tenant exposure
app.get("/uploads/recordings/:tenantId/:fileName", checkDbConnection, authenticate, streamRecordingByPath)
app.get("/api/calls/:callId/recording", checkDbConnection, authenticate, streamCallRecording)
app.put("/api/calls/:callId/recording", checkDbConnection, authenticate, uploadMobileRecording)
app.post("/api/auth/refresh", mobileRefreshToken)

app.use("/api/calls", callRoutes)
app.use("/api/devices", callRoutes)
app.use("/api/mobile", mobileRoutes)
app.use("/api/mobile/v1", mobileRoutes)
app.use("/mobile/v1", checkDbConnection, mobileRoutes)
app.use("/api/privacy", privacyRoutes)

// Error handling middleware
app.use(notFound)
app.use(errorHandler)

let server = null
let isShuttingDown = false

const setupGracefulShutdown = (httpServer) => {
  const shutdown = async (signal) => {
    if (isShuttingDown) {
      console.log(`⚠️ Shutdown already in progress. Ignoring duplicate ${signal}.`)
      return
    }
    isShuttingDown = true
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`)

    // Force exit if graceful shutdown exceeds timeout (10s)
    const forceExitTimer = setTimeout(() => {
      console.error("❌ Graceful shutdown timed out (10s limit exceeded). Forcing process exit.")
      process.exit(1)
    }, 10000)
    if (forceExitTimer.unref) {
      forceExitTimer.unref()
    }

    try {
      // 1. Stop accepting new HTTP requests
      if (httpServer && httpServer.close) {
        await new Promise((resolve) => {
          httpServer.close((err) => {
            if (err) {
              console.error("Error closing HTTP server:", err.message)
            } else {
              console.log("✅ HTTP server closed. In-flight requests completed.")
            }
            resolve()
          })
        })
      }

      // 2. Safely close Mongoose connection pool
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false)
        console.log("✅ Mongoose connection closed cleanly.")
      }

      clearTimeout(forceExitTimer)
      console.log("👋 Graceful shutdown complete. Exiting process.")
      process.exit(0)
    } catch (err) {
      console.error("❌ Error during graceful shutdown:", err.message)
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}

const startServer = async () => {
  try {
    console.log("⏳ Connecting to database before starting HTTP server...")
    await connectDB()
    console.log("✅ Database connected successfully.")

    const { registerAllHandlers } = require("./jobs")
    registerAllHandlers()

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server is running on port ${PORT}`)
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
    })

    setupGracefulShutdown(server)
  } catch (err) {
    console.error("❌ Fatal error during server startup:", err.message)
    if (process.env.NODE_ENV === "production") {
      process.exit(1)
    } else {
      console.warn("⚠️ Starting HTTP server in degraded mode for development debugging...")
      server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server is running in degraded mode on port ${PORT}`)
      })
      setupGracefulShutdown(server)
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  startServer()
}

module.exports = app
module.exports.startServer = startServer
module.exports.setupGracefulShutdown = setupGracefulShutdown
