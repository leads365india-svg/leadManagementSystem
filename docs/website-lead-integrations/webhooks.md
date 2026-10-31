# Third-Party Webhook Integration Guide

This guide covers connecting automation platforms (Zapier, Make.com, n8n, Pabbly Connect) and custom enterprise backends to **Leads-365 CRM** via REST Webhooks.

---

## 1. Webhook Specifications

- **Endpoint URL:** `POST https://your-crm-domain.com/api/integrations/leads/website`
- **Supported Content Types:**
  - `application/json` (Recommended)
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
- **Rate Limit:** 60 requests per minute per IP address.
- **Payload Size Limit:** 2MB per request (event ledger archives up to 64KB per submission).

---

## 2. Authentication Options

| Auth Type | Header | Example |
|---|---|---|
| **API Key Header** | `X-API-Key` | `X-API-Key: lf_live_...` |
| **Bearer Token** | `Authorization` | `Authorization: Bearer lf_live_...` |
| **Public Site Key** | `X-Site-Key` | `X-Site-Key: lf_site_...` (requires authorized Origin header) |

---

## 3. Recommended Headers

- `X-Idempotency-Key`: A unique UUID or timestamped ID. If a network retry occurs with the same key, the CRM returns the existing lead without creating duplicate records.
- `X-Signature-256`: Hexadecimal HMAC-SHA256 of the raw payload using your API key as the shared secret.
- `X-Timestamp`: Epoch timestamp in milliseconds. Requests older than 5 minutes are rejected for replay prevention.

---

## 4. Standard Payload Schema

```json
{
  "name": "David Wallace",
  "email": "david.wallace@dundermifflin.com",
  "phone": "+1-212-555-0143",
  "company": "Dunder Mifflin Paper Co.",
  "message": "Looking to upgrade our northeast branch CRM licenses",
  "source": "Partner Portal Webhook",
  "formId": "enterprise_rfp",
  "landingPage": "https://partner.example.com/rfp",
  "utm_source": "linkedin",
  "utm_medium": "cpc",
  "utm_campaign": "q4_enterprise_promo"
}
```

---

## 5. cURL Example

```bash
curl -X POST "https://your-crm-domain.com/api/integrations/leads/website" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lf_live_YOUR_PRIVATE_API_KEY" \
  -H "X-Idempotency-Key: idemp_1730355600_abcd1234" \
  -d '{
    "name": "Sarah Connor",
    "email": "sarah@example.com",
    "phone": "+1-555-0199",
    "company": "Cyberdyne Systems",
    "message": "Immediate consultation request",
    "source": "Custom Webhook"
  }'
```

---

## 6. HTTP Response Codes

| Status Code | Meaning | Description |
|---|---|---|
| **201 Created** | Lead Created | New lead record saved and assigned. |
| **200 OK** | Lead Updated / Idempotent | Duplicate lead updated or existing lead returned idempotently. |
| **400 Bad Request** | Validation Failure | Missing required fields, invalid email format, or honeypot triggered. |
| **401 Unauthorized** | Auth Failure | Invalid/revoked API key, missing credentials, bad HMAC, or expired timestamp. |
| **403 Forbidden** | Origin / Account Blocked | Origin header not in allowlist, or account suspended. |
| **409 Conflict** | Duplicate Rejected | Lead already exists and duplicate handling policy is `reject`. |
| **422 Unprocessable** | Policy Rejected | Blocked email domain or unaccepted form ID. |

