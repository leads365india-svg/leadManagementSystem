# Shopify Webhook Lead Integration Guide

This guide details how to securely connect **Shopify Stores** to **Leads-365 CRM** to automatically ingest new customers, checkouts, and orders as verified CRM leads.

---

## 1. Overview & Architecture

Leads-365 provides a native, highly secure webhook receiver designed specifically for Shopify's webhook delivery architecture:

- **Endpoint URL:** `POST https://your-crm-domain.com/api/integrations/webhooks/shopify`
- **Authentication:** Shopify HMAC-SHA256 signature verification over exact raw request body.
- **Tenant Isolation:** Automatically resolved from the registered `X-Shopify-Shop-Domain` header. Caller-supplied tenant identifiers are strictly ignored.
- **Deduplication:** Uses `X-Shopify-Webhook-Id` scoped to the store's integration identity to prevent duplicate processing during Shopify delivery retries.
- **Rate Limit:** Protected by integration rate limiting (60 req/min/IP).

---

## 2. Supported Shopify Webhook Topics

The integration listens to customer and checkout/order-related events:

| Topic | Trigger Event | CRM Action | Default Behavior |
|---|---|---|---|
| `customers/create` | New customer account created in Shopify | Create Lead | Captures name, email, phone, tags, customer note |
| `customers/update` | Customer information updated in Shopify | Merge / Update Lead | Enriches existing lead record based on duplicate policy |
| `orders/create` | New order placed | Create or Update Lead | Captures billing customer + order number, total price, currency |
| `orders/paid` | Order payment marked successful | Update Lead | Enriches lead status with payment confirmation note |
| `orders/fulfilled` | Order shipment fulfilled | Update Lead | Logs fulfillment update in lead notes |
| `checkouts/create` | Checkout initiated / abandoned | Create Lead | Captures high-intent prospect before purchase completion |
| `checkouts/update` | Checkout details updated | Update Lead | Updates cart value and contact details |
| Non-lead topics | App uninstall, inventory updates, etc. | Acknowledge | Returns HTTP 200 OK without creating unwanted CRM leads |

---

## 3. How to Connect a Shopify Store

### Step 1: Register Shopify Integration in Leads-365

Through the Leads-365 Integration Studio (or via API):

```bash
POST /api/integrations/shopify/connect
Content-Type: application/json
Authorization: Bearer <tenant_jwt_token>

{
  "shopDomain": "your-store.myshopify.com",
  "sharedSecret": "shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "My Shopify Store"
}
```

*Note: The `sharedSecret` is the **API Secret Key** found in your Shopify App Credentials.*

### Step 2: Configure Webhook in Shopify Admin

1. Log into your Shopify Store Admin (`https://admin.shopify.com/store/YOUR-STORE`).
2. Navigate to **Settings** > **Notifications** > scroll down to **Webhooks**.
3. Click **Create webhook**.
4. Configure the webhook settings:
   - **Event:** Select topic (e.g., `Customer creation`, `Order creation`, `Checkout creation`).
   - **Format:** `JSON`.
   - **URL:** `https://your-crm-domain.com/api/integrations/webhooks/shopify`
   - **Webhook API version:** Latest stable release (e.g. `2024-10`).
5. Save the webhook.

---

## 4. Security & Verification Details

Shopify signs every webhook request using HMAC-SHA256 with your app's client secret. Leads-365 performs rigorous verification:

1. **Exact Raw Body Preservation:** Express preserves raw bytes buffer (`req.rawBody`) before JSON parsing.
2. **Constant-Time Comparison:** Computed Base64 signature is compared with `X-Shopify-Hmac-Sha256` using `crypto.timingSafeEqual` to prevent timing attacks.
3. **Fail-Closed Security:** Unregistered stores, missing signatures, malformed Base64, or missing server-side secrets immediately reject the request with HTTP 401 or 404 without processing.
4. **Header Redaction:** Signatures and secrets are automatically redacted from CRM audit logs and `IntegrationEvent` persistence ledgers.

---

## 5. Duplicate Handling Policies

Shopify webhooks honor the tenant's duplicate lead policy:
- **`update` (Default):** Updates existing lead matching the customer's email or normalized phone number with new purchase data.
- **`reject`:** Silently acknowledges duplicate deliveries without modifying existing lead records.
- **`allow`:** Creates new lead entry while maintaining first-touch attribution integrity.
