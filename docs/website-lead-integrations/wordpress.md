# WordPress Website Lead Integration Guide

This guide details how to install, configure, and use the official **Leads365 CRM Integration WordPress Plugin** to automatically and securely transmit website enquiries into your Leads-365 CRM tenant.

---

## 1. Overview & Architecture

The official Leads365 WordPress plugin uses a **secure server-to-server relay architecture**:

```
[Website Visitor] 
       │ Submits form (Shortcode, Elementor, or CF7)
       ▼
[WordPress Server (wp_remote_post)]
       │ Attaches Private API Key (X-API-Key)
       │ Signs payload with HMAC-SHA256 (X-Signature-256)
       │ Adds timestamp & idempotency UUID (X-Idempotency-Key)
       ▼
[Leads-365 CRM Backend (POST /api/integrations/leads/website)]
       │ Verifies credential, timestamp, and HMAC signature
       │ Applies tenant duplicate handling policy (reject / update / allow)
       ▼
[CRM Tenant Database & Lead Dashboard]
```

### Key Security Benefits
- **Zero Browser Credential Exposure:** Private API keys (`lf_live_...`) are stored in WordPress server-side options and never printed in frontend HTML, scripts, or public REST endpoints.
- **HMAC Request Signing:** Prevents MITM tampering and guarantees payload authenticity.
- **Anti-Bot Honeypot:** Built-in hidden honeypot (`_hp_trap`) silently rejects automated spam bots without annoying human CAPTCHAs.
- **Marketing Attribution:** Automatically captures UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`), `landingPage`, and `referrer`.

---

## 2. Plugin Installation & Activation

### Method 1: Upload via WordPress Admin (Recommended)
1. Download the distributable plugin package:
   `docs/website-lead-integrations/wordpress-plugin/leads365-integration.zip`
2. In your WordPress Admin dashboard, navigate to **Plugins → Add New Plugin**.
3. Click **Upload Plugin** at the top of the page.
4. Select `leads365-integration.zip` and click **Install Now**.
5. Click **Activate Plugin**.

### Method 2: Manual FTP / SSH Upload
1. Extract the `leads365-integration` folder from the ZIP file.
2. Upload the folder to your WordPress site's directory:
   `/wp-content/plugins/leads365-integration/`
3. In WordPress Admin, go to **Plugins → Installed Plugins** and click **Activate** under **Leads365 CRM Integration**.

---

## 3. Configuration & CRM Connectivity Setup

1. In your WordPress Admin sidebar, click on the **Leads365** menu.
2. Configure the following settings:
   - **Leads365 API Endpoint URL:**
     `https://your-crm-domain.com/api/integrations/leads/website`
   - **Private Integration API Key:**
     Enter your Private API Key (`lf_live_...`) obtained from your Leads365 CRM dashboard (**Settings → Lead Feeds → Website Integrations**).
   - **Default Lead Source:**
     Label to identify submissions in CRM (e.g. `WordPress`, `Corporate Website`).
   - **Default Campaign Name (Optional):**
     Fallback campaign name if no `utm_campaign` is detected in the visitor's URL.
   - **HTTP Timeout:**
     Default 15 seconds (configurable up to 60s).
3. Click **Save Configuration**.
4. Click the **Test Connection** button.
   - The plugin dispatches a secure test verification ping to the CRM endpoint.
   - A green confirmation box confirms: *"Connection verified successfully! Leads365 CRM endpoint is reachable and your API Key is authenticated."*

---

## 4. Universal Form Integrations

### A. Native Shortcode: `[leads365_form]`
Embed our responsive, styled, anti-spam form anywhere on your site (posts, pages, elementor shortcode blocks, or sidebars):

```
[leads365_form]
```

#### Shortcode Attributes:
- `title`: Form header title (default: *"Request a Callback"*).
- `subtitle`: Form subheader description.
- `button_text`: Submit button label (default: *"Submit Enquiry"*).
- `source`: Custom lead source tag for this specific form.
- `form_id`: Custom form identifier.

Example with custom attributes:
```
[leads365_form title="Get a Free Estimate" button_text="Claim Free Quote" source="Pricing Page Quote Form"]
```

### B. Elementor Pro Forms Integration
If your website uses **Elementor Pro Forms**, the plugin automatically captures submissions via the official `elementor_pro/forms/new_record` hook:
1. Open your page in the Elementor Editor and select your Form widget.
2. For each field, open **Advanced** and ensure the **ID** matches standard names:
   - Name: `name` or `full_name`
   - Email: `email`
   - Phone: `phone` or `tel`
   - Message: `message`
3. Optional anti-spam honeypot: Add a hidden field with ID `_hp_trap` (leave value empty).
4. Submissions are automatically forwarded to Leads365 CRM without disrupting your existing Elementor email notifications or webhook actions.

### C. Contact Form 7 (CF7) Integration
If your website uses **Contact Form 7**, validated submissions are automatically captured via the official `wpcf7_mail_sent` hook:
1. Standard CF7 tags are mapped automatically:
   - `[text* your-name]` → Name
   - `[email* your-email]` → Email
   - `[tel* your-phone]` → Phone
   - `[textarea your-message]` → Message
2. Optional honeypot: Add hidden field `[text _hp_trap class:hidden]` to your form code.
3. The plugin includes request-level deduplication to prevent duplicate leads if multiple hooks fire.

---

## 5. Field Mapping & Custom Fields

The plugin maps incoming form fields into standard Leads365 CRM schema:

| Form Field ID / Name | Leads365 CRM Target |
|---|---|
| `name`, `full_name`, `your-name`, `first-name` + `last-name` | `lead.name` |
| `email`, `your-email`, `email_address` | `lead.email` |
| `phone`, `your-phone`, `tel`, `mobile` | `lead.phone` (normalized) |
| `message`, `your-message`, `comments` | `lead.message` |
| `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `fbclid` | `lead.attribution.firstTouch` & `lastTouch` |
| Additional custom inputs (e.g. `company`, `budget`, `city`) | `lead.customFields[key]` |

---

## 6. Verifying Ingested Leads in Leads365 CRM

1. Log into your Leads-365 CRM account.
2. Navigate to **Leads**.
3. Confirm that new submissions appear immediately with:
   - Source: `WordPress` (or your configured custom source)
   - Contact details (Name, Phone, Email, Requirement)
   - First-touch and last-touch marketing attribution
   - Form identifier (e.g. `cf7_105`, `elementor_contact_form`, `leads365_shortcode_form`)

---

## 7. Troubleshooting & Error Codes

| Status Code | Description | Cause & Solution |
|---|---|---|
| **401 Unauthorized** | Invalid or Revoked API Key | Verify your Private API Key in **Leads365 Settings**. Ensure you are using the Private Key (`lf_live_...`), not the public Site Key (`lf_site_...`). |
| **403 Forbidden** | Account Suspended / Denied | Ensure your Leads365 tenant account is active. Check with your CRM administrator. |
| **409 Conflict** | Duplicate Enquiry | The lead already exists in your CRM and the tenant duplicate policy is set to `reject`. If you want repeat enquiries to update the lead, change the duplicate policy to `update` in Leads365 Integration Studio. |
| **429 Too Many Requests** | Rate Limit Reached | The IP address exceeded the rate limit (60 requests/minute). Wait 60 seconds before submitting again. |
| **500 / Network Error** | Connection Timeout | Check that the Leads365 API Endpoint URL is correct and reachable from your WordPress web hosting server. Increase the HTTP Timeout in plugin settings if your CRM is behind a proxy. |
