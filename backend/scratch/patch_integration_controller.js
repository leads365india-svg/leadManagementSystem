const fs = require('fs');
const filePath = 'backend/controllers/integrationController.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. In createIntegration, add siteKey generation
const targetCreate = `    // Generate secure API key for the integration
    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)

    let assignedStaffName = "Unassigned"
    if (assignedStaffId && assignedStaffId !== "unassigned") {
      const staff = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
      if (staff) assignedStaffName = staff.name
    }

    const integration = new Integration({
      tenantId,
      name: name.trim(),
      type,
      status: "active",
      apiKeyHash,
      apiKeyMasked,
      apiKeyLastRotatedAt: new Date(),
      fieldMapping: Array.isArray(fieldMapping) ? fieldMapping : [],
      assignedRuleId: assignedRuleId || null,
      assignedStaffId: assignedStaffId || "unassigned",
      assignedStaffName,
      settings: settings || {},
    })`;

const replacementCreate = `    // Generate secure API key and public site key for the integration
    const rawApiKey = generateApiKey()
    const apiKeyHash = hashApiKey(rawApiKey)
    const apiKeyMasked = maskSecret(rawApiKey)
    const siteKey = generateSiteKey()

    let assignedStaffName = "Unassigned"
    if (assignedStaffId && assignedStaffId !== "unassigned") {
      const staff = await User.findOne({ _id: assignedStaffId, tenantId, status: "active" })
      if (staff) assignedStaffName = staff.name
    }

    const integration = new Integration({
      tenantId,
      name: name.trim(),
      type,
      status: "active",
      apiKeyHash,
      apiKeyMasked,
      siteKey,
      apiKeyLastRotatedAt: new Date(),
      fieldMapping: Array.isArray(fieldMapping) ? fieldMapping : [],
      assignedRuleId: assignedRuleId || null,
      assignedStaffId: assignedStaffId || "unassigned",
      assignedStaffName,
      settings: settings || {},
    })`;

const targetReturn = `    return res.status(201).json({
      success: true,
      message: "Integration created successfully",
      rawApiKey, // Displayed only ONCE upon creation
      data: integration,
    })`;

const replacementReturn = `    return res.status(201).json({
      success: true,
      message: "Integration created successfully",
      rawApiKey, // Displayed only ONCE upon creation
      siteKey,
      data: integration,
    })`;

// 2. Add generatePlatformSnippets, getIntegrationSnippets, and testIntegrationById
const snippetsCode = `
/**
 * Helper to construct the dynamic base URL from request
 */
const getBaseUrl = (req) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http"
  const host = req.headers["x-forwarded-host"] || req.get("host") || "localhost:5000"
  return \`\${protocol}://\${host}\`
}

/**
 * Constructs production-ready integration snippets for all 6 platforms
 */
const generatePlatformSnippets = ({ integration, baseUrl, rawApiKey = null }) => {
  const webhookUrl = \`\${baseUrl}/api/integrations/leads/website\`
  const siteKey = integration.siteKey || "lf_site_YOUR_PUBLIC_KEY"
  const apiKey = rawApiKey || "lf_live_YOUR_PRIVATE_API_KEY"
  const integrationName = integration.name || "Leads-365 Website Integration"

  // 1. WordPress
  const wordpress = {
    title: "WordPress Integration",
    description: "Connect standard WordPress forms, Elementor, Contact Form 7, WPForms, or custom PHP themes.",
    webhookUrl,
    siteKey,
    cf7WebhookInstructions: \`1. In WordPress, install 'CF7 to Webhook' or 'Redirection for Contact Form 7'.\\n2. Set Webhook URL to: \${webhookUrl}\\n3. Set Request Header: X-API-Key = \${apiKey} (or X-Site-Key = \${siteKey})\\n4. Map CF7 form tag names: your-name -> name, your-email -> email, your-phone -> phone, your-message -> message.\`,
    elementorInstructions: \`1. In Elementor Form settings, go to Actions After Submit -> Add 'Webhook'.\\n2. Under Webhook settings, set Webhook URL: \${webhookUrl}\\n3. In Advanced Settings, add Header: X-API-Key: \${apiKey} (or pass siteKey in form field).\\n4. Map Field IDs to: name, email, phone, message.\`,
    wpformsInstructions: \`1. In WPForms Settings -> Webhooks -> Add New Webhook.\\n2. Request URL: \${webhookUrl}\\n3. Request Method: POST, Request Format: JSON.\\n4. Headers: X-API-Key: \${apiKey}\\n5. Map Form Fields to: name, email, phone, message.\`,
    customPhpHook: \`// Add to your WordPress child theme's functions.php
add_action('wpcf7_mail_sent', 'leads365_forward_cf7_lead');
function leads365_forward_cf7_lead($contact_form) {
    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;
    $posted_data = $submission->get_posted_data();

    $payload = array(
        'name'    => sanitize_text_field($posted_data['your-name'] ?? ''),
        'email'   => sanitize_email($posted_data['your-email'] ?? ''),
        'phone'   => sanitize_text_field($posted_data['your-phone'] ?? ''),
        'message' => sanitize_textarea_field($posted_data['your-message'] ?? ''),
        'source'  => 'WordPress'
    );

    wp_remote_post('\${webhookUrl}', array(
        'method'      => 'POST',
        'timeout'     => 15,
        'headers'     => array(
            'Content-Type' => 'application/json',
            'X-API-Key'    => '\${apiKey}'
        ),
        'body'        => wp_json_encode($payload)
    ));
}\`,
    embedScript: \`<script 
  src="\${baseUrl}/api/integrations/snippet.js" 
  data-site-key="\${siteKey}" 
  async defer>
</script>\`
  }

  // 2. HTML / JavaScript
  const html = {
    title: "HTML / JavaScript Website Integration",
    description: "Embed directly on any static HTML or client-side website with built-in anti-spam honeypot and client-side protection.",
    webhookUrl,
    siteKey,
    htmlForm: \`<!-- Leads-365 HTML Lead Capture Form -->
<form id="leads365-form">
  <!-- Anti-bot honeypot field (hidden from human visitors) -->
  <input type="text" name="_hp_trap" style="display:none !important;" tabindex="-1" autocomplete="off" />

  <div>
    <label for="name">Full Name *</label>
    <input type="text" id="name" name="name" placeholder="John Doe" required />
  </div>

  <div>
    <label for="email">Email Address</label>
    <input type="email" id="email" name="email" placeholder="john@example.com" />
  </div>

  <div>
    <label for="phone">Phone Number *</label>
    <input type="tel" id="phone" name="phone" placeholder="+1234567890" required />
  </div>

  <div>
    <label for="message">Message</label>
    <textarea id="message" name="message" placeholder="How can we help you?"></textarea>
  </div>

  <button type="submit" id="leads365-submit-btn">Submit Enquiry</button>
  <div id="leads365-status" style="margin-top: 10px; display: none;"></div>
</form>

<script>
document.getElementById('leads365-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('leads365-submit-btn');
  const statusDiv = document.getElementById('leads365-status');

  btn.disabled = true;
  btn.textContent = 'Sending...';
  statusDiv.style.display = 'none';

  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    message: formData.get('message'),
    _hp_trap: formData.get('_hp_trap'),
    landingPage: window.location.href,
    source: 'Website'
  };

  try {
    const res = await fetch('\${webhookUrl}', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Site-Key': '\${siteKey}'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      statusDiv.textContent = 'Thank you! Your enquiry has been received.';
      statusDiv.style.color = 'green';
      statusDiv.style.display = 'block';
      form.reset();
    } else {
      throw new Error(data.error || 'Failed to submit form');
    }
  } catch (err) {
    statusDiv.textContent = 'Error: ' + err.message;
    statusDiv.style.color = 'red';
    statusDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Enquiry';
  }
});
</script>\`
  }

  // 3. PHP
  const php = {
    title: "PHP Website Integration",
    description: "Production-ready server-to-server PHP script with HMAC-SHA256 signature, timestamp expiration, and idempotency protection.",
    webhookUrl,
    apiKey,
    serverScript: \`<?php
/**
 * Leads-365 CRM - PHP Server-Side Lead Ingestion
 */
$apiUrl    = '\${webhookUrl}';
$apiKey    = '\${apiKey}'; // Keep secure in environment / config file
$siteKey   = '\${siteKey}';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // 1. Anti-bot honeypot check
    if (!empty($_POST['_hp_trap'])) {
        http_response_code(400);
        die(json_encode(['error' => 'Spam detected']));
    }

    // 2. Sanitize form inputs
    $payload = [
        'name'        => trim(filter_input(INPUT_POST, 'name', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'email'       => trim(filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL)),
        'phone'       => trim(filter_input(INPUT_POST, 'phone', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'message'     => trim(filter_input(INPUT_POST, 'message', FILTER_SANITIZE_FULL_SPECIAL_CHARS)),
        'source'      => 'PHP Website',
        'landingPage' => $_SERVER['HTTP_REFERER'] ?? ''
    ];

    $jsonPayload    = json_encode($payload);
    $timestamp      = time() * 1000;
    $idempotencyKey = bin2hex(random_bytes(16));
    
    // HMAC-SHA256 Signature calculation
    $hmacSignature  = hash_hmac('sha256', $jsonPayload, $apiKey);

    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $jsonPayload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-Signature-256: ' . $hmacSignature,
            'X-Timestamp: ' . $timestamp,
            'X-Idempotency-Key: ' . $idempotencyKey
        ]
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        error_log("Leads-365 CRM Connection Error: " . $curlErr);
        echo json_encode(['success' => false, 'error' => 'Network error connecting to CRM']);
    } else {
        http_response_code($httpCode);
        echo $response;
    }
    exit;
}\`
  }

  // 4. React
  const react = {
    title: "React Component Integration",
    description: "Reusable React functional component using public Site Key, client-side validation, loading states, and honeypot protection.",
    siteKey,
    webhookUrl,
    component: \`import React, { useState } from 'react';

export default function LeadCaptureForm() {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('\${webhookUrl}', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': '\${siteKey}'
        },
        body: JSON.stringify({
          ...formData,
          source: 'React Website',
          landingPage: typeof window !== 'undefined' ? window.location.href : ''
        })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit enquiry');
      }

      setSuccess(true);
      setFormData({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto p-6 bg-white shadow rounded-lg">
      <input
        type="text"
        name="_hp_trap"
        value={formData._hp_trap}
        onChange={(e) => setFormData({ ...formData, _hp_trap: e.target.value })}
        style={{ display: 'none' }}
        tabIndex={-1}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700">Full Name *</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Email Address</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Phone Number *</label>
        <input
          type="tel"
          required
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Message</label>
        <textarea
          rows={3}
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          className="mt-1 block w-full border border-gray-300 rounded-md p-2"
        />
      </div>

      {error && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}
      {success && <div className="p-3 text-sm text-green-700 bg-green-50 rounded-md">Enquiry sent successfully!</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white font-medium py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit Lead'}
      </button>
    </form>
  );
}\`
  }

  // 5. Next.js
  const nextjs = {
    title: "Next.js App Router Integration",
    description: "Next.js Route Handler / Server Action storing private API keys securely in backend environment variables, with client-side form.",
    webhookUrl,
    apiKey,
    envExample: \`# .env.local (Never prefix with NEXT_PUBLIC_)
LEADS365_WEBHOOK_URL="\${webhookUrl}"
LEADS365_API_KEY="\${apiKey}"\`,
    routeHandler: \`// app/api/contact/route.js (Next.js App Router Server Handler)
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();

    if (body._hp_trap) {
      return NextResponse.json({ error: 'Spam detected' }, { status: 400 });
    }

    const res = await fetch(process.env.LEADS365_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.LEADS365_API_KEY,
        'X-Idempotency-Key': 'nextjs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
      },
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        phone: body.phone,
        message: body.message,
        source: 'Next.js Website'
      })
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}\`,
    clientComponent: \`// app/components/ContactForm.jsx (Client Form)
'use client';

import { useState } from 'react';

export default function ContactForm() {
  const [status, setStatus] = useState({ loading: false, msg: '', error: false });

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, msg: '', error: false });

    const form = e.target;
    const payload = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      message: form.message.value,
      _hp_trap: form._hp_trap.value
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      setStatus({ loading: false, msg: 'Thank you! We will get in touch shortly.', error: false });
      form.reset();
    } catch (err) {
      setStatus({ loading: false, msg: err.message, error: true });
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-md mx-auto space-y-4">
      <input type="text" name="_hp_trap" className="hidden" tabIndex={-1} />
      <input name="name" placeholder="Full Name" required className="w-full p-2 border rounded" />
      <input name="email" type="email" placeholder="Email Address" className="w-full p-2 border rounded" />
      <input name="phone" type="tel" placeholder="Phone Number" required className="w-full p-2 border rounded" />
      <textarea name="message" placeholder="Your Message" className="w-full p-2 border rounded" />
      {status.msg && (
        <p className={status.error ? "text-red-500 text-sm" : "text-green-600 text-sm"}>{status.msg}</p>
      )}
      <button type="submit" disabled={status.loading} className="w-full bg-blue-600 text-white p-2 rounded">
        {status.loading ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}\`
  }

  // 6. Custom Webhook
  const webhook = {
    title: "Custom Third-Party Webhook",
    description: "Connect external platforms, custom backend scripts, or automation tools using standard HTTP POST.",
    webhookUrl,
    apiKey,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "X-Signature-256": "Optional HMAC-SHA256 of raw body using your API key",
      "X-Timestamp": "Optional Epoch milliseconds timestamp",
      "X-Idempotency-Key": "Optional unique submission ID for retry safety"
    },
    curlExample: \`curl -X POST "\${webhookUrl}" \\\\
  -H "Content-Type: application/json" \\\\
  -H "X-API-Key: \${apiKey}" \\\\
  -d '{
    "name": "Alex Mercer",
    "email": "alex@example.com",
    "phone": "+1-555-0199",
    "message": "Interested in enterprise plan",
    "source": "Custom Webhook",
    "formId": "enterprise_contact"
  }'\`
  }

  return {
    wordpress,
    html,
    php,
    react,
    nextjs,
    webhook,
  }
}

/**
 * GET /api/integrations/:id/snippets
 * Authenticated: Retrieve tailored code snippets for all platforms
 */
const getIntegrationSnippets = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const baseUrl = getBaseUrl(req)
    const snippets = generatePlatformSnippets({
      integration,
      baseUrl,
      rawApiKey: null,
    })

    return res.status(200).json({
      success: true,
      data: {
        integration: {
          id: integration._id,
          name: integration.name,
          type: integration.type,
          siteKey: integration.siteKey,
          apiKeyMasked: integration.apiKeyMasked,
          status: integration.status,
          settings: integration.settings,
        },
        snippets,
      },
    })
  } catch (error) {
    console.error("Error generating snippets:", error)
    return res.status(500).json({ success: false, error: "Failed to generate integration snippets" })
  }
}

/**
 * POST /api/integrations/:id/test
 * Authenticated (requireAccountAdmin): Send test lead for a specific integration
 */
const testIntegrationById = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const integration = await Integration.findOne({ _id: req.params.id, tenantId })
    if (!integration) {
      return res.status(404).json({ success: false, error: "Integration not found" })
    }

    const testPayload = req.body?.payload || {
      name: "Test Lead (" + integration.name + ")",
      email: "test-" + Date.now() + "@example.com",
      phone: "+919876543210",
      message: "Testing website lead ingestion pipeline for " + integration.name,
      isTest: true,
      source: integration.settings?.leadSource || "Website Test",
    }

    const result = await integrationService.processIntakePayload({
      event: null,
      integration,
      legacyConfig: null,
      tenantId,
      body: testPayload,
      headers: req.headers,
      query: { isTest: "true" },
      ip: req.ip || "127.0.0.1",
      rawApiKey: null,
      idempotencyKey: "test_" + Date.now(),
    })

    return res.status(200).json({
      success: true,
      message: "Test lead verified successfully",
      data: result,
    })
  } catch (error) {
    console.error("Error testing integration:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to test integration" })
  }
}
`;

const targetExports = `module.exports = {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  rotateSiteKey,
  serveWebsiteSnippet,
  sendTestLead,
  receiveWebsiteLead,
  listIntegrations,
  createIntegration,
  getIntegrationById,
  updateIntegration,
  rotateIntegrationKey,
  deleteIntegration,
  listSources,
  upsertSource,
  listEvents,
  replayIntegrationEvent,
  syncLegacyIntegrations,
}`;

const replacementExports = `module.exports = {
  getWebsiteConfig,
  updateWebsiteConfig,
  rotateApiKey,
  rotateSiteKey,
  serveWebsiteSnippet,
  sendTestLead,
  receiveWebsiteLead,
  listIntegrations,
  createIntegration,
  getIntegrationById,
  updateIntegration,
  rotateIntegrationKey,
  deleteIntegration,
  listSources,
  upsertSource,
  listEvents,
  replayIntegrationEvent,
  syncLegacyIntegrations,
  generatePlatformSnippets,
  getIntegrationSnippets,
  testIntegrationById,
}`;

let normalized = content.replace(/\r\n/g, '\n');
let tc = targetCreate.replace(/\r\n/g, '\n');
let rc = replacementCreate.replace(/\r\n/g, '\n');
let tr = targetReturn.replace(/\r\n/g, '\n');
let rr = replacementReturn.replace(/\r\n/g, '\n');
let te = targetExports.replace(/\r\n/g, '\n');
let re = replacementExports.replace(/\r\n/g, '\n');

if (!normalized.includes(tc)) {
  console.error('Target create not found!');
  process.exit(1);
}
normalized = normalized.replace(tc, rc);

if (!normalized.includes(tr)) {
  console.error('Target return not found!');
  process.exit(1);
}
normalized = normalized.replace(tr, rr);

if (!normalized.includes(te)) {
  console.error('Target exports not found!');
  process.exit(1);
}
normalized = normalized.replace(te, snippetsCode + '\n\n' + re);

fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched integrationController.js');

