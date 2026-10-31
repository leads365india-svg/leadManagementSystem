const fs = require('fs');
const filePath = 'frontend/lib/api.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `  async getIntegrationById(id) {
    return this.request(\`/integrations/\${id}\`)
  }`;

const replacement = `  async getIntegrationById(id) {
    return this.request(\`/integrations/\${id}\`)
  }

  async getIntegrationSnippets(id) {
    return this.request(\`/integrations/\${id}/snippets\`)
  }

  async testIntegration(id, payload = {}) {
    return this.request(\`/integrations/\${id}/test\`, {
      method: "POST",
      body: JSON.stringify({ payload }),
    })
  }`;

let normalized = content.replace(/\r\n/g, '\n');
let t = target.replace(/\r\n/g, '\n');
let r = replacement.replace(/\r\n/g, '\n');

if (!normalized.includes(t)) {
  console.error('Target not found in frontend/lib/api.js');
  process.exit(1);
}

normalized = normalized.replace(t, r);
fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched frontend/lib/api.js');

