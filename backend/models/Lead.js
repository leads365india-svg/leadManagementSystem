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
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please enter a valid email"],
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

// Create indexes for query performance
leadSchema.index({ tenantId: 1, createdAt: -1 })
leadSchema.index({ status: 1 })
leadSchema.index({ createdAt: -1 })
leadSchema.index({ name: "text", email: "text" })

module.exports = mongoose.model("Lead", leadSchema)
