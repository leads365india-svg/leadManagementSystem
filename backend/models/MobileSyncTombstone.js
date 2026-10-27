const mongoose = require("mongoose")

const mobileSyncTombstoneSchema = new mongoose.Schema(
  {
    leadId: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    assignedStaffId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["deleted", "reassigned", "unassigned"],
      default: "deleted",
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      expires: "30d", // TTL of 30 days
    },
  },
  {
    timestamps: false,
  }
)

mobileSyncTombstoneSchema.index({ tenantId: 1, assignedStaffId: 1, timestamp: 1 })

module.exports = mongoose.model("MobileSyncTombstone", mobileSyncTombstoneSchema)
