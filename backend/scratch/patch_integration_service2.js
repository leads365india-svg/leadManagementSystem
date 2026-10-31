const fs = require('fs');
const filePath = 'backend/services/integrationService.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `    // 1. Source Normalization
    const rawSource =
      body.source ||
      body.utm_source ||
      body.lead_source ||
      (integration.type === "website" ? "Website" : integration.type)
    const normalizedSource = await normalizeSource(tenantId, rawSource)
    if (event) event.source = normalizedSource

    // 2. Extract and sanitize fields (with field mapping support)
    const settings = integration.settings || {}
    let name = (
      body.name ||
      body.fullName ||
      body.full_name ||
      body.contactName ||
      "Website Lead"
    ).slice(0, 100).trim()
    let rawEmail = (body.email || body.emailAddress || body.email_address || "").toLowerCase().trim()
    let rawPhone = (body.phone || body.phoneNumber || body.phone_number || body.tel || body.mobile || "").trim()
    let message = (body.message || body.notes || body.comment || body.inquiry || "").slice(0, 2000).trim()
    let formId = (body.formId || body.form_id || body.formName || body.form_name || "").slice(0, 100).trim()
    let landingPage = (
      body.landingPage ||
      body.landing_page ||
      body.pageUrl ||
      body.page_url ||
      headers.referer ||
      ""
    ).slice(0, 500).trim()
    const isTest = Boolean(body.isTest || body.is_test || query?.isTest === "true")
    const verificationToken = (body.verificationToken || body.token || body.verification_token || "").trim()

    // Apply custom field mappings if configured
    if (Array.isArray(integration.fieldMapping) && integration.fieldMapping.length > 0) {
      for (const map of integration.fieldMapping) {
        if (!map.sourceField || !map.targetField) continue
        const val = body[map.sourceField]
        if (val !== undefined && val !== null) {
          let processedVal = String(val)
          if (map.transform === "lowercase") processedVal = processedVal.toLowerCase()
          if (map.transform === "uppercase") processedVal = processedVal.toUpperCase()
          if (map.transform === "trim") processedVal = processedVal.trim()
          if (map.transform === "phone_e164") processedVal = normalizePhoneDigits(processedVal)

          if (map.targetField === "name") name = processedVal
          if (map.targetField === "email") rawEmail = processedVal.toLowerCase()
          if (map.targetField === "phone") rawPhone = processedVal
          if (map.targetField === "message") message = processedVal
          if (map.targetField === "formId") formId = processedVal
        }
      }
    }`;

const replacement = `    // 1. Source Normalization
    const settings = integration.settings || {}
    const defaultSource = settings.leadSource || (integration.type === "website" ? "Website" : integration.type)
    let rawSource =
      body.source ||
      body.utm_source ||
      body.lead_source ||
      defaultSource

    // 2. Extract and sanitize fields (with field mapping support)
    let name = (
      body.name ||
      body.fullName ||
      body.full_name ||
      body.contactName ||
      "Website Lead"
    ).slice(0, 100).trim()
    let rawEmail = (body.email || body.emailAddress || body.email_address || "").toLowerCase().trim()
    let rawPhone = (body.phone || body.phoneNumber || body.phone_number || body.tel || body.mobile || "").trim()
    let message = (body.message || body.notes || body.comment || body.inquiry || "").slice(0, 2000).trim()
    let formId = (body.formId || body.form_id || body.formName || body.form_name || "").slice(0, 100).trim()
    let company = (body.company || body.organization || body.company_name || "").slice(0, 150).trim()
    let landingPage = (
      body.landingPage ||
      body.landing_page ||
      body.pageUrl ||
      body.page_url ||
      headers.referer ||
      ""
    ).slice(0, 500).trim()
    const isTest = Boolean(body.isTest || body.is_test || query?.isTest === "true")
    const verificationToken = (body.verificationToken || body.token || body.verification_token || "").trim()
    const customFields = {}

    // Apply custom field mappings if configured
    if (Array.isArray(integration.fieldMapping) && integration.fieldMapping.length > 0) {
      for (const map of integration.fieldMapping) {
        if (!map.sourceField || !map.targetField) continue
        let val = body[map.sourceField]
        if ((val === undefined || val === null || val === "") && map.defaultValue) {
          val = map.defaultValue
        }
        if (val !== undefined && val !== null && val !== "") {
          let processedVal = String(val)
          if (map.transform === "lowercase") processedVal = processedVal.toLowerCase()
          if (map.transform === "uppercase") processedVal = processedVal.toUpperCase()
          if (map.transform === "trim") processedVal = processedVal.trim()
          if (map.transform === "phone_e164") processedVal = normalizePhoneDigits(processedVal)

          if (map.targetField === "name") name = processedVal
          else if (map.targetField === "email") rawEmail = processedVal.toLowerCase()
          else if (map.targetField === "phone") rawPhone = processedVal
          else if (map.targetField === "message") message = processedVal
          else if (map.targetField === "formId") formId = processedVal
          else if (map.targetField === "company") company = processedVal
          else if (map.targetField === "landingPage") landingPage = processedVal
          else if (map.targetField === "source") rawSource = processedVal
          else {
            customFields[map.targetField] = processedVal
          }
        }
      }
    }

    const normalizedSource = await normalizeSource(tenantId, rawSource)
    if (event) event.source = normalizedSource`;

const targetStatus = `    let leadStatus = "New"
    if (verConfig.holdUntilConfirmed && !isVerified) {`;

const replacementStatus = `    let leadStatus = settings.defaultStatus || "New"
    if (verConfig.holdUntilConfirmed && !isVerified) {`;

const targetMetadata = `    // 9. Prepare Lead Metadata & Lead Creation
    const leadMetadata = {
      receivedVia: \`\${integration.type}_webhook\`,
      submittedAt: new Date(),
      ipAddress: ip,
      idempotencyKey: idempotencyKey || null,
      verificationTokenHash: verificationToken
        ? crypto.createHash("sha256").update(verificationToken.trim()).digest("hex")
        : null,
      integrationId: integration._id,
    }

    const duplicateHandling = settings.duplicateHandling || "reject"

    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: normalizedSource,
      payload: {
        name,
        email: rawEmail,
        phone: rawPhone,
        status: leadStatus,`;

const replacementMetadata = `    // 9. Prepare Lead Metadata & Lead Creation
    const leadMetadata = {
      receivedVia: \`\${integration.type}_webhook\`,
      submittedAt: new Date(),
      ipAddress: ip,
      idempotencyKey: idempotencyKey || null,
      verificationTokenHash: verificationToken
        ? crypto.createHash("sha256").update(verificationToken.trim()).digest("hex")
        : null,
      integrationId: integration._id,
      websiteDomain: settings.websiteDomain || null,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    }

    const duplicateHandling = settings.duplicateHandling || "reject"

    const serviceResult = await leadService.createOrMergeLead({
      tenantId,
      source: normalizedSource,
      payload: {
        name,
        email: rawEmail,
        phone: rawPhone,
        company: company || undefined,
        status: leadStatus,`;

let normalized = content.replace(/\r\n/g, '\n');
let t1 = target.replace(/\r\n/g, '\n');
let r1 = replacement.replace(/\r\n/g, '\n');
let t2 = targetStatus.replace(/\r\n/g, '\n');
let r2 = replacementStatus.replace(/\r\n/g, '\n');
let t3 = targetMetadata.replace(/\r\n/g, '\n');
let r3 = replacementMetadata.replace(/\r\n/g, '\n');

if (!normalized.includes(t1)) {
  console.error('Target 1 not found!');
  process.exit(1);
}
normalized = normalized.replace(t1, r1);

if (!normalized.includes(t2)) {
  console.error('Target 2 not found!');
  process.exit(1);
}
normalized = normalized.replace(t2, r2);

if (!normalized.includes(t3)) {
  console.error('Target 3 not found!');
  process.exit(1);
}
normalized = normalized.replace(t3, r3);

fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched integrationService.js part 2');

