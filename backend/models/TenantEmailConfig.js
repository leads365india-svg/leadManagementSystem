const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * TenantEmailConfig Model - Phase 3: Tenant Email Provider Integration
 * 
 * Stores tenant-isolated sender identity, SMTP connection parameters, and email templates.
 * Sensitive passwords are encrypted using AES-256-GCM and never returned in plaintext.
 */

const tenantEmailConfigSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for email config"],
      trim: true,
      index: true,
    },
    // Optional workspace scoping (null = Organization-wide default SMTP)
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    senderName: {
      type: String,
      default: "",
      trim: true,
    },
    senderEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    replyToEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    smtpHost: {
      type: String,
      default: "",
      trim: true,
    },
    smtpPort: {
      type: Number,
      default: 587,
    },
    smtpSecure: {
      type: Boolean,
      default: false,
    },
    smtpUser: {
      type: String,
      default: "",
      trim: true,
    },
    smtpPasswordEncrypted: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    templates: {
      brochureSubject: {
        type: String,
        default: "{{tenantBusinessName}} – Requested Product Brochure",
      },
      brochureBody: {
        type: String,
        default: `Namaste {{customerName}},

As discussed during our recent conversation, please find attached the product brochure for {{productName}}.

The brochure contains information about the product and its available features.

Please review it and let us know if you have any questions.

Regards,
{{tenantBusinessName}}
{{tenantContactDetails}}`,
      },
      quotationSubject: {
        type: String,
        default: "{{tenantBusinessName}} – Product Quotation for {{customerName}}",
      },
      quotationBody: {
        type: String,
        default: `Dear {{customerName}},

Thank you for your interest in {{tenantBusinessName}}.

Please find attached the official quotation for {{productName}} as requested.

Feel free to review the details and let us know if you have any questions or require any clarifications.

Best regards,
{{agentName}}
{{tenantBusinessName}}`,
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        // Never expose encrypted password to caller
        delete ret.smtpPasswordEncrypted
        ret.hasPasswordConfigured = Boolean(doc.smtpPasswordEncrypted)
        return ret
      },
    },
  }
)

tenantEmailConfigSchema.index({ tenantId: 1, workspaceId: 1 }, { unique: true })

tenantEmailConfigSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const TenantEmailConfig = mongoose.models.TenantEmailConfig || mongoose.model("TenantEmailConfig", tenantEmailConfigSchema)

/**
 * Migration helper to ensure hardened compound unique index is created safely.
 * Drops legacy single-field unique index tenantId_1 to enable workspace-level overrides.
 */
async function ensureUniqueIndexes() {
  try {
    if (TenantEmailConfig.collection && TenantEmailConfig.db.readyState === 1) {
      const indexes = await TenantEmailConfig.collection.indexes()
      for (const idx of indexes) {
        if (idx.name === "tenantId_1" && idx.unique) {
          await TenantEmailConfig.collection.dropIndex("tenantId_1").catch(() => {})
        }
      }
      await TenantEmailConfig.collection.createIndex(
        { tenantId: 1, workspaceId: 1 },
        { unique: true }
      )
    }
  } catch (err) {
    // Non-fatal
  }
}

TenantEmailConfig.ensureUniqueIndexes = ensureUniqueIndexes

if (mongoose.connection && mongoose.connection.readyState === 1) {
  ensureUniqueIndexes()
} else if (mongoose.connection) {
  mongoose.connection.once("open", () => {
    ensureUniqueIndexes()
  })
}

module.exports = TenantEmailConfig
