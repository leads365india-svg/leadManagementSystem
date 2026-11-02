# Plain HTML Lead Form Integration Guide

This guide describes how to embed and configure the complete standalone lead capture form on any static HTML, Jekyll, Hugo, GitHub Pages, or vanilla website to send verified leads directly into **Leads-365 CRM**.

---

## 1. Quick Start

The complete working HTML form is provided in [index.html](index.html).

### Steps to Deploy:
1. Open [index.html](index.html).
2. Locate the JavaScript configuration block near the bottom:
   ```javascript
   const DEFAULT_CONFIG = {
     apiEndpoint: "https://your-crm-domain.com/api/integrations/leads/website",
     siteKey: "lf_site_YOUR_ACTUAL_SITE_KEY",
   };
   ```
3. Replace `https://your-crm-domain.com` with your Leads-365 backend URL.
4. Replace `lf_site_YOUR_ACTUAL_SITE_KEY` with the public Site Key obtained from your Leads-365 Integration Studio.
5. Host `index.html` on your website server or web host (e.g. `https://www.example.com`).

---

## 2. Obtaining Your Site Key & Allowlisting Your Domain

Public website lead forms are authenticated by a **Public Site Key** coupled with **Origin Allowlisting**.

### Step 1: Open Integration Studio
1. Log into your Leads-365 CRM tenant account.
2. Go to **Settings** > **Lead Feeds** (or **Integration Studio**).
3. Find the **Website Lead Form** card or click **Add Website Integration**.

### Step 2: Copy the Public Site Key
- Look for the **Public Site Key** field (`lf_site_...`).
- *Important:* Never use your private API Key (`lf_live_...`) in client-side HTML or browser code.

### Step 3: Add Your Website to Allowed Origins
- In the **Allowed Origins** section, click **Add Origin**.
- Enter your exact website URL (including scheme and port if non-standard):
  - Example: `https://www.example.com`
  - Subdomain wildcard: `https://*.example.com`
  - Local development: `http://localhost:3000` or `http://localhost:8080`
- Click **Save Settings**.

> **Security Note:** If a form submission is sent from an unlisted domain or browser origin, the Leads-365 API rejects it with `HTTP 403 Forbidden` to prevent third-party origin spoofing or unauthorized submission spam.

---

## 3. Key Form Features & Implementation Details

### A. Anti-Spam Honeypot Trap
The form includes a hidden honeypot input field:
```html
<input 
  type="text" 
  name="_hp_trap" 
  id="_hp_trap" 
  style="display:none !important;" 
  tabindex="-1" 
  autocomplete="off" 
  aria-hidden="true" 
/>
```
Human visitors will not see or fill this field. Automated spam bots crawling HTML inputs will populate it, causing the CRM backend to reject the submission with `HTTP 400 Bad Request`.

### B. Automatic UTM & Attribution Tracking
The client script automatically captures UTM query parameters from the visitor's URL:
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `gclid` (Google Click ID)
- `fbclid` (Facebook Click ID)
- `landingPage` (Current URL)
- `referrer` (`document.referrer`)

These parameters are mapped directly into the lead record, preserving first-touch and multi-touch marketing attribution.

### C. Debouncing & Double-Click Prevention
During submission:
- The submit button is immediately disabled (`submitBtn.disabled = true;`).
- A loading spinner activates with *"Submitting Enquiry..."*.
- An `X-Idempotency-Key` header with a unique UUID is transmitted to ensure network retries do not create duplicate records.

### D. Clear HTTP Error Feedback
- **HTTP 403:** Alerts the visitor/webmaster that the current origin is not in the allowed origins list.
- **HTTP 409:** Informs the user that an enquiry with these contact details was already recorded.
- **HTTP 429:** Warns if rate limit (60 requests/minute/IP) has been exceeded.
- **HTTP 400:** Displays validation or missing field errors.

---

## 4. Live Testing in a Local Browser

You can test the form locally:
1. Start a local HTTP server serving the directory:
   ```bash
   npx serve docs/website-lead-integrations/examples/plain-html -p 8088
   ```
2. Open `http://localhost:8088` in your browser.
3. Pass your test Site Key dynamically via URL parameters without editing files:
   ```
   http://localhost:8088/?site_key=lf_site_YOUR_KEY&api_endpoint=http://localhost:5000/api/integrations/leads/website
   ```
4. Fill in the form and click **Submit Enquiry**.
5. Log into Leads-365 CRM to view your newly ingested lead in the **Leads** dashboard!
