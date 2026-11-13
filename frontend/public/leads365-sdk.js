/**
 * Leads365 Universal Form SDK (v2.1.0)
 * Hosted script for dynamic tenant website lead capture.
 */
(function(window, document) {
  'use strict';

  if (window.__Leads365_Loaded) {
    return;
  }
  window.__Leads365_Loaded = true;

  try {
    // 1. Detect current integration script element & configuration
    var scriptElement = document.currentScript || (function() {
      var scripts = document.querySelectorAll('script[data-site-key], script[src*="snippet.js"], script[src*="universal-sdk.js"], script[src*="sdk.js"]');
      return scripts.length > 0 ? scripts[scripts.length - 1] : null;
    })();

    var siteKey = scriptElement ? (scriptElement.getAttribute('data-site-key') || scriptElement.getAttribute('data-key')) : null;
    var customEndpoint = scriptElement ? scriptElement.getAttribute('data-endpoint') : null;
    var customSelector = scriptElement ? scriptElement.getAttribute('data-form-selector') : null;
    var debugMode = scriptElement ? (scriptElement.getAttribute('data-debug') === 'true' || window.__LEADS365_DEBUG === true) : false;

    var scriptOrigin = '';
    if (scriptElement && scriptElement.src) {
      try {
        var urlObj = new URL(scriptElement.src, window.location.href);
        scriptOrigin = urlObj.origin;
      } catch (e) {}
    }

    var defaultEndpoint = scriptOrigin
      ? (scriptOrigin + '/api/integrations/leads/website')
      : '/api/integrations/leads/website';

    var endpoint = customEndpoint || defaultEndpoint;

    function log() {
      if (debugMode && window.console && window.console.log) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Leads365]');
        window.console.log.apply(window.console, args);
      }
    }

    function warn() {
      if (window.console && window.console.warn) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Leads365]');
        window.console.warn.apply(window.console, args);
      }
    }

    if (!siteKey) {
      warn('Missing required data-site-key attribute on Leads365 integration script tag.');
    }

    // 2. UTM & Query Parameter Extractor
    function getQueryParams() {
      var params = {};
      try {
        var search = window.location.search.substring(1);
        if (search) {
          var pairs = search.split('&');
          for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            if (pair.length === 2) {
              params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1].replace(/\+/g, ' '));
            }
          }
        }
      } catch (e) {}
      return params;
    }

    // 3. String & Label Utilities
    function humanizeKey(str) {
      if (!str || typeof str !== 'string') return '';
      var clean = str.replace(/\[\]$/g, '').replace(/^(form_|input_|field_)/i, '');
      clean = clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      clean = clean.replace(/[_-]+/g, ' ').trim();
      return clean.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    function cleanLabelText(txt) {
      if (!txt) return '';
      return txt
        .replace(/[\*:]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function slugify(text) {
      if (!text) return '';
      return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\[\]$/g, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 64);
    }

    function extractElementLabel(el, form) {
      if (!el) return '';
      // 1. Explicit data-label attribute
      var dataLabel = el.getAttribute('data-label') || el.getAttribute('data-field-label');
      if (dataLabel && dataLabel.trim()) return cleanLabelText(dataLabel);

      // 2. Associated <label for="elementId">
      if (el.id && form) {
        try {
          var labelFor = form.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (labelFor && labelFor.textContent && labelFor.textContent.trim()) {
            return cleanLabelText(labelFor.textContent);
          }
        } catch (e) {}
      }

      // 3. Closest ancestor <label>
      try {
        var parentLabel = el.closest('label');
        if (parentLabel) {
          var clone = parentLabel.cloneNode(true);
          var nestedInputs = clone.querySelectorAll('input, select, textarea, button');
          for (var k = 0; k < nestedInputs.length; k++) {
            nestedInputs[k].parentNode.removeChild(nestedInputs[k]);
          }
          if (clone.textContent && clone.textContent.trim()) {
            return cleanLabelText(clone.textContent);
          }
        }
      } catch (e) {}

      // 4. aria-label
      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return cleanLabelText(ariaLabel);

      // 5. aria-labelledby
      var labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        try {
          var refEl = document.getElementById(labelledBy);
          if (refEl && refEl.textContent && refEl.textContent.trim()) {
            return cleanLabelText(refEl.textContent);
          }
        } catch (e) {}
      }

      // 6. Placeholder
      var placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim() && placeholder.length < 60) {
        return cleanLabelText(placeholder);
      }

      // 7. Humanized fallback from element name or id
      return humanizeKey(el.name || el.id || 'Field');
    }

    // 4. Security, Honeypot & Sensitive Field Filters
    var EXCLUDED_NAMES = [
      'password', 'pass', 'pwd', 'password_confirmation', 'confirm_password',
      'g-recaptcha-response', 'h-captcha-response', 'cf-turnstile-response', 'frc-captcha-solution',
      '_csrf', 'csrf_token', '_token', 'authenticity_token', 'csrfmiddlewaretoken', '__requestverificationtoken',
      'credit_card', 'cc_number', 'card_number', 'cvv', 'cvc', 'exp_month', 'exp_year',
      'api_key', 'access_token', 'secret', 'auth_token'
    ];

    function isSensitiveOrSecurityField(name, type) {
      // Exclude passwords, files, buttons, and submit elements
      if (type === 'password' || type === 'file' || type === 'button' || type === 'submit' || type === 'reset') {
        return true;
      }
      if (!name) return false;
      var lower = name.toLowerCase().trim();
      if (lower.indexOf('captcha') !== -1) return true;
      for (var i = 0; i < EXCLUDED_NAMES.length; i++) {
        if (lower === EXCLUDED_NAMES[i] || lower === EXCLUDED_NAMES[i] + '[]') {
          return true;
        }
      }
      return false;
    }

    function isHoneypotField(name) {
      if (!name) return false;
      var lower = name.toLowerCase().trim();
      return (
        lower === '_hp_trap' ||
        lower === 'hp_field' ||
        lower === '_lead_hp' ||
        lower === 'honeypot' ||
        lower === 'website_hp'
      );
    }

    function isIgnoredHiddenField(el) {
      if (el.type !== 'hidden') return false;
      var name = (el.name || '').toLowerCase().trim();
      if (!name) return true;
      // Allow explicit leads365 fields
      if (el.hasAttribute('data-leads365-field') || el.hasAttribute('data-label')) return false;
      // Allow form identification and tracking fields
      if (name === 'formid' || name === 'form_id' || name === 'formname' || name === 'form_name') return false;
      // Exclude framework hidden internal fields
      if (name.indexOf('viewstate') !== -1 || name.indexOf('eventvalidation') !== -1 || name === 'utf8' || name === '_method') {
        return true;
      }
      if (isSensitiveOrSecurityField(name, 'hidden')) return true;
      return false;
    }

    // 5. Standard Lead Fields Detector
    function isStandardNameField(key) {
      var k = key.toLowerCase();
      return k === 'name' || k === 'fullname' || k === 'full_name' || k === 'contact_name' || k === 'your-name' || k === 'client_name';
    }

    function isFirstNameField(key) {
      var k = key.toLowerCase();
      return k === 'firstname' || k === 'first_name' || k === 'fname' || k === 'given_name';
    }

    function isLastNameField(key) {
      var k = key.toLowerCase();
      return k === 'lastname' || k === 'last_name' || k === 'lname' || k === 'family_name' || k === 'surname';
    }

    function isStandardEmailField(key) {
      var k = key.toLowerCase();
      return k === 'email' || k === 'emailaddress' || k === 'email_address' || k === 'work_email' || k === 'workemail' || k === 'your-email';
    }

    function isStandardPhoneField(key) {
      var k = key.toLowerCase();
      return k === 'phone' || k === 'phonenumber' || k === 'phone_number' || k === 'mobile' || k === 'tel' || k === 'telephone' || k === 'your-phone' || k === 'contact_number';
    }

    function isStandardCompanyField(key) {
      var k = key.toLowerCase();
      return k === 'company' || k === 'company_name' || k === 'companyname' || k === 'organization' || k === 'organization_name' || k === 'org_name' || k === 'business_name' || k === 'hospital_name' || k === 'clinic_name';
    }

    function isStandardMessageField(key) {
      var k = key.toLowerCase();
      return k === 'message' || k === 'notes' || k === 'comments' || k === 'comment' || k === 'inquiry' || k === 'enquiry' || k === 'your-message' || k === 'description';
    }

    // 6. Form Field Extraction Engine (Supports DOM ordering, dynamic/conditional fields, checkboxes)
    function extractFormData(form) {
      var rawValues = {};
      var rawLabels = {};
      var rawTypes = {};
      var fieldOrder = [];
      var honeypotTrap = null;

      var elements = form.elements;
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (!el || !el.name || el.disabled) continue;

        var name = el.name.trim();
        var type = (el.type || el.tagName || 'text').toLowerCase();

        // 1. Honeypot check
        if (isHoneypotField(name)) {
          if (el.value) honeypotTrap = el.value;
          continue;
        }

        // 2. Sensitive fields, files, buttons
        if (isSensitiveOrSecurityField(name, type)) continue;

        // 3. Framework hidden fields
        if (isIgnoredHiddenField(el)) continue;

        // 4. Exclude hidden anti-bot traps
        var isVisible = el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
        if (!isVisible && (el.type === 'text' || el.type === 'email' || el.type === 'tel') && el.style.display === 'none') {
          if (el.value) honeypotTrap = el.value;
          continue;
        }

        var label = extractElementLabel(el, form);

        if (fieldOrder.indexOf(name) === -1) {
          fieldOrder.push(name);
        }

        rawLabels[name] = label;
        rawTypes[name] = type;

        if (type === 'radio') {
          if (el.checked) {
            rawValues[name] = el.value;
          }
        } else if (type === 'checkbox') {
          if (!rawValues[name]) {
            rawValues[name] = [];
          }
          if (el.checked) {
            rawValues[name].push(el.value || 'true');
          }
        } else if (type === 'select-multiple') {
          var selectedOpts = [];
          for (var optIdx = 0; optIdx < el.options.length; optIdx++) {
            if (el.options[optIdx].selected) {
              selectedOpts.push(el.options[optIdx].value || el.options[optIdx].text);
            }
          }
          if (selectedOpts.length > 0) {
            rawValues[name] = selectedOpts;
          }
        } else if (type === 'select-one' || el.tagName.toLowerCase() === 'select') {
          var selectedOpt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
          var val = selectedOpt ? selectedOpt.value : el.value;
          if (val && val !== '""' && val !== 'select' && val !== 'none') {
            rawValues[name] = val;
          }
        } else {
          var textVal = (el.value || '').trim();
          if (textVal) {
            rawValues[name] = textVal;
          }
        }
      }

      // Resolve single vs multi checkboxes
      for (var fName in rawValues) {
        if (Array.isArray(rawValues[fName])) {
          var matchedElements = form.querySelectorAll('[name="' + CSS.escape(fName) + '"]');
          if (matchedElements.length <= 1) {
            // Single checkbox
            rawValues[fName] = rawValues[fName].length > 0
              ? (rawValues[fName][0] === 'true' || rawValues[fName][0] === 'on' ? true : rawValues[fName][0])
              : false;
          } else {
            // Multiple checkboxes sharing same name: keep as array of checked values
          }
        }
      }

      return {
        values: rawValues,
        labels: rawLabels,
        types: rawTypes,
        order: fieldOrder,
        honeypotTrap: honeypotTrap
      };
    }

    // 7. Package Payload (Standard Fields + Structured customFields Array)
    function buildLeadPayload(extracted, form) {
      var values = extracted.values;
      var labels = extracted.labels;
      var types = extracted.types;
      var orderList = extracted.order;
      var q = getQueryParams();

      var name = '';
      var firstName = '';
      var lastName = '';
      var email = '';
      var phone = '';
      var company = '';
      var message = '';

      var customFields = [];
      var orderCounter = 1;

      for (var i = 0; i < orderList.length; i++) {
        var rawKey = orderList[i];
        var val = values[rawKey];
        if (val === undefined || val === null || val === '') continue;
        if (Array.isArray(val) && val.length === 0) continue;

        var cleanKey = slugify(rawKey);
        var label = labels[rawKey] || humanizeKey(rawKey);
        var fieldType = types[rawKey] || (Array.isArray(val) ? 'checkbox' : typeof val === 'boolean' ? 'checkbox' : 'text');
        if (fieldType === 'select-one') fieldType = 'select';
        if (fieldType === 'select-multiple') fieldType = 'checkbox';

        // Classify standard fields
        if (isStandardNameField(cleanKey) && !name) {
          name = String(val).trim();
          continue;
        }
        if (isFirstNameField(cleanKey) && !firstName) {
          firstName = String(val).trim();
          continue;
        }
        if (isLastNameField(cleanKey) && !lastName) {
          lastName = String(val).trim();
          continue;
        }
        if (isStandardEmailField(cleanKey) && !email) {
          email = String(val).trim();
          continue;
        }
        if (isStandardPhoneField(cleanKey) && !phone) {
          phone = String(val).trim();
          continue;
        }
        if (isStandardCompanyField(cleanKey) && !company) {
          company = String(val).trim();
          continue;
        }
        if (isStandardMessageField(cleanKey) && !message) {
          message = String(val).trim();
          continue;
        }

        // Generic structured custom field
        customFields.push({
          key: cleanKey,
          label: label,
          value: val,
          type: fieldType,
          order: orderCounter++
        });
      }

      if (!name && (firstName || lastName)) {
        name = (firstName + ' ' + lastName).trim();
      }

      var formId = (form && (form.getAttribute('data-form-id') || form.id || form.getAttribute('name'))) || 'website_form';

      // Unique client idempotency key
      var idempotencyKey = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

      var payload = {
        name: name,
        email: email,
        phone: phone,
        company: company,
        message: message,
        customFields: customFields,
        formId: formId,
        landingPage: window.location.href,
        referrer: document.referrer || '',
        idempotencyKey: idempotencyKey,
        utm_source: q.utm_source || '',
        utm_medium: q.utm_medium || '',
        utm_campaign: q.utm_campaign || '',
        utm_term: q.utm_term || '',
        utm_content: q.utm_content || '',
        gclid: q.gclid || '',
        fbclid: q.fbclid || ''
      };

      if (extracted.honeypotTrap) {
        payload._hp_trap = extracted.honeypotTrap;
      }

      return payload;
    }

    // 8. Lead Transmission Engine with Explicit Status & Coordination
    function submitLead(payload, form, options) {
      options = options || {};
      var activeSiteKey = options.siteKey || siteKey;
      var activeEndpoint = options.endpoint || endpoint;

      if (!activeSiteKey) {
        var errNoKey = new Error('Leads365: Missing Site Key');
        warn(errNoKey.message);
        return Promise.reject(errNoKey);
      }

      // Coordinate submit ownership: Mark form as in-flight
      if (form) {
        form.setAttribute('data-leads365-submitting', 'true');
        form._leads365LastCaptureTime = Date.now();
      }

      // UI status element handler
      function updateStatusUI(status, msg) {
        if (!form) return;
        var statusEl = form.querySelector('[data-leads365-status], .leads365-status-message, #leads365-status');
        if (statusEl) {
          statusEl.textContent = msg;
          statusEl.style.display = 'block';
          if (status === 'success') {
            statusEl.style.color = '#059669';
          } else if (status === 'error') {
            statusEl.style.color = '#dc2626';
          } else {
            statusEl.style.color = '#4f46e5';
          }
        }
      }

      updateStatusUI('submitting', 'Submitting enquiry...');

      // Dispatch submit event
      try {
        var startEvent = new CustomEvent('leads365:submit', { detail: { payload: payload, form: form } });
        document.dispatchEvent(startEvent);
      } catch (e) {}

      var requestHeaders = {
        'Content-Type': 'application/json',
        'x-site-key': activeSiteKey,
        'x-idempotency-key': payload.idempotencyKey || ('sub_' + Date.now())
      };

      return fetch(activeEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        keepalive: true
      })
      .then(function(res) {
        return res.json().then(function(data) {
          if (!res.ok || (data && data.success === false)) {
            var errMsg = (data && (data.error || data.message)) || res.statusText || 'Lead submission failed';
            throw new Error(errMsg);
          }
          return data;
        });
      })
      .then(function(result) {
        log('Lead submission successful:', result);
        if (form) {
          form.removeAttribute('data-leads365-submitting');
          form.setAttribute('data-leads365-submitted', 'true');
          form._leads365LastCaptureTime = Date.now();
        }
        updateStatusUI('success', 'Thank you! Your enquiry has been received.');
        try {
          var successEvent = new CustomEvent('leads365:success', { detail: { result: result, payload: payload, form: form } });
          document.dispatchEvent(successEvent);
        } catch (e) {}
        return result;
      })
      .catch(function(err) {
        warn('Lead submission error:', err.message);
        if (form) {
          form.removeAttribute('data-leads365-submitting');
        }
        updateStatusUI('error', 'Submission error: ' + err.message);
        try {
          var errorEvent = new CustomEvent('leads365:error', { detail: { error: err, payload: payload, form: form } });
          document.dispatchEvent(errorEvent);
        } catch (e) {}
        throw err;
      });
    }

    // 9. Form Target Resolution (STRICT: Only Explicitly Configured Forms)
    function isFormEligible(form) {
      if (!form || form.tagName !== 'FORM') return false;

      // Never intercept forms marked with data-leads365-ignore
      if (form.hasAttribute('data-leads365-ignore') || form.classList.contains('leads365-ignore')) {
        return false;
      }

      // Never intercept login, password reset, or registration forms
      if (form.querySelector('input[type="password"]')) {
        return false;
      }

      // Never intercept search forms
      if (form.getAttribute('role') === 'search' || (form.action && form.action.indexOf('/search') !== -1)) {
        return false;
      }

      // Never intercept checkout or payment forms
      if (form.querySelector('[data-stripe], [name*="card"], [id*="stripe"], [class*="stripe"], [name*="paypal"]')) {
        return false;
      }

      // STRICT REQUIREMENT 1: Capture ONLY explicitly configured forms:
      // a. data-leads365-form attribute or data-leads365="true"
      if (form.hasAttribute('data-leads365-form') || form.getAttribute('data-leads365') === 'true') {
        return true;
      }

      // b. leads365-form class
      if (form.classList.contains('leads365-form')) {
        return true;
      }

      // c. Explicit CSS selector specified on script tag (e.g. data-form-selector="#quoteForm, .contact-us")
      if (customSelector) {
        try {
          if (form.matches(customSelector)) {
            return true;
          }
        } catch (e) {}
      }

      // STRICT: Do NOT automatically capture forms containing email or phone fields.
      return false;
    }

    // 10. Event Listener & Submission Coordination Engine
    function handleFormSubmit(e) {
      var form = e.target;
      if (!isFormEligible(form)) return;

      // Coordinate submit ownership:
      // 1. If form has data-leads365-manual="true", let the developer's script call window.Leads365.capture()
      if (form.getAttribute('data-leads365-manual') === 'true') {
        return;
      }

      // 2. Prevent duplicate submissions:
      // If the developer already called window.Leads365.capture() in their custom handler within the last 3000ms, skip!
      if (form._leads365LastCaptureTime && (Date.now() - form._leads365LastCaptureTime < 3000)) {
        log('Form submission already initiated programmatically, skipping passive listener duplicate.');
        return;
      }

      // 3. In-flight lock: Prevent rapid double clicks
      if (form.getAttribute('data-leads365-submitting') === 'true') {
        log('Submission already in flight, skipping duplicate event.');
        return;
      }

      var extracted = extractFormData(form);
      var payload = buildLeadPayload(extracted, form);

      submitLead(payload, form).catch(function() {
        // Dispatched via leads365:error event
      });
    }

    function initListeners() {
      document.addEventListener('submit', handleFormSubmit, true);
      log('Universal Form SDK initialized and listening exclusively for explicitly configured forms.');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initListeners);
    } else {
      initListeners();
    }

    // 11. Public Programmatic JavaScript API (window.Leads365)
    window.Leads365 = window.Leads365 || {};
    window.Leads365.version = '2.1.0-universal';
    window.Leads365.siteKey = siteKey;
    window.Leads365.endpoint = endpoint;

    /**
     * Programmatic capture for custom React/Next.js/Vue submit handlers:
     * Accepts either a form DOM element or a custom data object.
     * 
     * Example React / Next.js usage:
     * const onSubmit = async (e) => {
     *   e.preventDefault();
     *   await window.Leads365.capture(formRef.current);
     * };
     */
    window.Leads365.capture = function(formOrData, options) {
      options = options || {};
      if (formOrData && formOrData.tagName === 'FORM') {
        var form = formOrData;
        form._leads365LastCaptureTime = Date.now();
        var extracted = extractFormData(form);
        var payload = buildLeadPayload(extracted, form);
        return submitLead(payload, form, options);
      } else if (typeof formOrData === 'object' && formOrData !== null) {
        var payload = Object.assign({}, formOrData);
        if (!payload.idempotencyKey) {
          payload.idempotencyKey = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
        }
        if (!payload.landingPage && typeof window !== 'undefined') {
          payload.landingPage = window.location.href;
        }
        return submitLead(payload, null, options);
      } else {
        return Promise.reject(new Error('Leads365: Expected a Form element or data object.'));
      }
    };

    window.Leads365.extractForm = function(form) {
      if (!form || form.tagName !== 'FORM') return null;
      var extracted = extractFormData(form);
      return buildLeadPayload(extracted, form);
    };

  } catch (err) {
    if (window.console && window.console.warn) {
      window.console.warn('[Leads365] Universal SDK initialization warning:', err);
    }
  }
})(window, document);