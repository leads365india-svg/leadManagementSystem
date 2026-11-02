# Leads365 CRM - React & Vite Integration Guide

This directory contains a production-ready, client-side lead capture form component designed for React Single Page Applications (SPAs) built with Vite, Create React App, or Astro.

---

## 1. Architecture & Security Model

```text
Browser React Form
  │ (X-Site-Key: lf_site_..., Origin: https://yourdomain.com)
  ▼
Leads365 Integration API (`/api/integrations/leads/website`)
  │ (Validates Site Key + Allowed Origins)
  ▼
Field Mapping Engine -> Lead Ingestion -> lead.metadata.customFields
```

### Critical Security Rules
1. **Public Site Key Only:** Browser requests MUST authenticate using the public `X-Site-Key` header (`lf_site_...`).
2. **Never Expose Private API Keys:** Private integration API keys (`lf_live_...`) or HMAC secrets must **NEVER** be placed in React source code or `VITE_` frontend variables.
3. **Domain Allowlisting:** The domain hosting your React application must be registered in Leads365 Integration Studio under **Allowed Origins** (e.g. `https://yourcompany.com`). Requests from unauthorized origins are rejected with HTTP 403.
4. **Tenant ID Isolation:** The browser never specifies a `tenantId`. The backend securely resolves the tenant from the Site Key.

---

## 2. Quick Setup

### Step 1: Copy Files
Copy the files into your React project:
```text
src/
└── components/
    └── LeadEnquiryForm/
        ├── LeadEnquiryForm.jsx
        ├── lead365.js
        └── form.css
```

### Step 2: Configure Environment Variables
Create or update `.env` in your Vite project:
```bash
# Public Leads365 Configuration (Safe for client bundles)
VITE_LEADS365_SITE_KEY="lf_site_your_public_site_key_here"
VITE_LEADS365_WEBHOOK_URL="https://crm.yourcompany.com/api/integrations/leads/website"
```

### Step 3: Render the Component
```jsx
import React from 'react';
import LeadEnquiryForm from './components/LeadEnquiryForm/LeadEnquiryForm';

export default function ContactPage() {
  return (
    <div className="container mx-auto py-12">
      <LeadEnquiryForm
        source="Marketing Landing Page"
        customFields={[
          {
            name: "product_interest",
            label: "Product of Interest",
            type: "dropdown",
            options: ["Enterprise CRM", "Starter Suite", "Custom API"],
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
        onSuccess={(result) => {
          console.log("Lead captured with ID:", result.leadId);
        }}
        onError={(err) => {
          console.error("Submission failed:", err);
        }}
      />
    </div>
  );
}
```

---

## 3. Supported Features

- **UTM & Multi-Touch Attribution:** Automatically captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, and `fbclid` from the browser URL.
- **Submission Idempotency:** Generates a unique `X-Idempotency-Key` per attempt to safely prevent duplicate leads during network retries.
- **Anti-Bot Honeypot:** Contains an invisible `_hp_trap` field. Spambots filling this field are silently rejected.
- **Frontend Duplicate Prevention:** Disables the submit button and prevents multi-click submissions.
- **Phase 5 Custom Field Compatibility:** Dynamically forwards custom attributes to `lead.metadata.customFields`.
