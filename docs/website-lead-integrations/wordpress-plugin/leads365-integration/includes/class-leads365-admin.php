<?php
/**
 * Leads365 Admin Settings Subsystem
 *
 * Provides WordPress administrator interface for configuring CRM API endpoints,
 * private credentials, field mappings, and executing connection tests.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Leads365_Admin {

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

        add_action('admin_menu', array($this, 'register_admin_menu'));
        add_action('admin_init', array($this, 'handle_save_settings'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));
        add_action('wp_ajax_leads365_test_connection', array($this, 'ajax_test_connection'));
    }

    /**
     * Register Admin Top-Level Menu
     */
    public function register_admin_menu() {
        add_menu_page(
            __('Leads365 CRM Settings', 'leads365-integration'),
            __('Leads365', 'leads365-integration'),
            'manage_options',
            'leads365-settings',
            array($this, 'render_settings_page'),
            'dashicons-groups',
            58
        );
    }

    /**
     * Enqueue Admin CSS and JS
     *
     * @param string $hook
     */
    public function enqueue_admin_assets($hook) {
        if ('toplevel_page_leads365-settings' !== $hook) {
            return;
        }

        wp_enqueue_style(
            'leads365-admin-css',
            LEADS365_PLUGIN_URL . 'assets/admin.css',
            array(),
            LEADS365_VERSION
        );

        wp_enqueue_script(
            'leads365-admin-js',
            LEADS365_PLUGIN_URL . 'assets/admin.js',
            array('jquery'),
            LEADS365_VERSION,
            true
        );

        // Pass AJAX configuration safely WITHOUT exposing API key
        wp_localize_script('leads365-admin-js', 'leads365_admin', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce'    => wp_create_nonce('leads365_admin_nonce'),
            'strings'  => array(
                'testing' => __('Testing connection to Leads365 CRM...', 'leads365-integration'),
                'success' => __('Connection successful!', 'leads365-integration'),
                'failed'  => __('Connection test failed.', 'leads365-integration'),
            ),
        ));
    }

    /**
     * Handle form post submission to save settings
     */
    public function handle_save_settings() {
        if (!isset($_POST['leads365_save_settings_action'])) {
            return;
        }

        if (!current_user_can('manage_options')) {
            wp_die(__('You do not have sufficient permissions to access this page.', 'leads365-integration'));
        }

        check_admin_referer('leads365_save_settings', 'leads365_nonce');

        // Sanitize and save API URL
        if (isset($_POST['leads365_api_url'])) {
            $raw_url = sanitize_text_field(wp_unslash($_POST['leads365_api_url']));
            update_option('leads365_api_url', esc_url_raw($raw_url));
        }

        // Sanitize and save API Key (only if user provided a new unmasked key)
        if (isset($_POST['leads365_api_key'])) {
            $raw_key = sanitize_text_field(wp_unslash($_POST['leads365_api_key']));
            // If field is not masked bullet string and not empty, update it
            if (!empty($raw_key) && strpos($raw_key, '•') === false) {
                update_option('leads365_api_key', $raw_key);
            }
        }

        // Sanitize and save default source
        if (isset($_POST['leads365_default_source'])) {
            update_option('leads365_default_source', sanitize_text_field(wp_unslash($_POST['leads365_default_source'])));
        }

        // Sanitize and save default campaign
        if (isset($_POST['leads365_default_campaign'])) {
            update_option('leads365_default_campaign', sanitize_text_field(wp_unslash($_POST['leads365_default_campaign'])));
        }

        // Sanitize and save timeout
        if (isset($_POST['leads365_timeout'])) {
            $timeout = absint($_POST['leads365_timeout']);
            $timeout = ($timeout > 0 && $timeout <= 60) ? $timeout : 15;
            update_option('leads365_timeout', $timeout);
        }

        wp_safe_redirect(add_query_arg(array('page' => 'leads365-settings', 'updated' => 'true'), admin_url('admin.php')));
        exit;
    }

    /**
     * AJAX handler for testing connection
     */
    public function ajax_test_connection() {
        check_ajax_referer('leads365_admin_nonce', 'security');

        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => __('Unauthorized permission check failed.', 'leads365-integration')));
        }

        $res = $this->api->test_connection();

        if ($res['success']) {
            wp_send_json_success(array('message' => $res['message']));
        } else {
            wp_send_json_error(array('message' => $res['message']));
        }
    }

    /**
     * Render the Settings Page HTML
     */
    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $api_url          = $this->api->get_api_url();
        $masked_key       = $this->api->get_masked_api_key();
        $default_source   = $this->api->get_default_source();
        $default_campaign = get_option('leads365_default_campaign', '');
        $timeout          = $this->api->get_timeout();
        $has_key          = !empty($this->api->get_api_key());
        ?>
        <div class="wrap leads365-admin-wrap">
            <div class="leads365-header">
                <div class="leads365-title-area">
                    <h1><?php esc_html_e('Leads365 CRM Integration', 'leads365-integration'); ?></h1>
                    <p class="leads365-subtitle"><?php esc_html_e('Connect WordPress website forms (Shortcode, Elementor, CF7) securely to your Leads365 CRM tenant.', 'leads365-integration'); ?></p>
                </div>
                <div class="leads365-version-badge">
                    <span>v<?php echo esc_html(LEADS365_VERSION); ?></span>
                </div>
            </div>

            <?php if (isset($_GET['updated']) && 'true' === $_GET['updated']) : ?>
                <div class="notice notice-success is-dismissible leads365-notice">
                    <p><strong><?php esc_html_e('Settings saved successfully.', 'leads365-integration'); ?></strong></p>
                </div>
            <?php endif; ?>

            <div class="leads365-layout">
                <!-- Main Form Column -->
                <div class="leads365-main-col">
                    <form method="post" action="" class="leads365-card">
                        <?php wp_nonce_field('leads365_save_settings', 'leads365_nonce'); ?>
                        <input type="hidden" name="leads365_save_settings_action" value="1" />

                        <div class="leads365-card-header">
                            <h2><?php esc_html_e('Connection & API Credentials', 'leads365-integration'); ?></h2>
                            <p><?php esc_html_e('Configure your CRM tenant endpoint and server-side private credentials.', 'leads365-integration'); ?></p>
                        </div>

                        <div class="leads365-card-body">
                            <!-- Endpoint URL -->
                            <div class="leads365-form-group">
                                <label for="leads365_api_url"><?php esc_html_e('Leads365 API Endpoint URL', 'leads365-integration'); ?> <span class="required">*</span></label>
                                <input type="url" id="leads365_api_url" name="leads365_api_url" value="<?php echo esc_attr($api_url); ?>" class="regular-text code" required placeholder="https://your-crm-domain.com/api/integrations/leads/website" />
                                <p class="description"><?php esc_html_e('The verified website lead intake webhook endpoint in your Leads365 instance.', 'leads365-integration'); ?></p>
                            </div>

                            <!-- Private API Key -->
                            <div class="leads365-form-group">
                                <label for="leads365_api_key"><?php esc_html_e('Private Integration API Key', 'leads365-integration'); ?> <span class="required">*</span></label>
                                <div class="leads365-input-with-badge">
                                    <input type="password" id="leads365_api_key" name="leads365_api_key" value="<?php echo esc_attr($masked_key); ?>" class="regular-text code" placeholder="<?php echo $has_key ? esc_attr__('Leave blank to keep current key', 'leads365-integration') : 'lf_live_...'; ?>" autocomplete="new-password" />
                                    <?php if ($has_key) : ?>
                                        <span class="leads365-badge leads365-badge-success"><?php esc_html_e('Key Active', 'leads365-integration'); ?></span>
                                    <?php else : ?>
                                        <span class="leads365-badge leads365-badge-warning"><?php esc_html_e('Missing Key', 'leads365-integration'); ?></span>
                                    <?php endif; ?>
                                </div>
                                <p class="description"><?php esc_html_e('Obtain your Private API Key (lf_live_...) from Leads365 CRM Settings → Lead Feeds → Website Integrations. Stored securely on the server; never exposed to browser visitors.', 'leads365-integration'); ?></p>
                            </div>

                            <!-- Default Source -->
                            <div class="leads365-form-group">
                                <label for="leads365_default_source"><?php esc_html_e('Default Lead Source', 'leads365-integration'); ?></label>
                                <input type="text" id="leads365_default_source" name="leads365_default_source" value="<?php echo esc_attr($default_source); ?>" class="regular-text" placeholder="WordPress" />
                                <p class="description"><?php esc_html_e('Source label attached to incoming leads (e.g. "WordPress", "Corporate Website").', 'leads365-integration'); ?></p>
                            </div>

                            <!-- Default Campaign -->
                            <div class="leads365-form-group">
                                <label for="leads365_default_campaign"><?php esc_html_e('Default Campaign Name (Optional)', 'leads365-integration'); ?></label>
                                <input type="text" id="leads365_default_campaign" name="leads365_default_campaign" value="<?php echo esc_attr($default_campaign); ?>" class="regular-text" placeholder="e.g. Website Inbound 2026" />
                                <p class="description"><?php esc_html_e('Default fallback campaign tag if no utm_campaign parameter is present.', 'leads365-integration'); ?></p>
                            </div>

                            <!-- Timeout -->
                            <div class="leads365-form-group">
                                <label for="leads365_timeout"><?php esc_html_e('HTTP Timeout (seconds)', 'leads365-integration'); ?></label>
                                <input type="number" id="leads365_timeout" name="leads365_timeout" value="<?php echo esc_attr($timeout); ?>" min="5" max="60" class="small-text" />
                                <p class="description"><?php esc_html_e('Maximum wait time for CRM backend response (default 15s).', 'leads365-integration'); ?></p>
                            </div>
                        </div>

                        <div class="leads365-card-footer">
                            <button type="submit" class="button button-primary button-large"><?php esc_html_e('Save Configuration', 'leads365-integration'); ?></button>
                            <button type="button" id="leads365-test-btn" class="button button-secondary button-large" <?php echo !$has_key ? 'disabled' : ''; ?>>
                                <span class="dashicons dashicons-update" style="line-height:28px;"></span>
                                <?php esc_html_e('Test Connection', 'leads365-integration'); ?>
                            </button>
                        </div>
                    </form>

                    <!-- Connection Test Output Container -->
                    <div id="leads365-test-result" class="leads365-test-box" style="display:none;"></div>
                </div>

                <!-- Side Helper Column -->
                <div class="leads365-side-col">
                    <!-- Native Shortcode Box -->
                    <div class="leads365-card">
                        <div class="leads365-card-header">
                            <h3><?php esc_html_e('Native Form Shortcode', 'leads365-integration'); ?></h3>
                        </div>
                        <div class="leads365-card-body">
                            <p><?php esc_html_e('Embed our responsive, anti-spam lead capture form anywhere on your site:', 'leads365-integration'); ?></p>
                            <div class="leads365-code-box">
                                <code>[leads365_form]</code>
                            </div>
                            <p class="description"><?php esc_html_e('Includes built-in honeypot anti-spam, client-side validation, and instant AJAX submission.', 'leads365-integration'); ?></p>
                        </div>
                    </div>

                    <!-- Elementor Pro Card -->
                    <div class="leads365-card">
                        <div class="leads365-card-header">
                            <h3><?php esc_html_e('Elementor Pro Integration', 'leads365-integration'); ?></h3>
                        </div>
                        <div class="leads365-card-body">
                            <p><?php esc_html_e('Automatic lead capture for Elementor forms is active. Use standard field IDs (name, email, phone, message) in your Elementor Form widget.', 'leads365-integration'); ?></p>
                            <div class="leads365-status-pill">
                                <?php if (did_action('elementor_pro/init') || class_exists('\ElementorPro\Plugin')) : ?>
                                    <span class="dashicons dashicons-yes-alt text-success"></span> <?php esc_html_e('Elementor Pro Detected', 'leads365-integration'); ?>
                                <?php else : ?>
                                    <span class="dashicons dashicons-minus"></span> <?php esc_html_e('Elementor Pro not detected (optional)', 'leads365-integration'); ?>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>

                    <!-- Contact Form 7 Card -->
                    <div class="leads365-card">
                        <div class="leads365-card-header">
                            <h3><?php esc_html_e('Contact Form 7 Integration', 'leads365-integration'); ?></h3>
                        </div>
                        <div class="leads365-card-body">
                            <p><?php esc_html_e('Contact Form 7 forms are automatically captured upon successful validation. Standard tags (your-name, your-email, your-phone, your-message) are mapped directly.', 'leads365-integration'); ?></p>
                            <div class="leads365-status-pill">
                                <?php if (defined('WPCF7_VERSION') || class_exists('WPCF7_ContactForm')) : ?>
                                    <span class="dashicons dashicons-yes-alt text-success"></span> <?php esc_html_e('Contact Form 7 Detected', 'leads365-integration'); ?>
                                <?php else : ?>
                                    <span class="dashicons dashicons-minus"></span> <?php esc_html_e('Contact Form 7 not detected (optional)', 'leads365-integration'); ?>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }
}
