<?php
/**
 * Leads365 Contact Form 7 Integration Subsystem
 *
 * Hooks into Contact Form 7 submission lifecycle:
 * - wpcf7_mail_sent (fires only after validation passes)
 * - Multi-hook execution deduplication
 * - Automatic extraction of standard CF7 tags (your-name, your-email, your-phone, your-message)
 * - Server-to-server dispatch with zero credential leakage
 * - Fails safe if CF7 is not installed
 */

if (!defined('ABSPATH')) {
    exit;
}

class Leads365_Contact_Form_7 {

    /**
     * API Subsystem
     * @var Leads365_API
     */
    private $api;

    /**
     * Static request cache to prevent duplicate dispatch if multiple hooks trigger
     * @var array
     */
    private static $processed_submissions = array();

    /**
     * Constructor
     * @param Leads365_API $api
     */
    public function __construct(Leads365_API $api) {
        $this->api = $api;

        add_action('wpcf7_mail_sent', array($this, 'on_cf7_mail_sent'));
    }

    /**
     * Hook callback for successful CF7 form submission
     *
     * @param object $contact_form WPCF7_ContactForm instance
     */
    public function on_cf7_mail_sent($contact_form) {
        if (!class_exists('WPCF7_Submission')) {
            return;
        }

        $submission = WPCF7_Submission::get_instance();
        if (!$submission) {
            return;
        }

        // Deduplication: prevent sending twice in the same PHP lifecycle
        $sub_id = spl_object_hash($submission);
        if (isset(self::$processed_submissions[$sub_id])) {
            return;
        }
        self::$processed_submissions[$sub_id] = true;

        $posted_data = $submission->get_posted_data();
        if (!is_array($posted_data) || empty($posted_data)) {
            return;
        }

        // Check honeypot field
        if (!empty($posted_data['_hp_trap']) || !empty($posted_data['hp_field'])) {
            return; // Spam bot detected
        }

        $form_id    = method_exists($contact_form, 'id') ? $contact_form->id() : 'cf7';
        $form_title = method_exists($contact_form, 'title') ? $contact_form->title() : 'Contact Form 7';

        // Standard CF7 Field Mapping
        $name    = '';
        $email   = '';
        $phone   = '';
        $message = '';
        $custom_fields = array();

        // 1. Name Mapping
        if (!empty($posted_data['your-name'])) {
            $name = sanitize_text_field($posted_data['your-name']);
        } elseif (!empty($posted_data['name'])) {
            $name = sanitize_text_field($posted_data['name']);
        } elseif (!empty($posted_data['full_name'])) {
            $name = sanitize_text_field($posted_data['full_name']);
        } elseif (!empty($posted_data['first-name']) || !empty($posted_data['last-name'])) {
            $fn = isset($posted_data['first-name']) ? sanitize_text_field($posted_data['first-name']) : '';
            $ln = isset($posted_data['last-name']) ? sanitize_text_field($posted_data['last-name']) : '';
            $name = trim($fn . ' ' . $ln);
        }

        // 2. Email Mapping
        if (!empty($posted_data['your-email'])) {
            $email = sanitize_email($posted_data['your-email']);
        } elseif (!empty($posted_data['email'])) {
            $email = sanitize_email($posted_data['email']);
        }

        // 3. Phone Mapping
        if (!empty($posted_data['your-phone'])) {
            $phone = sanitize_text_field($posted_data['your-phone']);
        } elseif (!empty($posted_data['your-tel'])) {
            $phone = sanitize_text_field($posted_data['your-tel']);
        } elseif (!empty($posted_data['phone'])) {
            $phone = sanitize_text_field($posted_data['phone']);
        } elseif (!empty($posted_data['tel'])) {
            $phone = sanitize_text_field($posted_data['tel']);
        } elseif (!empty($posted_data['mobile'])) {
            $phone = sanitize_text_field($posted_data['mobile']);
        }

        // 4. Message Mapping
        if (!empty($posted_data['your-message'])) {
            $message = sanitize_textarea_field($posted_data['your-message']);
        } elseif (!empty($posted_data['message'])) {
            $message = sanitize_textarea_field($posted_data['message']);
        } elseif (!empty($posted_data['your-subject'])) {
            $message = sanitize_textarea_field($posted_data['your-subject']);
        }

        // 5. Custom Fields Mapping (collect any extra tags)
        $known_tags = array(
            'your-name', 'name', 'full_name', 'first-name', 'last-name',
            'your-email', 'email', 'your-phone', 'your-tel', 'phone', 'tel', 'mobile',
            'your-message', 'message', 'your-subject', '_wpcf7', '_wpcf7_version',
            '_wpcf7_locale', '_wpcf7_unit_tag', '_wpcf7_container_post', '_hp_trap', 'hp_field'
        );

        foreach ($posted_data as $key => $val) {
            if (!in_array($key, $known_tags, true) && is_scalar($val)) {
                $clean_val = sanitize_text_field((string)$val);
                if (!empty($clean_val)) {
                    $custom_fields[sanitize_key($key)] = $clean_val;
                }
            }
        }

        // Must have at least a name, email, or phone
        if (empty($name) && empty($email) && empty($phone)) {
            return;
        }

        $lead_payload = array(
            'name'         => $name,
            'email'        => $email,
            'phone'        => $phone,
            'message'      => $message,
            'customFields' => $custom_fields,
        );

        $context = array(
            'source'         => 'WordPress Contact Form 7',
            'formId'         => 'cf7_' . $form_id,
            'idempotencyKey' => 'cf7_' . time() . '_' . substr(md5(wp_json_encode($lead_payload) . wp_rand()), 0, 10),
        );

        $this->api->send_lead($lead_payload, $context);
    }
}
