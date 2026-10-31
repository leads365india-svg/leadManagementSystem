const fs = require('fs');
const content = fs.readFileSync('backend/controllers/integrationController.js', 'utf8');
const lines = content.split('\n');
console.log(lines.slice(960, 1040).join('\n'));

