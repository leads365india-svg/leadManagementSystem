const mongoose = require("mongoose")
const dotenv = require("dotenv")
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
  } catch (error) {
    console.error("❌ Error connecting to MongoDB Atlas:", error.message)
    console.error("\n💡 IMPORTANT: If using MongoDB Atlas, your current public IP (47.29.250.116) must be whitelisted.")
    console.error("1. Go to: https://cloud.mongodb.com -> Network Access")
    console.error("2. Click 'Add IP Address' -> Select 'Allow Access from Anywhere' (0.0.0.0/0) or add 47.29.250.116")
    console.error("3. The backend will automatically retry connecting every 10 seconds...\n")

    if (!retryTimer) {
      retryTimer = setInterval(() => {
        connectDB()
      }, 10000)
    }
  } finally {
    isConnecting = false
  }
}

// Middleware to ensure DB is connected before processing requests
const checkDbConnection = (_req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error:
        "Database is currently connecting or IP not whitelisted. Please whitelist IP 47.29.250.116 or add '0.0.0.0/0' in MongoDB Atlas Network Access (https://cloud.mongodb.com).",
    })
  }
  next()
}

module.exports = connectDB
module.exports.checkDbConnection = checkDbConnection

