const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * LeadSource Model - Roadmap Phase 11: Canonical Lead Source Registry
 * 
 * Supports:
 * - Canonical sources (Website, Facebook, Instagram, Google Ads, IndiaMART, Referral, Walk-in, Zapier, Direct)
 * - Alias normalization table ("insta", "ig", "instagram_ad" -> "Instagram")
 * - Per-tenant custom sources
 * - Non-destructive normalization (preserves legitimate custom sources)
 */

const DEFAULT_CANONICAL_SOURCES = [
  {
    name: "Website",
    code: "website",
    aliases: ["web", "site", "landing_page", "website_form", "wordpress", "wix", "web_webhook"],
    color: "#2563eb",
    isSystem: true,
    description: "Inbound leads submitted via website contact forms and landing pages",
  },
  {
    name: "Facebook",
    code: "facebook",
    aliases: ["fb", "facebook_ad", "facebook_lead_ad", "facebook_form", "fb_ads", "fb_lead"],
    color: "#1877f2",
    isSystem: true,
    description: "Paid and organic leads generated from Facebook Lead Ads and Pages",
  },
  {
    name: "Instagram",
    code: "instagram",
    aliases: ["insta", "ig", "instagram_ad", "instagram_lead", "ig_ad", "ig_lead"],
    color: "#e1306c",
    isSystem: true,
    description: "Direct and ad leads generated from Instagram Lead Forms and DM ads",
  },
  {
    name: "Google Ads",
    code: "google_ads",
    aliases: ["google", "g_ads", "gads", "google_lead_form", "adwords", "googleads"],
    color: "#ea4335",
    isSystem: true,
    description: "Google Search, Performance Max, and Lead Form extension leads",
  },
  {
    name: "IndiaMART",
    code: "indiamart",
    aliases: ["indiamart_lead", "imart", "india_mart"],
    color: "#00a651",
    isSystem: true,
    description: "B2B buyer inquiries synced from IndiaMART marketplace",
  },
  {
    name: "Referral",
    code: "referral",
    aliases: ["word_of_mouth", "client_referral", "partner", "ref"],
    color: "#8b5cf6",
    isSystem: true,
    description: "Client, partner, or colleague recommendations",
  },
  {
    name: "Walk-in",
    code: "walk_in",
    aliases: ["direct_visit", "in_person", "office_visit", "walkin"],
    color: "#f59e0b",
    isSystem: true,
    description: "Direct physical visits to the office or clinic",
  },
  {
    name: "Zapier",
    code: "zapier",
    aliases: ["zapier_webhook", "make", "pabbly", "api_webhook", "webhook"],
    color: "#ff4f00",
    isSystem: true,
    description: "Leads pushed through Zapier, Make.com, or custom API webhooks",
  },
  {
    name: "Direct",
    code: "direct",
    aliases: ["phone_call", "inbound_call", "manual_entry", "manual", "telephony"],
    color: "#10b981",
    isSystem: true,
    description: "Direct inbound phone calls or staff manual entries",
  },
]

const leadSourceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for lead sources"],
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Source name is required"],
      trim: true,
      maxlength: 80,
    },
    code: {
      type: String,
      required: [true, "Source code slug is required"],
      lowercase: true,
      trim: true,
      maxlength: 80,
    },
    aliases: {
      type: [String],
      default: [],
      set: (aliases) =>
        Array.isArray(aliases)
          ? aliases.map((a) => (typeof a === "string" ? a.trim().toLowerCase() : "")).filter(Boolean)
          : [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    color: {
      type: String,
      default: "#3b82f6",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 255,
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

// Compound indexes
leadSourceSchema.index({ tenantId: 1, code: 1 }, { unique: true })
leadSourceSchema.index({ tenantId: 1, name: 1 })
leadSourceSchema.index({ tenantId: 1, aliases: 1 })

// Enforce ambient multi-tenant isolation
leadSourceSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const LeadSource = mongoose.models.LeadSource || mongoose.model("LeadSource", leadSourceSchema)

/**
 * Idempotently seeds default canonical sources for a tenant.
 * 
 * @param {string} tenantId 
 * @returns {Promise<Array>} Seeded or existing sources
 */
async function seedDefaultSources(tenantId) {
  if (!tenantId) return []

  const results = []
  for (const src of DEFAULT_CANONICAL_SOURCES) {
    const existing = await LeadSource.findOne({
      tenantId,
      code: src.code,
    }).setOptions({ skipTenantFilter: true })

    if (!existing) {
      const created = await LeadSource.create({
        tenantId,
        name: src.name,
        code: src.code,
        aliases: src.aliases,
        color: src.color,
        isSystem: true,
        description: src.description,
        isActive: true,
      })
      results.push(created)
    } else {
      results.push(existing)
    }
  }
  return results
}

/**
 * Normalizes an arbitrary raw source string into a canonical source name for the tenant.
 * Preserves custom legitimate sources rather than forcing them into unrelated categories.
 * 
 * @param {string} tenantId 
 * @param {string} rawSource 
 * @returns {Promise<string>} Canonical or formatted source name
 */
async function normalizeSource(tenantId, rawSource) {
  if (!rawSource || typeof rawSource !== "string" || !rawSource.trim()) {
    return "Website"
  }

  const clean = rawSource.trim()
  const lower = clean.toLowerCase()
  const slugified = lower.replace(/[\s\-_]+/g, "_")

  // 1. Fetch tenant-defined sources (or fallback to defaults)
  let sources = []
  if (tenantId) {
    sources = await LeadSource.find({ tenantId, isActive: true })
      .setOptions({ skipTenantFilter: true })
      .lean()
  }
  if (!sources || sources.length === 0) {
    sources = DEFAULT_CANONICAL_SOURCES
  }

  // 2. Exact match on code or case-insensitive name
  for (const s of sources) {
    if (s.code === slugified || s.code === lower || s.name.toLowerCase() === lower) {
      return s.name
    }
  }

  // 3. Exact match in aliases
  for (const s of sources) {
    const aliases = s.aliases || []
    if (aliases.some((a) => a === lower || a === slugified)) {
      return s.name
    }
  }

  // 4. Pattern / keyword heuristics for common ad platforms
  if (slugified.includes("instagram") || slugified.startsWith("insta") || slugified.startsWith("ig_")) {
    return "Instagram"
  }
  if (slugified.includes("facebook") || slugified === "fb" || slugified.startsWith("fb_")) {
    return "Facebook"
  }
  if (slugified.includes("indiamart") || slugified.includes("imart")) {
    return "IndiaMART"
  }
  if (
    slugified.includes("google") ||
    slugified.includes("adwords") ||
    slugified.includes("gads") ||
    slugified.includes("g_ads")
  ) {
    return "Google Ads"
  }
  if (slugified.includes("website") || slugified.includes("landing") || slugified.includes("web_form")) {
    return "Website"
  }

  // 5. Preserve legitimate custom source values
  // Title-case cleanly (e.g. "trade_show_2026" -> "Trade Show 2026")
  return clean
    .replace(/[_\-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

module.exports = {
  LeadSource,
  DEFAULT_CANONICAL_SOURCES,
  seedDefaultSources,
  normalizeSource,
}
