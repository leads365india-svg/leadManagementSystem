# Leads-365 CRM — Website Integrations Release Checklist
## Production Go-Live & Deployment Operational Manual

**Release Phase:** Phase 8 Final Go-Live Preparation  
**System Target:** `D:\LEADS\Leads-365`  
**Overall Go-Live Decision:** **CONDITIONAL GO**  
*(Core engine, multi-tenant security, and code deliverables are production-ready; external WordPress and Shopify dev store accounts require final customer configuration before live webhooks flow).*

---

## 1. Pre-Deployment Verification Checklist

| Check Item | Requirement | Verification Method | Status |
|---|---|---|:---:|
| **API Authentication** | Separate Site Key (public) & API Key (private) paths | `backend/services/integrationService.js` | PASS |
| **Origin Allowlist** | Strict W3C origin normalization and wildcard matching | `backend/utils/originValidator.js` | PASS |
| **HMAC Signatures** | Cryptographic HMAC-SHA256 verification of raw bodies | `backend/services/shopifyService.js` & route handlers | PASS |
| **Replay Protection** | 5-minute request timestamp validation window | `backend/services/integrationService.js` | PASS |
| **Anti-Bot Honeypot** | Trap fields (`_hp_trap`) silently reject bots (HTTP 400) | Ingestion pipeline check | PASS |
| **Idempotency** | Atomic reservation and concurrency locking | `idempotencyService.js` & `leadConcurrencyService.js` | PASS |
| **Tenant Isolation** | Ambient AsyncLocalStorage Mongoose plugin enforcement | `tenantIsolationPlugin.js` query hooks | PASS |
| **Secret Redaction** | No credentials in client bundles, event ledgers, or logs | Client code inspection & audit logs | PASS |
| **WordPress ZIP** | Clean installable archive without private keys | `leads365-integration.zip` integrity check | PASS |
| **Build Integrity** | All 16 backend integration modules load cleanly | Node module resolution | PASS |
| **Frontend UI** | Integration Studio and Custom Fields UI operational | Live dev server HTTP 200 checks | PASS |

---

## 2. Environment Configuration Specifications

> [!CAUTION]
> **Database Safety Notice:** The configured database points to a **shared Cloud Atlas MongoDB cluster** (`*.mongodb.net`). It is classified as **NOT VERIFIED / SHARED CLUSTER**. Zero database writes, migrations, or schema deletions should ever be performed as part of automated CI verification.

### Required Backend Environment Variables
*(Documented by purpose; secret values are omitted)*

| Variable Name | Purpose & Security Constraint | Sensitivity Level |
|---|---|---|
| `PORT` | Local port for Express API server (default: `5000`) | Non-sensitive |
| `NODE_ENV` | Runtime mode (`production`, `staging`, `development`) | Non-sensitive |
| `MONGODB_URI` | MongoDB Atlas cluster connection string with SSL | **CRITICAL SECRET** |
| `FRONTEND_URL` | Comma-separated allowlist of authorized frontend origins | Configuration |
| `JWT_SECRET` | Secret key for signing CRM user sessions | **CRITICAL SECRET** |
| `INTEGRATION_KEY_SALT` | Cryptographic salt for API key hashing | **CRITICAL SECRET** |
| `ENCRYPTION_KEY` | 32-byte AES-256-GCM master encryption key for credentials | **CRITICAL SECRET** |
| `SHOPIFY_API_KEY` | *(Optional)* Shopify App client API key for live stores | Confidential |
| `SHOPIFY_WEBHOOK_SECRET` | *(Optional)* Shopify shared app secret for live webhooks | **CRITICAL SECRET** |

### Required Frontend Environment Variables

| Variable Name | Purpose & Security Constraint | Sensitivity Level |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL for CRM backend (e.g. `https://crm.yourcompany.com`) | Public URL |
| *(Client Bundles)* | **NEVER** prefix private integration keys with `NEXT_PUBLIC_` | Security Invariant |

---

## 3. Safe Deployment Sequence

1. **Phase 1: Environment Preparation**
   - Configure secrets in the production hosting vault (e.g. AWS Secrets Manager, Vercel Environment Variables, or Railway).
   - Ensure `ENCRYPTION_KEY` (32 bytes hex) and `INTEGRATION_KEY_SALT` are securely generated and set.
2. **Phase 2: Backend Service Deployment**
   - Deploy backend Node.js service using `npm start` (`node start.js`).
   - Run health check: `GET /api/health` → verify `status: "healthy"`, `database: "connected"`.
3. **Phase 3: Frontend Deployment**
   - Build frontend production bundle: `npm run build` in `frontend/`.
   - Deploy frontend and verify that `/settings/lead-feeds` and `/settings/custom-fields` load cleanly.
4. **Phase 4: Domain Allowlisting**
   - In CRM **Integration Studio**, add the production website domain (e.g. `https://example.com`) to **Allowed Origins**.
5. **Phase 5: Client Platform Installation**
   - **Plain HTML / React:** Embed public Site Key (`lf_site_...`) and webhook URL in website forms.
   - **Next.js:** Set `LEADS365_API_KEY` in server `.env.local` (server-side Route Handler).
   - **WordPress:** Upload and activate `leads365-integration.zip` on WordPress admin. Enter private API key in settings.
   - **Shopify:** Register webhook URL `https://crm.yourcompany.com/api/integrations/webhooks/shopify` under Shopify Admin Notifications.

---

## 4. External Configuration Requirements (Remaining Setup)

Before live production data can flow from WordPress and Shopify, customer administrators must complete:

1. **WordPress Live Site Setup:**
   - Host must have PHP >= 7.4 installed.
   - Install and activate `leads365-integration.zip`.
   - In WordPress Admin -> **Leads365**, paste the integration API key generated in CRM Integration Studio.
   - If using Elementor Pro, set form action to **Leads365 Integration**.
2. **Shopify Store Webhook Setup:**
   - In Shopify Partner Dashboard or Admin -> **Settings -> Notifications -> Webhooks**, register webhook topic: `Customer creation` (`customers/create`).
   - Set callback URL to: `https://crm.yourcompany.com/api/integrations/webhooks/shopify`.
   - Copy Shopify Webhook Shared Secret into the Leads365 CRM Shopify integration settings.

---

## 5. Rollback Plan

If unexpected issues arise during deployment:
1. **Frontend Rollback:** Revert frontend to previous stable deployment on CDN/Vercel.
2. **Backend Rollback:** In-place rollback of backend container/process. No database schema migrations were applied; therefore, data rollback is zero-risk.
3. **Ingestion Fallback:** External forms continue queuing submissions; idempotency keys ensure retries do not generate duplicate records upon backend restart.
