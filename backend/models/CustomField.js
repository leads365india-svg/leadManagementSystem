const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * CustomField Model - Phase 5: Custom Fields & Integration Studio Completion
 * 
 * Supports 8 field types:
 * - text
 * - number
 * - email
 * - phone
 * - date
 * - dropdown
 * - checkbox
 * - textarea
 * 
 * Enforces tenant boundaries via tenantIsolationPlugin.
 * Uses soft archive strategy ("active" | "archived") so historical lead data
 * in lead.metadata.customFields is never corrupted or orphaned.
 */

const ALLOWED_FIELD_TYPES = [
  "text",
  "number",
  "email",
  "phone",
  "date",
  "dropdown",
  "checkbox",
  "textarea",
]

const customFieldSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for custom fields"],
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Field name/key is required"],
      trim: true,
      lowercase: true,
      minlength: [2, "Field key must be at least 2 characters"],
      maxlength: [50, "Field key cannot exceed 50 characters"],
      match: [/^[a-z0-9_]+$/, "Field key can only contain lowercase alphanumeric characters and underscores"],
    },
    label: {
      type: String,
      required: [true, "Field label is required"],
      trim: true,
      minlength: [2, "Field label must be at least 2 characters"],
      maxlength: [100, "Field label cannot exceed 100 characters"],
    },
    type: {
      type: String,
      required: [true, "Field type is required"],
      enum: {
        values: ALLOWED_FIELD_TYPES,
        message: "Invalid field type: `{VALUE}`",
      },
      default: "text",
    },
    options: {
      type: [String],
      default: [],
    },
    required: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      trim: true,
      default: "",
      maxlength: [120, "Placeholder cannot exceed 120 characters"],
    },
    defaultValue: {
      type: String,
      trim: true,
      default: "",
      maxlength: [255, "Default value cannot exceed 255 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [300, "Description cannot exceed 300 characters"],
    },
    order: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
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
  },
)

// Compound index for uniqueness of field key within a tenant
customFieldSchema.index({ tenantId: 1, name: 1 }, { unique: true })
customFieldSchema.index({ tenantId: 1, status: 1, order: 1 })

// Enforce tenant boundary isolation
customFieldSchema.plugin(tenantIsolationPlugin)

module.exports = {
  CustomField: mongoose.model("CustomField", customFieldSchema),
  ALLOWED_FIELD_TYPES,
}
