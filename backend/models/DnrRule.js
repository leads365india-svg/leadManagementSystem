const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")
const { normalizePhoneE164 } = require("../utils/phoneNormalizer")

/**
 * DnrRule Model - Roadmap Phase 18: Do-Not-Record & Privacy Controls
 * 
 * Stores tenant-scoped phone numbers and lead tags that must never be recorded.
 */
const dnrRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["number", "tag"],
      required: [true, "Rule type ('number' or 'tag') is required"],
    },
    value: {
      type: String,
      required: [true, "Value is required"],
      trim: true,
    },
    valueNormalized: {
      type: String,
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      default: "Customer opt-out / compliance",
      maxlength: [500, "Reason cannot exceed 500 characters"],
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
  },
)

// Pre-save hook: Normalize phone number if type is 'number'
dnrRuleSchema.pre("save", function (next) {
  if (this.type === "number" && this.value) {
    this.valueNormalized = normalizePhoneE164(this.value, "+91")
  } else if (this.type === "tag" && this.value) {
    this.valueNormalized = this.value.trim().toUpperCase()
  }
  next()
})

dnrRuleSchema.index({ tenantId: 1, type: 1, valueNormalized: 1 }, { unique: true })
dnrRuleSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const DnrRule = mongoose.models.DnrRule || mongoose.model("DnrRule", dnrRuleSchema)

module.exports = DnrRule
