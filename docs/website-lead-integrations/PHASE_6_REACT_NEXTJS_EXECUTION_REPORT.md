# LEADS365 – PHASE 6: REACT & NEXT.JS WEBSITE INTEGRATIONS REPORT
## Senior Full-Stack Engineer | One-Pass Implementation & Consolidated Validation

**Target Repository:** `D:\LEADS\Leads-365`  
**Date:** October 31, 2026  
**Status:** **100% Complete & Verified (25/25 Tests Passing)**

---

## 1. Executive Summary

Phase 6 introduces official, production-ready website integration modules for modern JavaScript/TypeScript frontends:
1. **React Integration (Vite / SPA)**: Browser-side client form with Public Site Key (`X-Site-Key`) authentication, domain allowlisting, anti-bot honeypots, automated UTM attribution extraction, and client-side duplicate prevention.
2. **Next.js Integration (App Router)**: Hybrid architecture routing browser form submissions through a Next.js Server Route Handler (`app/api/leads/route.js`) to the Leads365 CRM backend via private API Key (`X-API-Key`), HMAC-SHA256 request signing (`X-Signature-256`), request timestamps (`X-Timestamp`), and server-side idempotency.
3. **Integration Studio Updates**: Updated `frontend/app/settings/lead-feeds/lead-feeds-client.jsx` and `backend/controllers/integrationController.js` snippet generators to provide interactive, copyable React and Next.js integration templates with field-mapping guidance and security instructions.
4. **Custom Field Engine Compatibility**: Direct wiring into the Phase 5 custom field pipeline, ensuring custom properties reach `lead.metadata.customFields` while preserving standard field normalization and attribution.

---

## 2. Deliverables & Directory Structure

```
docs/website-lead-integrations/
├── examples/
│   ├── react/
│   │   ├── LeadEnquiryForm.jsx    # Accessible, responsive React form component with validation & states
│   │   ├── lead365.js             # Client-side SDK: UTM extraction, idempotency UUIDs, API communication
│   │   ├── form.css               # Premium CSS styles with responsive flex/grid and focus states
│   │   └── README.md              # Installation, quickstart, security & configuration manual
│   └── nextjs/
│       ├── app/
│       │   ├── api/
│       │   │   └── leads/
│       │   │       └── route.js   # Server Route Handler: HMAC signing, timestamp, timeout, validation
│       │   └── components/
│       │       └── LeadEnquiryForm.jsx # Client component posting to internal /api/leads endpoint
│       ├── .env.example           # Server-only environment variables (LEADS365_API_KEY, etc.)
│       └── README.md              # Next.js App Router integration manual & architecture guide
└── PHASE_6_REACT_NEXTJS_EXECUTION_REPORT.md # This comprehensive execution report
```

---

## 3. Architecture & Security Invariants

### 3.1 React Browser Integration Flow (Vite / SPA)
```
Browser Form (LeadEnquiryForm)
  │  Extracts UTMs & document.referrer
  │  Injects hidden honeypot (_hp_trap)
  │  Generates client idempotency key (UUIDv4)
  ▼
Direct fetch to Leads365 Webhook URL
  │  Header: X-Site-Key (Public identifier)
  │  Header: Origin (Browser-enforced)
  ▼
Leads365 Backend Ingestion
  ├── 1. Validates Origin against Allowed Origins list (403 if unauthorized)
  ├── 2. Inspects Honeypot (_hp_trap): Rejects bots with HTTP 400
  ├── 3. Maps Standard & Custom Fields (Phase 5 Engine)
  └── 4. Idempotent lead creation & Attribution Storage
```
- **Zero Secret Exposure**: The client bundle only contains the public Site Key (`site_...`). Private API keys (`lf_live_...`) are strictly excluded.
- **Allowed Origins Protection**: Unauthorized domains attempting to spoof or use the public site key are rejected with HTTP 403 Forbidden.
- **Double Submit Protection**: Component locks the submit button and uses client-side UUID idempotency keys to ensure network retries do not duplicate leads.

### 3.2 Next.js Server-to-Server Flow (App Router)
```
Browser Client Form
  │  Posts to internal Next.js Route: POST /api/leads
  ▼
Next.js Server Route Handler (app/api/leads/route.js)
  ├── 1. Reads LEADS365_API_KEY from process.env (Server-only, no NEXT_PUBLIC_ prefix)
  ├── 2. Validates inputs & checks honeypot (_hp_trap)
  ├── 3. Computes HMAC-SHA256 signature (X-Signature-256) over payload + timestamp
  ├── 4. Adds timestamp header (X-Timestamp) to prevent replay attacks
  ├── 5. Forwards client IP (x-forwarded-for) and Idempotency Key
  ├── 6. Implements 8000ms fetch timeout with AbortController
  ▼
Leads365 Backend Ingestion
  ├── 1. Validates API Key & HMAC signature
  ├── 2. Verifies timestamp is within 5-minute validity window
  ├── 3. Maps custom fields to lead.metadata.customFields
  └── 4. Returns 201 Created with sanitized client payload
```
- **Environment Isolation**: Private credentials (`LEADS365_API_KEY`) are kept strictly on the Node.js runtime. No `NEXT_PUBLIC_` prefixes are used.
- **Replay Protection**: The Leads365 backend verifies that `X-Timestamp` is within 300 seconds (5 minutes) of current server time.
- **HMAC Signing**: Payloads signed with the private key verify data integrity in transit.

---

## 4. Integration Studio UI Updates

In `frontend/app/settings/lead-feeds/lead-feeds-client.jsx` and `backend/controllers/integrationController.js`:
- **React Tab**:
  - Live copyable snippet using `lead365.js` and `LeadEnquiryForm.jsx`.
  - Prominent domain allowlisting banner emphasizing that browser submissions require configuring Allowed Origins.
  - Custom field mapping guidance for `budget`, `product_interest`, etc.
- **Next.js Tab**:
  - Dual snippet tabs: Server Route Handler (`app/api/leads/route.js`) and Client Form (`app/components/LeadEnquiryForm.jsx`).
  - `.env.local` configuration instructions highlighting private server keys.
  - HMAC signing and timeout handling documentation.
- **Preserved Existing Tabs**: Plain HTML, WordPress Plugin, Shopify Webhook tabs remain fully functional.

---

## 5. Consolidated Verification Test Results

Test suite: `backend/tests/verifyPhase6ReactNextjsIntegrations.js`

```
==================================================================
  LEADS365 - PHASE 6: REACT & NEXT.JS CONSOLIDATED VERIFICATION   
==================================================================

--- 1. Deliverable Artifact Structure Verification ---
  ✓ Test 1: React LeadEnquiryForm.jsx exists
  ✓ Test 2: React client SDK lead365.js exists
  ✓ Test 3: React form.css exists
  ✓ Test 4: React README.md guide exists
  ✓ Test 5: Next.js LeadEnquiryForm.jsx exists
  ✓ Test 6: Next.js App Router route.js exists
  ✓ Test 7: Next.js .env.example exists
  ✓ Test 8: Next.js README.md guide exists
  ✓ Test 9: React client deliverables do not bundle private API keys
  ✓ Test 10: Next.js environment configuration keeps private API key server-only (no NEXT_PUBLIC_ prefix)

--- 2. Setting Up Test Integration & Field Mappings ---
  ✓ Test 11: Integration created with Site Key & allowed origins

--- 3. React Browser Submission Flow (Public Site Key) ---
  ✓ Test 12: React browser intake with valid Site Key returns success: true
  ✓ Test 13: Standard field 'name' trimmed properly
  ✓ Test 14: Standard field 'email' lowercased properly
  ✓ Test 15: React custom fields (budget, product_interest) preserved in lead.metadata.customFields
  ✓ Test 16: React UTM attribution (utm_source, utm_campaign) stored in attribution.firstTouch
  ✓ Test 17: Requests from unauthorized origins fail allowlist check
  ✓ Test 18: React submission with honeypot trap populated is rejected with HTTP 400
  ✓ Test 19: React duplicate submission with same idempotency key handled safely without error

--- 4. Next.js Server-to-Server HMAC-Signed Flow ---
  ✓ Test 20: Next.js server intake with valid HMAC signature succeeds
  ✓ Test 21: Next.js lead name captured correctly
  ✓ Test 22: Next.js custom fields (budget, product_interest) preserved in lead.metadata.customFields
  ✓ Test 23: Tampered Next.js payload alters computed HMAC hash
  ✓ Test 24: Expired Next.js request timestamp (> 5 mins) detected
  ✓ Test 25: Tenant spoofing prevented: Lead assigned strictly to authenticated integration tenant

==================================================================
  PHASE 6 VERIFICATION COMPLETE: 25/25 PASSED
==================================================================
```

### Regression Verification of Previous Phases
- **Phase 5 (Custom Fields & Integration Studio)**: 23/23 PASSED (`verifyPhase5CustomFields.js`)
- **Phase 3B (HTML Website Live Integration)**: 15/15 PASSED (`verifyPhase3BHtmlIntegration.js`)

---

## 6. Strict Preservation & Boundary Checklist

| Constraint | Status | Notes |
| :--- | :---: | :--- |
| **Preserve Phase 0 - Phase 5** |  PASS | All security hardening, idempotency, Shopify, HTML, WordPress, and Custom Field features verified intact |
| **No Commit / Push / Deploy** |  PASS | No git commits, pushes, merges, or deployments performed |
| **No Production DB Writes** |  PASS | Used isolated test tenant ID (`tenant_phase6_test_...`) and cleaned up records |
| **No Schema Migrations** |  PASS | Used existing Mongoose models without index or schema alteration |
| **Do Not Modify `D:\LEADS-apk`** |  PASS | Zero modifications to Android repository |
| **No Private Key Leaks** |  PASS | Verified: Public Site Key for browser; Server-only API Key for Next.js |
