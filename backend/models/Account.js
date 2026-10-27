const mongoose = require("mongoose")

const accountSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
      maxlength: [120, "Company name cannot exceed 120 characters"],
    },
    displayName: {
      type: String,
      required: [true, "Display name is required"],
      trim: true,
      minlength: [2, "Display name must be at least 2 characters"],
      maxlength: [100, "Display name cannot exceed 100 characters"],
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    adminName: {
      type: String,
      required: true,
      trim: true,
    },
    adminEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactNumber: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      required: true,
      index: true,
    },
    // White-Label Settings
    customDomain: {
      type: String,
      trim: true,
      default: "",
      lowercase: true,
    },
    domainStatus: {
      type: String,
      enum: ["unconfigured", "pending_verification", "active"],
      default: "unconfigured",
    },
    logoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    primaryColor: {
      type: String,
      trim: true,
      default: "#4f46e5",
    },
    pageTitle: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

accountSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model("Account", accountSchema)
