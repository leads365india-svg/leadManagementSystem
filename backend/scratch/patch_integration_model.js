const fs = require('fs');
const filePath = 'backend/models/Integration.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `    settings: {
      acceptedForms: {
        type: [String],
        default: [],
      },`;

const replacement = `    settings: {
      websiteDomain: {
        type: String,
        default: "",
        trim: true,
      },
      allowedOrigins: {
        type: [String],
        default: [],
      },
      leadSource: {
        type: String,
        default: "",
        trim: true,
      },
      defaultStatus: {
        type: String,
        default: "New",
        trim: true,
      },
      acceptedForms: {
        type: [String],
        default: [],
      },`;

let normalized = content.replace(/\r\n/g, '\n');
let t = target.replace(/\r\n/g, '\n');
let r = replacement.replace(/\r\n/g, '\n');

if (!normalized.includes(t)) {
  console.error('Target not found in Integration.js');
  process.exit(1);
}

normalized = normalized.replace(t, r);
fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched Integration.js settings schema');

