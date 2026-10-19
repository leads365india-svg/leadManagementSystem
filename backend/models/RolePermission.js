const mongoose = require("mongoose")

const PERMISSION_MODULES = [
  {
    module: "Dashboard",
    label: "Dashboard",
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
        key: "leads.view",
        label: "View Leads List",
        module: "Leads",
        description: "View and filter leads within the account",
      },
      {
        key: "leads.create",
        label: "Create New Leads",
        module: "Leads",
        description: "Add new leads manually or via imports",
      },
      {
        key: "leads.edit",
        label: "Edit Leads",
        module: "Leads",
        description: "Update lead status, contact details, and notes",
      },
      {
        key: "leads.delete",
        label: "Delete Leads",
        module: "Leads",
        description: "Remove leads permanently from the account",
      },
      {
        key: "leads.export",
        label: "Export Leads Data",
        module: "Leads",
        description: "Download leads in CSV or Excel format",
      },
    ],
  },
  {
    module: "Follow-ups",
    label: "Follow-ups",
    permissions: [
      {
        key: "followups.view",
        label: "View Scheduled Follow-ups",
        module: "Follow-ups",
        description: "See upcoming and overdue lead follow-ups",
      },
      {
        key: "followups.manage",
        label: "Schedule & Update Follow-ups",
        module: "Follow-ups",
        description: "Create reminders, reschedule, and complete follow-ups",
      },
    ],
  },
  {
    module: "Call History",
    label: "Call History / Call Reports",
    permissions: [
      {
        key: "calls.view",
        label: "View Call Logs",
        module: "Call History",
        description: "Review call records and interaction history",
      },
      {
        key: "calls.manage",
        label: "Log Calls & Record Outcomes",
        module: "Call History",
        description: "Add call notes, duration, and disposition status",
      },
    ],
  },
  {
    module: "Lead Conversion",
    label: "Lead Conversion",
    permissions: [
      {
        key: "conversion.manage",
        label: "Manage Lead Conversion",
        module: "Lead Conversion",
        description: "Convert qualified leads to customers or deals",
      },
    ],
  },
  {
    module: "Account Settings",
    label: "Account Settings",
    permissions: [
      {
        key: "settings.view",
        label: "View Account Configuration",
        module: "Account Settings",
        description: "Inspect company details and preferences",
      },
      {
        key: "settings.manage",
        label: "Modify Account Settings",
        module: "Account Settings",
        description: "Update company profile and notification preferences",
      },
    ],
  },
  {
    module: "User Management",
    label: "User Management",
    permissions: [
      {
        key: "users.view",
        label: "View Account Team Members",
        module: "User Management",
        description: "List users belonging to this tenant account",
      },
      {
        key: "users.manage",
        label: "Manage Account Team",
        module: "User Management",
        description: "Invite, update, or remove users within the account",
      },
    ],
  },
]

// Server-defined allowlist of valid permission keys
const ALLOWED_PERMISSIONS = PERMISSION_MODULES.flatMap((group) =>
  group.permissions.map((p) => p.key),
)

// Default permissions granted to Leads Account Admins
const DEFAULT_ACCOUNT_ADMIN_PERMISSIONS = [
  "dashboard.view",
  "leads.view",
  "leads.create",
  "leads.edit",
  "followups.view",
  "followups.manage",
  "calls.view",
  "conversion.manage",
  "settings.view",
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

const RolePermission = mongoose.model("RolePermission", rolePermissionSchema)

module.exports = RolePermission
module.exports.RolePermission = RolePermission
module.exports.PERMISSION_MODULES = PERMISSION_MODULES
module.exports.ALLOWED_PERMISSIONS = ALLOWED_PERMISSIONS
module.exports.DEFAULT_ACCOUNT_ADMIN_PERMISSIONS = DEFAULT_ACCOUNT_ADMIN_PERMISSIONS
