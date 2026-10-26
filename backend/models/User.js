const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      required: [true, "Role is required"],
      default: "agent",
      trim: true,
      lowercase: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
      index: true,
    },
    tenantId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    contactNumber: {
      type: String,
      trim: true,
      default: "",
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
      index: true,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    maxOpenLeads: {
      type: Number,
      default: 50,
      min: [0, "Max open leads cannot be negative"],
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 1,
    },
    inviteTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    inviteTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    resetPasswordTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        delete ret.password
        return ret
      },
    },
  },
)

// Hash password before saving and sync status/isActive
userSchema.pre("save", async function (next) {
  // Sync isActive and status
  if (this.isModified("isActive") && !this.isModified("status")) {
    this.status = this.isActive ? "active" : "suspended"
  } else if (this.isModified("status") && !this.isModified("isActive")) {
    this.isActive = this.status === "active"
  }

  // Sync phone and contactNumber
  if (this.phone && !this.contactNumber) {
    this.contactNumber = this.phone
  } else if (this.contactNumber && !this.phone) {
    this.phone = this.contactNumber
  }

  if (!this.isModified("password")) return next()

  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

// Index for tenant queries
userSchema.index({ tenantId: 1, role: 1 })

// Compound unique index for tenant-scoped users (email unique within each tenant)
userSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { tenantId: { $type: "string" } } }
)

// Global unique index for Super Admin (email unique globally for super_admin)
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { role: "super_admin" } }
)

module.exports = mongoose.model("User", userSchema)
