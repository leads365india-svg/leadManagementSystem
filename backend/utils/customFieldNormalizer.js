/**
 * Leads365 — Universal Custom Field Normalizer & Sanitizer
 * 
 * Validates, sanitizes, and normalizes dynamic custom fields received from
 * website forms into a consistent structured array and backward-compatible object.
 */

const MAX_CUSTOM_FIELDS = 50;
const MAX_KEY_LENGTH = 64;
const MAX_LABEL_LENGTH = 100;
const MAX_STRING_VALUE_LENGTH = 5000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ARRAY_ITEM_LENGTH = 500;

// Security and internal field blacklist
const EXCLUDED_FIELD_KEYS = new Set([
  "password",
  "pass",
  "pwd",
  "password_confirmation",
  "confirm_password",
  "g_recaptcha_response",
  "g-recaptcha-response",
  "h_captcha_response",
  "h-captcha-response",
  "cf_turnstile_response",
  "cf-turnstile-response",
  "frc_captcha_solution",
  "frc-captcha-solution",
  "captcha",
  "recaptcha",
  "hcaptcha",
  "turnstile",
  "csrf",
  "_csrf",
  "csrf_token",
  "csrftoken",
  "token",
  "_token",
  "authenticity_token",
  "csrfmiddlewaretoken",
  "requestverificationtoken",
  "__requestverificationtoken",
  "hp_trap",
  "_hp_trap",
  "hp_field",
  "lead_hp",
  "_lead_hp",
  "honeypot",
  "website_hp",
  "tenantid",
  "tenant_id",
  "sitekey",
  "site_key",
  "apikey",
  "api_key",
  "secret",
  "accesstoken",
  "access_token",
  "idempotencykey",
  "idempotency_key",
  "submissionid",
  "submission_id",
]);

// Top-level standard lead properties that should not be duplicated as custom fields
const STANDARD_RESERVED_KEYS = new Set([
  "name",
  "fullname",
  "full_name",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "contactname",
  "contact_name",
  "email",
  "emailaddress",
  "email_address",
  "workemail",
  "work_email",
  "phone",
  "phonenumber",
  "phone_number",
  "tel",
  "mobile",
  "company",
  "companyname",
  "company_name",
  "organization",
  "organizationname",
  "organization_name",
  "message",
  "notes",
  "comments",
  "comment",
  "inquiry",
  "enquiry",
  "formid",
  "form_id",
  "formname",
  "form_name",
  "landingpage",
  "landing_page",
  "pageurl",
  "page_url",
  "referrer",
  "referer",
  "source",
  "leadsource",
  "lead_source",
  "istest",
  "is_test",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "token",
  "verificationtoken",
  "verification_token",
]);

/**
 * Strips script tags, HTML tags, and executable constructs from user input.
 */
function sanitizeString(input, maxLength = MAX_STRING_VALUE_LENGTH) {
  if (input === null || input === undefined) return "";
  let str = String(input);

  // Remove null bytes and non-printable control characters except standard whitespace
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Strip script, style, and event-handler tags
  str = str.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  str = str.replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "");
  str = str.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  str = str.replace(/on\w+\s*=\s*(['"]).*?\1/gi, "");
  str = str.replace(/javascript\s*:/gi, "");

  // Strip standard HTML tags while preserving text
  str = str.replace(/<[^>]+>/g, "");

  return str.trim().slice(0, maxLength);
}

/**
 * Normalizes field key to clean lowercase snake_case identifier.
 */
function normalizeFieldKey(keyOrName) {
  if (!keyOrName || typeof keyOrName !== "string") return "";
  return keyOrName
    .trim()
    .toLowerCase()
    .replace(/\[\]$/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_KEY_LENGTH);
}

/**
 * Converts a key into a human-readable Title Case label.
 */
function humanizeFieldKey(key) {
  if (!key || typeof key !== "string") return "";
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, MAX_LABEL_LENGTH);
}

/**
 * Infers an appropriate field type based on the value or explicitly declared type.
 */
function inferFieldType(typeHint, value) {
  const normalizedHint = (typeHint || "").toString().toLowerCase().trim();
  const ALLOWED_TYPES = ["text", "email", "phone", "number", "textarea", "select", "radio", "checkbox", "date"];

  if (ALLOWED_TYPES.includes(normalizedHint)) {
    return normalizedHint;
  }

  if (normalizedHint === "tel") return "phone";
  if (normalizedHint === "select-one" || normalizedHint === "dropdown") return "select";
  if (normalizedHint === "select-multiple") return "checkbox";

  if (Array.isArray(value)) return "checkbox";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && value.includes("\n")) return "textarea";

  return "text";
}

/**
 * Normalizes and sanitizes user-submitted custom fields.
 * 
 * @param {Object} options
 * @param {Object} options.body - Entire raw request body
 * @param {Array|Object} [options.rawCustomFields] - Explicit customFields payload
 * @returns {{ customFields: Array<Object>, customFieldsMap: Object }}
 */
function normalizeCustomFields({ body = {}, rawCustomFields = null }) {
  const structuredFields = [];
  const processedKeys = new Set();
  let orderIndex = 1;

  function addField(key, label, rawValue, typeHint, explicitOrder) {
    if (structuredFields.length >= MAX_CUSTOM_FIELDS) return;

    const cleanKey = normalizeFieldKey(key);
    if (!cleanKey) return;

    // Security check: Ignore passwords, honeypots, tokens, tenant IDs
    if (
      EXCLUDED_FIELD_KEYS.has(cleanKey) ||
      cleanKey.includes("csrf") ||
      cleanKey.includes("captcha") ||
      cleanKey.includes("honeypot") ||
      cleanKey.includes("hp_trap")
    ) {
      processedKeys.add(cleanKey);
      return;
    }
    if (processedKeys.has(cleanKey)) return;

    // Security check: Exclude file inputs unless a dedicated secure upload workflow exists
    if (typeHint && String(typeHint).toLowerCase().trim() === "file") {
      processedKeys.add(cleanKey);
      return;
    }
    if (
      cleanKey.endsWith("_file") ||
      cleanKey.endsWith("_upload") ||
      cleanKey.endsWith("_attachment") ||
      (typeof rawValue === "string" && (rawValue.includes("fakepath") || rawValue.startsWith("data:")))
    ) {
      processedKeys.add(cleanKey);
      return;
    }

    // Discard empty/missing optional values
    if (rawValue === undefined || rawValue === null || rawValue === "") return;
    if (Array.isArray(rawValue) && rawValue.length === 0) return;

    let sanitizedValue;
    let fieldType = inferFieldType(typeHint, rawValue);

    if (Array.isArray(rawValue)) {
      sanitizedValue = rawValue
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => sanitizeString(item, MAX_ARRAY_ITEM_LENGTH))
        .filter((item) => item !== "");
      if (sanitizedValue.length === 0) return;
      fieldType = "checkbox";
    } else if (typeof rawValue === "boolean") {
      sanitizedValue = rawValue;
      fieldType = "checkbox";
    } else if (typeof rawValue === "number" && !isNaN(rawValue) && isFinite(rawValue)) {
      sanitizedValue = rawValue;
      fieldType = "number";
    } else if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      // Handle string booleans like "true"/"false"
      if (trimmed.toLowerCase() === "true") {
        sanitizedValue = true;
        fieldType = "checkbox";
      } else if (trimmed.toLowerCase() === "false") {
        sanitizedValue = false;
        fieldType = "checkbox";
      } else {
        sanitizedValue = sanitizeString(trimmed, MAX_STRING_VALUE_LENGTH);
        if (!sanitizedValue) return;
      }
    } else {
      // Coerce object/unknown to sanitized string
      sanitizedValue = sanitizeString(String(rawValue), MAX_STRING_VALUE_LENGTH);
      if (!sanitizedValue) return;
    }

    const cleanLabel = sanitizeString(
      label || humanizeFieldKey(cleanKey),
      MAX_LABEL_LENGTH
    ) || humanizeFieldKey(cleanKey);

    const order = typeof explicitOrder === "number" && !isNaN(explicitOrder) ? explicitOrder : orderIndex++;

    structuredFields.push({
      key: cleanKey,
      label: cleanLabel,
      value: sanitizedValue,
      type: fieldType,
      order,
    });

    processedKeys.add(cleanKey);
  }

  // 1. Process explicit customFields if supplied
  const inputSource = rawCustomFields !== null ? rawCustomFields : body.customFields;

  if (Array.isArray(inputSource)) {
    // Format A: Array of structured field objects
    for (const item of inputSource) {
      if (!item || typeof item !== "object") continue;
      const key = item.key || item.name || item.id || item.label;
      const label = item.label || humanizeFieldKey(key);
      addField(key, label, item.value, item.type, item.order);
    }
  } else if (inputSource && typeof inputSource === "object") {
    // Format B: Key-value map of custom fields
    for (const [key, value] of Object.entries(inputSource)) {
      addField(key, humanizeFieldKey(key), value, null, null);
    }
  }

  // 2. Absorb unmapped top-level properties from body (Format C: Raw direct webhook)
  if (body && typeof body === "object") {
    for (const [rawKey, rawValue] of Object.entries(body)) {
      const cleanKey = normalizeFieldKey(rawKey);
      if (!cleanKey) continue;
      if (STANDARD_RESERVED_KEYS.has(cleanKey)) continue;
      if (EXCLUDED_FIELD_KEYS.has(cleanKey)) continue;
      if (rawKey === "customFields" || rawKey === "custom_fields" || rawKey === "metadata") continue;
      if (processedKeys.has(cleanKey)) continue;

      addField(cleanKey, humanizeFieldKey(rawKey), rawValue, null, null);
    }
  }

  // Sort by order ascending
  structuredFields.sort((a, b) => a.order - b.order);

  // Generate backward-compatible key-value map
  const customFieldsMap = {};
  for (const f of structuredFields) {
    customFieldsMap[f.key] = f.value;
  }

  return {
    customFields: structuredFields,
    customFieldsMap,
  };
}

module.exports = {
  normalizeCustomFields,
  sanitizeString,
  normalizeFieldKey,
  humanizeFieldKey,
  inferFieldType,
  MAX_CUSTOM_FIELDS,
  EXCLUDED_FIELD_KEYS,
};

