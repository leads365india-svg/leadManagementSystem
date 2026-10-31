const fs = require('fs');
const filePath = 'backend/routes/integrationRoutes.js';
let content = fs.readFileSync(filePath, 'utf8');

const targetImport = `  replayIntegrationEvent,
  syncLegacyIntegrations,
} = require("../controllers/integrationController")`;

const replacementImport = `  replayIntegrationEvent,
  syncLegacyIntegrations,
  getIntegrationSnippets,
  testIntegrationById,
} = require("../controllers/integrationController")`;

const targetRoutes = `router.get("/:id", authenticate, getIntegrationById)
router.put("/:id", authenticate, requireAccountAdmin, updateIntegration)
router.post("/:id/rotate-key", authenticate, requireAccountAdmin, rotateIntegrationKey)
router.delete("/:id", authenticate, requireAccountAdmin, deleteIntegration)`;

const replacementRoutes = `router.get("/:id", authenticate, getIntegrationById)
router.get("/:id/snippets", authenticate, getIntegrationSnippets)
router.post("/:id/test", authenticate, requireAccountAdmin, testIntegrationById)
router.put("/:id", authenticate, requireAccountAdmin, updateIntegration)
router.post("/:id/rotate-key", authenticate, requireAccountAdmin, rotateIntegrationKey)
router.delete("/:id", authenticate, requireAccountAdmin, deleteIntegration)`;

let normalized = content.replace(/\r\n/g, '\n');
let ti = targetImport.replace(/\r\n/g, '\n');
let ri = replacementImport.replace(/\r\n/g, '\n');
let tr = targetRoutes.replace(/\r\n/g, '\n');
let rr = replacementRoutes.replace(/\r\n/g, '\n');

if (!normalized.includes(ti)) {
  console.error('Target import not found!');
  process.exit(1);
}
normalized = normalized.replace(ti, ri);

if (!normalized.includes(tr)) {
  console.error('Target routes not found!');
  process.exit(1);
}
normalized = normalized.replace(tr, rr);

fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched integrationRoutes.js');

