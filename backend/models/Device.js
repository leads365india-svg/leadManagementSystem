const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Device Model - Roadmap Phase 14 & Mobile Sync Device Model
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
    deviceId: {
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
      maxlength: 60,
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
    appVersion: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    fcmToken: {
      type: String,
      default: null,
      trim: true,
    },
    pushToken: {
      type: String,
      default: "",
      trim: true,
    },
    refreshTokenHash: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
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
    lastSyncAt: {
      type: Date,
      default: null,
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

function syncDeviceFields(doc) {
  // Sync device identifier
  if (doc.deviceId && (!doc.deviceUuid || doc.deviceUuid === "")) {
    doc.deviceUuid = doc.deviceId
  } else if (doc.deviceUuid && (!doc.deviceId || doc.deviceId === "")) {
    doc.deviceId = doc.deviceUuid
  }

  // Sync model
  if (doc.deviceModel && (!doc.model || doc.model === "")) {
    doc.model = doc.deviceModel
  } else if (doc.model && (!doc.deviceModel || doc.deviceModel === "")) {
    doc.deviceModel = doc.model
  }

  // Sync app version
  if (doc.appVersionName && (!doc.appVersion || doc.appVersion === "")) {
    doc.appVersion = doc.appVersionName
  } else if (doc.appVersion && (!doc.appVersionName || doc.appVersionName === "")) {
    doc.appVersionName = doc.appVersion
  }

  // Sync push token
  if (doc.fcmToken && (!doc.pushToken || doc.pushToken === "")) {
    doc.pushToken = doc.fcmToken
  } else if (doc.pushToken && (!doc.fcmToken || doc.fcmToken === "")) {
    doc.fcmToken = doc.pushToken
  }

  // Sync status
  if (doc.status) {
    const s = doc.status.toUpperCase()
    if (s === "ACTIVE" || s === "REVOKED") {
      doc.status = s
    }
  }
}

deviceSchema.pre("validate", function () {
  syncDeviceFields(this)
})

deviceSchema.pre("save", function () {
  syncDeviceFields(this)
})

// Required Roadmap Indexes
deviceSchema.index({ userId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, userId: 1 })
deviceSchema.index({ tenantId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, userId: 1, status: 1 })
deviceSchema.index({ tenantId: 1, deviceUuid: 1 })
deviceSchema.index({ deviceId: 1 }, { sparse: true })

deviceSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const Device = mongoose.models.Device || mongoose.model("Device", deviceSchema)

module.exports = Device
