const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * WhatsAppSuppressedNumber Model
 * Stores phone numbers whose CRM Leads were manually deleted.
 * Prevents WhatsApp QR Sync from re-creating a deleted Lead automatically.
 * When a user manually creates a lead with this number, suppression is removed.
 */
const whatsAppSuppressedNumberSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    normalizedPhone: {
      type: String,
      required: [true, "Normalized phone is required"],
      trim: true,
      index: true,
    },
    suppressedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    reason: {
      type: String,
      default: "lead_deleted",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
)

// Unique index: a normalized phone is suppressed only once per tenant
whatsAppSuppressedNumberSchema.index({ tenantId: 1, normalizedPhone: 1 }, { unique: true })

whatsAppSuppressedNumberSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const WhatsAppSuppressedNumber =
  mongoose.models.WhatsAppSuppressedNumber ||
  mongoose.model("WhatsAppSuppressedNumber", whatsAppSuppressedNumberSchema)

module.exports = WhatsAppSuppressedNumber
