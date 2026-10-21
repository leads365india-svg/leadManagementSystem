const mongoose = require("mongoose")

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"],
      default: "New",
      required: [true, "Status is required"],
    },
    tenantId: {
      type: String,
      default: "default-tenant",
      index: true,
    },
    source: {
      type: String,
      default: "Website",
      trim: true,
    },
    assignedTo: {
      type: String,
      default: "Unassigned",
      trim: true,
    },
    assignedStaffId: {
      type: String,
      default: "unassigned",
    },
    message: {
      type: String,
      default: "",
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    formId: {
      type: String,
      default: "",
      trim: true,
    },
    landingPage: {
      type: String,
      default: "",
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    verificationStatus: {
      type: String,
      enum: ["unverified", "pending_confirmation", "verified", "trusted"],
      default: "unverified",
    },
    isTest: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
  },
)

// Create indexes for query performance and tenant-scoped lookups
leadSchema.index({ tenantId: 1, createdAt: -1 })
leadSchema.index({ tenantId: 1, email: 1 })
leadSchema.index({ tenantId: 1, phone: 1 })
leadSchema.index({ status: 1 })
leadSchema.index({ createdAt: -1 })
leadSchema.index({ name: "text", email: "text" })

module.exports = mongoose.model("Lead", leadSchema)
