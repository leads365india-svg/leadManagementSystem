const fs = require('fs');
const content = fs.readFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);

console.log('\n--- Active Tab References ---');
lines.forEach((l, i) => {
  if (l.includes('activeTab ===') || l.includes('setActiveTab(')) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

console.log('\n--- Platform Snippets References ---');
lines.forEach((l, i) => {
  if (l.toLowerCase().includes('wordpress') || l.toLowerCase().includes('nextjs') || l.toLowerCase().includes('react') || l.toLowerCase().includes('php')) {
    if (l.includes('snippet') || l.includes('tab') || l.includes('platform') || l.includes('label') || l.includes('Framework') || l.includes('selectedPlatform')) {
      console.log(`${i+1}: ${l.trim()}`);
    }
  }
});

