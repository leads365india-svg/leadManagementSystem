const fs = require("fs")
const path = require("path")

const seedPath = path.resolve(__dirname, "../db/seedSuperAdmin.js")
let content = fs.readFileSync(seedPath, "utf8").replace(/\r\n/g, "\n")

const targetStr = `    // If already bootstrapped in the past and not explicitly forced, do not recreate default credentials
    if (bootstrapMarker && !isForceReseed) {
      return
    }

    // Check if any Super Admin currently exists in the database
    const superAdminExists = await User.findOne({ role: "super_admin" })`

const replacementStr = `    // Check if any Super Admin currently exists in the database
    const superAdminExists = await User.findOne({ role: "super_admin" })

    // If SUPERADMIN_PASSWORD is set in environment, ensure the hash in DB matches
    if (superAdminExists && process.env.SUPERADMIN_PASSWORD) {
      const bcrypt = require("bcryptjs")
      const isMatch = await bcrypt.compare(process.env.SUPERADMIN_PASSWORD, superAdminExists.password)
      if (!isMatch) {
        superAdminExists.password = process.env.SUPERADMIN_PASSWORD
        if (process.env.SUPERADMIN_EMAIL) {
          superAdminExists.email = process.env.SUPERADMIN_EMAIL.toLowerCase().trim()
        }
        await superAdminExists.save()
        console.log("✅ Super Admin password synchronized from SUPERADMIN_PASSWORD environment variable.")
      }
    }

    // If already bootstrapped in the past and not explicitly forced, do not recreate default credentials
    if (bootstrapMarker && !isForceReseed) {
      return
    }`

if (!content.includes(targetStr)) {
  console.error("targetStr not found in seedSuperAdmin.js")
  process.exit(1)
}

content = content.replace(targetStr, replacementStr)
fs.writeFileSync(seedPath, content, "utf8")
console.log("Successfully patched seedSuperAdmin.js!")
