<?php
/**
 * Leads365 Native Form & Shortcode Subsystem
 *
 * Implements the universal [leads365_form] shortcode:
 * - Clean, accessible, responsive enquiry form
 * - Anti-spam honeypot protection (_hp_trap)
 * - WordPress nonce verification
 * - Server-side submission relay through Leads365 API subsystem
 * - Zero client-side API key exposure
 */

if (!defined('ABSPATH')) {
    exit;
}

class Leads365_Form {

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

        add_shortcode('leads365_form', array($this, 'render_shortcode'));
        add_action('wp_ajax_leads365_submit_lead', array($this, 'handle_ajax_submit'));
        add_action('wp_ajax_nopriv_leads365_submit_lead', array($this, 'handle_ajax_submit'));
    }

    /**
     * Render the [leads365_form] shortcode
     *
     * @param array $atts
     * @return string
     */
    public function render_shortcode($atts) {
        $atts = shortcode_atts(array(
            'title'       => __('Request a Callback', 'leads365-integration'),
            'subtitle'    => __('Fill out your contact details and our team will get in touch shortly.', 'leads365-integration'),
            'button_text' => __('Submit Enquiry', 'leads365-integration'),
            'source'      => $this->api->get_default_source(),
            'form_id'     => 'leads365_shortcode_form',
        ), $atts, 'leads365_form');

        $ajax_url = admin_url('admin-ajax.php');
        $nonce    = wp_create_nonce('leads365_form_submit');
        $form_uid = 'leads365_' . wp_rand(1000, 9999);

        ob_start();
        ?>
        <div class="leads365-form-container" id="<?php echo esc_attr($form_uid); ?>">
            <style>
                .leads365-form-container {
                    max-width: 500px;
                    margin: 20px auto;
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -4px rgba(0,0,0,0.05);
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    box-sizing: border-box;
                }
                .leads365-form-container * { box-sizing: border-box; }
                .leads365-f-header {
                    background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
                    color: #ffffff;
                    padding: 24px;
                }
                .leads365-f-header h3 {
                    margin: 0 0 6px 0;
                    font-size: 20px;
                    font-weight: 700;
                    color: #ffffff;
                }
                .leads365-f-header p {
                    margin: 0;
                    font-size: 13px;
                    color: rgba(255,255,255,0.85);
                }
                .leads365-f-body {
                    padding: 24px;
                }
                .leads365-f-group {
                    margin-bottom: 16px;
                }
                .leads365-f-group label {
                    display: block;
                    font-size: 13px;
                    font-weight: 600;
                    color: #334155;
                    margin-bottom: 6px;
                }
                .leads365-f-group input[type="text"],
                .leads365-f-group input[type="email"],
                .leads365-f-group input[type="tel"],
                .leads365-f-group textarea {
                    width: 100%;
                    padding: 10px 14px;
                    font-size: 14px;
                    color: #0f172a;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    outline: none;
                    transition: border-color 0.2s, box-shadow 0.2s;
                }
                .leads365-f-group input:focus,
                .leads365-f-group textarea:focus {
                    background: #ffffff;
                    border-color: #4f46e5;
                    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
                }
                .leads365-f-submit {
                    width: 100%;
                    padding: 12px 20px;
                    font-size: 15px;
                    font-weight: 600;
                    color: #ffffff;
                    background: #4f46e5;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.2s, transform 0.1s;
                }
                .leads365-f-submit:hover:not(:disabled) {
                    background: #4338ca;
                    transform: translateY(-1px);
                }
                .leads365-f-submit:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }
                .leads365-f-alert {
                    display: none;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    margin-bottom: 16px;
                    line-height: 1.4;
                }
                .leads365-f-alert.error {
                    display: block;
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    color: #991b1b;
                }
                .leads365-f-alert.success {
                    display: block;
                    background: #ecfdf5;
                    border: 1px solid #a7f3d0;
                    color: #065f46;
                }
                .leads365-f-thankyou {
                    display: none;
                    text-align: center;
                    padding: 30px 20px;
                }
                .leads365-f-thankyou h4 {
                    font-size: 20px;
                    color: #0f172a;
                    margin: 12px 0 6px 0;
                }
                .leads365-f-thankyou p {
                    font-size: 14px;
                    color: #64748b;
                    margin: 0;
                }
            </style>

            <div class="leads365-f-header">
                <h3><?php echo esc_html($atts['title']); ?></h3>
                <?php if (!empty($atts['subtitle'])) : ?>
                    <p><?php echo esc_html($atts['subtitle']); ?></p>
                <?php endif; ?>
            </div>

            <div class="leads365-f-body">
                <div class="leads365-f-alert" id="<?php echo esc_attr($form_uid); ?>_alert"></div>

                <form class="leads365-ajax-form" id="<?php echo esc_attr($form_uid); ?>_form">
                    <input type="hidden" name="action" value="leads365_submit_lead" />
                    <input type="hidden" name="security" value="<?php echo esc_attr($nonce); ?>" />
                    <input type="hidden" name="source" value="<?php echo esc_attr($atts['source']); ?>" />
                    <input type="hidden" name="form_id" value="<?php echo esc_attr($atts['form_id']); ?>" />

                    <!-- Anti-Spam Honeypot Field -->
                    <input type="text" name="_hp_trap" style="display:none !important;" tabindex="-1" autocomplete="off" aria-hidden="true" />

                    <!-- Full Name -->
                    <div class="leads365-f-group">
                        <label><?php esc_html_e('Full Name', 'leads365-integration'); ?> *</label>
                        <input type="text" name="name" required placeholder="<?php esc_attr_e('e.g. Rahul Sharma', 'leads365-integration'); ?>" />
                    </div>

                    <!-- Phone Number -->
                    <div class="leads365-f-group">
                        <label><?php esc_html_e('Phone Number', 'leads365-integration'); ?> *</label>
                        <input type="tel" name="phone" required placeholder="<?php esc_attr_e('e.g. +91 98765 43210', 'leads365-integration'); ?>" />
                    </div>

                    <!-- Email Address -->
                    <div class="leads365-f-group">
                        <label><?php esc_html_e('Email Address', 'leads365-integration'); ?> *</label>
                        <input type="email" name="email" required placeholder="<?php esc_attr_e('e.g. rahul@example.com', 'leads365-integration'); ?>" />
                    </div>

                    <!-- Message -->
                    <div class="leads365-f-group">
                        <label><?php esc_html_e('Requirement / Message', 'leads365-integration'); ?></label>
                        <textarea name="message" rows="3" placeholder="<?php esc_attr_e('How can our team assist you?', 'leads365-integration'); ?>"></textarea>
                    </div>

                    <!-- Submit Button -->
                    <button type="submit" class="leads365-f-submit">
                        <?php echo esc_html($atts['button_text']); ?>
                    </button>
                </form>

                <div class="leads365-f-thankyou" id="<?php echo esc_attr($form_uid); ?>_thanks">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="m9 12 2 2 4-4"></path>
                    </svg>
                    <h4><?php esc_html_e('Thank You!', 'leads365-integration'); ?></h4>
                    <p><?php esc_html_e('Your enquiry has been received. Our team will contact you shortly.', 'leads365-integration'); ?></p>
                </div>
            </div>

            <script>
            (function() {
                var formContainer = document.getElementById('<?php echo esc_js($form_uid); ?>');
                if (!formContainer) return;

                var form = formContainer.querySelector('.leads365-ajax-form');
                var alertBox = formContainer.querySelector('.leads365-f-alert');
                var thanksBox = formContainer.querySelector('.leads365-f-thankyou');
                var submitBtn = form.querySelector('.leads365-f-submit');
                var originalBtnText = submitBtn.textContent;

                form.addEventListener('submit', function(e) {
                    e.preventDefault();
                    alertBox.className = 'leads365-f-alert';
                    alertBox.style.display = 'none';

                    submitBtn.disabled = true;
                    submitBtn.textContent = '<?php echo esc_js(__('Submitting...', 'leads365-integration')); ?>';

                    var formData = new FormData(form);

                    fetch('<?php echo esc_url($ajax_url); ?>', {
                        method: 'POST',
                        body: formData
                    })
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;

                        if (data && data.success) {
                            form.style.display = 'none';
                            thanksBox.style.display = 'block';
                        } else {
                            alertBox.textContent = (data && data.data && data.data.message) ? data.data.message : '<?php echo esc_js(__('Enquiry submission failed. Please try again.', 'leads365-integration')); ?>';
                            alertBox.className = 'leads365-f-alert error';
                            alertBox.style.display = 'block';
                        }
                    })
                    .catch(function(err) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;
                        alertBox.textContent = '<?php echo esc_js(__('Network error connecting to website server.', 'leads365-integration')); ?>';
                        alertBox.className = 'leads365-f-alert error';
                        alertBox.style.display = 'block';
                    });
                });
            })();
            </script>
        </div>
        <?php
        return ob_get_clean();
    }

    /**
     * Handle AJAX Form Submission (Authenticated and Non-Authenticated visitors)
     */
    public function handle_ajax_submit() {
        check_ajax_referer('leads365_form_submit', 'security');

        // Honeypot anti-spam check
        if (!empty($_POST['_hp_trap'])) {
            // Silently discard spam bot submission
            wp_send_json_error(array(
                'message' => __('Bot submission rejected by anti-spam verification.', 'leads365-integration')
            ), 400);
        }

        $name    = isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '';
        $email   = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        $phone   = isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '';
        $message = isset($_POST['message']) ? sanitize_textarea_field(wp_unslash($_POST['message'])) : '';
        $source  = isset($_POST['source']) ? sanitize_text_field(wp_unslash($_POST['source'])) : $this->api->get_default_source();
        $form_id = isset($_POST['form_id']) ? sanitize_text_field(wp_unslash($_POST['form_id'])) : 'leads365_native_form';

        if (empty($name) || empty($phone) || empty($email)) {
            wp_send_json_error(array(
                'message' => __('Please fill in all required contact fields (Name, Phone, Email).', 'leads365-integration')
            ), 400);
        }

        if (!is_email($email)) {
            wp_send_json_error(array(
                'message' => __('Please provide a valid email address.', 'leads365-integration')
            ), 400);
        }

        // Forward to Leads365 CRM via API subsystem
        $lead_data = array(
            'name'    => $name,
            'email'   => $email,
            'phone'   => $phone,
            'message' => $message,
        );

        $context = array(
            'source'         => $source,
            'formId'         => $form_id,
            'idempotencyKey' => 'wp_form_' . time() . '_' . substr(md5($email . $phone . time()), 0, 10),
        );

        $res = $this->api->send_lead($lead_data, $context);

        if ($res['success']) {
            wp_send_json_success(array(
                'message' => __('Enquiry submitted successfully.', 'leads365-integration'),
                'leadId'  => isset($res['data']['lead']['_id']) ? $res['data']['lead']['_id'] : '',
            ));
        } else {
            wp_send_json_error(array(
                'message' => $res['error'] ? $res['error'] : __('Failed to log enquiry in CRM.', 'leads365-integration'),
            ), $res['status'] ? $res['status'] : 500);
        }
    }
}
