/**
 * Reproducible patch for ESLint 8 / eslint-plugin-react circular reference issue.
 * In eslint-plugin-react, plugin.configs.flat contains circular references (plugins: { react: plugin })
 * which causes @eslint/eslintrc in ESLint 8 to crash with "TypeError: Converting circular structure to JSON".
 * This script runs automatically on npm postinstall to ensure a clean, reproducible build environment.
 */
const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../node_modules/eslint-plugin-react/index.js');

try {
  if (fs.existsSync(targetFile)) {
    let content = fs.readFileSync(targetFile, 'utf8');
    if (content.includes('plugin.configs.flat = {') && !content.includes('// plugin.configs.flat = {')) {
      content = content.replace(
        /plugin\.configs\.flat\s*=\s*\{[\s\S]*?\n\};\n/g,
        '// plugin.configs.flat removed to prevent circular structure in eslint 8\n'
      );
      fs.writeFileSync(targetFile, content, 'utf8');
      console.log('✅ Applied reproducible postinstall patch to eslint-plugin-react.');
    }
  }
} catch (err) {
  console.warn('⚠️ Could not apply patch to eslint-plugin-react:', err.message);
}

