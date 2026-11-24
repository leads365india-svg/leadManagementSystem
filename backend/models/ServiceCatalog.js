const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * ServiceCatalog Model
 *
 * Configurable services/products offered by an organization that map incoming
 * inquiries (website forms, webhooks, campaigns) directly to a target workspace.
 * Avoids duplicate product databases by optionally linking to BusinessProduct.
 */
const serviceCatalogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for service catalog"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      minlength: [2, "Service name must be at least 2 characters"],
      maxlength: [120, "Service name cannot exceed 120 characters"],
    },
    code: {
      type: String,
      required: [true, "Service routing code is required"],
      trim: true,
      uppercase: true,
      maxlength: [50, "Code cannot exceed 50 characters"],
    },
    category: {
      type: String,
      trim: true,
      default: "General",
      maxlength: [100, "Category cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    targetWorkspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: [true, "Target Workspace ID is required"],
      index: true,
    },
    linkedProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessProduct",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
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
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

serviceCatalogSchema.index({ tenantId: 1, code: 1 }, { unique: true })
serviceCatalogSchema.index({ tenantId: 1, isActive: 1, displayOrder: 1 })
serviceCatalogSchema.index({ tenantId: 1, targetWorkspaceId: 1 })

// Enforce ambient AsyncLocalStorage tenant boundary
serviceCatalogSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("ServiceCatalog", serviceCatalogSchema)
