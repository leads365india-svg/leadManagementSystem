const mongoose = require("mongoose")
require("dotenv").config({ path: "backend/.env" })
const Account = require("../models/Account")
const User = require("../models/User")

async function inspectAccounts() {
  try {
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/leadflow"
    await mongoose.connect(mongoUri)
    console.log("Connected to MongoDB.")

    const accounts = await Account.find({}).lean()
    console.log(`\n=== TOTAL ACCOUNTS IN DB: ${accounts.length} ===`)
    for (const acc of accounts) {
      console.log(`Account ID: ${acc.accountId} | Company: "${acc.companyName}" | Status: ${acc.status} | CreatedAt: ${acc.createdAt} | Domain: "${acc.customDomain || ''}" | Slug: "${acc.slug || ''}"`)
    }

    const superAdmins = await User.find({ role: "super_admin" }).lean()
    console.log(`\n=== SUPER ADMIN USERS: ${superAdmins.length} ===`)
    for (const sa of superAdmins) {
      console.log(`SuperAdmin ID: ${sa._id} | Name: "${sa.name}" | Email: "${sa.email}" | Status: ${sa.status} | CreatedAt: ${sa.createdAt}`)
    }

    await mongoose.disconnect()
  } catch (err) {
    console.error("Inspection error:", err.message)
    process.exit(1)
  }
}

inspectAccounts()
