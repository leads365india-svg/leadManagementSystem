# WordPress Website Lead Integration Guide

This guide covers connecting any WordPress site (custom theme, Elementor, Contact Form 7, WPForms, or custom PHP) to **Leads-365 CRM**.

---

## 1. Prerequisites

1. Create a Website Integration in the Leads-365 CRM dashboard (**Settings → Lead Feeds → Website Integrations**).
2. Select **WordPress** as the platform type.
3. Note your generated credentials:
   - **Webhook URL:** `https://your-crm-domain.com/api/integrations/leads/website`
   - **Private API Key:** `lf_live_...`
   - **Public Site Key:** `lf_site_...`

---

## 2. Integration Method A: Elementor Forms (No Coding Required)

1. Open your page in the **Elementor Editor**.
2. Select your Contact Form widget.
3. In the left panel, expand **Actions After Submit**.
4. Add **Webhook** to the list of actions.
5. In the newly created **Webhook** section:
   - **Webhook URL:** `https://your-crm-domain.com/api/integrations/leads/website`
6. Expand **Advanced** for each form field and assign standardized IDs:
   - Name Field ID: `name`
   - Email Field ID: `email`
   - Phone Field ID: `phone`
   - Message Field ID: `message`
7. Add a hidden field for anti-spam:
   - Field Type: `Hidden`
   - Label/ID: `_hp_trap` (Leave value empty)
8. In the Webhook settings, under **Request Headers**, add:
   - Header Name: `X-API-Key`
   - Header Value: Your Private API Key (`lf_live_...`)
9. Click **Update** and publish your page.

---

## 3. Integration Method B: Contact Form 7 (CF7)

Add the following snippet to your child theme's `functions.php` file:

```php
<?php
/**
 * Leads-365 CRM - Contact Form 7 Integration Hook
 */
add_action('wpcf7_mail_sent', 'leads365_forward_cf7_lead');

function leads365_forward_cf7_lead($contact_form) {
    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;

    $posted_data = $submission->get_posted_data();

    // Check honeypot
    if (!empty($posted_data['_hp_trap'])) {
        return; // Bot detected, do not forward
    }

    $payload = array(
        'name'        => sanitize_text_field($posted_data['your-name'] ?? ''),
        'email'       => sanitize_email($posted_data['your-email'] ?? ''),
        'phone'       => sanitize_text_field($posted_data['your-phone'] ?? ''),
        'message'     => sanitize_textarea_field($posted_data['your-message'] ?? ''),
        'source'      => 'WordPress Contact Form 7',
        'landingPage' => esc_url_raw($_SERVER['HTTP_REFERER'] ?? ''),
        'formId'      => 'cf7_' . $contact_form->id()
    );

    $api_url = 'https://your-crm-domain.com/api/integrations/leads/website';
    $api_key = 'lf_live_YOUR_PRIVATE_API_KEY';

    wp_remote_post($api_url, array(
        'method'      => 'POST',
        'timeout'     => 15,
        'headers'     => array(
            'Content-Type' => 'application/json',
            'X-API-Key'    => $api_key
        ),
        'body'        => wp_json_encode($payload)
    ));
}
```

---

## 4. Integration Method C: WPForms Webhook Addon

1. In WordPress Admin, navigate to **WPForms → All Forms → Edit Form**.
2. Go to **Settings → Webhooks**.
3. Click **Add New Webhook**.
4. Configure:
   - **Request URL:** `https://your-crm-domain.com/api/integrations/leads/website`
   - **Request Method:** `POST`
   - **Request Format:** `JSON`
   - **Secret:** Leave blank or configure HMAC
   - **Headers:** Add Header `X-API-Key` with value `lf_live_...`
   - **Map Fields:**
     - `name` $\rightarrow$ Name Field
     - `email` $\rightarrow$ Email Field
     - `phone` $\rightarrow$ Phone Field
     - `message` $\rightarrow$ Message Field
5. Save form.

---

## 5. Integration Method D: Universal HTML Embed Script

For any WordPress page or block using custom HTML:

```html
<script 
  src="https://your-crm-domain.com/api/integrations/snippet.js" 
  data-site-key="lf_site_YOUR_PUBLIC_SITE_KEY" 
  async defer>
</script>
```
Place this script in your header or footer via a header/footer injection plugin. It automatically detects forms and forwards submissions with anti-spam protections.

