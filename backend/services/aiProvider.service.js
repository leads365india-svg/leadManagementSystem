/**
 * AI Provider Service - Phase 2: AI Keyword Generation & Admin Approval
 * 
 * Pluggable AI abstraction supporting:
 * - Gemini API (via Google AI Studio REST endpoints)
 * - Extensible provider interface (OpenAI / Anthropic / Local LLM)
 * - Deterministic, NLP-based fallback generator for offline environments, testing, or missing API keys.
 * 
 * Strict grounding:
 * - Prevents hallucinated products, specs, or guarantees.
 * - Extracts topics strictly from verified Business Profile, Products, and COMPLETED Knowledge Sources.
 */

const https = require("https")

/**
 * Executes an HTTPS POST request with JSON payload.
 * Native implementation avoids third-party transport dependencies.
 */
function makeHttpsRequest(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr)
      const postData = JSON.stringify(data)
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          ...headers,
        },
      }

      const req = https.request(options, (res) => {
        let body = ""
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body))
            } catch (err) {
              resolve(body)
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`))
          }
        })
      })

      req.on("error", (err) => reject(err))
      req.setTimeout(30000, () => {
        req.destroy(new Error("AI Provider request timed out after 30 seconds"))
      })
      req.write(postData)
      req.end()
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Builds grounding context text from tenant knowledge assets.
 */
function buildGroundingContext({ profile, products = [], knowledgeSources = [] }) {
  let context = "=== TENANT BUSINESS KNOWLEDGE ===\n\n"

  // 1. Business Profile
  if (profile) {
    context += "--- BUSINESS PROFILE ---\n"
    context += `Business Name: ${profile.businessName || "Unnamed"}\n`
    context += `Industry: ${profile.industry || "General"}${profile.customIndustry ? ` (${profile.customIndustry})` : ""}\n`
    if (profile.description) {
      context += `Description: ${profile.description}\n`
    }
    if (profile.languages && profile.languages.length > 0) {
      context += `Supported Languages: ${profile.languages.join(", ")}\n`
    }
    context += "\n"
  }

  // 2. Products & Services
  if (products.length > 0) {
    context += `--- PRODUCTS & SERVICES (${products.length}) ---\n`
    products.forEach((p, idx) => {
      context += `[${idx + 1}] ${p.type || "PRODUCT"}: ${p.name}\n`
      if (p.category) context += `    Category: ${p.category}\n`
      if (p.description) context += `    Description: ${p.description}\n`
      if (p.price?.amount) {
        context += `    Pricing: ${p.price.currency || "INR"} ${p.price.amount} (${p.price.billingCycle || "one-time"})\n`
      }
      if (p.features && p.features.length > 0) {
        context += `    Features: ${p.features.join("; ")}\n`
      }
      context += "\n"
    })
  }

  // 3. Completed Knowledge Sources
  const completedSources = knowledgeSources.filter((s) => s.status === "COMPLETED")
  if (completedSources.length > 0) {
    context += `--- KNOWLEDGE DOCUMENTS & SOURCES (${completedSources.length}) ---\n`
    completedSources.forEach((s, idx) => {
      context += `[${idx + 1}] Source: "${s.title}" (Type: ${s.sourceType})\n`
      if (s.productName) context += `    Linked Product: ${s.productName}\n`
      const text = s.extractedText || s.manualDetails?.content || ""
      const snippet = text.slice(0, 3000).replace(/\s+/g, " ").trim()
      if (snippet) {
        context += `    Content Excerpt: ${snippet}\n`
      }
      context += "\n"
    })
  }

  return context
}

/**
 * Deterministic Semantic / NLP Fallback Generator.
 * Used when no external AI API key is configured or during offline testing.
 * Produces structured, highly relevant topics grounded strictly in provided knowledge.
 */
function generateDeterministicTopics({ profile, products = [], knowledgeSources = [] }) {
  const topics = []
  const completedSources = knowledgeSources.filter((s) => s.status === "COMPLETED")

  // 1. Topic per Product / Service
  products.forEach((prod) => {
    const isService = prod.type === "SERVICE"
    const prodName = prod.name.trim()
    const category = isService ? "Consultation & Services" : "Product Specifications"
    
    // Extract terms from product name and features
    const nameWords = prodName.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const featureKeywords = (prod.features || []).flatMap((f) => 
      f.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
    ).slice(0, 5)

    const primaryKeywords = Array.from(new Set([
      prodName.toLowerCase(),
      ...nameWords,
      ...featureKeywords,
      prod.category ? prod.category.toLowerCase() : "",
    ])).filter(Boolean).slice(0, 8)

    const synonyms = [
      `${prodName} options`,
      `${prodName} inquiries`,
      `${prodName} quotes`,
      `${prod.category || "item"} order`,
    ].filter((s) => !primaryKeywords.includes(s.toLowerCase()))

    const customerQuestions = [
      `What are the specifications of ${prodName}?`,
      `How much does ${prodName} cost?`,
      `What is the lead time or delivery schedule for ${prodName}?`,
      `Can you customize ${prodName} for our specific requirements?`,
    ]

    const productTerminology = [
      prod.category || "General",
      prod.price?.billingCycle ? `${prod.price.billingCycle} billing` : "standard pricing",
      ...(prod.features || []).slice(0, 3),
    ].filter(Boolean)

    const discussionPoints = [
      `Walk through key capabilities and differentiators of ${prodName}.`,
      `Clarify customer budget, volume requirements, and timeline.`,
      `Confirm specific customization or installation requirements.`,
    ]

    // Find linked or matching knowledge sources
    const matchingSources = completedSources.filter(
      (s) => (s.productId && s.productId.toString() === prod._id.toString()) ||
             (s.productName && s.productName.toLowerCase() === prodName.toLowerCase()) ||
             (s.extractedText && s.extractedText.toLowerCase().includes(prodName.toLowerCase()))
    )

    const sourceReferences = matchingSources.map((s) => ({
      sourceId: s._id,
      title: s.title,
      sourceType: s.sourceType,
      snippet: (s.extractedText || s.manualDetails?.content || "").slice(0, 200).trim(),
    }))

    topics.push({
      name: `${prodName} - Details & Inquiries`,
      category,
      confidenceScore: 0.95,
      primaryKeywords,
      synonyms,
      customerQuestions,
      productTerminology,
      discussionPoints,
      relatedProductIds: [prod._id],
      sourceReferences,
    })
  })

  // 2. Topic per Knowledge Source (policies, manuals, websites, guides)
  completedSources.forEach((source) => {
    // If source is not already linked to a specific product
    const title = source.title.trim()
    const content = (source.extractedText || source.manualDetails?.content || "").trim()
    
    // Categorize based on title keywords
    let category = "Sales & Inquiries"
    const lowerTitle = title.toLowerCase()
    if (lowerTitle.includes("warranty") || lowerTitle.includes("return") || lowerTitle.includes("support")) {
      category = "Warranty & Support"
    } else if (lowerTitle.includes("price") || lowerTitle.includes("pricing") || lowerTitle.includes("cost") || lowerTitle.includes("payment")) {
      category = "Pricing & Commercials"
    } else if (lowerTitle.includes("delivery") || lowerTitle.includes("shipping") || lowerTitle.includes("dispatch")) {
      category = "Delivery & Logistics"
    } else if (lowerTitle.includes("spec") || lowerTitle.includes("manual") || lowerTitle.includes("technical")) {
      category = "Product Specifications"
    }

    const titleWords = lowerTitle.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
    const primaryKeywords = Array.from(new Set([
      lowerTitle,
      ...titleWords,
      category.toLowerCase(),
    ])).filter(Boolean).slice(0, 8)

    const synonyms = [
      `${title} details`,
      `${title} questions`,
      `terms for ${titleWords[0] || "policy"}`,
    ]

    const customerQuestions = [
      `What is your policy regarding ${title}?`,
      `How does ${title} apply to our current inquiry?`,
      `Who handles questions about ${title}?`,
    ]

    const discussionPoints = [
      `Explain the relevant terms from "${title}".`,
      `Reassure customer regarding official procedures and timelines.`,
    ]

    const sourceSnippet = content.slice(0, 250).replace(/\s+/g, " ").trim()

    topics.push({
      name: `${title} Guidance`,
      category,
      confidenceScore: 0.90,
      primaryKeywords,
      synonyms,
      customerQuestions,
      productTerminology: titleWords.slice(0, 3),
      discussionPoints,
      relatedProductIds: source.productId ? [source.productId] : [],
      sourceReferences: [
        {
          sourceId: source._id,
          title: source.title,
          sourceType: source.sourceType,
          snippet: sourceSnippet,
        },
      ],
    })
  })

  // 3. High-level Business Consultation topic (if profile exists)
  if (profile && profile.businessName) {
    const bName = profile.businessName.trim()
    const industry = profile.industry || "General"
    
    topics.push({
      name: `${bName} General Inquiries & Company Overview`,
      category: "Sales & Inquiries",
      confidenceScore: 0.88,
      primaryKeywords: [
        bName.toLowerCase(),
        industry.toLowerCase(),
        "company details",
        "office location",
        "business hours",
        "contact sales",
      ],
      synonyms: [
        `about ${bName.toLowerCase()}`,
        `${industry.toLowerCase()} consultation`,
        "general inquiry",
      ],
      customerQuestions: [
        `What services does ${bName} provide?`,
        `Where are your operations or branches located?`,
        `How can I speak to a senior sales representative?`,
      ],
      productTerminology: [
        industry,
        ...(profile.languages || []),
      ],
      discussionPoints: [
        `Introduce ${bName} and highlight core domain expertise in ${industry}.`,
        `Identify the caller's immediate business need or project requirements.`,
        `Qualify the opportunity and schedule next steps.`,
      ],
      relatedProductIds: products.slice(0, 3).map((p) => p._id),
      sourceReferences: completedSources.slice(0, 2).map((s) => ({
        sourceId: s._id,
        title: s.title,
        sourceType: s.sourceType,
        snippet: (s.extractedText || "").slice(0, 150).trim(),
      })),
    })
  }

  return topics
}

/**
 * Calls Gemini API with structured output prompt.
 */
async function generateGeminiTopics({ apiKey, profile, products = [], knowledgeSources = [] }) {
  const groundingContext = buildGroundingContext({ profile, products, knowledgeSources })

  const systemInstruction = `You are a Senior AI Call Intelligence Engineer inside Leads-365 CRM.
Your objective is to generate business-specific sales conversation topics and keywords for a CRM tenant.

RULES:
1. Ground EVERYTHING strictly in the provided business profile, products/services, and knowledge sources.
2. DO NOT invent or hallucinate pricing, guarantees, technical specs, or unlisted capabilities.
3. Generate between 3 and 10 distinct, high-impact conversation topics suitable for real-time sales call monitoring.
4. Output MUST be a valid JSON array of objects. Do not include markdown code block backticks if possible, or wrap in \`\`\`json.
Each object must have the following schema:
{
  "name": "Topic Name (Concise, 2-10 words)",
  "category": "One of: Sales & Inquiries, Product Specifications, Pricing & Commercials, Delivery & Logistics, Warranty & Support, Consultation & Services, General / Other",
  "confidenceScore": 0.80 to 0.99,
  "primaryKeywords": ["keyword 1", "keyword 2", ... (3 to 8 keywords)],
  "synonyms": ["synonym 1", ... (2 to 5 variations)],
  "customerQuestions": ["Common customer question?", ... (2 to 4 questions)],
  "productTerminology": ["Key terminology 1", ...],
  "discussionPoints": ["Sales agent cue or guideline", ...],
  "relatedProductNames": ["Exact product name from context if applicable"],
  "contributingSourceTitles": ["Exact document title from context if applicable"]
}`

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${systemInstruction}\n\n${groundingContext}\n\nPlease generate the JSON array of topics:`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  }

  // Use Gemini 1.5 Flash (standard model)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`

  const response = await makeHttpsRequest(endpoint, requestBody)
  const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error("Empty response received from Gemini API")
  }

  // Parse JSON output
  let parsed
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(`Failed to parse Gemini JSON output: ${err.message}. Raw: ${rawText.slice(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini response is not a JSON array of topics")
  }

  // Map product names and source titles back to IDs
  return parsed.map((item) => {
    const matchedProducts = products.filter((p) =>
      (item.relatedProductNames || []).some(
        (n) => n && p.name && n.toLowerCase().trim() === p.name.toLowerCase().trim()
      )
    )

    const matchedSources = knowledgeSources.filter((s) =>
      (item.contributingSourceTitles || []).some(
        (t) => t && s.title && t.toLowerCase().trim() === s.title.toLowerCase().trim()
      )
    )

    return {
      name: item.name || "Generated Discussion Topic",
      category: item.category || "Sales & Inquiries",
      confidenceScore: typeof item.confidenceScore === "number" ? Math.min(Math.max(item.confidenceScore, 0.5), 1.0) : 0.85,
      primaryKeywords: Array.isArray(item.primaryKeywords) ? item.primaryKeywords.map((k) => String(k).trim()) : [],
      synonyms: Array.isArray(item.synonyms) ? item.synonyms.map((s) => String(s).trim()) : [],
      customerQuestions: Array.isArray(item.customerQuestions) ? item.customerQuestions.map((q) => String(q).trim()) : [],
      productTerminology: Array.isArray(item.productTerminology) ? item.productTerminology.map((t) => String(t).trim()) : [],
      discussionPoints: Array.isArray(item.discussionPoints) ? item.discussionPoints.map((d) => String(d).trim()) : [],
      relatedProductIds: matchedProducts.map((p) => p._id),
      sourceReferences: matchedSources.map((s) => ({
        sourceId: s._id,
        title: s.title,
        sourceType: s.sourceType,
        snippet: (s.extractedText || "").slice(0, 200).trim(),
      })),
    }
  })
}

/**
 * Main public entrypoint for AI Keyword & Topic Generation.
 * Tries the configured provider (Gemini / OpenAI), gracefully falling back to deterministic NLP engine.
 */
async function generateKeywordsAndTopics({ profile, products = [], knowledgeSources = [] }) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase().trim()
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY

  if (provider === "gemini" && apiKey) {
    try {
      console.log("ℹ️ Invoking Gemini API for tenant AI Keyword generation...")
      const topics = await generateGeminiTopics({ apiKey, profile, products, knowledgeSources })
      if (topics && topics.length > 0) {
        return {
          provider: "gemini",
          topics,
        }
      }
    } catch (err) {
      console.warn("⚠️ Gemini API invocation failed, falling back to deterministic engine:", err.message)
    }
  }

  // Fallback to deterministic NLP engine
  console.log("ℹ️ Generating keywords and discussion topics using deterministic NLP engine...")
  const topics = generateDeterministicTopics({ profile, products, knowledgeSources })
  return {
    provider: "deterministic-nlp",
    topics,
  }
}

module.exports = {
  generateKeywordsAndTopics,
  buildGroundingContext,
  generateDeterministicTopics,
}

