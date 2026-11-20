const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * TenantPhoneContact Model
 * Stores phone-saved contacts synced from mobile devices per tenant.
 * Used by WhatsApp QR Sync to ignore personal/device contacts when creating new leads.
 */
const tenantPhoneContactSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    normalizedPhone: {
      type: String,
      required: [true, "Normalized phone is required"],
      trim: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
)

// Compound unique index: a normalized phone is unique per tenant
tenantPhoneContactSchema.index({ tenantId: 1, normalizedPhone: 1 }, { unique: true })

tenantPhoneContactSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const TenantPhoneContact =
  mongoose.models.TenantPhoneContact || mongoose.model("TenantPhoneContact", tenantPhoneContactSchema)

module.exports = TenantPhoneContact
