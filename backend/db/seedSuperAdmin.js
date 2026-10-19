const User = require("../models/User")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, RolePermission } = require("../models/RolePermission")
const SystemConfig = require("../models/SystemConfig")

const bootstrapSuperAdmin = async () => {
  try {
    const isForceReseed = process.env.FORCE_RESEED_SUPERADMIN === "true"

    // Check persistent bootstrap history in system configuration
    const bootstrapMarker = await SystemConfig.findOne({ key: "superadmin_bootstrap_completed" })

    // If already bootstrapped in the past and not explicitly forced, do not recreate default credentials
    if (bootstrapMarker && !isForceReseed) {
      return
    }

    // Check if any Super Admin currently exists in the database
    const superAdminExists = await User.findOne({ role: "super_admin" })

    if (!superAdminExists || isForceReseed) {
      const email = (process.env.SUPERADMIN_EMAIL || "superadmin@leadflow.io").toLowerCase().trim()
      const password = process.env.SUPERADMIN_PASSWORD || "SuperAdmin@2026!"
      const name = process.env.SUPERADMIN_NAME || "LeadFlow Super Admin"

      if (superAdminExists && isForceReseed) {
        superAdminExists.password = password
        await superAdminExists.save()
        console.log(`ℹ️ Super Admin credentials updated via FORCE_RESEED: ${email}`)
      } else {
        const superAdmin = new User({
          name,
          email,
          password,
          role: "super_admin",
          status: "active",
          tenantId: null,
        })
        await superAdmin.save()
        console.log(`✅ Super Admin account bootstrapped: ${email}`)
      }

      // Mark persistent bootstrap record to prevent future silent password recreation
      await SystemConfig.findOneAndUpdate(
        { key: "superadmin_bootstrap_completed" },
        { value: { bootstrappedAt: new Date(), email } },
        { upsert: true, new: true },
      )
    }

    // Bootstrap default Account Admin permissions template if not present
    const permissionsConfig = await RolePermission.findOne({ targetRole: "account_admin" })
    if (!permissionsConfig) {
      await RolePermission.create({
        targetRole: "account_admin",
        permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
        updatedBy: "system_bootstrap",
      })
      console.log("✅ Default Leads Account Admin permissions configured.")
    }
  } catch (error) {
    console.error("⚠️ Error bootstrapping Super Admin account:", error)
  }
}

module.exports = {
  bootstrapSuperAdmin,
}
