const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Quotation Model - Phase 1: Lead-Specific Quotation Documents
 * 
 * Securely associates uploaded quotation PDFs with an individual lead and tenant.
 * Maintains immutable send histories and delivery tracking.
 */

const sentHistorySubSchema = new mongoose.Schema(
  {
    sentAt: {
      type: Date,
      default: Date.now,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sentByName: {
      type: String,
      default: "Agent",
      trim: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      default: "",
    },
    messageId: {
      type: String,
      default: "",
      trim: true,
    },
    provider: {
      type: String,
      default: "smtp",
    },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "failed", "bounced"],
      default: "sent",
    },
    error: {
      type: String,
      default: null,
    },
  },
  { _id: true }
)

const quotationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for quotations"],
      trim: true,
      index: true,
    },
    // Optional workspace scoping (null = Standalone mode or unassigned)
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead ID is required for quotations"],
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
    status: {
      type: String,
      enum: ["draft", "uploaded", "sent", "superseded", "voided", "archived"],
      default: "uploaded",
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    uploadedByName: {
      type: String,
      default: "Agent",
      trim: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidedByName: {
      type: String,
      default: null,
      trim: true,
    },
    voidReason: {
      type: String,
      default: null,
      trim: true,
    },
    sentHistory: {
      type: [sentHistorySubSchema],
      default: [],
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
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

quotationSchema.index({ tenantId: 1, leadId: 1, createdAt: -1 })
quotationSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Quotation = mongoose.models.Quotation || mongoose.model("Quotation", quotationSchema)

module.exports = Quotation
