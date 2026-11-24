const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * DomainMapping Model - Multi-Tenant Global Custom Domain Router
 *
 * Provides cluster-wide unique custom domain routing across both Parent Accounts (Mode A/B)
 * and individual Workspaces (Mode B).
 * Prevents cross-tenant domain squatting and sparse unique index collisions.
 */
const domainMappingSchema = new mongoose.Schema(
  {
    domain: {
      type: String,
      required: [true, "Domain hostname is required"],
      unique: true, // Global uniqueness across the entire system
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: function (v) {
          if (!v) return false
          const clean = v.toLowerCase().trim().replace(/^https?:\/\//i, "").split("/")[0].split(":")[0]
          if (
            clean === "leads365.in" ||
            clean.endsWith(".leads365.in") ||
            clean === "localhost" ||
            clean.endsWith(".localhost") ||
            clean.endsWith(".vercel.app") ||
            clean.endsWith(".onrender.com")
          ) {
            return false
          }
          return true
        },
        message: (props) => `${props.value} is a core platform domain and cannot be registered in DomainMapping.`,
      },
    },
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["ACCOUNT", "WORKSPACE"],
      required: [true, "Target type must be ACCOUNT or WORKSPACE"],
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Target ID is required"],
      index: true,
    },
    targetSlug: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["unconfigured", "pending_verification", "verified", "suspended"],
      default: "pending_verification",
      index: true,
    },
    verificationToken: {
      type: String,
      required: [true, "Verification token is required"],
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
)

domainMappingSchema.index({ tenantId: 1, targetType: 1 })
domainMappingSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

module.exports = mongoose.model("DomainMapping", domainMappingSchema)
