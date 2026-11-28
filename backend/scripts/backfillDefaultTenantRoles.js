const path = require("path")
const dotenv = require("dotenv")
dotenv.config({ path: path.join(__dirname, "../.env") })

const mongoose = require("mongoose")
const connectDB = require("../db/connection")
const Account = require("../models/Account")
const Role = require("../models/Role")
const { ensureTenantRoles, SYSTEM_ROLES } = Role
const { getSuperAdminCeiling } = require("../models/RolePermission")
const { isPermissionCoveredByCeiling } = require("../utils/rbacScope")

/**
 * Idempotent Tenant Default Roles Backfill Script
 *
 * Ensures every existing tenant Account has the full set of default system roles
 * (including `account_admin`, `manager`, `sales_executive`, `telecaller`, `marketing`,
 * plus legacy compatibility defaults) without EVER overwriting or resetting existing
 * role documents (especially customized roles or custom roles sharing a slug).
 *
 * Usage:
 *   node backend/scripts/backfillDefaultTenantRoles.js --dry-run
 *   node backend/scripts/backfillDefaultTenantRoles.js
 */
async function backfillDefaultTenantRoles({ dryRun = false } = {}) {
  await connectDB()

  const accounts = await Account.find({})
    .select("accountId companyName displayName status")
    .sort({ createdAt: 1 })
    .lean()

  const ceiling = await getSuperAdminCeiling()
  const systemSlugs = SYSTEM_ROLES.map((r) => r.slug)
  const report = []

  console.log(`\n${dryRun ? "[DRY-RUN] " : ""}Backfilling default tenant roles for ${accounts.length} account(s)...`)
  console.log(`System role slugs checked: ${systemSlugs.join(", ")}\n`)

  for (const account of accounts) {
    const tenantId = account.accountId
    const beforeRoles = await Role.find({ tenantId })
      .setOptions({ skipTenantFilter: true })
      .select("slug name isSystem isCustomized permissions")
      .lean()

    const beforeSlugs = new Set(beforeRoles.map((r) => r.slug))
    const missingSysRoles = SYSTEM_ROLES.filter((sr) => !beforeSlugs.has(sr.slug))

    if (!dryRun && missingSysRoles.length > 0) {
      await ensureTenantRoles(tenantId)
    }

    const afterRoles = !dryRun
      ? await Role.find({ tenantId })
          .setOptions({ skipTenantFilter: true })
          .select("slug name isSystem isCustomized permissions")
          .lean()
      : beforeRoles

    const afterMap = new Map(afterRoles.map((r) => [r.slug, r]))
    const createdSlugs = missingSysRoles.map((sr) => {
      const created = afterMap.get(sr.slug)
      const perms = created
        ? created.permissions
        : sr.slug === "account_admin" && Array.isArray(ceiling)
          ? Array.from(new Set(ceiling))
          : sr.permissions.filter((p) => isPermissionCoveredByCeiling(p, ceiling))
      return `${sr.slug} (${perms.length} perms)`
    })

    const preservedSlugs = beforeRoles.map(
      (r) => `${r.slug}${r.isCustomized ? " [customized]" : ""}`,
    )

    const entry = {
      tenantId,
      companyName: account.companyName || account.displayName || tenantId,
      created: createdSlugs,
      preserved: preservedSlugs,
      totalAfter: dryRun ? beforeRoles.length + missingSysRoles.length : afterRoles.length,
    }
    report.push(entry)

    console.log(
      `• ${entry.tenantId} (${entry.companyName}): +${createdSlugs.length} added [${
        createdSlugs.join(", ") || "none"
      }], ${preservedSlugs.length} preserved [${preservedSlugs.join(", ")}]`,
    )
  }

  return report
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run")
  backfillDefaultTenantRoles({ dryRun })
    .then(async () => {
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close()
      }
      console.log("\n✅ Tenant default roles backfill complete.\n")
      process.exit(0)
    })
    .catch(async (err) => {
      console.error("\n❌ Tenant default roles backfill failed:", err)
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.connection.close()
      }
      process.exit(1)
    })
}

module.exports = { backfillDefaultTenantRoles }
