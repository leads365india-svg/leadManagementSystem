const User = require("../models/User")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, RolePermission } = require("../models/RolePermission")
const SystemConfig = require("../models/SystemConfig")

const bootstrapSuperAdmin = async () => {
  try {
    const isForceReseed = process.env.FORCE_RESEED_SUPERADMIN === "true"

    // Check persistent bootstrap history in system configuration
    const bootstrapMarker = await SystemConfig.findOne({ key: "superadmin_bootstrap_completed" })

    // Bootstrap default Account Admin permissions template if not present or missing audit.view
    let permissionsConfig = await RolePermission.findOne({ targetRole: "account_admin" })
    if (!permissionsConfig) {
      await RolePermission.create({
        targetRole: "account_admin",
        permissions: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
        updatedBy: "system_bootstrap",
      })
      console.log("✅ Default Leads Account Admin permissions configured.")
    } else {
      let changed = false
      for (const perm of DEFAULT_ACCOUNT_ADMIN_PERMISSIONS) {
        if (!permissionsConfig.permissions.includes(perm)) {
          permissionsConfig.permissions.push(perm)
          changed = true
        }
      }
      if (changed) {
        await permissionsConfig.save()
      }
    }

    // Ensure all existing system account_admin roles in the database possess audit.view
    const Role = require("../models/Role")
    await Role.updateMany(
      { isSystem: true, slug: "account_admin" },
      { $addToSet: { permissions: "audit.view" } },
    ).setOptions({ skipTenantFilter: true })

    // Check if any Super Admin currently exists in the database
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
    }

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


  } catch (error) {
    console.error("⚠️ Error bootstrapping Super Admin account:", error)
  }
}

module.exports = {
  bootstrapSuperAdmin,
}
