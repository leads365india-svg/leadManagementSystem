const mongoose = require("mongoose")
const dotenv = require("dotenv")
const { bootstrapSuperAdmin } = require("./seedSuperAdmin")

dotenv.config()

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI

    if (!mongoURI) {
      throw new Error("MONGODB_URI is not defined in environment variables")
    }

    const conn = await mongoose.connect(mongoURI)

    console.log(`MongoDB Connected: ${conn.connection.host}`)
    await bootstrapSuperAdmin()
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error)
    console.error("\n💡 Help: MongoDB is not reachable.")
    console.error("1. If using MongoDB locally: Make sure MongoDB service is running (e.g. 'net start MongoDB' or start mongod).")
    console.error("2. If using MongoDB Atlas (Cloud): Put your connection string in backend/.env (e.g. MONGODB_URI=mongodb+srv://...)\n")
    process.exit(1)
  }
}

module.exports = connectDB
