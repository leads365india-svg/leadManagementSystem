const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * WhatsAppQrAuth Model
 * Stores Baileys multi-file-auth-state credentials and Signal keys in MongoDB
 * so sessions persist across server restarts, reboots, and redeploys.
 */
const whatsAppQrAuthSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    keyId: {
      type: String,
      required: [true, "Key ID is required"],
      trim: true,
      index: true,
    },
    data: {
      type: String,
      required: [true, "Auth data payload is required"],
    },
  },
  {
    timestamps: true,
  }
)

// Ensure each keyId is unique per tenant
whatsAppQrAuthSchema.index({ tenantId: 1, keyId: 1 }, { unique: true })

whatsAppQrAuthSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const WhatsAppQrAuth =
  mongoose.models.WhatsAppQrAuth || mongoose.model("WhatsAppQrAuth", whatsAppQrAuthSchema)

module.exports = WhatsAppQrAuth
