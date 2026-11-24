const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * WorkspaceMembership Model
 *
 * Dedicated collection mapping tenant staff to authorized workspaces.
 * Avoids concurrency hazards and document bloat from embedding arrays inside User documents.
 */
const workspaceMembershipSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for membership"],
      trim: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: [true, "Workspace ID is required for membership"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required for membership"],
      index: true,
    },
    role: {
      type: String,
      enum: ["workspace_admin", "manager", "agent", "viewer"],
      default: "agent",
      required: true,
      index: true,
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

// A user can hold at most one membership record per workspace
workspaceMembershipSchema.index({ tenantId: 1, workspaceId: 1, userId: 1 }, { unique: true })
workspaceMembershipSchema.index({ tenantId: 1, userId: 1, status: 1 })
workspaceMembershipSchema.index({ tenantId: 1, workspaceId: 1, status: 1 })

// Enforce ambient AsyncLocalStorage tenant boundary
workspaceMembershipSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("WorkspaceMembership", workspaceMembershipSchema)
