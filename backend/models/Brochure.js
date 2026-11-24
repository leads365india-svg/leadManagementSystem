const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Brochure Model - Phase 2: Tenant-Wide Global Brochure Management
 * 
 * Stores product-specific and general brochures configured by each tenant.
 * "Global" is strictly scoped within that tenant's boundaries.
 */

const brochureSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for brochures"],
      trim: true,
      index: true,
    },
    // Optional workspace scoping (null = Organization-wide brochure)
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Brochure title is required"],
      trim: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessProduct",
      default: null,
      index: true,
    },
    productName: {
      type: String,
      default: "",
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
    },
    originalName: {
      type: String,
      required: [true, "Original file name is required"],
      trim: true,
    },
    fileId: {
      type: String,
      required: [true, "Storage file ID is required"],
      index: true,
    },
    storageProvider: {
      type: String,
      enum: ["gridfs", "imagekit", "local"],
      default: "gridfs",
    },
    fileSize: {
      type: Number,
      required: true,
      min: [1, "File size must be greater than 0"],
    },
    mimeType: {
      type: String,
      default: "application/pdf",
      trim: true,
    },
    sha256: {
      type: String,
      trim: true,
      default: "",
    },
    version: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    uploadedByName: {
      type: String,
      default: "Admin",
      trim: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brochure",
      default: null,
    },
    sentCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

brochureSchema.index({ tenantId: 1, isActive: 1 })
brochureSchema.index({ tenantId: 1, productId: 1, isActive: 1 })
brochureSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Brochure = mongoose.models.Brochure || mongoose.model("Brochure", brochureSchema)

module.exports = Brochure
