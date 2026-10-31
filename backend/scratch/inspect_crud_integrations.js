const fs = require('fs');
const content = fs.readFileSync('backend/controllers/integrationController.js', 'utf8');
const lines = content.split('\n');
console.log(lines.slice(835, 960).join('\n'));

