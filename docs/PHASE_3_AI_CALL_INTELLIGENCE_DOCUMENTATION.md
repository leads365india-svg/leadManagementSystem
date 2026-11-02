# Leads-365 CRM — Phase 3: AI Call Intelligence Documentation

## 1. Executive Summary & Architecture Overview

Phase 3 introduces an enterprise-grade, tenant-isolated AI Call Intelligence engine to the Leads-365 CRM platform. When phone calls are completed and audio recordings are stored in GridFS or remote CDN storage, the system asynchronously transcribes the conversation, semantically compares the discussion against Admin-Approved Phase 2 topics, and extracts grounded executive summaries, customer intent, objections, sentiment, and agreed next steps.

```text
       Completed CRM Phone Call
                  |
                  v
       Call Recording Stored (GridFS / ImageKit)
                  |
                  v
       Tenant & Recording Eligibility Check
                  |
                  v
       Idempotent Queue Job Dispatch (ai_call.process)
                  |
                  v
       Step 1: Speech-to-Text (STT) Engine (Gemini 3.8 Flash / Hindi-English Support)
                  |
                  v
       Step 2: AITranscript Persisted (Versioned & Grounded)
                  |
                  v
       Step 3: Load Approved Topics for Tenant Only (getApprovedTopicsForTenant)
                  |
                  v
       Step 4: Semantic Approved Topic Matching (Zero unapproved topic leaks)
                  |
                  v
       Step 5: AI Call Analysis Engine (Executive Summary, Tone, Key Moments)
                  |
                  v
       Step 6: AICallAnalysis Persisted & Versioned
                  |
                  v
       Step 7: AI Usage Ledger Tracked (Audit & Token Accounting)
                  |
                  v
       CRM AI Call Intelligence Report UI (/dashboard/ai-call-intelligence)
```

---

## 2. Processing Pipeline & Error Isolation

1. **Automatic Ingestion Hook**:
   - Integrated into `backend/services/recordingStorage.js` (`storeCallRecording`).
   - Dispatches `enqueueCallIntelligenceJob({ callId, tenantId })` asynchronously without blocking or failing the core recording upload.
2. **Step-Level Idempotency**:
   - If a call is reprocessed or duplicate webhooks trigger, existing `COMPLETED` transcripts are reused unless `force: true` or `forceNewTranscript: true` is explicitly provided.
   - Separate idempotency keys prevent duplicate ledger events (`stt_${callId}_v${version}` and `analysis_${callId}_v${version}`).
3. **Failure Boundary**:
   - If STT fails (e.g., audio download error or upstream provider timeout), `AITranscript` records status `FAILED` with sanitized safe error messages. Downstream analysis is skipped, preventing hallucinated summaries.
   - If analysis fails, the completed transcript remains intact and accessible.
   - Non-admin agents cannot trigger costly reprocessing; only Account Admins (`admin`, `superadmin`) can reprocess calls.

---

## 3. Data Models & Compound Indexes

### A. `AITranscript` (`backend/models/AITranscript.js`)
Stores speech-to-text outputs, timestamped segments, and language indicators.
- **Fields**:
  - `tenantId` (String, required, indexed)
  - `callId` (ObjectId, ref: 'Call', required)
  - `recordingReference` (`fileId`, `mp3FileId`, `sizeBytes`, `storageProvider`)
  - `recordingChecksum` (String)
  - `provider` (String, default: `'gemini'`)
  - `model` (String, default: `'gemini-3.8-flash'`)
  - `language` (String: `'hi'`, `'en'`, `'hi-en'`, `'auto'`, default: `'auto'`)
  - `transcriptText` (String)
  - `segments` (Array of `{ speaker, startTime, endTime, text }`)
  - `duration` (Number, seconds)
  - `status` (`'PENDING'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'`)
  - `version` (Number, default: 1)
  - `safeErrorMessage`, `errorCode`, timestamps
- **Indexes**:
  - `{ tenantId: 1, callId: 1, version: -1 }`
  - `{ tenantId: 1, status: 1 }`
  - `{ transcriptText: "text" }` with `{ default_language: "none", language_override: "none" }` to prevent MongoDB language stemming conflicts with custom language codes (e.g. `'hi-en'`).

### B. `AICallAnalysis` (`backend/models/AICallAnalysis.js`)
Stores grounded conversational insights, sentiment, and topic matches.
- **Fields**:
  - `tenantId`, `callId`, `transcriptId` (Refs)
  - `analysisVersion` (Number, default: 1)
  - `status` (`'PENDING'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'`)
  - `summary` (String, grounded executive overview)
  - `customerIntent` (String)
  - `customerNeeds`, `productInterests`, `objections`, `competitorMentions` (Array of Strings)
  - `sentiment` (`'POSITIVE'`, `'NEUTRAL'`, `'NEGATIVE'`, `'MIXED'`)
  - `sentimentScore` (Number, clamped between 0.10 and 0.95)
  - `callOutcome` (`'INTERESTED'`, `'NOT_INTERESTED'`, `'FOLLOW_UP_REQUIRED'`, `'CALL_BACK_LATER'`, `'DEAL_CLOSED'`, `'ESCALATED'`, `'WRONG_NUMBER'`, `'UNRESOLVED'`)
  - `keyMoments` (Array of `{ timestamp, description, quote }`)
  - `nextSteps`, `followUpRecommendations` (Array of Strings)
  - `topicMatches` (Array of `{ topicId, topicName, confidenceScore, evidence, timestamp }`)
  - `provider`, `model`, `usage` (`inputTokens`, `outputTokens`, `durationMs`)
- **Indexes**:
  - `{ tenantId: 1, callId: 1, analysisVersion: -1 }`
  - `{ tenantId: 1, status: 1 }`
  - `{ tenantId: 1, callOutcome: 1 }`
  - `{ tenantId: 1, sentiment: 1 }`

### C. `AIUsageLedger` (`backend/models/AIUsageLedger.js`)
Immutable operational accounting ledger for audit trails and billing tracking.
- **Fields**:
  - `tenantId`, `callId`
  - `processingType` (`'TRANSCRIPTION'`, `'ANALYSIS'`, `'TOPIC_MATCHING'`)
  - `provider`, `model`
  - `audioDurationSeconds` (Number)
  - `inputTokens`, `outputTokens` (Number or null when not returned by provider)
  - `durationMs` (Number, execution latency)
  - `status` (`'SUCCESS'`, `'FAILED'`)
  - `idempotencyKey` (String, unique index per tenant)
- **Indexes**:
  - `{ tenantId: 1, idempotencyKey: 1 }` (Unique)
  - `{ tenantId: 1, processingType: 1, createdAt: -1 }`

---

## 4. Semantic Approved Topic Matching (Phase 2 & 3 Contract)

Implemented in `backend/services/aiTopicMatcher.service.js`:
- **Strict Rule**: Uses `AIKeywordTopic.getApprovedTopicsForTenant(tenantId)`. Only topics with `status: "APPROVED"` are evaluated.
- **Zero Leaks**: Unapproved topics (`DRAFT`, `PENDING_APPROVAL`, `REJECTED`, `ARCHIVED`) and cross-tenant topics are strictly excluded from topic matching.
- **Grounded Evidence**: Every matched topic includes the exact quote from the transcript, confidence score, and start timestamp.

---

## 5. API Endpoints Reference

All endpoints are mounted at `/api/ai-calls` and require authentication.

| Method | Endpoint | Authorization | Description |
|---|---|---|---|
| `GET` | `/api/ai-calls/dashboard` | User / Admin | Aggregated KPI counts, outcome & sentiment distributions, and top matched topics |
| `GET` | `/api/ai-calls` | User / Admin | Paginated call listing with filtering by date, status, outcome, and topic |
| `GET` | `/api/ai-calls/:callId/status` | User / Admin | Real-time status of transcription, analysis, and queue jobs |
| `GET` | `/api/ai-calls/:callId/transcript` | User / Admin | Full transcript text, language, and speaker-labeled segments |
| `GET` | `/api/ai-calls/:callId/analysis` | User / Admin | Executive summary, intent, sentiment, key moments, and approved topic matches |
| `POST` | `/api/ai-calls/:callId/analyze` | User / Admin | Trigger initial AI analysis job for an eligible recorded call |
| `POST` | `/api/ai-calls/:callId/reprocess` | Admin Only | Force re-transcription and re-analysis of a recorded call |
| `GET` | `/api/ai-calls/usage` | Admin Only | Token accounting, audio duration totals, and ledger event statistics |

---

## 6. Provider Configuration & Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Primary Google Gemini API key for speech-to-text and call analysis | Optional (falls back to deterministic engine) |
| `GOOGLE_AI_API_KEY` | Secondary fallback Google Gemini API key | Optional |
| `GEMINI_MODEL` | Gemini model name | `gemini-3.8-flash` |

### Official Gemini 3.8 Parameter Standards
- Request header: `x-goog-api-key: <KEY>` (never passed in query strings).
- Request body includes `"store": false` for enterprise request logging privacy.
- Gemini 3.8 unsupported parameters (`temperature`, `top_p`, `top_k`, `candidate_count`) are completely omitted.
- `generationConfig` uses `maxOutputTokens: 4096` and `responseMimeType: "application/json"`.

---

## 7. Local Testing & Verification Commands

To run all automated verification suites locally:

```bash
# 1. Phase 3 AI Call Intelligence (51 tests)
node backend/tests/verifyPhase3AICallIntelligence.js

# 2. Phase 2 AI Keyword Generation & Approval Lifecycle (56 tests)
node backend/tests/verifyPhase2AIKeywords.js

# 3. Phase 1 AI Business Knowledge & Source Ingestion (32 tests)
node backend/tests/verifyPhase1AIKnowledge.js

# 4. Focused Gemini 3.8 Compatibility & Grounding Tests (29 tests)
node backend/tests/verifyGeminiProvider.js

# 5. Frontend ESLint Verification
npm --prefix frontend run lint

# 6. Frontend Production Build Verification
npm --prefix frontend run build
```
