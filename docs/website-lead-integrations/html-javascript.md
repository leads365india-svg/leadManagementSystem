# Static HTML / JavaScript Website Lead Integration

This guide provides a secure, lightweight implementation for static HTML and client-side JavaScript websites without backend servers.

---

## 1. Security Architecture

- **Public Site Key:** Uses `X-Site-Key: lf_site_...` in the request header.
- **Allowed Origins:** Only requests with an `Origin` matching the tenant's allowlist are accepted.
- **Anti-Bot Honeypot:** Hidden field `_hp_trap` catches automated spambots and silently rejects them with HTTP 400.
- **Submission Debounce:** Client-side button disabling prevents accidental double-clicks.
- **CORS Handling:** Server responds with `Access-Control-Allow-Origin` matching authorized domains.

---

## 2. Copyable HTML Form Markup

```html
<!-- Leads-365 HTML Lead Capture Form -->
<form id="leads365-contact-form" class="lead-form">
  <!-- Honeypot anti-spam field: Hidden from human users -->
  <input 
    type="text" 
    name="_hp_trap" 
    style="display:none !important;" 
    tabindex="-1" 
    autocomplete="off" 
    aria-hidden="true" 
  />

  <div class="form-group">
    <label for="name">Full Name *</label>
    <input type="text" id="name" name="name" placeholder="Sarah Connor" required />
  </div>

  <div class="form-group">
    <label for="email">Email Address</label>
    <input type="email" id="email" name="email" placeholder="sarah@example.com" />
  </div>

  <div class="form-group">
    <label for="phone">Phone Number *</label>
    <input type="tel" id="phone" name="phone" placeholder="+1-555-0199" required />
  </div>

  <div class="form-group">
    <label for="message">Message</label>
    <textarea id="message" name="message" rows="4" placeholder="How can our team help you?"></textarea>
  </div>

  <button type="submit" id="leads365-submit-btn">Send Enquiry</button>
  
  <div id="leads365-feedback" style="display:none; margin-top: 12px; padding: 10px; border-radius: 6px;"></div>
</form>
```

---

## 3. Client-Side JavaScript Handler

```javascript
<script>
document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('leads365-contact-form');
  const submitBtn = document.getElementById('leads365-submit-btn');
  const feedback = document.getElementById('leads365-feedback');

  const CRM_ENDPOINT = 'https://your-crm-domain.com/api/integrations/leads/website';
  const PUBLIC_SITE_KEY = 'lf_site_YOUR_PUBLIC_SITE_KEY'; // Obtained from CRM Integration Studio

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    // 1. Debounce button to prevent multiple rapid clicks
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    feedback.style.display = 'none';

    // 2. Extract form data
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      message: formData.get('message'),
      _hp_trap: formData.get('_hp_trap'), // Bot trap
      landingPage: window.location.href,
      source: 'Static Website'
    };

    // 3. Dispatch to Leads-365 CRM API
    try {
      const response = await fetch(CRM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': PUBLIC_SITE_KEY
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.success) {
        feedback.textContent = 'Thank you! Your details have been submitted successfully.';
        feedback.style.backgroundColor = '#ecfdf5';
        feedback.style.color = '#065f46';
        feedback.style.display = 'block';
        form.reset();
      } else {
        throw new Error(result.error || 'Failed to submit enquiry.');
      }
    } catch (err) {
      feedback.textContent = 'Error: ' + err.message;
      feedback.style.backgroundColor = '#fef2f2';
      feedback.style.color = '#991b1b';
      feedback.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
});
</script>
```

