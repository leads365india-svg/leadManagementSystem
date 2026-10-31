const fs = require('fs');

// 1. Patch LeadSource.js
let lsContent = fs.readFileSync('backend/models/LeadSource.js', 'utf8');
const lsTarget = `  if (slugified.includes("website") || slugified.includes("landing") || slugified.includes("web_form")) {
    return "Website"
  }`;
const lsReplacement = `  if (slugified.includes("wordpress") || slugified.startsWith("wp_")) {
    return "WordPress"
  }
  if (slugified.includes("website") || slugified.includes("landing") || slugified.includes("web_form")) {
    return "Website"
  }`;
lsContent = lsContent.replace(lsTarget.replace(/\r\n/g, '\n'), lsReplacement.replace(/\r\n/g, '\n'));
fs.writeFileSync('backend/models/LeadSource.js', lsContent, 'utf8');
console.log('Successfully patched LeadSource.js');

// 2. Patch integrationService.js
let isContent = fs.readFileSync('backend/services/integrationService.js', 'utf8');
const isTarget = `  if (integration) {
    return {
      integration,
      tenantId: integration.tenantId,
      isLegacy: false,
      isSiteKey: true,
      allowedOrigins: integration.settings?.allowedOrigins || [],
    }
  }`;

const isReplacement = `  if (integration) {
    let origins = [...(integration.settings?.allowedOrigins || [])]
    if (integration.settings?.websiteDomain) {
      const cleanDom = integration.settings.websiteDomain.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '').trim()
      if (cleanDom) {
        if (!origins.includes(\`http://\${cleanDom}\`)) origins.push(\`http://\${cleanDom}\`)
        if (!origins.includes(\`https://\${cleanDom}\`)) origins.push(\`https://\${cleanDom}\`)
      }
    }
    if (origins.length === 0) {
      origins.push("http://localhost:3000", "http://localhost:5000", "http://127.0.0.1:3000")
    }
    return {
      integration,
      tenantId: integration.tenantId,
      isLegacy: false,
      isSiteKey: true,
      allowedOrigins: origins,
    }
  }`;

isContent = isContent.replace(isTarget.replace(/\r\n/g, '\n'), isReplacement.replace(/\r\n/g, '\n'));
fs.writeFileSync('backend/services/integrationService.js', isContent, 'utf8');
console.log('Successfully patched integrationService.js');

