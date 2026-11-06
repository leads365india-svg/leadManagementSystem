const mongoose = require("mongoose")

/**
 * Tenant Knowledge Base Grounding & Prompt Builder Service
 * 
 * Dynamically constructs tenant-isolated system instructions for the AI Receptionist:
 * - Ingests verified Business Profile, Products/Services, and COMPLETED Knowledge Sources.
 * - Enforces multi-tenant isolation: strictly filters all knowledge queries by tenantId.
 * - Handles bilingual mode: Hindi, English, and Hinglish.
 * - Grounds responses to eliminate hallucinated pricing, availability, and business commitments.
 * - Fallbacks safely when tenant knowledge is empty or database is offline.
 */

/**
 * Formats tenant knowledge assets into a structured grounding context string.
 * 
 * @param {Object} params
 * @param {string} params.tenantId - The tenant's identifier
 * @param {Object} [params.profile] - TenantBusinessProfile document or object
 * @param {Array} [params.products] - List of BusinessProduct documents
 * @param {Array} [params.knowledgeSources] - List of AIKnowledgeSource documents
 * @returns {string} Formatted grounding context
 */
function buildTenantGroundingContext({ tenantId, profile, products = [], knowledgeSources = [] }) {
  if (!tenantId) {
    throw new Error("Cannot build grounding context: tenantId is required")
  }

  let context = `=== TENANT KNOWLEDGE BASE [TENANT: ${tenantId}] ===\n\n`

  // 1. Business Profile
  context += "--- BUSINESS OVERVIEW ---\n"
  if (profile) {
    context += `Business Name: ${profile.businessName || "Unnamed Business"}\n`
    context += `Industry: ${profile.industry || "General"}${profile.customIndustry ? ` (${profile.customIndustry})` : ""}\n`
    if (profile.description) {
      context += `About Company: ${profile.description.trim()}\n`
    }
    if (profile.website) {
      context += `Website: ${profile.website}\n`
    }
    if (profile.contactEmail) {
      context += `Email: ${profile.contactEmail}\n`
    }
    if (profile.contactPhone) {
      context += `Phone: ${profile.contactPhone}\n`
    }
    if (profile.address && (profile.address.city || profile.address.state)) {
      const addrParts = [
        profile.address.street,
        profile.address.city,
        profile.address.state,
        profile.address.country,
        profile.address.postalCode,
      ].filter(Boolean)
      context += `Location: ${addrParts.join(", ")}\n`
    }
    if (profile.telephonyConfig?.humanHandoverNumber) {
      context += `Human Escalation Number: ${profile.telephonyConfig.humanHandoverNumber}\n`
    }
  } else {
    context += `Business Name: Business ${tenantId}\n`
  }
  context += "\n"

  // 2. Verified Products & Services
  if (Array.isArray(products) && products.length > 0) {
    context += "--- PRODUCTS & SERVICES ---\n"
    products.forEach((prod, idx) => {
      const type = prod.type || "PRODUCT"
      const name = prod.name || `Item ${idx + 1}`
      const desc = prod.description ? ` - ${prod.description.trim()}` : ""
      let priceStr = "Contact for pricing"
      if (prod.price && typeof prod.price.amount === "number" && prod.price.amount > 0) {
        priceStr = `${prod.price.currency || "INR"} ${prod.price.amount}${prod.price.billingCycle ? ` (${prod.price.billingCycle})` : ""}`
      }
      const featuresStr = Array.isArray(prod.features) && prod.features.length > 0 ? ` [Key Features: ${prod.features.join(", ")}]` : ""
      context += `• [${type}] ${name}: ${priceStr}${desc}${featuresStr}\n`
    })
    context += "\n"
  }

  // 3. Verified Knowledge Sources (FAQs, Manuals, Policies)
  const completedSources = (knowledgeSources || []).filter(
    (ks) => ks && (ks.status === "COMPLETED" || !ks.status) && ks.extractedText
  )

  if (completedSources.length > 0) {
    context += "--- VERIFIED BUSINESS KNOWLEDGE & FAQS ---\n"
    completedSources.forEach((ks, idx) => {
      const title = ks.title || `Knowledge Document ${idx + 1}`
      const text = ks.extractedText.trim()
      // Limit individual snippet to 1500 chars to avoid prompt bloat
      const snippet = text.length > 1500 ? `${text.slice(0, 1500)}...` : text
      context += `[Doc ${idx + 1}: ${title}]\n${snippet}\n\n`
    })
  }

  return context.trim()
}

/**
 * Builds the complete system instruction prompt for a tenant's AI Receptionist.
 * 
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {Object} [params.profile]
 * @param {Array} [params.products]
 * @param {Array} [params.knowledgeSources]
 * @param {string} [params.language] - 'hindi' | 'english' | 'hinglish' | 'both'
 * @param {string} [params.greeting]
 * @returns {string} System instruction prompt
 */
function buildTenantReceptionistPrompt({
  tenantId,
  profile,
  products = [],
  knowledgeSources = [],
  language = null,
  greeting = null,
}) {
  const businessName = profile?.businessName || `Business (${tenantId})`
  const configuredLang = (language || profile?.telephonyConfig?.aiLanguage || "hinglish").toLowerCase()
  const configuredGreeting = greeting || profile?.telephonyConfig?.aiGreeting || "Namaste, thank you for calling. How can I help you today?"

  let langInstruction = ""
  if (configuredLang === "hindi") {
    langInstruction = "Always speak politely in fluent, natural Hindi (Devanagari or clean phonetic Hindi). Respond in Hindi."
  } else if (configuredLang === "english") {
    langInstruction = "Always speak politely in professional, natural, articulate English."
  } else {
    langInstruction = "Speak in natural, conversational Hinglish (a mix of Hindi and English commonly spoken in Indian business conversations)."
  }

  const groundingKnowledge = buildTenantGroundingContext({
    tenantId,
    profile,
    products,
    knowledgeSources,
  })

  return `You are the professional AI Voice Receptionist for ${businessName}.
Your standard greeting on answering is: "${configuredGreeting}"
Language Directive: ${langInstruction}

=== STRICT BEHAVIORAL PROTOCOLS ===
1. Introduce yourself courteously as the AI receptionist of ${businessName}.
2. Listen attentively to the caller. Never interrupt or speak over the caller.
3. Ask concise, relevant follow-up questions to understand their exact inquiry (e.g. caller's full name, requirement, preferred callback window).
4. Strictly ground all answers in the provided knowledge base below.
5. NEVER invent, assume, or hallucinate product prices, discounts, delivery dates, or stock availability not explicitly mentioned in the knowledge base.
6. If a caller asks about something not covered in the knowledge base, state politely: "I will make a note of your query and ensure our team gets back to you with the exact details."
7. NEVER promise or state that an order, booking, or lead is officially confirmed until confirmed by the backend CRM system.
8. If the caller requests human escalation or asks to speak with an agent, politely confirm their contact details and let them know you are initiating a transfer or arranging an urgent callback.
9. End the call politely and warmly when the customer says goodbye.

${groundingKnowledge}`
}

/**
 * Safely fetches tenant grounding context from MongoDB if available,
 * falling back gracefully if database is offline or unpopulated.
 * 
 * @param {string} tenantId
 * @returns {Promise<{ profile: Object|null, products: Array, knowledgeSources: Array }>}
 */
async function fetchTenantGroundingData(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId is required to fetch grounding data")
  }

  const isDbReady = mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db

  if (!isDbReady) {
    // Database offline / in-memory testing mode: return safe empty structures
    return {
      profile: null,
      products: [],
      knowledgeSources: [],
    }
  }

  try {
    const { TenantBusinessProfile } = require("../../models/TenantBusinessProfile")
    const AIKnowledgeSource = require("../../models/AIKnowledgeSource")
    const BusinessProduct = require("../../models/BusinessProduct")

    const [profile, products, knowledgeSources] = await Promise.all([
      TenantBusinessProfile.findOne({ tenantId }).lean(),
      BusinessProduct.find({ tenantId, status: { $ne: "INACTIVE" } }).lean(),
      AIKnowledgeSource.find({ tenantId, status: "COMPLETED" }).lean(),
    ])

    return {
      profile: profile || null,
      products: products || [],
      knowledgeSources: knowledgeSources || [],
    }
  } catch (err) {
    console.warn(`[PromptBuilder] Notice: Could not fetch grounding data for tenant ${tenantId}: ${err.message}`)
    return {
      profile: null,
      products: [],
      knowledgeSources: [],
    }
  }
}

module.exports = {
  buildTenantGroundingContext,
  buildTenantReceptionistPrompt,
  fetchTenantGroundingData,
}
