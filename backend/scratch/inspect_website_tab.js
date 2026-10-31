const fs = require('fs');
const content = fs.readFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', 'utf8');
const lines = content.split('\n');

console.log('Lines 1767-1850:');
console.log(lines.slice(1766, 1850).join('\n'));

