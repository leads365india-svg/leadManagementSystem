<?php
/**
 * Plugin Name: Leads365 CRM Integration
 * Plugin URI:  https://leads365.in
 * Description: Connect WordPress website forms (Native Shortcode, Elementor Pro Forms, Contact Form 7, WPForms) securely to Leads365 CRM with zero credential exposure.
 * Version:     1.0.0
 * Author:      Leads365 Engineering Team
 * Author URI:  https://leads365.in
 * License:     GPL-2.0+
 * License URI: http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain: leads365-integration
 * Domain Path: /languages
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

// Plugin Constants
define('LEADS365_VERSION', '1.0.0');
define('LEADS365_PLUGIN_FILE', __FILE__);
define('LEADS365_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('LEADS365_PLUGIN_URL', plugin_dir_url(__FILE__));
define('LEADS365_PLUGIN_BASENAME', plugin_basename(__FILE__));

// Require Core Subsystems
require_once LEADS365_PLUGIN_DIR . 'includes/class-leads365-api.php';
require_once LEADS365_PLUGIN_DIR . 'includes/class-leads365-admin.php';
require_once LEADS365_PLUGIN_DIR . 'includes/class-leads365-form.php';
require_once LEADS365_PLUGIN_DIR . 'includes/class-leads365-elementor.php';
require_once LEADS365_PLUGIN_DIR . 'includes/class-leads365-contact-form-7.php';

/**
 * Main Leads365 Plugin Singleton
 */
final class Leads365_Plugin {

    /**
     * Singleton instance
     * @var Leads365_Plugin
     */
    private static $instance = null;

    /**
     * API Subsystem
     * @var Leads365_API
     */
    public $api = null;

    /**
     * Admin Subsystem
     * @var Leads365_Admin
     */
    public $admin = null;

    /**
     * Native Form Subsystem
     * @var Leads365_Form
     */
    public $form = null;

    /**
     * Elementor Subsystem
     * @var Leads365_Elementor
     */
    public $elementor = null;

    /**
     * Contact Form 7 Subsystem
     * @var Leads365_Contact_Form_7
     */
    public $cf7 = null;

    /**
     * Get singleton instance
     * @return Leads365_Plugin
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
    private function __construct() {
        $this->init_subsystems();
        $this->init_hooks();
    }

    /**
     * Initialize subsystems
     */
    private function init_subsystems() {
        $this->api       = Leads365_API::get_instance();
        $this->admin     = new Leads365_Admin($this->api);
        $this->form      = new Leads365_Form($this->api);
        $this->elementor = new Leads365_Elementor($this->api);
        $this->cf7       = new Leads365_Contact_Form_7($this->api);
    }

    /**
     * Initialize lifecycle hooks
     */
    private function init_hooks() {
        add_action('init', array($this, 'on_init'));
        add_filter('plugin_action_links_' . LEADS365_PLUGIN_BASENAME, array($this, 'add_action_links'));
    }

    /**
     * On WordPress Init
     */
    public function on_init() {
        load_plugin_textdomain('leads365-integration', false, dirname(LEADS365_PLUGIN_BASENAME) . '/languages');
    }

    /**
     * Add settings shortcut link to plugins list page
     *
     * @param array $links
     * @return array
     */
    public function add_action_links($links) {
        $settings_link = '<a href="' . esc_url(admin_url('admin.php?page=leads365-settings')) . '">' . __('Settings', 'leads365-integration') . '</a>';
        array_unshift($links, $settings_link);
        return $links;
    }
}

/**
 * Bootstrap the plugin on plugins_loaded
 */
function leads365_init() {
    return Leads365_Plugin::get_instance();
}
add_action('plugins_loaded', 'leads365_init');

/**
 * Activation hook
 */
function leads365_activate() {
    // Set safe defaults if not already present
    if (false === get_option('leads365_api_url')) {
        add_option('leads365_api_url', 'http://localhost:5000/api/integrations/leads/website');
    }
    if (false === get_option('leads365_default_source')) {
        add_option('leads365_default_source', 'WordPress');
    }
    if (false === get_option('leads365_timeout')) {
        add_option('leads365_timeout', 15);
    }
}
register_activation_hook(__FILE__, 'leads365_activate');
