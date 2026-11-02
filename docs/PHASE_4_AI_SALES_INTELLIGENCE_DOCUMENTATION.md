# Leads-365 CRM — Phase 4: AI Sales Performance, Coaching & Business Intelligence Documentation

## 1. Executive Summary & Architecture Overview

Phase 4 bridges Phase 3 AI Call Intelligence and core CRM pipeline execution. It transforms conversation analytics into actionable sales coaching, transparent agent scorecards, customer objection distributions, catalog interest trends, explainable lead prioritization, and proactive manager alerts.

```text
       Phase 3: Completed AICallAnalysis & Grounded AITranscript
                                  │
                                  ▼
                Asynchronous Pipeline Hook (Non-Blocking)
              aiCallProcessingPipeline.js (Step 8 Trigger)
                                  │
         ┌────────────────────────┴────────────────────────┐
         │                                                 │
         ▼                                                 ▼
1. AI Sales Coaching Engine                       2. AI Lead Priority Engine
   aiSalesCoaching.service.js                        aiLeadPriority.service.js
   • 7 Measurable Dimensions                         • Commercial Intent Scoring
   • Grounded Transcript Quotes                      • Overdue Follow-up Detection
   • Actionable Recommendations                      • Explainable Factual Factors
         │                                                 │
         ▼                                                 ▼
3. Manager Alert Center                           4. AI Lead Priority Record
   AIManagerRecommendation                           AILeadPriority
   • HIGH_INTENT_FOLLOWUP                            • Status: PENDING / ACCEPTED
   • CALLBACK_REQUESTED                              • Preserves CRM Lead Stage
   • REPEATED_OBJECTION                              • Explicit Human-in-the-Loop
   • Idempotent Deduplication                              │
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  │
                                  ▼
5. Agent Scorecards & Business Intelligence Aggregation
   • aiSalesScorecard.service.js (Enforces Sample Size >= 3 Threshold)
   • aiBusinessInsights.service.js (MongoDB Aggregation Pipelines)
   • Strict Closed-Won Conversion Tracking (No False Positives)
                                  │
                                  ▼
6. Manager 1-on-1 Coaching Workflow & Frontend Dashboard
   • /dashboard/ai-sales-intelligence (Executive KPIs & Analytics)
   • /dashboard/ai-sales-intelligence/agents (Agent Scorecards)
   • /dashboard/ai-sales-intelligence/coaching (1-on-1 Reviews & Action Items)
   • /dashboard/ai-sales-intelligence/recommendations (Manager Alert Center)
   • /dashboard/ai-sales-intelligence/lead-priorities (Prioritization Hub)
```

---

## 2. Core Data Models

### 2.1 AIAgentScorecard (`backend/models/AIAgentScorecard.js`)
Stores aggregated evaluation metrics per sales agent for a specified period.
- **Tenant Isolation**: Mandatory `tenantId` field with compound index `{ tenantId: 1, agentId: 1, periodStart: 1, periodEnd: 1 }`.
- **7 Measurable Dimensions**:
  1. `requirementDiscovery` (0–100): Evidence-backed discovery questions and customer requirement scoping.
  2. `productKnowledge` (0–100): Relevant approved catalog features accurately presented.
  3. `objectionHandling` (0–100): Customer objections surfaced and resolved constructively.
  4. `communicationClarity` (0–100): Active listening, concise explanations, and professional tone.
  5. `nextStepDiscipline` (0–100): Follow-up or next meeting scheduled with date/time commitments.
  6. `customerEngagement` (0–100): Customer participation and conversation rapport.
  7. `conversionRate` (0–100%): Verified CRM `Closed-Won` leads attributed to the agent.
- **Sample Coverage Integrity**:
  - `sampleSize`: Total completed calls evaluated.
  - `sampleCoverage`: `"SUFFICIENT"` when `sampleSize >= 3`; `"INSUFFICIENT_SAMPLE"` when `sampleSize < 3`.
  - When `sampleSize < 3`, `overallScore` remains strictly `null` (never fabricated or arbitrarily assumed as 0 or 100).

### 2.2 AILeadPriority (`backend/models/AILeadPriority.js`)
Represents explainable commercial priority signals for CRM leads.
- **Priority Categories**: `HIGH_INTENT`, `NEEDS_FOLLOWUP`, `AT_RISK`, `MEDIUM_INTENT`, `LOW_INTENT`, `INSUFFICIENT_DATA`.
- **Explainability**:
  - `commercialIntentScore` (0–100).
  - `reason`: Grounded summary explaining the assigned category.
  - `factors`: Array of `{ factor, detail, quote }` with grounded quotes from actual call transcripts.
  - `recommendedAction`: Concrete next step for the sales representative.
- **Human-in-the-Loop Safe Mutation**:
  - `userAction.status`: `PENDING`, `ACCEPTED`, `DISMISSED`.
  - Accepting a recommendation creates audit history and updates internal state without mutating CRM lead stage or assigned agent without explicit user confirmation.

### 2.3 AIManagerRecommendation (`backend/models/AIManagerRecommendation.js`)
Proactive management alerts for customer risks, buyer intent, and operational coaching opportunities.
- **Alert Types**:
  - `HIGH_INTENT_FOLLOWUP`: Buyer expressed strong purchase readiness.
  - `CALLBACK_REQUESTED`: Buyer explicitly requested a callback at a specific time.
  - `REPEATED_OBJECTION`: Customer raised multiple unhandled pricing/contract objections.
  - `UNRESOLVED_REQUIREMENT`: Important customer technical requirement remained unaddressed.
  - `AT_RISK_OVERDUE`: High-intent lead has an overdue CRM follow-up touchpoint.
  - `TOPIC_COVERAGE_GAP`: Agent repeatedly failed to discuss approved product knowledge.
  - `AGENT_COACHING_REVIEW`: Coaching review recommended based on scorecard trends.
- **Lifecycle Statuses**: `NEW`, `VIEWED`, `ACCEPTED`, `DISMISSED`, `RESOLVED`.
- **Idempotency**: Unique compound index `{ tenantId: 1, idempotencyKey: 1 }` prevents duplicate alerts for the same underlying call or overdue event.

### 2.4 AICoachingReview (`backend/models/AICoachingReview.js`)
Formal 1-on-1 manager-agent coaching records.
- **Fields**: `agentId`, `managerId`, `callId`, `managerNotes`, `actionItems` (`[{ item, completed }]`), `strengths`, `areasForImprovement`, `status` (`DRAFT`, `DISCUSSED`, `ACTION_COMPLETED`).
- **Permissions**: Manager/Admin authored; regular agents can view their own reviews but cannot alter manager notes.

---

## 3. Strict Metric Definitions & Data Accuracy

| Metric | Source Field | Calculation Method | Exclusion Rules |
|---|---|---|---|
| **Total Analyzed Calls** | `AICallAnalysis` | `count(canonical=true, status="COMPLETED")` | Incomplete or failed analyses, older versions of reprocessed calls |
| **Qualified / Interested Calls** | `AICallAnalysis` | `count(callOutcome IN ["INTERESTED", "DEAL_CLOSED"])` | Calls where outcome is `NOT_INTERESTED`, `WRONG_NUMBER`, or `UNRESOLVED` |
| **Converted Leads** | CRM `Lead` | `count(status="Closed-Won")` | AI interest does NOT equal converted. Only leads with verified CRM `Closed-Won` stage |
| **Lost Opportunities** | CRM `Lead` | `count(status="Closed-Lost")` | Only leads with confirmed CRM `Closed-Lost` stage |
| **Follow-ups Required** | `AICallAnalysis` | `count(callOutcome IN ["FOLLOW_UP_REQUIRED", "CALL_BACK_LATER"])` | Closed or non-interested calls |
| **High-Intent Leads** | `AILeadPriority` | `count(priority="HIGH_INTENT")` | Low or medium intent leads |
| **Average Call Duration** | CRM `Call` | `avg(durationSeconds)` | Calls missing duration data |
| **Follow-up Completion Rate** | CRM `FollowUp` | `(completedFollowUps / totalFollowUps) * 100` | Excludes deleted or cancelled tasks |

---

## 4. API Reference

All routes are mounted at `/api/ai-sales-intelligence` and enforce authentication, tenant isolation, and RBAC:

### 4.1 Analytics & Business Intelligence
- `GET /api/ai-sales-intelligence/dashboard`
  - Query params: `dateFrom`, `dateTo`, `agentId`, `callOutcome`, `approvedTopic`.
  - Returns executive KPIs, conversion funnel, call outcomes, sentiment breakdown, customer objections, and product interest.
- `GET /api/ai-sales-intelligence/topics`
  - Returns discussion frequency and knowledge coverage strictly for Admin-Approved Phase 2 topics.

### 4.2 Agent Scorecards
- `GET /api/ai-sales-intelligence/scorecards`
  - Query params: `page`, `limit`, `dateFrom`, `dateTo`.
  - Lists all tenant agents with sample size, coverage badge, 7 dimension scores, and CRM conversion rate.
- `GET /api/ai-sales-intelligence/scorecards/:agentId`
  - Retrieves detailed scorecard and historical call breakdown for an individual agent.
- `POST /api/ai-sales-intelligence/scorecards/:agentId/recompute`
  - Enforces Manager/Admin authorization. Recomputes scorecard over recent calls and updates cache.

### 4.3 AI Sales Coaching Engine
- `GET /api/ai-sales-intelligence/coaching/:callId`
  - Returns grounded coaching insights for a completed call, including dimension scores, strengths with quotes/timestamps, improvement areas, suggested objection responses, and recommended training topics.
  - Short/unverified calls safely return `NOT_ENOUGH_EVIDENCE`.

### 4.4 Lead Prioritization Hub
- `GET /api/ai-sales-intelligence/lead-priorities`
  - Query params: `priority`, `status`, `page`, `limit`.
  - Returns explainable priority signals with grounded transcript evidence.
- `POST /api/ai-sales-intelligence/lead-priorities/:leadId/evaluate`
  - Triggers on-demand priority evaluation for a specific lead.
- `POST /api/ai-sales-intelligence/lead-priorities/:leadId/accept`
  - Records user acceptance with optional notes without mutating CRM status automatically.
- `POST /api/ai-sales-intelligence/lead-priorities/:leadId/dismiss`
  - Records dismissal feedback.

### 4.5 Manager Alert Center
- `GET /api/ai-sales-intelligence/recommendations`
  - Query params: `status`, `priority`, `type`, `page`, `limit`.
  - Enforces Manager/Admin role. Returns proactive alerts with idempotency keys and evidence.
- `PATCH /api/ai-sales-intelligence/recommendations/:id/status`
  - Payload: `{ status, managerNotes }`. Transitions alert status (`VIEWED`, `ACCEPTED`, `DISMISSED`, `RESOLVED`).

### 4.6 1-on-1 Coaching Reviews
- `GET /api/ai-sales-intelligence/coaching-reviews`
  - Lists formal 1-on-1 coaching records.
- `POST /api/ai-sales-intelligence/coaching-reviews`
  - Enforces Manager/Admin role. Payload: `{ agentId, callId, managerNotes, actionItems, strengths, areasForImprovement, status }`.
- `PATCH /api/ai-sales-intelligence/coaching-reviews/:id/complete`
  - Marks an agreed action plan as `ACTION_COMPLETED`.

---

## 5. Security, Tenant Isolation & RBAC

1. **Multi-Tenant Isolation**:
   - Every database query strictly injects `tenantId: req.tenantId`.
   - Automated tests confirm that Tenant B cannot access Tenant A's scorecards, alerts, lead priorities, or analytics.
2. **Role-Based Access Control**:
   - `account_admin`, `admin`, `manager`, `super_admin`, `superadmin`: Full access to executive analytics, agent scorecards, manager alerts, and coaching review authoring.
   - `agent`: Access to personal performance scorecards and assigned lead priorities; restricted from manager recommendation centers and other agents' private records.
3. **Data Privacy & Zero Text in Audit Logs**:
   - Transcript contents and sensitive audio are excluded from application logs and audit metadata.

---

## 6. Testing & Validation

The Phase 4 test suite runs without external live API dependency, ensuring 100% deterministic local verification:

```bash
# Run Phase 4 Verification Suite (52/52 Tests Pass)
node backend/tests/verifyPhase4AISalesIntelligence.js

# Run Prior Phase Regressions
node backend/tests/verifyPhase3AICallIntelligence.js
node backend/tests/verifyPhase2AIKeywords.js
node backend/tests/verifyPhase1AIKnowledge.js
node backend/tests/verifyGeminiProvider.js

# Frontend Lint and Build
cd frontend
npm run lint
npm run build
```

---

## 7. Known Limitations & Safe Boundaries

1. **Sample Size Constraint**: Scorecards require a minimum of 3 completed calls (`sampleSize >= 3`) before computing an overall rating. For agents with fewer than 3 calls, scores are marked `INSUFFICIENT_SAMPLE` and remain `null` to avoid misleading ratings.
2. **Human-in-the-Loop Safe Guard**: AI recommendations never automatically change CRM lead stages, pipeline phases, or agent assignments without explicit user action.
3. **Topic Matching**: Only topics approved via the Phase 2 approval lifecycle are tracked; unapproved/draft topics are strictly excluded from business intelligence analytics.
