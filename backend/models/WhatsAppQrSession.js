const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * WhatsAppQrSession Model
 * Stores per-tenant WhatsApp Web QR connection state
 */
const whatsAppQrSessionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      unique: true,
      trim: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["disconnected", "qr_ready", "connecting", "connected"],
      default: "disconnected",
      index: true,
    },
    qrDataUrl: {
      type: String,
      default: "",
    },
    phoneNumber: {
      type: String,
      default: "",
      trim: true,
    },
    pushName: {
      type: String,
      default: "",
      trim: true,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
)

whatsAppQrSessionSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const WhatsAppQrSession =
  mongoose.models.WhatsAppQrSession || mongoose.model("WhatsAppQrSession", whatsAppQrSessionSchema)

module.exports = WhatsAppQrSession
