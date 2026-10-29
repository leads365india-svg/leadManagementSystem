const mongoose = require("mongoose")
require("dotenv").config({ path: "backend/.env" })
const Account = require("../models/Account")

async function backfillSlugs() {
  try {
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/leadflow"
    await mongoose.connect(mongoUri)
    console.log("Connected to MongoDB for slug backfill.")

    const accounts = await Account.find({ $or: [{ slug: "" }, { slug: { $exists: false } }, { slug: null }] })
    console.log(`Found ${accounts.length} accounts without a slug.`)

    for (const acc of accounts) {
      let base = (acc.companyName || acc.displayName || "tenant")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
      if (!base) base = "tenant"
      
      let candidate = base
      let counter = 1
      while (await Account.findOne({ slug: candidate, _id: { $ne: acc._id } })) {
        counter++
        candidate = `${base}-${counter}`
      }

      acc.slug = candidate
      await acc.save()
      console.log(`  Updated Account ${acc.accountId} ("${acc.companyName}") -> slug: "${candidate}"`)
    }

    await mongoose.disconnect()
    console.log("Backfill complete.")
  } catch (err) {
    console.error("Backfill error:", err.message)
    process.exit(1)
  }
}

backfillSlugs()
