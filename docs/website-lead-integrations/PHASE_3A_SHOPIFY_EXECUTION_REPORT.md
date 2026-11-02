# LEADS365 — PHASE 3A: SHOPIFY WEBHOOK INTEGRATION EXECUTION REPORT
**Author:** Senior Backend Engineer  
**Target:** D:\LEADS\Leads-365  
**Scope:** One-Pass Implementation of Shopify Webhook Lead Ingestion, Verification, and Carry-Forward Phase 2 Corrections.

---

## 1. Executive Summary

Phase 3A implements native, verified Shopify webhook ingestion into Leads-365 CRM, enabling Shopify stores to securely transmit customer, checkout, and order events as CRM leads. The implementation strictly preserves existing website lead ingestion pipelines, applies all required security controls (exact raw-body HMAC-SHA256 Base64 verification, store-to-tenant resolution, and delivery deduplication), carries forward critical Phase 2 idempotency & distributed lock corrections, and runs clean across all regression suites without any production database mutations or Git commits.

---

## 2. Shopify Webhook Endpoint

- **Route:** `POST /api/integrations/webhooks/shopify`
- **Controller:** `backend/controllers/shopifyController.js` (`handleShopifyWebhook`)
- **Service:** `backend/services/shopifyService.js` (`processShopifyWebhook`)
- **Mount Path:** In `backend/routes/integrationRoutes.js`, mounted directly under `/webhooks/shopify` with `integrationLimiter` and raw body capture.
- **Management Endpoints:**
  - `POST /api/integrations/shopify/connect` — Secure registration of Shopify store domain and shared secret.
  - `GET /api/integrations/shopify/status` — Health and connection status of tenant's Shopify integration.

---

## 3. HMAC Verification Design & Raw Body Preservation

### Raw Body Preservation Order
Per the official Shopify Webhook documentation ([Shopify Webhook Verification Guide](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)), the webhook signature is calculated over the raw, unparsed request body bytes.
- Express body parsing in `backend/start.js` was enhanced with a `verify` callback:
  ```javascript
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length) {
        req.rawBody = buf;
      }
    },
  })
  ```
- This guarantees `req.rawBody` contains the exact Buffer received on the socket without breaking normal JSON body parsing or disrupting other endpoints.

### HMAC-SHA256 Verification Logic
1. **Header Inspection:** Reads `X-Shopify-Hmac-Sha256` header. If absent or empty, fails closed with HTTP 401.
2. **Buffer Preparation:** Reconstructs the raw body Buffer from `req.rawBody` or `Buffer.from(JSON.stringify(req.body))` if raw buffer is missing.
3. **Digest Computation:** Computes `crypto.createHmac("sha256", secret).update(rawBuffer).digest("base64")`.
4. **Constant-Time Comparison:** Converts computed and received Base64 strings to Buffers and verifies equality using `crypto.timingSafeEqual` with byte-length matching to eliminate timing attack vectors.
5. **Fail-Closed Guarantees:** Malformed Base64 signatures, signature length mismatches, tampered bodies, or missing server-side secrets immediately reject without executing lead logic or revealing details to the caller.

---

## 4. Store-to-Tenant Resolution & Anti-Spoofing

1. **Domain Validation:** Validates `X-Shopify-Shop-Domain` against a strict regex `^[a-zA-Z0-9][a-zA-Z0-9\\-]*\\.myshopify\\.com$` or standard hostname. Rejects malformed domains with HTTP 400.
2. **Server-Side Integration Lookup:** Queries the `Integration` collection matching:
   - `type: "shopify"`
   - `settings.shopifyShopDomain: normalizedDomain`
   - `status: "active"`
   Query uses `skipTenantFilter: true` strictly for resolution across partitioned tenants.
3. **Tenant Context Partitioning:** Derives `tenantId` exclusively from `integration.tenantId`.
4. **Caller-Supplied Tenant Protection:** Any `tenantId` field provided in the payload body or arbitrary request headers is completely ignored. The lead is created strictly inside the authenticated tenant's partition.

---

## 5. Webhook Delivery Deduplication

1. **Delivery Identifier:** Reads `X-Shopify-Webhook-Id` (Shopify's unique per-delivery identifier).
2. **Scoping:** Scopes delivery deduplication to `${tenantId}:${integrationId}:${webhookId}` via `IdempotencyReservation`.
3. **Multi-Instance Safe:** Atomic reservation insertion guarantees that concurrent duplicate deliveries across distributed cluster workers will only allow one worker to proceed; the concurrent duplicate waits or returns cached response.
4. **Idempotent Acknowledgment:** Already completed deliveries return HTTP 200 with `{ success: true, idempotent: true }` without repeating lead creation, assignment, notification, or audit side effects.
5. **Topic Separation:** Does not conflate `X-Shopify-Webhook-Id` with `X-Shopify-Event-Id`, allowing separate subscriptions to process independently.

---

## 6. Supported Topics and Lead Field Mapping

| Shopify Topic | CRM Action | Extraction & Field Mappings |
|---|---|---|
| `customers/create`, `customers/update` | Create / Merge Lead | `first_name` + `last_name` -> `name`<br/>`email` -> normalized `email`<br/>`phone` / `default_address.phone` -> normalized `phone`<br/>`tags` + `note` -> `tags`, `message`<br/>Source metadata: `source: "Shopify"`, `subSource: "customers"` |
| `orders/create`, `orders/paid`, `orders/fulfilled` | Create / Merge Lead | Billing/Customer info -> `name`, `email`, `phone`<br/>`total_price`, `currency`, `order_number` -> formatted inquiry message<br/>Source metadata: `source: "Shopify"`, `subSource: "orders"`, `externalId: order.id` |
| `checkouts/create`, `checkouts/update` | Create / Merge Lead | Abandoned/initiated checkout customer data -> `name`, `email`, `phone`<br/>Cart total -> lead inquiry value |
| Non-lead topics (e.g. `app/uninstalled`) | Acknowledge Only | Safely returns HTTP 200 without creating unneeded lead records |

---

## 7. Carry-Forward Phase 2 Corrections

### Idempotency Reservation Scoping
- **Before:** Key was `${tenantId}:${sha256(idempotencyKey)}`.
- **After:** Key is `${tenantId}:${integrationId}:${sha256(idempotencyKey)}`.
- **Result:** Two distinct integrations under the same tenant can use identical idempotency keys (e.g. order IDs or UUIDs) without colliding.
- **Replay & 409 Integrity:** Same-key + same-payload returns cached response; same-key + different-payload returns HTTP 409 Conflict. Backward compatibility with legacy reservations is preserved.

### Distributed Lock Lease Renewal & Fencing
- **Fencing:** Every acquired lock generates a unique cryptographically secure `ownerToken` (`crypto.randomUUID()`). Releasing a lock requires matching both `_id` and `ownerToken`, preventing an expired former owner from releasing or overwriting a lock acquired by a newer owner.
- **Active Heartbeat Lease Renewal:** An active heartbeat timer runs every 3 seconds (`unref()`'d to prevent process hangs) while the worker is holding the lock, continually renewing `expiresAt` by 15 seconds. Long-running operations exceeding the default 12-second lease never lose their lock while executing.

---

## 8. Configuration Required for a Real Shopify Store

To connect a production Shopify store:
1. **Create Shopify Custom/Public App:**
   - Go to Shopify Partner Dashboard or Store Admin > **Apps and sales channels** > **Develop apps**.
   - Create an app and configure webhook subscriptions (`customers/create`, `orders/create`).
   - Copy the app's **API Secret Key** (used as `shopifySharedSecret`).
2. **Register in Leads-365:**
   - Execute `POST /api/integrations/shopify/connect` with:
     ```json
     {
       "shopDomain": "your-store.myshopify.com",
       "sharedSecret": "<SHOPIFY_API_SECRET_KEY>",
       "name": "Production Store"
     }
     ```
3. **Webhook Callback URL in Shopify:**
   - Set callback URL to: `https://<leads365-domain>/api/integrations/webhooks/shopify`
   - Select Event Topics: `Customer creation`, `Order creation`, `Checkout creation`.
   - Format: `JSON`.

---

## 9. Verification & Test Results

### Test Suite Execution Summary

| Test Suite | File | Tests Run | Passed | Failed | Status |
|---|---|---|---|---|---|
| **Phase 3A Shopify Webhook** | `backend/tests/verifyPhase3AShopifyWebhook.js` | 15 | 15 | 0 | **PASS** |
| **Phase 1 Security Hardening** | `backend/tests/verifyPhase1SecurityHardening.js` | 21 | 21 | 0 | **PASS** |
| **Phase 22 Website Snippet** | `backend/tests/verifyPhase22WebsiteSnippet.js` | 23 | 23 | 0 | **PASS** |
| **Phase 2 Deduplication** | `backend/tests/verifyPhase2Deduplication.js` | 12 | 12 | 0 | **PASS** |
| **Total Automated Tests** | — | **71** | **71** | **0** | **100% PASS** |

### Phase 3A Test Breakdown
- **Test 1:** Valid raw-body HMAC-SHA256 signature accepted & creates lead. *(PASS)*
- **Test 2:** Invalid HMAC signature rejected with HTTP 401. *(PASS)*
- **Test 3:** Missing `X-Shopify-Hmac-Sha256` header rejected with HTTP 401. *(PASS)*
- **Test 4:** Tampered body with original HMAC signature rejected. *(PASS)*
- **Test 5:** Malformed Base64 signature rejected without crash. *(PASS)*
- **Test 6:** Missing server-side secret fails closed with HTTP 401. *(PASS)*
- **Test 7:** Valid registered Shopify domain resolves correct tenant & maps source. *(PASS)*
- **Test 8:** Unknown Shopify domain rejected with HTTP 404. *(PASS)*
- **Test 9:** Caller-supplied tenant ID ignored; tenant partition derived from integration. *(PASS)*
- **Test 10:** Repeated `X-Shopify-Webhook-Id` delivery deduplicated & cached. *(PASS)*
- **Test 11:** Concurrent duplicate deliveries create exactly one lead. *(PASS)*
- **Test 12:** Two integrations in one tenant independently use same idempotency key. *(PASS)*
- **Test 13:** Long-running lock renews lease via heartbeat and enforces owner fencing. *(PASS)*
- **Test 14:** Duplicate policy ('update') updates existing lead on subsequent Shopify orders. *(PASS)*
- **Test 15:** Existing website API integrations remain fully functional. *(PASS)*

---

## 10. Exact Modified and New Files

### Modified Files (Tracked)
1. `backend/controllers/integrationController.js` — Enhanced with integrationId tracking in idempotency.
2. `backend/middleware/rateLimiters.js` — Maintained rate limiter isolation.
3. `backend/models/Integration.js` — Added `"shopify"` integration type, `shopifyShopDomain`, and `shopifySharedSecret`.
4. `backend/models/IntegrationEvent.js` — Added redaction for `x-shopify-hmac-sha256` and all signature/hmac headers.
5. `backend/routes/integrationRoutes.js` — Mounted Shopify webhook and connection endpoints.
6. `backend/services/integrationService.js` — Scoped idempotency claims to integration identity.
7. `backend/services/leadService.js` — Ensured duplicate policy enforcement across all sources.
8. `backend/start.js` — Configured rawBody capture in `express.json` verify callback and Shopify CORS headers.
9. `backend/tests/verifyPhase22WebsiteSnippet.js` — Maintained regression suite.
10. `backend/utils/originValidator.js` — Maintained origin validation invariants.
11. `docs/website-lead-integrations/README.md` — Added Shopify to documentation directory and architecture diagram.

### New Files Created
1. `backend/services/shopifyService.js` — Core Shopify webhook verification, topic mapping, and processing service.
2. `backend/controllers/shopifyController.js` — HTTP controllers for Shopify webhook intake and store connection.
3. `backend/models/IdempotencyReservation.js` — Multi-instance idempotency reservation model with integration scoping.
4. `backend/models/LeadConcurrencyLock.js` — Distributed lock model with lease renewal & ownerToken fencing.
5. `backend/services/idempotencyService.js` — Tenant + integration scoped idempotency engine.
6. `backend/services/leadConcurrencyService.js` — Identity locking engine with active heartbeat renewal and fencing.
7. `backend/tests/verifyPhase3AShopifyWebhook.js` — 15-test automated verification suite for Shopify integration.
8. `docs/website-lead-integrations/shopify.md` — Complete Shopify store setup and webhook guide.
9. `docs/website-lead-integrations/PHASE_3A_SHOPIFY_EXECUTION_REPORT.md` — This report.

---

## 11. Production & Operational Safety Confirmation

- **Production Database Connections / Writes:** CONFIRMED NONE (Zero production writes; automated tests ran against local test instance with automatic cleanup).
- **Manual Database Migrations or Index Changes:** CONFIRMED NONE.
- **Git Commits, Pushes, or Deployments:** CONFIRMED NONE.
- **PII or Secret Leakage:** CONFIRMED NONE (HMAC secrets, customer PII, and credentials strictly redacted from logs and events).
- **External Shopify Testing:** NOT TESTED against live external Shopify store (synthetic test payloads and generated HMAC keys utilized for automated local end-to-end verification).
