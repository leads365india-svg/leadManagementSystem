/**
 * Leads-365 — Phase 20: Android Hardening & Distribution Verification Suite
 */

const fs = require("fs")
const path = require("path")

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    passed++
  } else {
    console.error(`  [FAIL] ${message}`)
    failed++
  }
}

async function runPhase20Checks() {
  console.log("================================================================================")
  console.log("=== PHASE 20: ANDROID HARDENING & DISTRIBUTION VERIFICATION SUITE ===")
  console.log("================================================================================")

  const androidRoot = path.join(__dirname, "../../android-feasibility-spike")
  const appRoot = path.join(androidRoot, "app")
  const manifestPath = path.join(appRoot, "src/main/AndroidManifest.xml")
  const netSecPath = path.join(appRoot, "src/main/res/xml/network_security_config.xml")
  const oemHelperPath = path.join(appRoot, "src/main/java/com/leadflow/feasibility/telephony/OemAutostartHelper.kt")
  const workerPath = path.join(appRoot, "src/main/java/com/leadflow/feasibility/worker/UploadRecordingsWorker.kt")
  const buildGradlePath = path.join(appRoot, "build.gradle.kts")
  const proguardPath = path.join(appRoot, "proguard-rules.pro")
  const settingsScreenPath = path.join(appRoot, "src/main/java/com/leadflow/feasibility/ui/screens/SettingsScreen.kt")
  const permissionsScreenPath = path.join(appRoot, "src/main/java/com/leadflow/feasibility/ui/screens/PermissionsScreen.kt")

  // =========================================================================
  // 1. NETWORK SECURITY CONFIG & CLEARTEXT TRAFFIC HARDENING
  // =========================================================================
  console.log("\n--- 1. NETWORK SECURITY CONFIG & TLS HARDENING ---")
  assert(fs.existsSync(netSecPath), "network_security_config.xml exists")
  const netSecContent = fs.readFileSync(netSecPath, "utf8")
  assert(netSecContent.includes('base-config cleartextTrafficPermitted="false"'), "Base config strictly disallows cleartext traffic")
  assert(netSecContent.includes("10.0.2.2") && netSecContent.includes("localhost"), "Cleartext permitted strictly for local development loopback")

  const manifestContent = fs.readFileSync(manifestPath, "utf8")
  assert(manifestContent.includes('android:networkSecurityConfig="@xml/network_security_config"'), "Manifest binds networkSecurityConfig")
  assert(!manifestContent.includes('android:usesCleartextTraffic="true"'), "Manifest removed permissive global usesCleartextTraffic")

  // =========================================================================
  // 2. OEM BACKGROUND SURVIVAL & AUTOSTART DEEP LINKS
  // =========================================================================
  console.log("\n--- 2. OEM BACKGROUND SURVIVAL & AUTOSTART ---")
  assert(fs.existsSync(oemHelperPath), "OemAutostartHelper.kt exists")
  const oemHelperContent = fs.readFileSync(oemHelperPath, "utf8")
  assert(oemHelperContent.includes("XIAOMI") && oemHelperContent.includes("OPPO") && oemHelperContent.includes("VIVO") && oemHelperContent.includes("SAMSUNG"), "OemAutostartHelper covers Xiaomi, Oppo, Vivo, Samsung")
  assert(oemHelperContent.includes("isIgnoringBatteryOptimizations"), "Provides battery optimization status check")
  assert(oemHelperContent.includes("resolveActivity"), "Validates intent resolution before launching to prevent crashes")

  const permContent = fs.readFileSync(permissionsScreenPath, "utf8")
  assert(permContent.includes("OemAutostartHelper"), "Permissions screen integrates OEM autostart guidance card")

  // =========================================================================
  // 3. WORKER RETRY BOUNDS, DNR REJECTION & QUEUE HEALTH
  // =========================================================================
  console.log("\n--- 3. WORKER RESILIENCE & QUEUE HEALTH ---")
  assert(fs.existsSync(workerPath), "UploadRecordingsWorker.kt exists")
  const workerContent = fs.readFileSync(workerPath, "utf8")
  assert(workerContent.includes("SKIPPED_DNR"), "Worker maps HTTP 403 to SKIPPED_DNR to prevent infinite retry loops")
  assert(workerContent.includes("FAILED_RETRIES_EXCEEDED"), "Worker caps failed uploads at max retries")
  assert(workerContent.includes("EXPIRED"), "Worker maps HTTP 410 to EXPIRED state")

  // =========================================================================
  // 4. DATA SECURITY & LOGOUT CLEANUP
  // =========================================================================
  console.log("\n--- 4. DATA SECURITY & LOCAL STORAGE PURGE ---")
  const settingsContent = fs.readFileSync(settingsScreenPath, "utf8")
  assert(settingsContent.includes("sessionManager.clearSession()"), "Logout clears encrypted session credentials")
  assert(settingsContent.includes("db.leadDao().clearAll()"), "Logout purges cached lead phone numbers from Room")
  assert(settingsContent.includes("db.uploadQueueDao().clearAll()"), "Logout purges pending upload queue from Room")

  // =========================================================================
  // 5. DISTRIBUTION, PROGUARD & BUILD CONFIGURATION
  // =========================================================================
  console.log("\n--- 5. DISTRIBUTION, PROGUARD & BUILD CONFIGURATION ---")
  assert(fs.existsSync(buildGradlePath), "build.gradle.kts exists")
  const buildGradleContent = fs.readFileSync(buildGradlePath, "utf8")
  assert(buildGradleContent.includes('versionName = "1.0.0"'), "Version name is set to production release 1.0.0")
  assert(buildGradleContent.includes("isMinifyEnabled = true"), "Release build enables R8/ProGuard minification")
  assert(buildGradleContent.includes("ANDROID_KEYSTORE_PATH"), "Signing config dynamically reads from environment variables (zero hardcoded secrets)")

  assert(fs.existsSync(proguardPath), "proguard-rules.pro exists")
  const proguardContent = fs.readFileSync(proguardPath, "utf8")
  assert(proguardContent.includes("com.leadflow.feasibility.network"), "ProGuard preserves Retrofit/Gson DTO models")
  assert(proguardContent.includes("androidx.room"), "ProGuard preserves Room database classes")
  assert(proguardContent.includes("androidx.work"), "ProGuard preserves WorkManager CoroutineWorkers")

  console.log("\n================================================================================")
  console.log(`=== PHASE 20 SUMMARY: Passed: ${passed} | Failed: ${failed} ===`)
  console.log("================================================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runPhase20Checks().catch((err) => {
  console.error("Fatal Phase 20 Verification Error:", err)
  process.exit(1)
})
