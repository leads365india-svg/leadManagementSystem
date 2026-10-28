# Leads-365 Android App: Hardening & Distribution Guide (Phase 20)

## 1. Distribution Strategy: Why Direct APK / MDM is Mandatory

Google Play Developer policies strictly restrict `READ_CALL_LOG` and `READ_PHONE_STATE` permissions to applications that serve as the **default phone handler (dialer)** on the user's handset. 

Because Leads-365 operates as an agency CRM companion that launches the native OEM dialer via `Intent.ACTION_DIAL` (rather than replacing the system dialer entirely), Google Play does not grant standard call-log permission exemptions.

**Distribution Model:**
1. **Direct Enterprise APK Sideloading / Download Page**: Agencies download the signed release APK directly from their Leads-365 web portal (`https://agency.leads365.com/download/android`).
2. **Enterprise Mobile Device Management (MDM)**: Agencies running Samsung Knox, Microsoft Intune, or Google Workspace Endpoint Management push and install the APK across fleet devices automatically.
3. **In-App Update Checking**: The app checks the backend `/api/mobile/status` minimum version header (`X-Min-App-Version`) on launch and prompts agents to update when a newer APK is published.

---

## 2. Release Build & APK Signing Workflow

### A. Keystore Generation (One-Time Setup)
To sign the production release APK, generate a private signing keystore:

```bash
keytool -genkey -v -keystore leads365-release.jks -alias leads365 -keyalg RSA -keysize 2048 -validity 10000
```

> **Security Mandate**: Never commit `leads365-release.jks` or passwords into Git repositories. Store them in secure enterprise key vaults or CI secrets.

### B. Building Release APK via Environment Variables
Set the following environment variables before invoking Gradle:

```bash
export ANDROID_KEYSTORE_PATH="/secure/path/leads365-release.jks"
export ANDROID_KEYSTORE_PASSWORD="your-keystore-password"
export ANDROID_KEY_ALIAS="leads365"
export ANDROID_KEY_PASSWORD="your-key-password"

./gradlew assembleRelease
```

The resulting signed APK is generated at:
`android-feasibility-spike/app/build/outputs/apk/release/app-release.apk`

### C. Building Development / Testing Debug APK
For development and physical handset field testing without production keys:

```bash
./gradlew assembleDebug
```
Output:
`android-feasibility-spike/app/build/outputs/apk/debug/app-debug.apk`

---

## 3. Manufacturer-Specific Battery & Background Hardening

Modern Android OEMs (particularly Xiaomi, Oppo, and Vivo) employ aggressive proprietary task killers that terminate background services and delayed WorkManager tasks when the screen turns off. 

Leads-365 includes built-in deep links (`OemAutostartHelper`) that launch users directly into the required manufacturer permission screens:

| OEM Brand | Required Configuration | Deep-Link Destination |
|---|---|---|
| **Xiaomi / Redmi / POCO** (MIUI 13/14, HyperOS) | 1. Autostart: **ON**<br>2. Battery Saver: **No Restrictions** | `com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity` |
| **Oppo / Realme / OnePlus** (ColorOS, OxygenOS) | 1. Auto-launch: **Allowed**<br>2. Background Activity: **Don't optimize** | `com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity` |
| **Vivo / iQOO** (Funtouch OS) | 1. Autostart: **Enabled**<br>2. High Background Power Consumption: **Allowed** | `com.iqoo.secure/com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity` |
| **Samsung** (One UI 5/6) | 1. Battery: **Unrestricted**<br>2. Put app to sleep: **Never sleeping apps** | `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` |

---

## 4. Privacy & Compliance Guarantees

1. **Strict Lead-Only Privacy Filter**: Only incoming or outgoing calls that match an assigned CRM lead phone number trigger audio recording inspection. Personal calls are rejected immediately before disk read or network connection.
2. **Server-Authoritative Do-Not-Record (DNR)**: All recording uploads verify eligibility against tenant DNR number lists, tags, and per-lead toggles. If rejected with HTTP 403, the worker marks the item `SKIPPED_DNR` and immediately drops further retries.
3. **No Cleartext Traffic in Release**: Production builds enforce TLS/HTTPS via `network_security_config.xml`. Cleartext HTTP is restricted strictly to local emulator/loopback development addresses (`10.0.2.2`, `localhost`).
4. **Zero Residual Data on Logout**: Logging out executes an atomic wipe of local Room database tables (`LeadEntity`, `UploadQueueEntity`, `CallLogEntity`) and clears `EncryptedSharedPreferences`.
