const fs = require('fs');
const content = fs.readFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('activeTab === "website"') || l.includes("activeTab === 'website'")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

