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

const TELEPHONY_PROVIDERS = ["mock", "twilio", "exotel", "airtel_iq", "sip"]
const TELEPHONY_CONNECTION_MODES = ["sim_forwarding", "cloud_number", "sip_pbx"]
const TELEPHONY_ANSWER_MODES = ["unanswered_only"]
const TELEPHONY_LANGUAGES = ["hindi", "english", "hinglish", "both"]
const TELEPHONY_STATUSES = ["unconfigured", "active", "paused", "error"]

const telephonyConfigSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: TELEPHONY_PROVIDERS,
      default: "mock",
    },
    connectionMode: {
      type: String,
      enum: TELEPHONY_CONNECTION_MODES,
      default: "sim_forwarding",
    },
    businessPhoneNumber: {
      type: String,
      trim: true,
      default: "",
    },
    virtualNumber: {
      type: String,
      trim: true,
      default: "",
    },
    answerMode: {
      type: String,
      enum: TELEPHONY_ANSWER_MODES,
      default: "unanswered_only",
    },
    noAnswerTimeoutSeconds: {
      type: Number,
      min: [10, "No-answer timeout must be at least 10 seconds"],
      max: [60, "No-answer timeout cannot exceed 60 seconds"],
      default: 20,
    },
    aiEnabled: {
      type: Boolean,
      default: false,
    },
    aiLanguage: {
      type: String,
      enum: TELEPHONY_LANGUAGES,
      default: "hinglish",
    },
    aiGreeting: {
      type: String,
      trim: true,
      default: "Namaste, thank you for calling. How can I help you today?",
    },
    humanHandoverNumber: {
      type: String,
      trim: true,
      default: "",
    },
    recordingEnabled: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: TELEPHONY_STATUSES,
      default: "unconfigured",
    },
    credentialsEncrypted: {
      type: String,
      default: null,
    },
    credentialsConfigured: {
      type: Boolean,
      default: false,
    },
    credentialsLastUpdated: {
      type: Date,
      default: null,
    },
    credentialsMasked: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { _id: false }
)

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
    telephonyConfig: {
      type: telephonyConfigSchema,
      default: () => ({}),
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
  TELEPHONY_PROVIDERS,
  TELEPHONY_CONNECTION_MODES,
  TELEPHONY_ANSWER_MODES,
  TELEPHONY_LANGUAGES,
  TELEPHONY_STATUSES,
}
