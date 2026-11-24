const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Workspace Model - Multi-Workspace SaaS Partition
 *
 * Represents an operational unit, division, or sub-project within a Parent Organization.
 * Partitions CRM records (leads, calls, follow-ups, quotations) under the canonical tenantId.
 */
const workspaceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for workspace"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Workspace name is required"],
      trim: true,
      minlength: [2, "Workspace name must be at least 2 characters"],
      maxlength: [100, "Workspace name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      required: [true, "Workspace slug is required"],
      trim: true,
      lowercase: true,
      maxlength: [120, "Slug cannot exceed 120 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    customDomain: {
      type: String,
      trim: true,
      default: null,
      lowercase: true,
    },
    domainStatus: {
      type: String,
      enum: ["unconfigured", "pending", "pending_verification", "verified", "active"],
      default: "unconfigured",
    },
    branding: {
      displayName: { type: String, default: null, trim: true },
      logoUrl: { type: String, default: null, trim: true },
      primaryColor: { type: String, default: "#4f46e5", trim: true },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
      index: true,
    },
    settings: {
      allowAgentLeadCreation: { type: Boolean, default: true },
      autoLeadCaptureEnabled: { type: Boolean, default: true },
      smtpOverrideEnabled: { type: Boolean, default: false },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

workspaceSchema.index({ tenantId: 1, slug: 1 }, { unique: true })
workspaceSchema.index({ tenantId: 1, status: 1 })
workspaceSchema.index({ tenantId: 1, isDefault: 1 })

// Enforce ambient AsyncLocalStorage tenant boundary
workspaceSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("Workspace", workspaceSchema)
