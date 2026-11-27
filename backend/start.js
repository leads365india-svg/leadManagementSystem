const path = require("path")
const dotenv = require("dotenv")

// Load environment variables immediately before any internal module or route is required
dotenv.config({ path: path.join(__dirname, ".env") })

const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const cookieParser = require("cookie-parser")
const mongoose = require("mongoose")
const connectDB = require("./db/connection")
const { checkDbConnection } = require("./db/connection")
const leadRoutes = require("./routes/leadRoutes")
const leadImportRoutes = require("./routes/leadImportRoutes")
const authRoutes = require("./routes/authRoutes")
const superAdminRoutes = require("./routes/superAdminRoutes")
const integrationRoutes = require("./routes/integrationRoutes")
const followUpRoutes = require("./routes/followUpRoutes")
const staffRoutes = require("./routes/staffRoutes")
const teamRoutes = require("./routes/teamRoutes")
const roleRoutes = require("./routes/roleRoutes")
const assignmentRuleRoutes = require("./routes/assignmentRuleRoutes")
const auditRoutes = require("./routes/auditRoutes")
const queueMonitorRoutes = require("./routes/queueMonitorRoutes")
const callRoutes = require("./routes/callRoutes")
const deviceRoutes = require("./routes/deviceRoutes")
const mobileRoutes = require("./routes/mobileRoutes")
const privacyRoutes = require("./routes/privacyRoutes")
const mediaRoutes = require("./routes/mediaRoutes")
const customFieldRoutes = require("./routes/customFieldRoutes")
const aiKnowledgeRoutes = require("./routes/aiKnowledgeRoutes")
const aiKeywordRoutes = require("./routes/aiKeywordRoutes")
const aiCallRoutes = require("./routes/aiCallRoutes")
const aiSalesIntelligenceRoutes = require("./routes/aiSalesIntelligenceRoutes")
const telephonyRoutes = require("./routes/telephonyRoutes")
const quotationRoutes = require("./routes/quotationRoutes")
const brochureRoutes = require("./routes/brochureRoutes")
const emailConfigRoutes = require("./routes/emailConfigRoutes")
const dealAnalyticsRoutes = require("./routes/dealAnalyticsRoutes")
const workspaceRoutes = require("./routes/workspaceRoutes")
const { getJwtSecret, verifyCSRF } = require("./middleware/authMiddleware")
const { tenantContextMiddleware } = require("./middleware/tenantContext")
const { errorHandler, notFound } = require("./middleware/errorHandler")

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

// Import CORS origin parsing and matching helpers
const { parseAllowedOrigins, isOriginAllowed } = require("./utils/corsHelper")
const {
  isCustomDomainAllowed,
  invalidateCustomDomainCache,
} = require("./utils/customDomainCache")

// CORS configuration supporting comma-separated FRONTEND_URL or local defaults
const configuredFrontendUrls = parseAllowedOrigins(process.env.FRONTEND_URL || "")

const defaultLocalOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
]

// Support core platform and preview deployments alongside configured origins
const platformDefaults = [
  "https://leads365.in",
  "https://*.leads365.in",
  "https://*.vercel.app",
  "https://*.onrender.com",
]

const allowedOrigins = [
  ...new Set([
    ...configuredFrontendUrls,
    ...platformDefaults,
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
    "x-signature-256",
    "X-Signature-256",
    "x-hub-signature-256",
    "X-Hub-Signature-256",
    "x-signature",
    "X-Signature",
    "x-hmac-signature",
    "X-Hmac-Signature",
    "x-timestamp",
    "X-Timestamp",
    "x-request-timestamp",
    "X-Request-Timestamp",
    "timestamp",
    "Timestamp",
    "x-idempotency-key",
    "X-Idempotency-Key",
    "idempotency-key",
    "x-queue-async",
    "X-Queue-Async",
    "X-Content-SHA256",
    "x-content-sha256",
    "X-Audio-SHA256",
    "x-audio-sha256",
    "X-File-Name",
    "x-file-name",
    "X-Shopify-Hmac-Sha256",
    "x-shopify-hmac-sha256",
    "X-Shopify-Shop-Domain",
    "x-shopify-shop-domain",
    "X-Shopify-Topic",
    "x-shopify-topic",
    "X-Shopify-Webhook-Id",
    "x-shopify-webhook-id",
  ],
})
app.use("/api/integrations/leads/website", webhookCors)
app.options("/api/integrations/leads/website", webhookCors)

const isDevelopment = process.env.NODE_ENV !== "production"

const isAllowedOrigin = (origin) => {
  return isOriginAllowed(origin, allowedOrigins, isDevelopment)
}

const defaultAllowedHeaders = [
  "Content-Type",
  "Authorization",
  "x-tenant-domain",
  "X-Tenant-Domain",
  "x-auth-portal",
  "X-Auth-Portal",
  "x-tenant-id",
  "X-Tenant-Id",
  "x-workspace-id",
  "X-Workspace-Id",
  "x-csrf-token",
  "X-CSRF-Token",
  "x-requested-with",
  "X-Requested-With",
  "Accept",
  "Origin",
  "Access-Control-Request-Method",
  "Access-Control-Request-Headers",
]

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server proxies)
    if (!origin) return callback(null, true)

    // Fast-path: check static / env / local origins
    if (isAllowedOrigin(origin)) {
      return callback(null, true)
    }

    // Dynamic check for tenant custom domains (white-label CNAME domains)
    isCustomDomainAllowed(origin)
      .then((allowed) => {
        if (allowed) {
          return callback(null, true)
        }
        callback(null, false)
      })
      .catch((err) => {
        console.error("Dynamic CORS domain validation error:", err.message)
        callback(null, false)
      })
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: defaultAllowedHeaders,
  credentials: true, // Allow cookies to be sent across origins
  maxAge: 86400, // Cache preflight requests for 24 hours
  optionsSuccessStatus: 204,
}

// Dynamic CORS delegate that reflects requested headers while ensuring defaults are always permitted
const corsOptionsDelegate = (req, callback) => {
  const reqHeaders = req.headers["access-control-request-headers"]
  let allowedHeaders = [...defaultAllowedHeaders]
  if (reqHeaders && typeof reqHeaders === "string") {
    const requested = reqHeaders.split(",").map((h) => h.trim()).filter(Boolean)
    for (const h of requested) {
      if (!allowedHeaders.some((ah) => ah.toLowerCase() === h.toLowerCase())) {
        allowedHeaders.push(h)
      }
    }
  }

  callback(null, {
    origin: corsOptions.origin,
    methods: corsOptions.methods,
    allowedHeaders,
    credentials: true,
    maxAge: 86400,
    optionsSuccessStatus: 204,
  })
}

// Apply CORS middleware - MUST RUN FIRST before any auth, CSRF, rate-limit, or redirect middleware
app.options("*", cors(corsOptionsDelegate))
app.use(cors(corsOptionsDelegate))

// Enforce HTTPS in production behind reverse proxies / balancers
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    // OPTIONS preflight requests must NEVER be redirected (causes CORS preflight failure in browsers)
    if (req.method === "OPTIONS") {
      return next()
    }
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      return next()
    }
    return res.redirect(301, `https://${req.headers.host}${req.url}`)
  })
}

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
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

// Body and Cookie parsing middleware (hardened 2mb request-size limit with rawBody preservation)
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length) {
        req.rawBody = buf
      }
    },
  })
)
app.use(express.urlencoded({ extended: true, limit: "2mb" }))
app.use(cookieParser())
app.use(verifyCSRF(allowedOrigins))

// Health check route - accurately reports service, database readiness, dbName, and worker status
const healthCheckHandler = (_req, res) => {
  const isDbReady = mongoose.connection && mongoose.connection.readyState === 1
  const workerStatus = process.env.DISABLE_EMBEDDED_WORKER === "true" ? "disabled" : "active"

  if (!isDbReady) {
    return res.status(503).json({
      status: "degraded",
      database: "disconnected",
      databaseName: mongoose.connection?.name || null,
      worker: workerStatus,
      message: "Database service unavailable",
      timestamp: new Date().toISOString(),
    })
  }

  res.status(200).json({
    status: "healthy",
    database: "connected",
    databaseName: mongoose.connection.name,
    worker: workerStatus,
    message: "Service is operational",
    timestamp: new Date().toISOString(),
  })
}

app.get("/health", healthCheckHandler)
app.get("/api/health", healthCheckHandler)

// Ensure DB is ready for API calls
app.use("/api", checkDbConnection)
app.use("/api", tenantContextMiddleware)

// API routes
app.use("/api/auth", authRoutes)
app.use("/api/super-admin", superAdminRoutes)
app.use("/api/leads/import", leadImportRoutes)
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
app.use("/api/custom-fields", customFieldRoutes)
app.use("/api/ai-knowledge", aiKnowledgeRoutes)
app.use("/api/ai-keywords", aiKeywordRoutes)
app.use("/api/ai-calls", aiCallRoutes)
app.use("/api/ai-sales-intelligence", aiSalesIntelligenceRoutes)
app.use("/api/telephony", telephonyRoutes)
app.use("/api/quotations", quotationRoutes)
app.use("/api/brochures", brochureRoutes)
app.use("/api/email-config", emailConfigRoutes)
app.use("/api/deal-analytics", dealAnalyticsRoutes)
app.use("/api/workspaces", workspaceRoutes)

// Secure Call Recording Streaming & Playback endpoints (Phase 8 + Final Integration)
const {
  uploadMobileRecording,
  mobileRefreshToken,
  streamCallRecording,
  streamRecordingByPath,
} = require("./controllers/mobileController")
const { authenticate } = require("./middleware/authMiddleware")
const { authenticateRecordingUpload } = require("./middleware/recordingAuthMiddleware")

// Strictly authenticated recording access — prevents unauthenticated streaming or cross-tenant exposure
app.get("/uploads/recordings/:tenantId/:fileName", checkDbConnection, authenticate, streamRecordingByPath)
app.get("/api/calls/:callId/recording", checkDbConnection, authenticate, streamCallRecording)
app.put("/api/calls/:callId/recording", checkDbConnection, authenticateRecordingUpload, uploadMobileRecording)
app.post("/api/auth/refresh", mobileRefreshToken)

app.use("/api/calls", callRoutes)
app.use("/api/devices", deviceRoutes)
app.use("/api/mobile", mobileRoutes)
app.use("/api/mobile/v1", mobileRoutes)
app.use("/mobile/v1", checkDbConnection, mobileRoutes)
app.use("/api/privacy", privacyRoutes)
app.use("/api/media", mediaRoutes)

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
      // 0. Stop embedded worker polling loop if active
      try {
        const worker = require("./worker")
        if (worker.stopPolling) {
          worker.stopPolling()
        }
      } catch (_e) {}

      // 0.4 Shutdown Gemini Live sessions
      try {
        const { geminiLiveManager } = require("./services/telephony/geminiLiveClient.service")
        geminiLiveManager.closeAll()
      } catch (_e) {}

      // 0.5 Shutdown Voice Gateway active streams
      try {
        const { voiceGateway } = require("./services/telephony/voiceGateway.service")
        await voiceGateway.shutdown()
      } catch (_e) {}

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

    // Pre-warm tenant custom domain CORS cache before listening
    try {
      const { getCustomDomainsCached } = require("./utils/customDomainCache")
      await getCustomDomainsCached()
      console.log("✅ Tenant custom domain CORS cache pre-warmed.")
    } catch (cacheErr) {
      console.warn("⚠️ Failed to pre-warm custom domain cache:", cacheErr.message)
    }

    // Auto-restore active WhatsApp QR sync sessions
    try {
      const { restoreConnectedSessions } = require("./services/whatsappQrService")
      await restoreConnectedSessions()
    } catch (qrErr) {
      console.warn("⚠️ Failed to restore WhatsApp QR sessions:", qrErr.message)
    }

    const { registerAllHandlers } = require("./jobs")
    registerAllHandlers()

    try {
      const { recoverStaleAiJobs, RECOVER_STALE_JOB_NAME } = require("./services/aiCallProcessingPipeline")
      await recoverStaleAiJobs()
      const scheduler = require("./services/schedulerService")
      scheduler.registerSchedule({
        id: "ai-call-stale-recovery",
        name: RECOVER_STALE_JOB_NAME,
        intervalMs: 5 * 60 * 1000,
        runImmediately: false,
      })
    } catch (recErr) {
      console.warn("⚠️ Startup AI stale-job recovery notice:", recErr.message)
    }

    if (process.env.DISABLE_EMBEDDED_WORKER !== "true") {
      const worker = require("./worker")
      const scheduler = require("./services/schedulerService")
      scheduler.startScheduler()
      worker.processNext()
      console.log("✅ Background queue worker polling loop active.")
    }

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server is running on port ${PORT}`)
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
      try {
        const { voiceGateway } = require("./services/telephony/voiceGateway.service")
        voiceGateway.attach(server)
        const { geminiLiveManager } = require("./services/telephony/geminiLiveClient.service")
        geminiLiveManager.attachToVoiceGateway(voiceGateway)
      } catch (vgErr) {
        console.error("⚠️ Failed to attach Voice Gateway:", vgErr.message)
      }
    })

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use by another process.`)
        console.error("💡 Check running node processes or specify a different PORT in .env")
      } else {
        console.error("❌ HTTP server error:", err.message)
      }
      process.exit(1)
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
        try {
          const { voiceGateway } = require("./services/telephony/voiceGateway.service")
          voiceGateway.attach(server)
          const { geminiLiveManager } = require("./services/telephony/geminiLiveClient.service")
          geminiLiveManager.attachToVoiceGateway(voiceGateway)
        } catch (vgErr) {
          console.error("⚠️ Failed to attach Voice Gateway in degraded mode:", vgErr.message)
        }
      })
      setupGracefulShutdown(server)
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  startServer()
}

module.exports = app
module.exports.webhookCors = webhookCors
module.exports.corsOptions = corsOptions
module.exports.invalidateCustomDomainCache = invalidateCustomDomainCache
module.exports.startServer = startServer
module.exports.setupGracefulShutdown = setupGracefulShutdown
module.exports.voiceGateway = require("./services/telephony/voiceGateway.service").voiceGateway
module.exports.geminiLiveManager = require("./services/telephony/geminiLiveClient.service").geminiLiveManager
