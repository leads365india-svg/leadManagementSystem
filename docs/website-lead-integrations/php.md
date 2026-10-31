# PHP Website Lead Integration Guide

This guide covers integrating custom PHP applications, eCommerce checkouts, and custom CMS backends with **Leads-365 CRM** using server-to-server HTTP requests.

---

## 1. Security Architecture

- **Private API Key:** Kept confidential on your PHP server; never sent to visitor browsers.
- **HMAC-SHA256 Payload Signature:** Guarantees that the payload has not been intercepted or modified in transit.
- **Replay Protection (Timestamp Check):** Requires `X-Timestamp` within a 5-minute window of the CRM server's clock.
- **Idempotency Key:** Attaches a unique submission ID (`X-Idempotency-Key`) to prevent duplicate leads if network retries occur.

---

## 2. Production-Ready PHP Ingestion Script

```php
<?php
/**
 * Leads-365 CRM — Secure Server-to-Server Lead Submission
 */

// 1. CRM Configuration (Store in environment or config file)
$crm_webhook_url = getenv('LEADS365_WEBHOOK_URL') ?: 'https://your-crm-domain.com/api/integrations/leads/website';
$crm_api_key     = getenv('LEADS365_API_KEY')     ?: 'lf_live_YOUR_PRIVATE_API_KEY';

// 2. Validate incoming form submission
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Anti-bot honeypot check
    if (!empty($_POST['_hp_trap'])) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Bot submission rejected']);
        exit;
    }

    // Sanitize user inputs
    $name    = trim(filter_input(INPUT_POST, 'name', FILTER_SANITIZE_FULL_SPECIAL_CHARS));
    $email   = trim(filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL));
    $phone   = trim(filter_input(INPUT_POST, 'phone', FILTER_SANITIZE_FULL_SPECIAL_CHARS));
    $message = trim(filter_input(INPUT_POST, 'message', FILTER_SANITIZE_FULL_SPECIAL_CHARS));
    $company = trim(filter_input(INPUT_POST, 'company', FILTER_SANITIZE_FULL_SPECIAL_CHARS));

    if (empty($name) || (empty($email) && empty($phone))) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Name and either email or phone are required.']);
        exit;
    }

    // 3. Construct CRM lead payload
    $lead_payload = [
        'name'        => $name,
        'email'       => $email,
        'phone'       => $phone,
        'company'     => $company,
        'message'     => $message,
        'source'      => 'PHP Website',
        'landingPage' => $_SERVER['HTTP_REFERER'] ?? '',
        'formId'      => 'php_contact_v1'
    ];

    $json_payload    = json_encode($lead_payload, JSON_UNESCAPED_SLASHES);
    $timestamp       = time() * 1000; // Milliseconds
    $idempotency_key = 'php_' . bin2hex(random_bytes(12));

    // 4. Generate HMAC-SHA256 signature
    $hmac_signature  = hash_hmac('sha256', $json_payload, $crm_api_key);

    // 5. Send cURL request to Leads-365 CRM
    $ch = curl_init($crm_webhook_url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $json_payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-API-Key: ' . $crm_api_key,
            'X-Signature-256: ' . $hmac_signature,
            'X-Timestamp: ' . $timestamp,
            'X-Idempotency-Key: ' . $idempotency_key
        ]
    ]);

    $response  = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_err  = curl_error($ch);
    curl_close($ch);

    header('Content-Type: application/json');

    if ($curl_err) {
        error_log("Leads-365 CRM Connection Error: " . $curl_err);
        http_response_code(502);
        echo json_encode(['success' => false, 'error' => 'Gateway error communicating with CRM.']);
    } else {
        http_response_code($http_code);
        echo $response;
    }
    exit;
}
?>
```

