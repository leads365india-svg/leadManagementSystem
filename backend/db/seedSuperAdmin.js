const bcrypt = require("bcryptjs")
const User = require("../models/User")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, RolePermission } = require("../models/RolePermission")
const SystemConfig = require("../models/SystemConfig")

/**
 * Validates whether a given string is a structurally sound bcrypt hash.
 * Bcrypt hashes begin with $2a$, $2b$, or $2y$, followed by a 2-digit cost, and 53 base64 characters.
 */
function isValidBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)
}

const bootstrapSuperAdmin = async () => {
  try {
    const isForceReseed = process.env.FORCE_RESEED_SUPERADMIN === "true"

    // 1. Check persistent bootstrap history in system configuration
    const bootstrapMarker = await SystemConfig.findOne({ key: "superadmin_bootstrap_completed" })

    // 2. Bootstrap default Account Admin permissions template if not present or missing audit.view
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

    // 3. Ensure all existing system account_admin roles in the database possess audit.view
    const Role = require("../models/Role")
    await Role.updateMany(
      { isSystem: true, slug: "account_admin" },
      { $addToSet: { permissions: "audit.view" } },
    ).setOptions({ skipTenantFilter: true })

    // 4. Query existing Super Admin account explicitly selecting the password hash
    // (User schema marks password with select: false, so +password is mandatory)
    const superAdminExists = await User.findOne({ role: "super_admin" }).select("+password")

    // 5. Inspect and validate environment configuration for Super Admin seeding
    const configuredPassword = typeof process.env.SUPERADMIN_PASSWORD === "string"
      ? process.env.SUPERADMIN_PASSWORD.trim()
      : ""
    const configuredEmail = typeof process.env.SUPERADMIN_EMAIL === "string"
      ? process.env.SUPERADMIN_EMAIL.toLowerCase().trim()
      : ""
    const configuredName = typeof process.env.SUPERADMIN_NAME === "string"
      ? process.env.SUPERADMIN_NAME.trim()
      : ""

    // 6. Handle existing Super Admin account state safely
    if (superAdminExists) {
      const storedHash = superAdminExists.password
      const hasStoredHash = typeof storedHash === "string" && storedHash.trim().length > 0
      const isStoredHashValid = hasStoredHash && isValidBcryptHash(storedHash)

      if (!hasStoredHash || !isStoredHashValid) {
        // Super Admin record found with missing or corrupt password hash
        if (isForceReseed) {
          if (configuredPassword) {
            superAdminExists.password = configuredPassword
            if (configuredEmail) {
              superAdminExists.email = configuredEmail
            }
            await superAdminExists.save()
            console.log("✅ Super Admin password repaired via explicit FORCE_RESEED_SUPERADMIN recovery.")
          } else {
            console.warn("⚠️ Cannot repair Super Admin password: SUPERADMIN_PASSWORD environment variable is required when FORCE_RESEED_SUPERADMIN=true.")
          }
        } else {
          console.warn(
            !hasStoredHash
              ? "⚠️ Existing Super Admin record is missing a password hash. Automatic overwrite skipped to protect existing credentials. Set FORCE_RESEED_SUPERADMIN=true with SUPERADMIN_PASSWORD in environment to repair."
              : "⚠️ Existing Super Admin record has an invalid password hash format. Automatic overwrite skipped to protect existing credentials. Set FORCE_RESEED_SUPERADMIN=true with SUPERADMIN_PASSWORD in environment to repair."
          )
        }
      } else {
        // Valid password hash exists in database
        if (!configuredPassword) {
          console.log("ℹ️ SUPERADMIN_PASSWORD environment variable is not configured. Skipping credential verification.")
        } else {
          // Both arguments are guaranteed valid strings before invoking bcrypt.compare
          try {
            const isMatch = await bcrypt.compare(configuredPassword, storedHash)
            if (isMatch) {
              console.log("ℹ️ Super Admin credentials verified against environment configuration.")
            } else {
              if (isForceReseed) {
                superAdminExists.password = configuredPassword
                if (configuredEmail) {
                  superAdminExists.email = configuredEmail
                }
                await superAdminExists.save()
                console.log("✅ Super Admin password synchronized from SUPERADMIN_PASSWORD environment variable via FORCE_RESEED_SUPERADMIN.")
              } else {
                console.log("ℹ️ Super Admin credentials in database differ from environment configuration. Preserving existing database credentials (set FORCE_RESEED_SUPERADMIN=true to force synchronization).")
              }
            }
          } catch (compareErr) {
            console.warn("⚠️ Failed to compare Super Admin password hash:", compareErr.message)
          }
        }
      }

      // If already bootstrapped in the past and not explicitly forced to reseed, do not perform account creation
      if (bootstrapMarker && !isForceReseed) {
        return { success: true, status: "already_bootstrapped", superAdminId: superAdminExists._id }
      }
    }

    // 7. First-time bootstrap or explicit FORCE_RESEED recreation
    if (!superAdminExists) {
      const email = configuredEmail || "superadmin@leadflow.io"
      const password = configuredPassword || "SuperAdmin@2026!"
      const name = configuredName || "LeadFlow Super Admin"

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

      // Mark persistent bootstrap record to prevent future silent password recreation
      await SystemConfig.findOneAndUpdate(
        { key: "superadmin_bootstrap_completed" },
        { value: { bootstrappedAt: new Date(), email } },
        { upsert: true, new: true },
      )

      return { success: true, status: "bootstrapped", superAdminId: superAdmin._id }
    }

    return { success: true, status: "ready", superAdminId: superAdminExists?._id }
  } catch (error) {
    console.error("⚠️ Error bootstrapping Super Admin account:", error.message || error)
    return { success: false, error: error.message }
  }
}

module.exports = {
  bootstrapSuperAdmin,
  isValidBcryptHash,
}
