const fs = require('fs');
const content = fs.readFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', 'utf8');
const lines = content.split('\n');

for (let i = 1850; i < 2235; i += 80) {
  console.log(`--- Lines ${i}-${Math.min(i+80, 2235)} ---`);
  console.log(lines.slice(i, Math.min(i+80, 2235)).filter(l => l.includes('<h') || l.includes('Snippet') || l.includes('curl') || l.includes('WordPress') || l.includes('HTML') || l.includes('button') || l.includes('selected') || l.includes('tab') || l.includes('Platform')).join('\n'));
}

