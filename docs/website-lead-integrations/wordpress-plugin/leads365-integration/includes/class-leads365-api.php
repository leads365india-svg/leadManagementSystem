<?php
/**
 * Leads365 API Client Subsystem
 *
 * Handles server-to-server HTTP communication with Leads365 CRM webhook endpoint:
 * - Private API Key authentication via x-api-key
 * - HMAC-SHA256 request signing via x-signature-256
 * - Timestamp replay defense via x-timestamp
 * - Client idempotency deduplication via x-idempotency-key
 * - Safe response normalization and zero credential exposure
 */

if (!defined('ABSPATH')) {
    exit;
}

class Leads365_API {

    /**
     * Singleton instance
     * @var Leads365_API
     */
    private static $instance = null;

    /**
     * Get singleton instance
     * @return Leads365_API
     */
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {}

    /**
     * Get configured API endpoint URL
     *
     * @return string
     */
    public function get_api_url() {
        $url = get_option('leads365_api_url', 'http://localhost:5000/api/integrations/leads/website');
        return esc_url_raw(trim($url));
    }

    /**
     * Get configured Private API Key
     *
     * @return string
     */
    public function get_api_key() {
        $key = get_option('leads365_api_key', '');
        return is_string($key) ? trim($key) : '';
    }

    /**
     * Get masked API key for safe UI display (e.g. lf_live_••••••••••••1234)
     *
     * @return string
     */
    public function get_masked_api_key() {
        $key = $this->get_api_key();
        if (empty($key)) {
            return '';
        }
        $len = strlen($key);
        if ($len <= 8) {
            return str_repeat('•', $len);
        }
        $prefix = substr($key, 0, 8); // e.g. "lf_live_"
        $suffix = substr($key, -4);
        return $prefix . str_repeat('•', 12) . $suffix;
    }

    /**
     * Get request timeout in seconds
     *
     * @return int
     */
    public function get_timeout() {
        $timeout = (int) get_option('leads365_timeout', 15);
        return ($timeout > 0 && $timeout <= 60) ? $timeout : 15;
    }

    /**
     * Get default lead source
     *
     * @return string
     */
    public function get_default_source() {
        $source = get_option('leads365_default_source', 'WordPress');
        return sanitize_text_field($source);
    }

    /**
     * Build and normalize lead payload
     *
     * @param array $raw_data
     * @param array $context
     * @return array
     */
    public function normalize_lead_payload($raw_data, $context = array()) {
        $payload = array();

        // 1. Contact Information
        $payload['name']    = isset($raw_data['name']) ? sanitize_text_field($raw_data['name']) : '';
        $payload['email']   = isset($raw_data['email']) ? sanitize_email($raw_data['email']) : '';
        $payload['phone']   = isset($raw_data['phone']) ? sanitize_text_field($raw_data['phone']) : '';
        $payload['message'] = isset($raw_data['message']) ? sanitize_textarea_field($raw_data['message']) : '';

        // Handle first_name / last_name split if name is missing
        if (empty($payload['name'])) {
            $fname = isset($raw_data['first_name']) ? sanitize_text_field($raw_data['first_name']) : '';
            $lname = isset($raw_data['last_name']) ? sanitize_text_field($raw_data['last_name']) : '';
            $payload['name'] = trim($fname . ' ' . $lname);
        }

        // 2. Anti-spam honeypot
        if (isset($raw_data['_hp_trap'])) {
            $payload['_hp_trap'] = sanitize_text_field($raw_data['_hp_trap']);
        }

        // 3. Metadata & Context
        $payload['source']   = !empty($context['source']) ? sanitize_text_field($context['source']) : $this->get_default_source();
        $payload['formId']   = !empty($context['formId']) ? sanitize_text_field($context['formId']) : 'wordpress_form';
        $payload['platform'] = 'WordPress/' . get_bloginfo('version');

        // 4. Marketing Attribution
        $server_referer = isset($_SERVER['HTTP_REFERER']) ? esc_url_raw($_SERVER['HTTP_REFERER']) : '';
        $server_host    = isset($_SERVER['HTTP_HOST']) ? sanitize_text_field($_SERVER['HTTP_HOST']) : '';
        $request_uri    = isset($_SERVER['REQUEST_URI']) ? sanitize_text_field($_SERVER['REQUEST_URI']) : '';

        $landing_page = $server_referer;
        if (empty($landing_page) && !empty($server_host)) {
            $scheme = is_ssl() ? 'https://' : 'http://';
            $landing_page = esc_url_raw($scheme . $server_host . $request_uri);
        }

        $payload['landingPage'] = $landing_page;
        $payload['referrer']    = $server_referer;

        // Extract UTM parameters if present in request or context
        $utm_keys = array('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid');
        foreach ($utm_keys as $key) {
            if (!empty($raw_data[$key])) {
                $payload[$key] = sanitize_text_field($raw_data[$key]);
            } elseif (!empty($_GET[$key])) {
                $payload[$key] = sanitize_text_field($_GET[$key]);
            } elseif (!empty($context[$key])) {
                $payload[$key] = sanitize_text_field($context[$key]);
            }
        }

        // Default campaign fallback from options if configured
        $default_campaign = get_option('leads365_default_campaign', '');
        if (empty($payload['utm_campaign']) && !empty($default_campaign)) {
            $payload['utm_campaign'] = sanitize_text_field($default_campaign);
        }

        // 5. Custom Fields
        $custom_fields = array();
        $reserved_keys = array(
            'name', 'first_name', 'last_name', 'email', 'phone', 'message',
            '_hp_trap', 'source', 'formId', 'platform', 'landingPage', 'referrer',
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'gclid', 'fbclid', 'security', 'action', 'leads365_form_nonce'
        );

        foreach ($raw_data as $k => $v) {
            if (!in_array($k, $reserved_keys, true) && is_scalar($v)) {
                $custom_fields[sanitize_key($k)] = sanitize_text_field((string)$v);
            }
        }

        if (!empty($custom_fields)) {
            $payload['customFields'] = $custom_fields;
        }

        return $payload;
    }

    /**
     * Submit lead securely to Leads365 CRM
     *
     * @param array $raw_data
     * @param array $context
     * @return array Result array with 'success' (bool), 'status' (int), 'data' (array), 'error' (string)
     */
    public function send_lead($raw_data, $context = array()) {
        $api_url = $this->get_api_url();
        $api_key = $this->get_api_key();

        if (empty($api_key)) {
            return array(
                'success' => false,
                'status'  => 401,
                'error'   => __('Leads365 Private API Key is not configured in WordPress settings.', 'leads365-integration'),
            );
        }

        if (empty($api_url)) {
            return array(
                'success' => false,
                'status'  => 400,
                'error'   => __('Leads365 API Endpoint URL is not configured.', 'leads365-integration'),
            );
        }

        // Normalize payload
        $payload = $this->normalize_lead_payload($raw_data, $context);

        // Honeypot check: If filled, reject locally without leaking API failure
        if (!empty($payload['_hp_trap'])) {
            return array(
                'success' => false,
                'status'  => 400,
                'error'   => __('Bot submission rejected by anti-spam verification.', 'leads365-integration'),
            );
        }

        // Encode JSON body
        $json_body = wp_json_encode($payload);
        if (!$json_body) {
            return array(
                'success' => false,
                'status'  => 400,
                'error'   => __('Failed to encode lead data to JSON.', 'leads365-integration'),
            );
        }

        // Generate unique delivery / idempotency key
        $idempotency_key = isset($context['idempotencyKey'])
            ? sanitize_text_field($context['idempotencyKey'])
            : 'wp_' . time() . '_' . substr(md5($json_body . wp_rand()), 0, 12);

        $timestamp = (string) round(microtime(true) * 1000);
        $signature = hash_hmac('sha256', $json_body, $api_key);

        // Prepare server-to-server headers
        $headers = array(
            'Content-Type'        => 'application/json; charset=utf-8',
            'Accept'              => 'application/json',
            'X-API-Key'           => $api_key,
            'X-Idempotency-Key'   => $idempotency_key,
            'X-Timestamp'         => $timestamp,
            'X-Signature-256'     => $signature,
            'User-Agent'          => 'Leads365-WordPress/' . LEADS365_VERSION . '; ' . home_url(),
        );

        $request_args = array(
            'method'      => 'POST',
            'timeout'     => $this->get_timeout(),
            'redirection' => 2,
            'headers'     => $headers,
            'body'        => $json_body,
            'sslverify'   => true,
        );

        // Execute HTTP request
        $response = wp_remote_post($api_url, $request_args);

        // Handle network / transport errors
        if (is_wp_error($response)) {
            $error_message = $response->get_error_message();
            return array(
                'success' => false,
                'status'  => 500,
                'error'   => sprintf(__('Network connection error: %s', 'leads365-integration'), $error_message),
            );
        }

        $status_code = wp_remote_retrieve_response_code($response);
        $response_body = wp_remote_retrieve_body($response);
        $parsed = json_decode($response_body, true);

        if (!is_array($parsed)) {
            $parsed = array('raw' => $response_body);
        }

        if ($status_code >= 200 && $status_code < 300 && !empty($parsed['success'])) {
            return array(
                'success' => true,
                'status'  => $status_code,
                'data'    => $parsed,
                'error'   => '',
            );
        }

        // Error message resolution based on status code
        $err_msg = isset($parsed['error']) ? $parsed['error'] : '';
        if (empty($err_msg)) {
            switch ($status_code) {
                case 401:
                    $err_msg = __('Authentication failed: Invalid or revoked Leads365 API Key.', 'leads365-integration');
                    break;
                case 403:
                    $err_msg = __('Forbidden: Account suspended or access denied.', 'leads365-integration');
                    break;
                case 409:
                    $err_msg = __('Duplicate enquiry: Lead already exists and policy is set to reject.', 'leads365-integration');
                    break;
                case 429:
                    $err_msg = __('Rate limit exceeded: Please wait a moment before sending more enquiries.', 'leads365-integration');
                    break;
                default:
                    $err_msg = sprintf(__('Server error (HTTP %d).', 'leads365-integration'), $status_code);
                    break;
            }
        }

        return array(
            'success' => false,
            'status'  => $status_code,
            'data'    => $parsed,
            'error'   => $err_msg,
        );
    }

    /**
     * Test CRM connection with configured credentials
     *
     * @return array
     */
    public function test_connection() {
        $api_key = $this->get_api_key();
        if (empty($api_key)) {
            return array(
                'success' => false,
                'message' => __('Please enter and save your Private API Key before testing.', 'leads365-integration'),
            );
        }

        $test_payload = array(
            'name'    => 'Leads365 Connection Test',
            'email'   => 'connection-test@leads365.local',
            'phone'   => '+91 99999 00000',
            'message' => 'Automated health verification ping from WordPress plugin admin.',
            'source'  => 'WordPress Ping',
            '_hp_trap'=> '',
        );

        $res = $this->send_lead($test_payload, array(
            'formId'         => 'wp_admin_test_ping',
            'idempotencyKey' => 'test_ping_' . time(),
        ));

        if ($res['success']) {
            return array(
                'success' => true,
                'message' => __('Connection verified successfully! Leads365 CRM endpoint is reachable and your API Key is authenticated.', 'leads365-integration'),
            );
        }

        return array(
            'success' => false,
            'message' => sprintf(__('Connection failed (HTTP %d): %s', 'leads365-integration'), $res['status'], $res['error']),
        );
    }
}
