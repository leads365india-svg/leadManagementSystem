=== Leads365 CRM Integration ===
Contributors: leads365
Donate link: https://leads365.in
Tags: leads, crm, elementor, contact form 7, forms, webhooks
Requires at least: 5.6
Tested up to: 6.7
Stable tag: 1.0.0
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html

Official WordPress plugin to securely connect website form enquiries to Leads365 CRM with zero credential exposure.

== Description ==

The **Leads365 CRM Integration** plugin allows WordPress administrators to capture website lead enquiries and transmit them directly and securely to their Leads365 CRM tenant.

Unlike browser-side scripts that expose private credentials or rely on insecure CORS configurations, Leads365 uses a **secure server-to-server relay architecture**:
1. Website visitors submit forms normally to your WordPress website.
2. The WordPress server authenticates the payload using your **Private API Key** and signs the request with an **HMAC-SHA256 signature**.
3. Leads are ingested immediately into your assigned CRM tenant partition with full marketing attribution (UTM parameters, landing page, and referrer).

### Features
* **Zero Credential Exposure:** Private API keys are stored server-side in WordPress options and never printed in frontend HTML, scripts, or public REST endpoints.
* **Universal Form Support:**
  * **Native Shortcode:** Use `[leads365_form]` to render a modern, responsive, honeypot-protected lead capture form anywhere on your site.
  * **Elementor Pro Forms:** Automatic lead capture for Elementor form widgets without extra webhook setup.
  * **Contact Form 7:** Automatic lead capture from validated CF7 submissions with multi-hook deduplication.
  * **WPForms / Custom Forms:** Extensible via clean WordPress action hooks.
* **Anti-Spam Protection:** Built-in honeypot verification silently discards automated spam bot submissions.
* **Marketing Attribution:** Preserves first-touch and multi-touch attribution (utm_source, utm_medium, utm_campaign, gclid, fbclid, landing page).
* **Connection Tester:** Verify CRM connectivity directly from the WordPress admin dashboard with one click.

== Installation ==

1. Download `leads365-integration.zip`.
2. In your WordPress Admin, go to **Plugins → Add New → Upload Plugin**.
3. Choose `leads365-integration.zip` and click **Install Now**.
4. Click **Activate Plugin**.
5. Navigate to **Leads365** in the left WordPress menu.
6. Enter your **Leads365 API Endpoint URL** and **Private Integration API Key** (`lf_live_...`).
7. Click **Save Configuration**, then click **Test Connection** to verify.

== Frequently Asked Questions ==

= Where do I find my Leads365 Private API Key? =
In your Leads365 CRM dashboard, go to **Settings → Lead Feeds → Website Integrations**. Select your website integration to view your Private API Key (`lf_live_...`).

= Does this plugin work without Elementor or CF7? =
Yes! You can use the built-in `[leads365_form]` shortcode on any post, page, or widget area. If Elementor or Contact Form 7 are not installed, the plugin operates without any errors.

= How are duplicate enquiries handled? =
Leads365 CRM enforces your tenant's configured duplicate handling policy (`reject`, `update`, or `allow`). If set to `update`, repeat enquiries from the same customer will enrich the existing lead with additional notes rather than creating duplicate records.

== Changelog ==

= 1.0.0 =
* Initial official release.
* Added native `[leads365_form]` shortcode with anti-spam honeypot and client-side validation.
* Added Elementor Pro form integration (`elementor_pro/forms/new_record`).
* Added Contact Form 7 integration (`wpcf7_mail_sent`).
* Added server-to-server HMAC-SHA256 signing, timestamp replay prevention, and idempotency headers.
* Added WordPress Admin Settings dashboard and one-click connection tester.
