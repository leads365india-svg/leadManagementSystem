# Leads365 CRM - Next.js App Router Integration Guide

This directory contains a complete, production-grade Next.js App Router integration that forwards website leads to Leads365 CRM using server-to-server HMAC-SHA256 authentication.

---

## 1. Architecture & Security Model

```text
Browser Client Form (`app/components/LeadEnquiryForm.jsx`)
  │ (Internal request: POST /api/leads)
  ▼
Next.js Route Handler (`app/api/leads/route.js`)
  │ - Reads private `LEADS365_API_KEY` from server process.env
  │ - Computes HMAC-SHA256 signature (`X-Signature-256`)
  │ - Injects request timestamp (`X-Timestamp`) & idempotency (`X-Idempotency-Key`)
  │ - Sanitizes and validates inputs
  ▼
Leads365 Integration Webhook (`/api/integrations/leads/website`)
  │
  ▼
CRM Lead Ingestion -> Field Mapping -> lead.metadata.customFields
```

### Essential Security Practices
1. **Server-Only Credentials:** The private integration key (`LEADS365_API_KEY`) is stored strictly on the server in `.env.local`. **NEVER** prefix it with `NEXT_PUBLIC_`.
2. **HMAC-SHA256 Cryptographic Signing:** Each outgoing server request computes an HMAC-SHA256 hash using the private integration key over the request body and attaches it via the `X-Signature-256` header.
3. **Replay & Timestamp Protection:** The `X-Timestamp` header guarantees requests expire within 5 minutes, preventing replay attacks.
4. **Idempotency Guarantee:** Every submission generates a unique `X-Idempotency-Key` to safely prevent duplicate records during network retries or timeouts.
5. **Clean Error Masks:** Internal CRM error codes or stack traces are never exposed to the client browser.

---

## 2. Directory Structure

```text
my-nextjs-app/
├── .env.local                                # Server-only credentials
├── app/
│   ├── api/
│   │   └── leads/
│   │       └── route.js                     # Secure App Router Route Handler
│   └── components/
│       └── LeadEnquiryForm.jsx              # Client-side form component
```

---

## 3. Quick Setup

### Step 1: Set Up Environment Variables
Create or update `.env.local` in your Next.js project root:
```bash
# Server-only credentials (Never expose to browser)
LEADS365_WEBHOOK_URL="https://crm.yourcompany.com/api/integrations/leads/website"
LEADS365_API_KEY="lf_live_your_private_api_key_here"
```

### Step 2: Render in Your Next.js Page
```jsx
// app/contact/page.jsx
import LeadEnquiryForm from '../components/LeadEnquiryForm';

export const metadata = {
  title: 'Contact Us | Enterprise Solutions',
  description: 'Submit an enquiry to our sales and engineering team.',
};

export default function ContactPage() {
  return (
    <main className="py-16 px-4 bg-slate-50 min-h-screen flex items-center justify-center">
      <LeadEnquiryForm
        source="Next.js Main Site"
        customFields={[
          {
            name: "product_interest",
            label: "Product of Interest",
            type: "dropdown",
            options: ["Enterprise Suite", "Growth Plan", "Custom API"],
            required: true
          },
          {
            name: "budget",
            label: "Estimated Budget ($)",
            type: "number",
            placeholder: "e.g. 50000",
            required: false
          }
        ]}
      />
    </main>
  );
}
```

---

## 4. Phase 5 Custom Field Mapping

Custom fields configured in Leads365 CRM under **Settings -> Custom Fields** (e.g., `product_interest`, `budget`) are automatically routed to `lead.metadata.customFields`:
- The client component bundles inputs under the `customFields` object.
- The server route forwards both the `customFields` map and top-level fields.
- Leads365 maps attributes according to the integration rules defined in Integration Studio.
