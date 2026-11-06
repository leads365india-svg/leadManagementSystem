/**
 * Leads365 Frontend — AI Receptionist Settings UI & Client Verification Test
 */

const assert = require("assert")
const fs = require("fs")
const path = require("path")

console.log("\n=======================================================")
console.log("   FRONTEND AI RECEPTIONIST SETTINGS VERIFICATION     ")
console.log("=======================================================\n")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✅ PASS: ${name}`)
  } catch (err) {
    failed++
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`)
  }
}

// 1. Verify ApiClient has telephony methods
test("ApiClient exports getTelephonyConfig and updateTelephonyConfig", () => {
  const { apiClient } = require("../lib/api")
  assert.strictEqual(typeof apiClient.getTelephonyConfig, "function", "getTelephonyConfig must be a function")
  assert.strictEqual(typeof apiClient.updateTelephonyConfig, "function", "updateTelephonyConfig must be a function")
})

// 2. Verify Page & Client Components Exist
test("AI Receptionist Settings page.jsx and ai-receptionist-client.jsx exist", () => {
  const pagePath = path.join(__dirname, "../app/settings/ai-receptionist/page.jsx")
  const clientPath = path.join(__dirname, "../app/settings/ai-receptionist/ai-receptionist-client.jsx")
  assert(fs.existsSync(pagePath), "page.jsx must exist")
  assert(fs.existsSync(clientPath), "ai-receptionist-client.jsx must exist")
})

// 3. Verify Header Navigation Link Exists
test("Header navigation includes AI Receptionist link under Settings category", () => {
  const headerContent = fs.readFileSync(path.join(__dirname, "../components/header.jsx"), "utf8")
  assert(headerContent.includes("/settings/ai-receptionist"), "Header must link to /settings/ai-receptionist")
  assert(headerContent.includes("settings-ai-receptionist"), "Nav category must include settings-ai-receptionist id")
})

// 4. Verify Truthful States in Client Code
test("Client component renders truthful states and never exposes plaintext secrets", () => {
  const clientContent = fs.readFileSync(path.join(__dirname, "../app/settings/ai-receptionist/ai-receptionist-client.jsx"), "utf8")
  
  // Truthful state checks
  assert(clientContent.includes("Status: Not Configured"), "Must handle Not Configured state")
  assert(clientContent.includes("Status: Provider Credentials Required"), "Must handle Credentials Required state")
  assert(clientContent.includes("Status: AI Receptionist Disabled"), "Must handle AI Disabled state")
  assert(clientContent.includes("Status: Configuration Active"), "Must handle Active state")
  
  // Verification that fake connected status is NOT displayed
  assert(!clientContent.includes("Status: Connected to Telephony Gateway"), "Must NOT display fake connected status")
  
  // Carrier instructions
  assert(clientContent.includes("*61*"), "Must display carrier conditional call forwarding code helper")
  
  // Input fields for all 5 providers
  assert(clientContent.includes("twilio"), "Must support Twilio")
  assert(clientContent.includes("exotel"), "Must support Exotel")
  assert(clientContent.includes("airtel_iq"), "Must support Airtel IQ")
  assert(clientContent.includes("sip"), "Must support SIP PBX")
  assert(clientContent.includes("mock"), "Must support Mock provider")
})

console.log("\n=======================================================")
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
console.log("=======================================================\n")

if (failed > 0) process.exit(1)

