const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * WhatsAppMessage Model - Super-Admin-Controlled Multi-Tenant WhatsApp Integration
 * 
 * Enforces strict ambient tenant isolation on all operations.
 * Captures inbound and outbound WhatsApp Cloud API messages, delivery receipts,
 * and media metadata with idempotency on externalMessageId per tenant.
 */

const ALLOWED_DIRECTIONS = ["inbound", "outbound"]
const ALLOWED_MESSAGE_TYPES = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "interactive",
  "template",
  "location",
  "contacts",
  "other",
]
const ALLOWED_MESSAGE_STATUSES = [
  "received",
  "sent",
  "delivered",
  "read",
  "failed",
]

const whatsAppMessageSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for WhatsApp messages"],
      trim: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: [true, "Lead ID is required for WhatsApp messages"],
      index: true,
    },
    phoneNumberId: {
      type: String,
      required: [true, "WhatsApp Phone Number ID is required"],
      trim: true,
      index: true,
    },
    wabaId: {
      type: String,
      trim: true,
      default: "",
    },
    externalMessageId: {
      type: String,
      required: [true, "External message ID is required"],
      trim: true,
      index: true,
    },
    direction: {
      type: String,
      enum: {
        values: ALLOWED_DIRECTIONS,
        message: "Invalid direction: `{VALUE}`",
      },
      required: [true, "Message direction is required"],
      index: true,
    },
    senderPhone: {
      type: String,
      trim: true,
      default: "",
    },
    recipientPhone: {
      type: String,
      trim: true,
      default: "",
    },
    messageType: {
      type: String,
      enum: {
        values: ALLOWED_MESSAGE_TYPES,
        message: "Invalid message type: `{VALUE}`",
      },
      default: "text",
    },
    body: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: {
        values: ALLOWED_MESSAGE_STATUSES,
        message: "Invalid message status: `{VALUE}`",
      },
      default: "received",
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    sentByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
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

// Idempotency: externalMessageId is unique per tenant
whatsAppMessageSchema.index({ tenantId: 1, externalMessageId: 1 }, { unique: true })

// Fast chronological timeline retrieval for lead drawer
whatsAppMessageSchema.index({ tenantId: 1, leadId: 1, timestamp: 1 })

// Delivery receipts and status updates
whatsAppMessageSchema.index({ tenantId: 1, externalMessageId: 1, status: 1 })

// Phone number routing lookups
whatsAppMessageSchema.index({ phoneNumberId: 1, createdAt: -1 })

// Enforce ambient multi-tenant isolation
whatsAppMessageSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const WhatsAppMessage =
  mongoose.models.WhatsAppMessage || mongoose.model("WhatsAppMessage", whatsAppMessageSchema)

module.exports = {
  WhatsAppMessage,
  ALLOWED_DIRECTIONS,
  ALLOWED_MESSAGE_TYPES,
  ALLOWED_MESSAGE_STATUSES,
}
