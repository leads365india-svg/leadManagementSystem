const mongoose = require("mongoose")

const PERMISSION_MODULES = [
  {
    module: "Dashboard",
    label: "Dashboard Overview",
    permissions: [
      {
        key: "dashboard.view",
        label: "View Dashboard Overview",
        module: "Dashboard",
        description: "Access stats, pipeline analytics, and performance metrics",
      },
    ],
  },
  {
    module: "Leads",
    label: "Leads Management",
    permissions: [
      {
        key: "leads.view.all",
        label: "View All Leads",
        module: "Leads",
        description: "View all leads across the entire tenant account",
        scope: "all",
      },
      {
        key: "leads.view.team",
        label: "View Team Leads",
        module: "Leads",
        description: "View leads assigned to members of the user's team",
        scope: "team",
      },
      {
        key: "leads.view.own",
        label: "View Own Leads",
        module: "Leads",
        description: "View only leads directly assigned to the user",
        scope: "own",
      },
      {
        key: "leads.create",
        label: "Create Leads",
        module: "Leads",
        description: "Add new leads manually or via imports",
      },
      {
        key: "leads.edit.all",
        label: "Edit All Leads",
        module: "Leads",
        description: "Update any lead in the account",
        scope: "all",
      },
      {
        key: "leads.edit.team",
        label: "Edit Team Leads",
        module: "Leads",
        description: "Update leads belonging to the user's team",
        scope: "team",
      },
      {
        key: "leads.edit.own",
        label: "Edit Own Leads",
        module: "Leads",
        description: "Update only leads assigned to the user",
        scope: "own",
      },
      {
        key: "leads.delete.all",
        label: "Delete All Leads",
        module: "Leads",
        description: "Delete any lead in the account",
        scope: "all",
      },
      {
        key: "leads.delete.team",
        label: "Delete Team Leads",
        module: "Leads",
        description: "Delete leads belonging to the user's team",
        scope: "team",
      },
      {
        key: "leads.delete.own",
        label: "Delete Own Leads",
        module: "Leads",
        description: "Delete only leads assigned to the user",
        scope: "own",
      },
      {
        key: "leads.assign",
        label: "Assign Lead Ownership",
        module: "Leads",
        description: "Reassign lead ownership or team routing",
      },
      {
        key: "leads.export",
        label: "Export Leads Data",
        module: "Leads",
        description: "Download leads in CSV or Excel format",
      },
      {
        key: "leads.bulkUpdate",
        label: "Bulk Update Leads",
        module: "Leads",
        description: "Perform batch status or field updates on leads",
      },
    ],
  },
  {
    module: "Follow-ups",
    label: "Follow-ups Management",
    permissions: [
      {
        key: "followups.view.all",
        label: "View All Follow-ups",
        module: "Follow-ups",
        description: "See all follow-ups across the tenant account",
        scope: "all",
      },
      {
        key: "followups.view.team",
        label: "View Team Follow-ups",
        module: "Follow-ups",
        description: "See follow-ups scheduled by or assigned to team members",
        scope: "team",
      },
      {
        key: "followups.view.own",
        label: "View Own Follow-ups",
        module: "Follow-ups",
        description: "See only follow-ups assigned to the current user",
        scope: "own",
      },
      {
        key: "followups.manage.all",
        label: "Manage All Follow-ups",
        module: "Follow-ups",
        description: "Create, reschedule, and complete any follow-up in the account",
        scope: "all",
      },
      {
        key: "followups.manage.team",
        label: "Manage Team Follow-ups",
        module: "Follow-ups",
        description: "Manage follow-ups belonging to the user's team",
        scope: "team",
      },
      {
        key: "followups.manage.own",
        label: "Manage Own Follow-ups",
        module: "Follow-ups",
        description: "Manage only follow-ups assigned to the current user",
        scope: "own",
      },
    ],
  },
  {
    module: "Calls",
    label: "Calls & Telephony",
    permissions: [
      {
        key: "calls.view.all",
        label: "View All Call Records",
        module: "Calls",
        description: "Review call logs across the entire tenant",
        scope: "all",
      },
      {
        key: "calls.view.team",
        label: "View Team Call Records",
        module: "Calls",
        description: "Review call logs for team members",
        scope: "team",
      },
      {
        key: "calls.view.own",
        label: "View Own Call Records",
        module: "Calls",
        description: "Review call logs initiated by the user",
        scope: "own",
      },
      {
        key: "calls.log",
        label: "Log Calls & Dispositions",
        module: "Calls",
        description: "Log outbound and inbound calls, notes, and call outcomes",
      },
    ],
  },
  {
    module: "Recordings",
    label: "Call Recordings",
    permissions: [
      {
        key: "recordings.listen",
        label: "Listen to Call Recordings",
        module: "Recordings",
        description: "Stream and playback recorded customer phone conversations",
      },
      {
        key: "recordings.download",
        label: "Download Call Recordings",
        module: "Recordings",
        description: "Export audio recording files locally",
      },
      {
        key: "recordings.manage",
        label: "Manage Recordings",
        module: "Recordings",
        description: "Delete or override recording retention flags",
      },
    ],
  },
  {
    module: "Staff & Teams",
    label: "Staff & Team Management",
    permissions: [
      {
        key: "staff.view",
        label: "View Staff & Agents",
        module: "Staff & Teams",
        description: "View staff list, profiles, and team assignments",
      },
      {
        key: "staff.manage",
        label: "Manage Staff Accounts",
        module: "Staff & Teams",
        description: "Invite, update roles, reset passwords, and deactivate staff",
      },
      {
        key: "teams.manage",
        label: "Manage Teams & Squads",
        module: "Staff & Teams",
        description: "Create, rename, and assign members to sales teams",
      },
    ],
  },
  {
    module: "Integrations & Devices",
    label: "Integrations & Mobile Devices",
    permissions: [
      {
        key: "integrations.manage",
        label: "Manage Integrations",
        module: "Integrations & Devices",
        description: "Configure website feeds, webhooks, and ad channels",
      },
      {
        key: "devices.manage",
        label: "Manage Mobile Devices",
        module: "Integrations & Devices",
        description: "Approve, register, and revoke agent Android recording phones",
      },
      {
        key: "donotrecord.manage",
        label: "Manage Do-Not-Record List",
        module: "Integrations & Devices",
        description: "Configure phone numbers excluded from call recording",
      },
    ],
  },
  {
    module: "Security & Auditing",
    label: "Audit & Roles",
    permissions: [
      {
        key: "audit.view",
        label: "View Audit Log",
        module: "Security & Auditing",
        description: "Inspect chronological trail of security and CRM operations",
      },
      {
        key: "roles.manage",
        label: "Manage Roles & Permissions",
        module: "Security & Auditing",
        description: "Configure tenant roles, permission assignments, and scopes",
      },
    ],
  },
  {
    module: "Account Settings",
    label: "Account Configuration",
    permissions: [
      {
        key: "conversion.manage",
        label: "Manage Lead Conversion",
        module: "Account Settings",
        description: "Convert qualified leads to customers or accounts",
      },
      {
        key: "settings.view",
        label: "View Account Configuration",
        module: "Account Settings",
        description: "Inspect company details and account preferences",
      },
      {
        key: "settings.manage",
        label: "Modify Account Settings",
        module: "Account Settings",
        description: "Update company profile and system configurations",
      },
    ],
  },
]

// Server-defined allowlist of valid permission keys including backward-compatibility aliases
const LEGACY_ALIASES = [
  "leads.view",
  "leads.edit",
  "leads.delete",
  "followups.view",
  "followups.manage",
  "calls.view",
  "calls.manage",
  "users.view",
  "users.manage",
]

const ALLOWED_PERMISSIONS = Array.from(
  new Set([
    ...PERMISSION_MODULES.flatMap((group) => group.permissions.map((p) => p.key)),
    ...LEGACY_ALIASES,
  ]),
)

// Default permissions granted to Leads Account Admins (Super Admin ceiling baseline)
const DEFAULT_ACCOUNT_ADMIN_PERMISSIONS = [
  "dashboard.view",
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.assign",
  "leads.export",
  "leads.bulkUpdate",
  "followups.view",
  "followups.manage",
  "calls.view",
  "calls.log",
  "recordings.listen",
  "conversion.manage",
  "staff.view",
  "staff.manage",
  "teams.manage",
  "roles.manage",
  "audit.view",
  "devices.manage",
  "donotrecord.manage",
  "reports.view",
  "leadfeed.manage",
  "settings.view",
  "settings.manage",
]

const rolePermissionSchema = new mongoose.Schema(
  {
    targetRole: {
      type: String,
      required: true,
      unique: true,
      default: "account_admin",
    },
    permissions: {
      type: [String],
      required: true,
      default: DEFAULT_ACCOUNT_ADMIN_PERMISSIONS,
    },
    updatedBy: {
      type: String,
      default: "system",
    },
  },
  {
    timestamps: true,
  },
)

const changeListeners = []
rolePermissionSchema.post(["save", "findOneAndUpdate", "updateOne", "updateMany"], function () {
  changeListeners.forEach((fn) => {
    try {
      fn()
    } catch (_) {}
  })
})

const onRolePermissionChange = (callback) => {
  if (typeof callback === "function" && !changeListeners.includes(callback)) {
    changeListeners.push(callback)
  }
}

let ceilingDefaultsSeeded = false
const ensureCeilingDefaultsSeeded = async () => {
  if (ceilingDefaultsSeeded) return
  try {
    const doc = await RolePermission.findOne({ targetRole: "account_admin" })
    if (doc) {
      let changed = false
      for (const perm of DEFAULT_ACCOUNT_ADMIN_PERMISSIONS) {
        if (!doc.permissions.includes(perm)) {
          doc.permissions.push(perm)
          changed = true
        }
      }
      if (changed) {
        await doc.save()
      }
    }
    ceilingDefaultsSeeded = true
  } catch (_) {}
}

const getSuperAdminCeiling = async () => {
  await ensureCeilingDefaultsSeeded()
  const config = await RolePermission.findOne({ targetRole: "account_admin" }).lean()
  if (!config || !Array.isArray(config.permissions)) {
    return ALLOWED_PERMISSIONS
  }
  return config.permissions
}

const RolePermission = mongoose.model("RolePermission", rolePermissionSchema)

module.exports = RolePermission
module.exports.RolePermission = RolePermission
module.exports.PERMISSION_MODULES = PERMISSION_MODULES
module.exports.ALLOWED_PERMISSIONS = ALLOWED_PERMISSIONS
module.exports.DEFAULT_ACCOUNT_ADMIN_PERMISSIONS = DEFAULT_ACCOUNT_ADMIN_PERMISSIONS
module.exports.onRolePermissionChange = onRolePermissionChange
module.exports.getSuperAdminCeiling = getSuperAdminCeiling
