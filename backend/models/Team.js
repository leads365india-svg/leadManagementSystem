const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * Team Model
 * Complies with Roadmap Phase 4: Staff and agent accounts.
 * 
 * Supports sales departments, outbound squads, and agency sub-teams.
 * Enforces tenant boundary isolation automatically via tenantIsolationPlugin.
 */

const teamSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Team name is required"],
      trim: true,
      minlength: [2, "Team name must be at least 2 characters"],
      maxlength: [100, "Team name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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
  }
)

teamSchema.index({ tenantId: 1, name: 1 })
teamSchema.index({ tenantId: 1, isActive: 1 })

teamSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("Team", teamSchema)
