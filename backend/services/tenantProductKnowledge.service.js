const mongoose = require("mongoose")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")

/**
 * Universal Multi-Tenant Product Knowledge Service
 * 
 * Dynamically resolves, normalizes, and indexes tenant-specific products, services,
 * approved topics, features, and vocabulary across all business verticals.
 * 
 * Strict Multi-Tenant Isolation:
 * - Never shares or leaks one tenant's products/topics into another tenant's evaluation.
 * - In-memory cache is strictly keyed by tenantId with configurable TTL.
 * - Zero hardcoded tenant names, domains, or industry module sets.
 */

// In-memory tenant knowledge cache: Map<cleanTenantId, { data, expiresAt }>
const knowledgeCache = new Map()
const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Checks if a string is purely a URL or domain name.
 */
function isUrlOrDomain(term) {
  if (!term || typeof term !== "string") return false
  const t = term.trim().toLowerCase()
  return (
    t.startsWith("http://") ||
    t.startsWith("https://") ||
    t.startsWith("www.") ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/.*)?$/i.test(t)
  )
}

/**
 * Strips URLs, domain names, protocol prefixes, and non-alphanumeric noise.
 */
function sanitizeTerm(term) {
  if (!term || typeof term !== "string") return ""
  return term
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
}

/**
 * Tokenizes text into Unicode-safe words (English, Hindi Devanagari, and numbers).
 */
function tokenizeWords(text) {
  if (!text || typeof text !== "string") return []
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
}

/**
 * Expands a software/product/service keyword with natural language equivalents
 * and common Hinglish phrasing (e.g., software <-> system <-> solution <-> erp <-> app).
 */
function expandKeywordEquivalents(rawKw) {
  if (!rawKw || isUrlOrDomain(rawKw)) return []
  const clean = rawKw.toLowerCase().trim()
  if (clean.length < 2) return []

  const variants = new Set([clean])

  // Space-collapsed variant (e.g. "medical 365" -> "medical365", "real estate" -> "realestate")
  if (clean.includes(" ")) {
    variants.add(clean.replace(/\s+/g, ""))
    variants.add(clean.replace(/\s+/g, "-"))
  }

  // Expansion of software / system / solution / erp / app equivalents
  const typeTokens = ["software", "system", "solution", "erp", "app", "application", "portal", "crm"]
  for (const token of typeTokens) {
    if (new RegExp(`\\b${token}\\b`, "i").test(clean)) {
      for (const replacement of typeTokens) {
        if (replacement !== token) {
          variants.add(clean.replace(new RegExp(`\\b${token}\\b`, "gi"), replacement).replace(/\s+/g, " ").trim())
        }
      }
      // Base without type word (e.g. "school erp software" -> "school erp", "school")
      const baseWithoutType = clean.replace(new RegExp(`\\b(${typeTokens.join("|")})\\b`, "gi"), "").replace(/\s+/g, " ").trim()
      if (baseWithoutType.length >= 3 && !["company", "business", "service", "services", "online", "digital"].includes(baseWithoutType)) {
        variants.add(baseWithoutType)
      }
    }
  }

  // Compound contractions (e.g. "school management erp" -> "school erp", "school erp software")
  if (/\b(management|automation|administration|tracking|monitoring)\b/i.test(clean)) {
    const withoutManagement = clean.replace(/\b(management|automation|administration|tracking|monitoring)\b/gi, "").replace(/\s+/g, " ").trim()
    if (withoutManagement.length >= 3) {
      variants.add(withoutManagement)
      for (const token of typeTokens) {
        if (new RegExp(`\\b${token}\\b`, "i").test(withoutManagement)) {
          for (const replacement of typeTokens) {
            if (replacement !== token) {
              variants.add(withoutManagement.replace(new RegExp(`\\b${token}\\b`, "gi"), replacement).replace(/\s+/g, " ").trim())
            }
          }
        }
      }
    }
  }

  // Common Hinglish connector variants: e.g. "hospital software" -> "hospital ka software", "school erp" -> "school ke liye erp"
  const connectorTokens = ["software", "system", "erp", "crm", "solution"]
  for (const cToken of connectorTokens) {
    if (clean.includes(` ${cToken}`)) {
      const base = clean.replace(new RegExp(`\\s+${cToken}\\b`, "i"), "").trim()
      if (base.length >= 3) {
        variants.add(`${base} ka ${cToken}`)
        variants.add(`${base} ke liye ${cToken}`)
        variants.add(`${base} chalane ka ${cToken}`)
        variants.add(`${base} ke liye ${cToken} software`)
      }
    }
  }

  return Array.from(variants).filter((v) => v.length >= 2 && !isUrlOrDomain(v))
}

/**
 * Builds canonical title from a raw keyword (e.g., "pharmacy management software" -> "Pharmacy Management Module").
 */
function formatCanonicalInterestTitle(phrase) {
  if (!phrase) return ""
  const cleaned = phrase.trim().replace(/\s+/g, " ")
  // Capitalize each word
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/**
 * Dynamically resolves and compiles tenant product knowledge from DB models.
 */
async function getTenantProductKnowledge(tenantId, options = {}) {
  const { forceRefresh = false, ttlMs = DEFAULT_TTL_MS } = options
  const cleanTenantId = tenantId ? String(tenantId).trim() : ""

  if (!cleanTenantId) {
    return {
      tenantId: "",
      companyName: "",
      industry: "",
      description: "",
      products: [],
      approvedTopics: [],
      approvedKeywords: [],
      moduleCatalog: [],
      rawCatalog: {},
    }
  }

  // Check in-memory cache
  if (!forceRefresh) {
    const cached = knowledgeCache.get(cleanTenantId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }
  }

  // Load from database in parallel across models
  const [profile, products, approvedTopics, knowledgeSources] = await Promise.all([
    TenantBusinessProfile.findOne({ tenantId: cleanTenantId })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => null),
    BusinessProduct.find({ tenantId: cleanTenantId, status: "active", isArchived: false })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
    AIKeywordTopic.find({ tenantId: cleanTenantId, status: "APPROVED" })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
    AIKnowledgeSource.find({ tenantId: cleanTenantId, status: "COMPLETED" })
      .setOptions({ skipTenantFilter: true })
      .lean()
      .catch(() => []),
  ])

  const companyName = profile?.businessName || profile?.companyName || ""
  const industry = profile?.industry || profile?.customIndustry || ""
  const description = profile?.description || ""

  const approvedKeywords = new Set()
  const moduleCatalog = [] // Array of { canonicalName, originalName, source: 'product'|'feature'|'topic'|'profile', keywords: [] }

  const addKeywordsToSet = (termList) => {
    if (!termList) return
    const list = Array.isArray(termList) ? termList : [termList]
    for (const item of list) {
      if (!item || isUrlOrDomain(item)) continue
      const expansions = expandKeywordEquivalents(item)
      for (const exp of expansions) {
        approvedKeywords.add(exp.toLowerCase())
      }
    }
  }

  // 1. Ingest Tenant Profile: Business name, company aliases, salient terms from description
  if (companyName && !isUrlOrDomain(companyName)) {
    addKeywordsToSet(companyName)
    moduleCatalog.push({
      canonicalName: companyName,
      source: "profile_name",
      keywords: expandKeywordEquivalents(companyName),
    })
  }

  // Extract key descriptive software phrases from tenant business description
  if (description) {
    const descMatches = description.match(/\b([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+){1,3}\s+(?:software|system|erp|crm|solutions?|services?|platform))\b/gi)
    if (descMatches) {
      for (const dm of descMatches) {
        addKeywordsToSet(dm)
      }
    }
  }

  // 2. Ingest BusinessProducts (Products, Services, Categories, Features, Descriptions)
  const normalizedProducts = []
  for (const p of products) {
    if (!p.name || isUrlOrDomain(p.name)) continue

    const pKeywords = expandKeywordEquivalents(p.name)
    addKeywordsToSet(p.name)

    // Category
    if (p.category && !isUrlOrDomain(p.category)) {
      addKeywordsToSet(p.category)
      pKeywords.push(...expandKeywordEquivalents(p.category))
    }

    // Features
    const featList = []
    if (Array.isArray(p.features)) {
      for (const feat of p.features) {
        if (feat && !isUrlOrDomain(feat)) {
          featList.push(feat)
          addKeywordsToSet(feat)
          pKeywords.push(...expandKeywordEquivalents(feat))
          moduleCatalog.push({
            canonicalName: formatCanonicalInterestTitle(feat),
            productName: p.name,
            source: "product_feature",
            keywords: expandKeywordEquivalents(feat),
          })
        }
      }
    }

    normalizedProducts.push({
      id: p._id,
      name: p.name,
      type: p.type || "PRODUCT",
      category: p.category || "",
      description: p.description || "",
      features: featList,
      price: p.price || null,
      keywords: pKeywords,
    })

    moduleCatalog.push({
      canonicalName: p.name,
      productName: p.name,
      source: "product",
      keywords: pKeywords,
    })
  }

  // 3. Ingest Approved AI Keyword Topics
  const normalizedTopics = []
  for (const t of approvedTopics) {
    const topicKeywords = []

    // Topic Name (only if not a URL)
    if (t.name && !isUrlOrDomain(t.name)) {
      addKeywordsToSet(t.name)
      topicKeywords.push(...expandKeywordEquivalents(t.name))
      moduleCatalog.push({
        canonicalName: t.name,
        source: "topic_name",
        keywords: expandKeywordEquivalents(t.name),
      })
    }

    // Primary Keywords
    if (Array.isArray(t.primaryKeywords)) {
      for (const kw of t.primaryKeywords) {
        if (kw && !isUrlOrDomain(kw)) {
          addKeywordsToSet(kw)
          topicKeywords.push(...expandKeywordEquivalents(kw))
          // For salient multi-word primary keywords, add as a module entry
          if (kw.split(/\s+/).length >= 2) {
            moduleCatalog.push({
              canonicalName: formatCanonicalInterestTitle(kw),
              source: "topic_keyword",
              keywords: expandKeywordEquivalents(kw),
            })
          }
        }
      }
    }

    // Synonyms
    if (Array.isArray(t.synonyms)) {
      for (const syn of t.synonyms) {
        if (syn && !isUrlOrDomain(syn)) {
          addKeywordsToSet(syn)
          topicKeywords.push(...expandKeywordEquivalents(syn))
        }
      }
    }

    // Product Terminology
    if (Array.isArray(t.productTerminology)) {
      for (const pt of t.productTerminology) {
        if (pt && !isUrlOrDomain(pt)) {
          addKeywordsToSet(pt)
          topicKeywords.push(...expandKeywordEquivalents(pt))
        }
      }
    }

    normalizedTopics.push({
      id: t._id,
      name: t.name,
      category: t.category || "General",
      keywords: topicKeywords,
    })
  }

  // 4. Ingest AI Knowledge Sources
  for (const ks of knowledgeSources) {
    if (ks.title && !isUrlOrDomain(ks.title)) {
      addKeywordsToSet(ks.title)
    }
    if (ks.productName && !isUrlOrDomain(ks.productName)) {
      addKeywordsToSet(ks.productName)
    }
  }

  // 5. Fallback baseline ONLY for completely unconfigured tenants (0 products & 0 topics)
  if (approvedKeywords.size === 0) {
    const genericBaseline = ["software", "crm", "solution", "services", "system", "pricing", "quotation", "demo"]
    for (const b of genericBaseline) {
      approvedKeywords.add(b)
    }
  }

  const knowledgeData = {
    tenantId: cleanTenantId,
    companyName,
    industry,
    description,
    products: normalizedProducts,
    approvedTopics: normalizedTopics,
    approvedKeywords: Array.from(approvedKeywords),
    moduleCatalog,
    cachedAt: Date.now(),
  }

  // Cache in memory
  knowledgeCache.set(cleanTenantId, {
    data: knowledgeData,
    expiresAt: Date.now() + ttlMs,
  })

  return knowledgeData
}

/**
 * Clears the in-memory knowledge cache for a specific tenant or all tenants.
 */
function clearTenantKnowledgeCache(tenantId = null) {
  if (tenantId) {
    knowledgeCache.delete(String(tenantId).trim())
  } else {
    knowledgeCache.clear()
  }
}

/**
 * Matches a transcript text against a tenant's loaded product knowledge.
 * Uses Unicode-aware token and phrase matching.
 */
function matchTranscriptAgainstKnowledge(transcriptText, knowledge) {
  if (!transcriptText || !knowledge || !Array.isArray(knowledge.approvedKeywords)) {
    return {
      matchedKeywords: [],
      matchedProducts: [],
      matchedModules: [],
    }
  }

  const lowerText = transcriptText.toLowerCase()
  const matchedKeywords = []

  for (const kw of knowledge.approvedKeywords) {
    if (!kw || kw.length < 2) continue
    const lowerKw = kw.toLowerCase()

    let isMatch = false
    // ASCII regex word boundary check
    if (/^[a-z0-9\s_-]+$/i.test(lowerKw)) {
      const escaped = lowerKw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
      const kwRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, "i")
      isMatch = kwRegex.test(lowerText)
    } else {
      // Unicode word boundary check for Devanagari or other scripts
      const escaped = lowerKw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
      try {
        const uRegex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=[^\\p{L}\\p{N}]|$)`, "iu")
        isMatch = uRegex.test(lowerText)
      } catch {
        isMatch = lowerText.includes(lowerKw)
      }
    }

    if (isMatch && !isUrlOrDomain(kw)) {
      matchedKeywords.push(kw)
    }
  }

  const uniqueMatchedKeywords = Array.from(new Set(matchedKeywords))

  // Resolve matching canonical products and modules from moduleCatalog
  const candidateProducts = new Set()
  const candidateModules = new Set()

  if (Array.isArray(knowledge.moduleCatalog)) {
    for (const item of knowledge.moduleCatalog) {
      if (!item.canonicalName || isUrlOrDomain(item.canonicalName)) continue

      const hasMatch = (item.keywords || []).some((kw) => {
        const lkw = kw.toLowerCase()
        return uniqueMatchedKeywords.includes(lkw) || lowerText.includes(lkw)
      })

      if (hasMatch) {
        if (item.source === "product") {
          candidateProducts.add(item.canonicalName)
        } else if (item.source === "product_feature" || item.source === "topic_keyword") {
          candidateModules.add(item.canonicalName)
        } else if (item.source === "topic_name" && !isUrlOrDomain(item.canonicalName)) {
          candidateProducts.add(item.canonicalName)
        }
      }
    }
  }

  return {
    matchedKeywords: uniqueMatchedKeywords,
    matchedProducts: Array.from(candidateProducts),
    matchedModules: Array.from(candidateModules),
  }
}

module.exports = {
  getTenantProductKnowledge,
  clearTenantKnowledgeCache,
  matchTranscriptAgainstKnowledge,
  isUrlOrDomain,
  sanitizeTerm,
  tokenizeWords,
  expandKeywordEquivalents,
  formatCanonicalInterestTitle,
}
