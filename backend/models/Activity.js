const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { sanitizeAuditDetails } = require("../utils/auditSanitizer")

/**
 * Activity Model - Roadmap Phase 10: Lead Detail Drawer & Activity Timeline
 * 
 * Records discrete business events for each lead:
 * - lead.created / created
 * - lead.status_changed / status_changed
 * - lead.owner_changed / owner_changed
 * - lead.note_added / note_added
 * - lead.field_edited / field_edited
 * - lead.followup_created / followup_created
 * - lead.followup_completed / followup_completed
 * - lead.source_updated / source_updated
 */

const actorSubSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: "System",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    role: {
      type: String,
      trim: true,
      default: "system",
    },
  },
  { _id: false },
)

const ALLOWED_ACTIVITY_TYPES = [
  // Canonical types
  "lead.created",
  "lead.status_changed",
  "lead.owner_changed",
  "lead.note_added",
  "lead.field_edited",
  "lead.followup_created",
  "lead.followup_completed",
  "lead.source_updated",
  "call.logged",
  "call.associated",
  "whatsapp.message_received",
  "whatsapp.message_sent",
  "quotation.requested",
  "quotation.uploaded",
  "quotation.sent",
  "quotation.deleted",
  "quotation.voided",
  "brochure.requested",
  "brochure.sent",
  "email.failed",
  "deal.amount_updated",
  "deal.closed_won",
  // Short aliases for convenience
  "created",
  "status_changed",
  "owner_changed",
  "note_added",
  "field_edited",
  "followup_created",
  "followup_completed",
  "source_updated",
  "call_logged",
  "call_associated",
  "whatsapp_received",
  "whatsapp_sent",
  "whatsapp_message",
  "quotation_requested",
  "quotation_uploaded",
  "quotation_sent",
  "brochure_requested",
  "brochure_sent",
  "email_failed",
  "deal_amount_updated",
  "deal_closed_won",
]

const activitySchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for activities"],
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
      required: [true, "Lead ID is required for activities"],
      index: true,
    },
    type: {
      type: String,
      required: [true, "Activity type is required"],
      trim: true,
      enum: {
        values: ALLOWED_ACTIVITY_TYPES,
        message: "Invalid activity type: `{VALUE}`",
      },
      index: true,
    },
    actor: {
      type: actorSubSchema,
      default: () => ({ name: "System", role: "system" }),
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

// Compound indexes for optimal query performance
activitySchema.index({ tenantId: 1, leadId: 1, createdAt: -1 })
activitySchema.index({ tenantId: 1, type: 1, createdAt: -1 })
activitySchema.index({ tenantId: 1, createdAt: -1 })

// Pre-save hook: ensure payload is stripped of sensitive credentials
activitySchema.pre("save", function (next) {
  if (this.payload && typeof this.payload === "object") {
    this.payload = sanitizeAuditDetails(this.payload)
  }
  next()
})

// Enforce ambient multi-tenant isolation
activitySchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Activity = mongoose.models.Activity || mongoose.model("Activity", activitySchema)

module.exports = {
  Activity,
  ALLOWED_ACTIVITY_TYPES,
}
