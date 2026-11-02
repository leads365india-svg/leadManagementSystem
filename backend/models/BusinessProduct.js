const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

const businessProductSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Product or service name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [150, "Name cannot exceed 150 characters"],
      index: true,
    },
    type: {
      type: String,
      enum: ["PRODUCT", "SERVICE"],
      required: [true, "Type must be either PRODUCT or SERVICE"],
      default: "PRODUCT",
      index: true,
    },
    category: {
      type: String,
      trim: true,
      maxlength: [100, "Category cannot exceed 100 characters"],
      default: "",
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, "Description cannot exceed 3000 characters"],
      default: "",
    },
    price: {
      amount: {
        type: Number,
        min: [0, "Price cannot be negative"],
        default: 0,
      },
      currency: {
        type: String,
        trim: true,
        uppercase: true,
        default: "INR",
        maxlength: [5, "Currency code cannot exceed 5 characters"],
      },
      billingCycle: {
        type: String,
        enum: ["one-time", "monthly", "quarterly", "yearly", "custom", ""],
        default: "one-time",
      },
    },
    features: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, "Additional notes cannot exceed 2000 characters"],
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    archivedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
)

// Compound index for unique product name per tenant among non-archived items
businessProductSchema.index({ tenantId: 1, name: 1, isArchived: 1 })

// Apply multi-tenant isolation plugin
businessProductSchema.plugin(tenantIsolationPlugin)

const BusinessProduct = mongoose.model("BusinessProduct", businessProductSchema)

module.exports = BusinessProduct

