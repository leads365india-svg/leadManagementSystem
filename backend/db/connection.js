const mongoose = require("mongoose")
const dotenv = require("dotenv")
const dns = require("dns")
const { bootstrapSuperAdmin } = require("./seedSuperAdmin")

dotenv.config()

let isConnecting = false
let retryTimer = null

const connectDB = async () => {
  if (isConnecting || mongoose.connection.readyState === 1) return
  isConnecting = true

  try {
    const mongoURI = process.env.MONGODB_URI

    if (!mongoURI) {
      throw new Error("MONGODB_URI is not defined in environment variables")
    }

    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000,
    })

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`)
    if (retryTimer) {
      clearInterval(retryTimer)
      retryTimer = null
    }
    await bootstrapSuperAdmin()
    return conn
  } catch (error) {
    console.error("❌ Error connecting to MongoDB Atlas:", error.message)
    console.error("\n💡 IMPORTANT: If using MongoDB Atlas, ensure your server IP address is whitelisted in Network Access.")
    console.error("1. Go to: https://cloud.mongodb.com -> Network Access")
    console.error("2. Add your server IP address or '0.0.0.0/0' for dynamic cloud hosting environments (e.g. Render).")
    console.error("3. The backend will automatically retry connecting every 10 seconds...\n")

    if (!retryTimer) {
      retryTimer = setInterval(() => {
        connectDB().catch(() => {})
      }, 10000)
    }
    throw error
  } finally {
    isConnecting = false
  }
}

// Middleware to ensure DB is connected before processing requests
const checkDbConnection = (_req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error: "Database service temporarily unavailable. Please verify Atlas Network Access and try again shortly.",
    })
  }
  next()
}

module.exports = connectDB
module.exports.checkDbConnection = checkDbConnection

