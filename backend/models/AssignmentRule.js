const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * AssignmentRule Model - Phase 7: Lead Ownership & Assignment
 * 
 * Defines tenant-scoped automated lead routing policies:
 * - Direct: fixed agent assignment
 * - Round-Robin: circular rotation among active team agents
 * - Fewest Open Leads: capacity-aware balancing respecting agent maxOpenLeads
 * - Pool: routed to unassigned pool
 */

const assignmentRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Rule name is required"],
      trim: true,
      minlength: [2, "Rule name must be at least 2 characters"],
      maxlength: [100, "Rule name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    priority: {
      type: Number,
      required: [true, "Priority is required"],
      default: 1,
      min: [1, "Priority must be at least 1"],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    conditions: {
      sources: {
        type: [String],
        default: [],
      },
      tags: {
        type: [String],
        default: [],
      },
      city: {
        type: String,
        trim: true,
        default: "",
      },
    },
    routingType: {
      type: String,
      enum: ["direct", "round_robin", "fewest_open_leads", "pool"],
      required: [true, "Routing type is required"],
      default: "round_robin",
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    targetUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastAssignedIndex: {
      type: Number,
      default: 0,
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

assignmentRuleSchema.index({ tenantId: 1, priority: 1 })
assignmentRuleSchema.plugin(tenantIsolationPlugin)

module.exports = mongoose.model("AssignmentRule", assignmentRuleSchema)
