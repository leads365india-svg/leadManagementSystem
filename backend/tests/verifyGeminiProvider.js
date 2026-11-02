/**
 * Focused Gemini Provider Unit & Compatibility Test Suite
 * 
 * Verifies:
 * 1. Default model is 'gemini-3.8-flash'.
 * 2. GEMINI_MODEL env override works.
 * 3. Obsolete models ('gemini-1.5-flash', etc.) are safely rejected.
 * 4. Correct GenerateContent endpoint is constructed with 'x-goog-api-key' header (no query param exposure).
 * 5. Request body explicitly contains 'store: false'.
 * 6. API key is never exposed in logs or error output (sanitizeErrorMessage).
 * 7. Successful mock response parsing works.
 * 8. Malformed responses, timeouts, HTTP errors, missing key, and obsolete models trigger deterministic fallback.
 * 9. Provider status distinctly reports 'gemini' vs 'deterministic-nlp'.
 * 10. Topic structure and source-grounding rules remain intact.
 * 
 * ZERO external network calls - uses isolated mock httpClient.
 */

const assert = require("assert")
const {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiModel,
  sanitizeErrorMessage,
  buildGroundingContext,
  generateDeterministicTopics,
  generateGeminiTopics,
  generateKeywordsAndTopics,
} = require("../services/aiProvider.service")

const results = []
function record(name, passed, detail = "") {
  results.push({ name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (!passed && detail) {
    console.log(`     Error: ${detail}`)
  }
}

async function runGeminiProviderTests() {
  console.log("\n=======================================================")
  console.log("   FOCUSED GEMINI PROVIDER COMPATIBILITY TEST SUITE   ")
  console.log("=======================================================\n")

  const originalEnv = { ...process.env }

  try {
    // -----------------------------------------------------------------
    // Suite 1: Model Resolution & Obsolete Model Protection
    // -----------------------------------------------------------------
    console.log("--- 1. Gemini Model Resolution & Deprecation Checks ---")

    // Test 1.1: Default model is gemini-3.8-flash
    delete process.env.GEMINI_MODEL
    const defaultModel = resolveGeminiModel()
    record(
      "Default model resolves to 'gemini-3.8-flash'",
      defaultModel === "gemini-3.8-flash" && DEFAULT_GEMINI_MODEL === "gemini-3.8-flash",
      `Expected 'gemini-3.8-flash', got '${defaultModel}'`
    )

    // Test 1.2: Environment variable override
    process.env.GEMINI_MODEL = "gemini-2.5-flash"
    const overrideModel = resolveGeminiModel()
    record(
      "GEMINI_MODEL env override resolves correctly",
      overrideModel === "gemini-2.5-flash",
      `Expected 'gemini-2.5-flash', got '${overrideModel}'`
    )

    // Test 1.3: Rejects obsolete gemini-1.5-flash
    let obsoleteCaught15 = false
    let obsoleteMsg15 = ""
    try {
      process.env.GEMINI_MODEL = "gemini-1.5-flash"
      resolveGeminiModel()
    } catch (err) {
      obsoleteCaught15 = true
      obsoleteMsg15 = err.message
    }
    record(
      "Obsolete model 'gemini-1.5-flash' is rejected with clear error",
      obsoleteCaught15 && obsoleteMsg15.includes("obsolete or shut down"),
      `Did not catch expected error: ${obsoleteMsg15}`
    )

    // Test 1.4: Rejects obsolete gemini-1.5-pro and gemini-1.0
    let obsoleteCaughtPro = false
    try {
      process.env.GEMINI_MODEL = "gemini-1.5-pro"
      resolveGeminiModel()
    } catch (err) {
      obsoleteCaughtPro = err.message.includes("obsolete or shut down")
    }
    record(
      "Obsolete model 'gemini-1.5-pro' is rejected",
      obsoleteCaughtPro
    )

    // Test 1.5: Rejects invalid model identifiers
    let invalidCaught = false
    try {
      process.env.GEMINI_MODEL = "not-a-gemini-model"
      resolveGeminiModel()
    } catch (err) {
      invalidCaught = err.message.includes("Invalid Gemini model configuration")
    }
    record(
      "Malformed model identifier throws safe validation error",
      invalidCaught
    )

    // -----------------------------------------------------------------
    // Suite 2: Endpoint Construction & Request Privacy (store: false)
    // -----------------------------------------------------------------
    console.log("\n--- 2. REST Endpoint Construction & Request Privacy ---")
    delete process.env.GEMINI_MODEL

    let capturedUrl = null
    let capturedBody = null
    let capturedHeaders = null

    const mockHttpClientCapture = async (url, data, headers) => {
      capturedUrl = url
      capturedBody = data
      capturedHeaders = headers
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      name: "Enterprise Solutions",
                      category: "Sales & Inquiries",
                      confidenceScore: 0.95,
                      primaryKeywords: ["enterprise", "customization"],
                      synonyms: ["b2b solutions"],
                      customerQuestions: ["Do you offer SLA?"],
                      productTerminology: ["Enterprise Tier"],
                      discussionPoints: ["Discuss dedicated hosting"],
                      relatedProductNames: ["Cloud Suite"],
                      contributingSourceTitles: ["Enterprise FAQ"],
                    },
                  ]),
                },
              ],
            },
          },
        ],
      }
    }

    const dummyProfile = { businessName: "Acme SaaS", industry: "Cloud Tech" }
    const dummyProducts = [{ _id: "prod-123", name: "Cloud Suite", type: "PRODUCT" }]
    const dummySources = [{ _id: "src-456", title: "Enterprise FAQ", sourceType: "MANUAL", status: "COMPLETED", extractedText: "Enterprise SLAs available" }]

    await generateGeminiTopics({
      apiKey: "test-gemini-api-key-9999",
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockHttpClientCapture,
    })

    // Test 2.1: Endpoint matches expected Google REST GenerateContent format
    const expectedEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`
    record(
      "GenerateContent endpoint uses configured model and v1beta path",
      capturedUrl === expectedEndpoint,
      `Expected ${expectedEndpoint}, got ${capturedUrl}`
    )

    // Test 2.2: API key is passed in header, NOT in query parameter
    const urlObj = new URL(capturedUrl)
    const keyInQuery = urlObj.searchParams.has("key")
    const keyInHeader = capturedHeaders && capturedHeaders["x-goog-api-key"] === "test-gemini-api-key-9999"
    record(
      "API key passed via 'x-goog-api-key' header and omitted from URL query string",
      !keyInQuery && keyInHeader,
      `Key in query: ${keyInQuery}, Key in header: ${keyInHeader}`
    )

    // Test 2.3: store: false is present in request body
    record(
      "Request body explicitly includes 'store: false' for request-level logging control",
      capturedBody && capturedBody.store === false,
      `Body store property: ${capturedBody?.store}`
    )

    // Test 2.4: Gemini 3.8 unsupported sampling parameters are absent
    const genConfig = capturedBody?.generationConfig || {}
    const hasTemperature = "temperature" in genConfig || "temperature" in capturedBody
    record(
      "Sampling parameter 'temperature' is absent from Gemini request",
      !hasTemperature,
      `Found temperature: ${genConfig.temperature}`
    )

    const hasTopP = "top_p" in genConfig || "topP" in genConfig || "top_p" in capturedBody || "topP" in capturedBody
    record(
      "Sampling parameter 'top_p' / 'topP' is absent from Gemini request",
      !hasTopP,
      `Found top_p in config: ${JSON.stringify(genConfig)}`
    )

    const hasTopK = "top_k" in genConfig || "topK" in genConfig || "top_k" in capturedBody || "topK" in capturedBody
    record(
      "Sampling parameter 'top_k' / 'topK' is absent from Gemini request",
      !hasTopK,
      `Found top_k in config: ${JSON.stringify(genConfig)}`
    )

    const hasCandidateCount = "candidate_count" in genConfig || "candidateCount" in genConfig || "candidate_count" in capturedBody || "candidateCount" in capturedBody
    record(
      "Parameter 'candidate_count' / 'candidateCount' is absent from Gemini request",
      !hasCandidateCount,
      `Found candidate_count in config: ${JSON.stringify(genConfig)}`
    )

    // Test 2.5: Supported output configuration is present
    record(
      "generationConfig specifies responseMimeType 'application/json' and maxOutputTokens",
      genConfig.responseMimeType === "application/json" && typeof genConfig.maxOutputTokens === "number",
      `generationConfig: ${JSON.stringify(genConfig)}`
    )

    // -----------------------------------------------------------------
    // Suite 3: API Key & Secret Sanitization
    // -----------------------------------------------------------------
    console.log("\n--- 3. Error & Secret Sanitization ---")

    const sampleErrorWithKey = "Request failed for key=AIzaSyA1234567890abcdefghijklmnopqrstuv: forbidden"
    const sanitizedError = sanitizeErrorMessage(sampleErrorWithKey)
    record(
      "sanitizeErrorMessage redacts AIza API key",
      !sanitizedError.includes("AIzaSyA1234567890abcdefghijklmnopqrstuv") && sanitizedError.includes("[REDACTED"),
      `Sanitized output: ${sanitizedError}`
    )

    const sampleHeaderLeak = "Network failure while sending x-goog-api-key: AIzaSyA1234567890abcdefghijklmnopqrstuv"
    const sanitizedHeader = sanitizeErrorMessage(sampleHeaderLeak)
    record(
      "sanitizeErrorMessage redacts 'x-goog-api-key' header values",
      !sanitizedHeader.includes("AIzaSyA1234567890abcdefghijklmnopqrstuv"),
      `Sanitized output: ${sanitizedHeader}`
    )

    // Test error redaction when httpClient throws error with secret
    const leakingHttpClient = async () => {
      throw new Error("HTTP 403: Invalid request for key=AIzaSyA1234567890abcdefghijklmnopqrstuv")
    }

    let caughtLeakingErr = ""
    try {
      await generateGeminiTopics({
        apiKey: "AIzaSyA1234567890abcdefghijklmnopqrstuv",
        profile: dummyProfile,
        httpClient: leakingHttpClient,
      })
    } catch (err) {
      caughtLeakingErr = err.message
    }
    record(
      "generateGeminiTopics sanitizes transport errors containing secrets",
      !caughtLeakingErr.includes("AIzaSyA1234567890abcdefghijklmnopqrstuv") && caughtLeakingErr.includes("[REDACTED]"),
      `Caught message: ${caughtLeakingErr}`
    )

    // -----------------------------------------------------------------
    // Suite 4: Response Parsing & Grounding Alignment
    // -----------------------------------------------------------------
    console.log("\n--- 4. Response Parsing & Grounding References ---")

    const mockResponseMarkdownWrapped = async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: "```json\n" + JSON.stringify([
                  {
                    name: "Cloud Suite Consultation",
                    category: "Consultation & Services",
                    confidenceScore: 0.92,
                    primaryKeywords: ["cloud suite", "deployment"],
                    synonyms: ["cloud setup"],
                    customerQuestions: ["How long does cloud deployment take?"],
                    productTerminology: ["Deployment Guide"],
                    discussionPoints: ["Walk through setup stages"],
                    relatedProductNames: ["Cloud Suite"],
                    contributingSourceTitles: ["Enterprise FAQ"],
                  },
                ]) + "\n```",
              },
            ],
          },
        },
      ],
    })

    const parsedTopics = await generateGeminiTopics({
      apiKey: "test-key",
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockResponseMarkdownWrapped,
    })

    record(
      "Handles markdown fenced json (```json ... ```) and extracts array",
      Array.isArray(parsedTopics) && parsedTopics.length === 1,
      `Parsed: ${JSON.stringify(parsedTopics)}`
    )

    record(
      "Maps relatedProductNames to matching product ObjectId/string",
      parsedTopics[0].relatedProductIds.includes("prod-123"),
      `relatedProductIds: ${JSON.stringify(parsedTopics[0]?.relatedProductIds)}`
    )

    record(
      "Maps contributingSourceTitles to sourceReferences with sourceId",
      parsedTopics[0].sourceReferences.some((s) => s.sourceId === "src-456"),
      `sourceReferences: ${JSON.stringify(parsedTopics[0]?.sourceReferences)}`
    )

    // -----------------------------------------------------------------
    // Suite 5: Fallback Preservation Across Failure Scenarios
    // -----------------------------------------------------------------
    console.log("\n--- 5. Deterministic Fallback Across Failure Scenarios ---")

    // 5.1: Missing API key -> deterministic fallback
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_API_KEY
    process.env.AI_PROVIDER = "gemini"

    const fallbackNoKey = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
    })
    record(
      "Missing API key gracefully falls back to 'deterministic-nlp'",
      fallbackNoKey.provider === "deterministic-nlp" && fallbackNoKey.topics.length > 0,
      `Provider: ${fallbackNoKey.provider}, count: ${fallbackNoKey.topics.length}`
    )

    // 5.2: Invalid API key (HTTP 403 mock) -> deterministic fallback
    process.env.GEMINI_API_KEY = "invalid-dummy-key"
    const mockHttpError = async () => {
      throw new Error("HTTP 403: API_KEY_INVALID: API key not valid. Please pass a valid API key.")
    }

    const fallbackInvalidKey = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockHttpError,
    })
    record(
      "Invalid API key (HTTP error) gracefully falls back to 'deterministic-nlp'",
      fallbackInvalidKey.provider === "deterministic-nlp" && fallbackInvalidKey.topics.length > 0,
      `Provider: ${fallbackInvalidKey.provider}`
    )

    // 5.3: Unsupported/obsolete model configured -> deterministic fallback
    process.env.GEMINI_MODEL = "gemini-1.5-flash"
    const fallbackObsolete = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockHttpClientCapture,
    })
    record(
      "Unsupported/obsolete model triggers safe fallback to 'deterministic-nlp'",
      fallbackObsolete.provider === "deterministic-nlp" && fallbackObsolete.topics.length > 0,
      `Provider: ${fallbackObsolete.provider}`
    )
    delete process.env.GEMINI_MODEL

    // 5.4: Request timeout / network error -> deterministic fallback
    const mockTimeout = async () => {
      throw new Error("AI Provider request timed out after 30 seconds")
    }
    const fallbackTimeout = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockTimeout,
    })
    record(
      "Request timeout gracefully falls back to 'deterministic-nlp'",
      fallbackTimeout.provider === "deterministic-nlp" && fallbackTimeout.topics.length > 0,
      `Provider: ${fallbackTimeout.provider}`
    )

    // 5.5: Malformed JSON from Gemini -> deterministic fallback
    const mockMalformedJson = async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: "This is not valid json at all!" }],
          },
        },
      ],
    })
    const fallbackMalformed = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockMalformedJson,
    })
    record(
      "Malformed JSON response gracefully falls back to 'deterministic-nlp'",
      fallbackMalformed.provider === "deterministic-nlp" && fallbackMalformed.topics.length > 0,
      `Provider: ${fallbackMalformed.provider}`
    )

    // 5.6: Empty Gemini response -> deterministic fallback
    const mockEmptyCandidates = async () => ({
      candidates: [],
    })
    const fallbackEmpty = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockEmptyCandidates,
    })
    record(
      "Empty Gemini candidates response gracefully falls back to 'deterministic-nlp'",
      fallbackEmpty.provider === "deterministic-nlp" && fallbackEmpty.topics.length > 0,
      `Provider: ${fallbackEmpty.provider}`
    )

    // 5.7: Successful Gemini call returns provider: "gemini" and model
    const successResult = await generateKeywordsAndTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: dummySources,
      httpClient: mockHttpClientCapture,
    })
    record(
      "Successful Gemini execution returns provider 'gemini' and model 'gemini-3.8-flash'",
      successResult.provider === "gemini" && successResult.model === "gemini-3.8-flash" && successResult.topics.length > 0,
      `Result: provider=${successResult.provider}, model=${successResult.model}`
    )

    // -----------------------------------------------------------------
    // Suite 6: Grounding & Inactive Knowledge Source Exclusion
    // -----------------------------------------------------------------
    console.log("\n--- 6. Knowledge Grounding Rules ---")

    const mixedSources = [
      { _id: "s1", title: "Valid Return Policy", sourceType: "MANUAL", status: "COMPLETED", extractedText: "30-day return policy" },
      { _id: "s2", title: "Unprocessed Draft", sourceType: "FILE", status: "PENDING", extractedText: "Leaked secret internal note" },
      { _id: "s3", title: "Corrupt Upload", sourceType: "FILE", status: "FAILED", extractedText: "Broken raw buffer" },
    ]

    const groundingContext = buildGroundingContext({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: mixedSources,
    })

    record(
      "Grounding context includes COMPLETED knowledge sources",
      groundingContext.includes("Valid Return Policy") && groundingContext.includes("30-day return policy"),
      "COMPLETED source missing from grounding context"
    )

    record(
      "Grounding context excludes PENDING or FAILED knowledge sources",
      !groundingContext.includes("Unprocessed Draft") && !groundingContext.includes("Corrupt Upload"),
      "Draft/Failed source leaked into grounding context"
    )

    const deterministicTopics = generateDeterministicTopics({
      profile: dummyProfile,
      products: dummyProducts,
      knowledgeSources: mixedSources,
    })

    const hasAllFields = deterministicTopics.every((t) =>
      t.name &&
      t.category &&
      typeof t.confidenceScore === "number" &&
      Array.isArray(t.primaryKeywords) &&
      Array.isArray(t.synonyms) &&
      Array.isArray(t.customerQuestions) &&
      Array.isArray(t.productTerminology) &&
      Array.isArray(t.discussionPoints) &&
      Array.isArray(t.relatedProductIds) &&
      Array.isArray(t.sourceReferences)
    )
    record(
      "Deterministic topics strictly adhere to all 10 topic schema properties",
      hasAllFields && deterministicTopics.length >= 2,
      `Sample topic keys: ${Object.keys(deterministicTopics[0] || {}).join(", ")}`
    )

  } finally {
    // Restore environment
    process.env = originalEnv
  }

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  console.log("\n=======================================================")
  console.log(`   TEST RESULTS: ${passed}/${total} PASSED (${failed} FAILED)`)
  console.log("=======================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runGeminiProviderTests().catch((err) => {
  console.error("Unhandled test runner exception:", err)
  process.exit(1)
})
