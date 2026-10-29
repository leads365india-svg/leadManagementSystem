const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "../..")
const FRONTEND_DIR = path.join(PROJECT_ROOT, "frontend")
const BACKEND_DIR = path.join(PROJECT_ROOT, "backend")

// 1. Scan Frontend Pages & Components
const scanDir = (dir, ext = /\.(jsx?|tsx?)$/) => {
  let files = []
  if (!fs.existsSync(dir)) return files
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item)
    if (fs.statSync(full).isDirectory()) {
      if (item !== "node_modules" && item !== ".next" && item !== ".git") {
        files = files.concat(scanDir(full, ext))
      }
    } else if (ext.test(item)) {
      files.push(full)
    }
  }
  return files
}

const frontendFiles = scanDir(FRONTEND_DIR)
console.log(`Discovered ${frontendFiles.length} frontend JSX/JS files.`)

// Analyze interactive elements in frontend
let buttonCount = 0
let formCount = 0
let dialogCount = 0
let selectCount = 0
let inputCount = 0
let tableCount = 0

const pageSummaries = []

for (const file of frontendFiles) {
  const content = fs.readFileSync(file, "utf8")
  const relPath = path.relative(PROJECT_ROOT, file).replace(/\\/g, "/")

  const buttons = (content.match(/<Button\b|<button\b/g) || []).length
  const forms = (content.match(/<form\b|<Form\b/g) || []).length
  const dialogs = (content.match(/<Dialog\b|<AlertDialog\b|<Drawer\b|<Sheet\b/g) || []).length
  const selects = (content.match(/<Select\b|<select\b|<DropdownMenu\b/g) || []).length
  const inputs = (content.match(/<Input\b|<input\b|<Textarea\b|<textarea\b/g) || []).length
  const tables = (content.match(/<Table\b|<table\b/g) || []).length

  buttonCount += buttons
  formCount += forms
  dialogCount += dialogs
  selectCount += selects
  inputCount += inputs
  tableCount += tables

  if (buttons > 0 || forms > 0 || dialogs > 0 || selects > 0 || inputs > 0 || tables > 0) {
    pageSummaries.push({
      file: relPath,
      buttons,
      forms,
      dialogs,
      selects,
      inputs,
      tables,
    })
  }
}

console.log("=== FRONTEND INTERACTION INVENTORY ===")
console.log(`Total Buttons / Action triggers: ${buttonCount}`)
console.log(`Total Forms: ${formCount}`)
console.log(`Total Dialogs / Drawers / Modals: ${dialogCount}`)
console.log(`Total Selects / Dropdowns: ${selectCount}`)
console.log(`Total Inputs / Textareas: ${inputCount}`)
console.log(`Total Tables: ${tableCount}`)

// 2. Scan API calls in frontend/lib/api.js
const apiContent = fs.readFileSync(path.join(FRONTEND_DIR, "lib/api.js"), "utf8")
const methodRegex = /async\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{([^}]+(?:\}[^}]+)*?)\}/g
let methodMatch
const apiMethods = []

const callRegex = /this\.request\(\s*[`"']([^`"']+)`?|\bapiClient\.request\(\s*[`"']([^`"']+)`?/g
const rawEndpoints = new Set()

for (const line of apiContent.split("\n")) {
  const m = line.match(/(?:this|apiClient)\.request\(\s*[`"']([^`"'\?]+)/)
  if (m) {
    rawEndpoints.add(m[1].replace(/\$\{[^}]+\}/g, ":param"))
  }
}

console.log(`\n=== API CLIENT INVENTORY ===`)
console.log(`Total API Endpoints called from client: ${rawEndpoints.size}`)
Array.from(rawEndpoints).sort().forEach(ep => console.log(`  - ${ep}`))

// 3. Scan Backend Routes
const routeFiles = scanDir(path.join(BACKEND_DIR, "routes"))
console.log(`\n=== BACKEND ROUTES INVENTORY (${routeFiles.length} files) ===`)
for (const rf of routeFiles) {
  const content = fs.readFileSync(rf, "utf8")
  const rel = path.relative(PROJECT_ROOT, rf).replace(/\\/g, "/")
  const routes = []
  const rRegex = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g
  let rm
  while ((rm = rRegex.exec(content)) !== null) {
    routes.push(`${rm[1].toUpperCase()} ${rm[2]}`)
  }
  console.log(`\nFile: ${rel} (${routes.length} handlers)`)
  routes.forEach(r => console.log(`    ${r}`))
}

// 4. Scan Database Models & Indexes
const modelFiles = scanDir(path.join(BACKEND_DIR, "models"))
console.log(`\n=== DATABASE MODELS INVENTORY (${modelFiles.length} models) ===`)
for (const mf of modelFiles) {
  const content = fs.readFileSync(mf, "utf8")
  const rel = path.relative(PROJECT_ROOT, mf).replace(/\\/g, "/")
  const modelNameMatch = content.match(/mongoose\.model\(["']([^"']+)["']/)
  const modelName = modelNameMatch ? modelNameMatch[1] : path.basename(mf, ".js")
  const indexMatches = content.match(/\.index\([^)]+\)/g) || []
  console.log(`  Model: ${modelName.padEnd(25)} (${rel}) - Defined Indexes: ${indexMatches.length}`)
}
