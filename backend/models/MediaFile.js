const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * MediaFile Model
 * 
 * Central registry for all media files uploaded to ImageKit or stored in CRM:
 * - Documents, PDFs, and spreadsheet attachments
 * - Lead attachments and proofs
 * - Call attachments and recordings
 * - User profile images and company logos
 * 
 * Enforces tenant isolation, RBAC tracking, and storage provider metadata.
 */

const mediaFileSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    provider: {
      type: String,
      enum: ["imagekit", "gridfs", "local"],
      default: "imagekit",
      index: true,
    },
    fileId: {
      type: String,
      required: [true, "Provider file ID is required"],
      index: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
    },
    originalName: {
      type: String,
      default: "",
      trim: true,
    },
    filePath: {
      type: String,
      default: "",
      trim: true,
    },
    folder: {
      type: String,
      default: "",
      trim: true,
    },
    url: {
      type: String,
      default: "",
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: null,
      trim: true,
    },
    mimeType: {
      type: String,
      default: "application/octet-stream",
      trim: true,
    },
    sizeBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    format: {
      type: String,
      default: "",
      trim: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      enum: ["recordings", "profile-images", "documents", "attachments", "call-attachments", "general"],
      default: "general",
      index: true,
    },
    relatedEntity: {
      entityType: {
        type: String,
        enum: ["Lead", "Call", "User", "Account", "None"],
        default: "None",
        index: true,
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
      },
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    uploadStatus: {
      type: String,
      enum: ["pending", "stored", "failed", "purged"],
      default: "stored",
      index: true,
    },
    sha256: {
      type: String,
      default: "",
      trim: true,
    },
    isPrivate: {
      type: Boolean,
      default: true,
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
  },
)

// Compound indexes for fast tenant queries
mediaFileSchema.index({ tenantId: 1, category: 1, createdAt: -1 })
mediaFileSchema.index({ tenantId: 1, "relatedEntity.entityType": 1, "relatedEntity.entityId": 1 })

// Multi-tenant isolation plugin
mediaFileSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("MediaFile", mediaFileSchema)

