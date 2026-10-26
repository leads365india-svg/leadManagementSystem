const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Device Model - Roadmap Phase 14: Call, Device & Recording Data Model
 * 
 * Tracks authorized agent hardware (Android phones) running the mobile dialer/sync client.
 */

const deviceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User/Agent ID is required"],
      index: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    model: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    osVersion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 60,
    },
    appVersion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    pushToken: {
      type: String,
      default: "",
      trim: true,
    },
    deviceUuid: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncAt: {
      type: Date,
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
        delete ret.refreshTokenHash
        return ret
      },
    },
  },
)

deviceSchema.index({ tenantId: 1, userId: 1 })
deviceSchema.index({ tenantId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, userId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, deviceUuid: 1 })

deviceSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Device = mongoose.models.Device || mongoose.model("Device", deviceSchema)

module.exports = Device
