const mongoose = require("mongoose")

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    deviceModel: {
      type: String,
      default: "",
      trim: true,
    },
    manufacturer: {
      type: String,
      default: "",
      trim: true,
    },
    osVersion: {
      type: String,
      default: "",
      trim: true,
    },
    sdkInt: {
      type: Number,
      default: 0,
    },
    appVersionCode: {
      type: Number,
      default: 0,
    },
    appVersionName: {
      type: String,
      default: "",
      trim: true,
    },
    fcmToken: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED"],
      default: "ACTIVE",
      index: true,
    },
    registeredAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
    },
    healthSummary: {
      batteryOptimizationIgnored: { type: Boolean, default: null },
      permissionsAllGranted: { type: Boolean, default: null },
      storageAccessGranted: { type: Boolean, default: null },
      autoRecordVerified: { type: Boolean, default: null },
      missingRecordingsCount: { type: Number, default: 0 },
      pendingUploadsCount: { type: Number, default: 0 },
      lastSyncEpochMs: { type: Number, default: null },
      lastSuccessfulUploadEpochMs: { type: Number, default: null },
      healthState: { type: String, default: "HEALTHY" },
    },
  },
  {
    timestamps: true,
  }
)

deviceSchema.index({ userId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, status: 1 })

module.exports = mongoose.model("Device", deviceSchema)
