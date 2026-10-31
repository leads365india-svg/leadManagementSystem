const fs = require('fs');
const filePath = 'backend/services/integrationService.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update authenticateSiteKey to allow all website types
const target1 = `  // 2. Check Integration collection
  const integration = await Integration.findOne({
    siteKey: cleanKey,
    type: "website",
  }).setOptions({ skipTenantFilter: true })`;

const replacement1 = `  // 2. Check Integration collection across all website integration types
  const integration = await Integration.findOne({
    siteKey: cleanKey,
    type: { $in: ["website", "wordpress", "html", "php", "react", "nextjs", "webhook", "generic"] },
  }).setOptions({ skipTenantFilter: true })`;

// 2. Update intakeWebhookPayload to add timestamp check and HMAC signature verification
const target2 = `  // 0. Abuse protection: Honeypot check
  if (body && (body._hp_trap || body.hp_field || body._lead_hp)) {
    return {
      success: false,
      status: 400,
      error: "Spam submission rejected by honeypot verification",
    }
  }

  // 1. Authenticate credential (API key or public site key)`;

const replacement2 = `  // 0. Abuse protection: Honeypot check
  if (body && (body._hp_trap || body.hp_field || body._lead_hp)) {
    return {
      success: false,
      status: 400,
      error: "Spam submission rejected by honeypot verification",
    }
  }

  // 0b. Timestamp verification for replay attack protection (if supplied)
  const timestampHeader = headers["x-timestamp"] || headers["x-request-timestamp"] || headers["timestamp"]
  if (timestampHeader) {
    const ts = parseInt(timestampHeader, 10)
    const now = Date.now()
    // 5-minute validity window (300,000 ms) with 60s future clock skew tolerance
    if (isNaN(ts) || ts > now + 60000 || now - ts > 300000) {
      return {
        success: false,
        status: 401,
        error: "Unauthorized: Request timestamp is expired or outside allowable window (5 minutes)",
      }
    }
  }

  // 1. Authenticate credential (API key or public site key)`;

// 3. HMAC signature check after authentication
const target3 = `  const { integration, tenantId, isLegacy, legacyConfig, allowedOrigins } = authResult

  // Allowed Origin validation for public site key requests`;

const replacement3 = `  const { integration, tenantId, isLegacy, legacyConfig, allowedOrigins } = authResult

  // 1b. HMAC Signature verification (if signature header provided for server-to-server requests)
  const signatureHeader =
    headers["x-signature-256"] ||
    headers["x-hub-signature-256"] ||
    headers["x-signature"] ||
    headers["x-hmac-signature"]

  if (signatureHeader && rawApiKey) {
    const rawSig = String(signatureHeader).replace(/^sha256=/, "").trim()
    const payloadToSign = typeof body === "string" ? body : JSON.stringify(body)
    const expectedSig = crypto.createHmac("sha256", rawApiKey).update(payloadToSign).digest("hex")

    if (
      rawSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(rawSig, "utf8"), Buffer.from(expectedSig, "utf8"))
    ) {
      return {
        success: false,
        status: 401,
        error: "Unauthorized: Invalid HMAC signature",
      }
    }
  }

  // Allowed Origin validation for public site key requests`;

let normalized = content.replace(/\r\n/g, '\n');
let t1 = target1.replace(/\r\n/g, '\n');
let r1 = replacement1.replace(/\r\n/g, '\n');
let t2 = target2.replace(/\r\n/g, '\n');
let r2 = replacement2.replace(/\r\n/g, '\n');
let t3 = target3.replace(/\r\n/g, '\n');
let r3 = replacement3.replace(/\r\n/g, '\n');

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
console.log('Successfully patched integrationService.js part 1');

