const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * EmailCommunication Model - Phase 4: Unified Communication & Email History
 * 
 * Stores unified transaction records for all manual quotation and automatic brochure emails.
 * Captures provider message IDs, timestamps, delivery statuses, and lead links.
 */

const emailCommunicationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for communication log"],
      trim: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead ID is required for communication log"],
      index: true,
    },
    emailType: {
      type: String,
      enum: ["MANUAL_QUOTATION", "AUTO_BROCHURE"],
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ["quotation", "brochure"],
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    attachmentFileName: {
      type: String,
      default: "",
      trim: true,
    },
    attachmentFileId: {
      type: String,
      default: "",
    },
    recipientEmail: {
      type: String,
      required: [true, "Recipient email is required"],
      trim: true,
      lowercase: true,
      index: true,
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
    provider: {
      type: String,
      default: "smtp",
    },
    providerMessageId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "failed", "bounced"],
      default: "sent",
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sentByName: {
      type: String,
      default: "System",
      trim: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Call",
      default: null,
    },
    transcriptEvidence: {
      type: String,
      default: "",
      trim: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      index: true,
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

emailCommunicationSchema.index({ tenantId: 1, leadId: 1, sentAt: -1 })
emailCommunicationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { sparse: true })
emailCommunicationSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const EmailCommunication = mongoose.models.EmailCommunication || mongoose.model("EmailCommunication", emailCommunicationSchema)

module.exports = EmailCommunication
