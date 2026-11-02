const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

const INDUSTRY_CATEGORIES = [
  "Furniture",
  "Healthcare",
  "Real Estate",
  "Education",
  "Automobile",
  "Insurance",
  "Finance",
  "Retail",
  "Travel",
  "Other",
]

const tenantBusinessProfileSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required"],
      unique: true,
      trim: true,
      index: true,
    },
    businessName: {
      type: String,
      required: [true, "Business name is required"],
      trim: true,
      minlength: [2, "Business name must be at least 2 characters"],
      maxlength: [150, "Business name cannot exceed 150 characters"],
    },
    industry: {
      type: String,
      enum: INDUSTRY_CATEGORIES,
      default: "Other",
      required: true,
      index: true,
    },
    customIndustry: {
      type: String,
      trim: true,
      maxlength: [100, "Custom industry cannot exceed 100 characters"],
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, "Business description cannot exceed 3000 characters"],
      default: "",
    },
    website: {
      type: String,
      trim: true,
      maxlength: [255, "Website URL cannot exceed 255 characters"],
      default: "",
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [255, "Contact email cannot exceed 255 characters"],
      default: "",
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: [30, "Contact phone cannot exceed 30 characters"],
      default: "",
    },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "India" },
      postalCode: { type: String, trim: true, default: "" },
    },
    languages: {
      type: [{ type: String, trim: true }],
      default: ["English", "Hindi"],
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  }
)

// Apply multi-tenant isolation plugin
tenantBusinessProfileSchema.plugin(tenantIsolationPlugin)

const TenantBusinessProfile = mongoose.model("TenantBusinessProfile", tenantBusinessProfileSchema)

module.exports = {
  TenantBusinessProfile,
  INDUSTRY_CATEGORIES,
}

