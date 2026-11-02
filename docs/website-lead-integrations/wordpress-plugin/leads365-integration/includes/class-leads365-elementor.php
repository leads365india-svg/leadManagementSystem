<?php
/**
 * Leads365 Elementor Pro Forms Integration Subsystem
 *
 * Hooks into official Elementor form submission lifecycle:
 * - elementor_pro/forms/new_record
 * - Safe extraction of form fields, metadata, and custom field values
 * - Server-to-server dispatch without exposing credentials
 * - Fails safe if Elementor is absent
 */

if (!defined('ABSPATH')) {
    exit;
}

class Leads365_Elementor {

    /**
     * API Subsystem
     * @var Leads365_API
     */
    private $api;

    /**
     * Constructor
     * @param Leads365_API $api
     */
    public function __construct(Leads365_API $api) {
        $this->api = $api;

        add_action('elementor_pro/forms/new_record', array($this, 'on_elementor_form_submit'), 10, 2);
    }

    /**
     * Hook callback for Elementor Pro form submission
     *
     * @param object $record Elementor Form Record instance
     * @param object $handler Elementor Form Handler instance
     */
    public function on_elementor_form_submit($record, $handler) {
        if (!is_object($record) || !method_exists($record, 'get')) {
            return;
        }

        $raw_fields = $record->get('fields');
        if (!is_array($raw_fields) || empty($raw_fields)) {
            return;
        }

        // Check if honeypot is present
        if (!empty($raw_fields['_hp_trap']['value']) || !empty($raw_fields['hp_field']['value'])) {
            return; // Bot detected, skip CRM submission
        }

        // Form settings & ID
        $form_settings = method_exists($record, 'get_form_settings') ? $record->get_form_settings() : array();
        $form_name     = !empty($form_settings['form_name']) ? sanitize_text_field($form_settings['form_name']) : 'Elementor Form';
        $form_id       = !empty($form_settings['id']) ? sanitize_text_field($form_settings['id']) : 'elementor_' . wp_rand(100, 999);

        // Map fields by ID and label
        $mapped = array(
            'name'         => '',
            'first_name'   => '',
            'last_name'    => '',
            'email'        => '',
            'phone'        => '',
            'message'      => '',
            'customFields' => array(),
        );

        foreach ($raw_fields as $field_id => $field) {
            $val   = isset($field['value']) ? (is_array($field['value']) ? implode(', ', $field['value']) : (string)$field['value']) : '';
            $title = isset($field['title']) ? strtolower(trim($field['title'])) : '';
            $id    = strtolower(trim($field_id));
            $type  = isset($field['type']) ? strtolower(trim($field['type'])) : '';

            $val_clean = sanitize_text_field($val);

            // Match Email
            if (empty($mapped['email']) && ($type === 'email' || strpos($id, 'email') !== false || strpos($title, 'email') !== false)) {
                $mapped['email'] = sanitize_email($val);
                continue;
            }

            // Match Phone
            if (empty($mapped['phone']) && ($type === 'tel' || strpos($id, 'phone') !== false || strpos($id, 'mobile') !== false || strpos($title, 'phone') !== false || strpos($title, 'mobile') !== false)) {
                $mapped['phone'] = $val_clean;
                continue;
            }

            // Match Full Name
            if (empty($mapped['name']) && ($id === 'name' || $id === 'full_name' || $id === 'fullname' || $title === 'name' || $title === 'full name')) {
                $mapped['name'] = $val_clean;
                continue;
            }

            // Match First Name
            if (empty($mapped['first_name']) && (strpos($id, 'first') !== false || strpos($title, 'first') !== false || $id === 'fname')) {
                $mapped['first_name'] = $val_clean;
                continue;
            }

            // Match Last Name
            if (empty($mapped['last_name']) && (strpos($id, 'last') !== false || strpos($title, 'last') !== false || $id === 'lname')) {
                $mapped['last_name'] = $val_clean;
                continue;
            }

            // Match Message
            if (empty($mapped['message']) && ($type === 'textarea' || strpos($id, 'message') !== false || strpos($title, 'message') !== false || strpos($id, 'comment') !== false || strpos($title, 'requirement') !== false)) {
                $mapped['message'] = sanitize_textarea_field($val);
                continue;
            }

            // Capture other non-empty fields in customFields
            if (!empty($val_clean) && $id !== '_hp_trap') {
                $custom_key = !empty($title) ? $title : $id;
                $mapped['customFields'][sanitize_key($custom_key)] = $val_clean;
            }
        }

        // Construct full name if split
        if (empty($mapped['name']) && (!empty($mapped['first_name']) || !empty($mapped['last_name']))) {
            $mapped['name'] = trim($mapped['first_name'] . ' ' . $mapped['last_name']);
        }

        // Must have at least name, email, or phone to consider it a lead
        if (empty($mapped['name']) && empty($mapped['email']) && empty($mapped['phone'])) {
            return;
        }

        // Prepare context
        $context = array(
            'source'         => 'WordPress Elementor Form',
            'formId'         => 'elementor_' . $form_id,
            'idempotencyKey' => 'elem_' . time() . '_' . substr(md5(wp_json_encode($mapped) . wp_rand()), 0, 10),
        );

        $payload = array(
            'name'         => $mapped['name'],
            'email'        => $mapped['email'],
            'phone'        => $mapped['phone'],
            'message'      => $mapped['message'],
            'customFields' => $mapped['customFields'],
        );

        // Dispatch to CRM
        $this->api->send_lead($payload, $context);
    }
}
