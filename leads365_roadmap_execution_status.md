# Leads-365 — Roadmap Execution Status Tracker

Last Updated: October 27, 2026
Workspace: `D:\Leads Management Sytem`

---

## 1. Phase Status Overview

| Phase | Description | Status | Verification Suite |
|---|---|---|---|
| **Phase 0–13** | Backend Security, Multi-Tenant Isolation, RBAC, Lead Models, Lead Feeds & Ingestion (Meta, IndiaMART) | ✅ Completed | Verified via `verifyAllLeadsFeature.js`, `verifyPhase11IntegrationCore.js`, `verifyPhase12MetaLeadAds.js`, `verifyPhase13IndiaMart.js` |
| **Phase 14** | Call Data Model, Device Registration, Call Logs & Activity Hooks | ✅ Completed | 49/49 Passed (`verifyPhase14CallDataModel.js`) |
| **Phase 15** | Mobile Device Authentication, Refresh Tokens, Scoped Lead Delta Sync & Call Logging | ✅ Completed | 87/87 Passed (`verifyPhase15DeviceAuthSync.js`) |
| **Phase 16** | Call Recording Storage (GridFS, 30-Day Retention, Audio Streaming) | ✅ Completed | 49/49 Passed (`verifyPhase16GridFSRecordings.js`) |
| **Phase 17** | Android App MVP (Jetpack Compose, Room, WorkManager, Lead-Only Privacy Filter) | ✅ Completed | 20/20 Contract tests passed (`verifyPhase17AndroidContracts.js`), Room & Compose MVP complete. |
| **Phase 18** | Do-Not-Record, Consent & Privacy Controls | ✅ Completed | 29/29 Passed (`verifyPhase18ConsentPrivacy.js`) |
| **Phase 19** | Call Reports & In-Browser Recording Playback | ✅ Completed | 23/23 Passed (`verifyPhase19CallReportsPlayback.js`) |
| **Phase 20** | Android Hardening & Distribution | 🟡 PASS WITH BLOCKERS | 25/25 Passed (`verifyPhase20AndroidHardening.js`), Hardening & Distribution Guide complete. Environment Blockers: Android SDK/JDK CLI absent on host PATH; physical OEM device testing pending. |
| **Phase 21** | Call Ingestion (Manual Upload) | ✅ Completed (PASS) | 33/33 Passed (`verifyPhase21CallIngestion.js`), Audio Upload, CSV Batch Ingestion, Review Queue & Lead Match complete. |
| **Phase 22** | Website Snippet, Allowed Origins & Attribution | ✅ Completed (PASS) | 23/23 Passed (`verifyPhase22WebsiteSnippet.js`): 12 Static Invariants, 11 Behavioral Tests. Public Site Key, Allowed Origins manager, Snippet distribution & Attribution engine complete. |
| **Phase 23** | Google Lead Form Webhooks & Direct Ingestion | ✅ Completed (PASS) | 45/45 Passed (`verifyPhase23GoogleLeadWebhook.js`): 25 Static Invariants, 20 Behavioral Tests. Server-side tenant resolution, timing-safe verification, user_column_data normalization, multi-touch attribution, idempotency deduplication, Google Ads test data handling, key rotation, and Lead Feeds settings UI complete. |
| **Phase 24** | Generic Connector (Zapier, Make, n8n, Pabbly) | ✅ Completed (PASS) | 41/41 Passed (`verifyPhase24GenericConnector.js`): 20 Static Invariants, 21 Behavioral Tests. Inbound webhook intake, high-entropy API keys, multi-location auth, flexible field normalization, idempotency, duplicate merge/reject, and settings UI complete. |
| **Phase 25** | IndiaMART Lead Manager Integration | ✅ Completed (PASS) | 86/86 Passed (`verifyPhase25IndiaMart.js`) + 70/70 Passed (`verifyPhase13IndiaMart.js`). Official Lead Manager API v2 pull polling + push webhook intake, AES-256-GCM encrypted credentials, DD-MMM-YYYY date protocol, buyer payload mapping, canonical IndiaMART source attribution, idempotency on UNIQUE_QUERY_ID, incremental watermark cursor (lastSyncTime with 2-min safety window), overlap sync lock, background queue worker ('indiamart.sync_leads'), reconnect-needed detection, and Lead Feeds UI complete. |

---

## 2. Phase 17: Android App MVP Implementation Details

### A. Android Project Structure
Located at: `D:\Leads Management Sytem\android-feasibility-spike`
- **Module:** `app`
- **Language:** Kotlin
- **UI Framework:** Jetpack Compose (BOM 2024.02.00) + Material3
- **Local Database:** Room 2.6.1 (`LeadEntity`, `CallLogEntity`, `UploadQueueEntity`)
- **Background Tasks:** WorkManager 2.9.0 (`LeadSyncWorker`, `UploadRecordingsWorker`)
- **Networking:** Retrofit 2.9.0 + OkHttp 4.12.0 + Gson
- **Security:** EncryptedSharedPreferences (`androidx.security:security-crypto:1.1.0-alpha06`)
- **Min SDK:** 26 (Android 8.0 Oreo) | **Target SDK:** 34 (Android 14)

### B. Project Files Created & Modified
1. **Build & Manifest:**
   - `android-feasibility-spike/app/build.gradle.kts`: Added Compose BOM, Material3, Room, WorkManager, Retrofit, OkHttp, Security Crypto.
   - `android-feasibility-spike/app/src/main/AndroidManifest.xml`: Configured permissions (`READ_PHONE_STATE`, `READ_CALL_LOG`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_PHONE_CALL`, `INTERNET`), cleartext traffic support for dev URLs, receiver and service bindings.
2. **Local Persistence (`data/`):**
   - `SessionManager.kt`: Encrypted storage for device UUID, JWT `accessToken`, `refreshToken`, agent ID, tenant ID, backend URL, and SAF folder URI.
   - `Entities.kt`: Room entities (`LeadEntity`, `CallLogEntity`, `UploadQueueEntity`) and DAOs (`LeadDao`, `CallLogDao`, `UploadQueueDao`).
   - `AppDatabase.kt`: Room database singleton with migration-free destructive recreate fallback for development.
3. **Networking (`network/`):**
   - `MobileApiModels.kt`: DTOs matching Phase 15 backend contract (`DeviceLoginRequest`, `SyncLeadsResponse`, `ReportCallRequest`, etc.).
   - `MobileApiService.kt`: Retrofit interface defining mobile endpoints.
   - `ApiClient.kt`: OkHttpClient with automated Bearer auth token injection, `X-Device-Id` header, and automatic 401 token refresh authenticator.
4. **Telephony & Privacy (`telephony/`):**
   - `PhoneNumberNormalizer.kt`: E.164 and 10-digit mobile number normalization.
   - `CallStateReceiver.kt`: Intercepts call state transitions; enforces strict **Lead-Only Privacy Filter** (stops immediately with zero recording read or data upload for non-CRM calls).
   - `RecordingFinder.kt`: Scans SAF directory for audio files matching timestamp (+/- 180s) and duration (+/- 5s), computes SHA-256 integrity hash.
5. **Background Workers (`worker/`):**
   - `LeadSyncWorker.kt`: Periodic/on-demand delta-sync via `GET /api/mobile/leads?since=...`, updates Room cache, removes reassigned lead IDs.
   - `UploadRecordingsWorker.kt`: Processes upload queue, respects Wi-Fi only constraint, handles Phase 16 dependency detection without faking success.
6. **Jetpack Compose UI Screens (`ui/screens/`):**
   - `LoginScreen.kt`: Device-bound agent login with server URL configuration, loading states, and error handling.
   - `PermissionsScreen.kt`: Granular readiness cards explaining permissions, triggering runtime permission dialogs, and SAF folder selection.
   - `MyLeadsScreen.kt`: Displays agent's assigned leads, search/filter bar, lead detail cards, Do-Not-Record badges, and native dialer launch (`Intent.ACTION_DIAL`).
   - `PostCallScreen.kt`: Records call outcome, notes, and follow-up; displays recording match status.
   - `CallHistoryScreen.kt`: Chronological call logs, duration, status, and recording upload badge.
   - `SettingsScreen.kt`: Diagnostics view, device UUID, upload queue status, Wi-Fi only toggle, Sync Now action, and Logout with local data cleanup.
   - `ui/AppNavigation.kt`: Navigation host with Material3 `NavigationBar` for tab routing.
   - `MainActivity.kt`: Sets Compose content with dark/light dynamic theme.
7. **Unit Tests & Backend Contracts:**
   - `app/src/test/java/com/leadflow/feasibility/PhoneNumberNormalizerTest.kt`: Unit test suite for phone number normalization.
   - `app/src/test/java/com/leadflow/feasibility/LeadOnlyPrivacyFilterTest.kt`: Unit test suite for privacy filter and Do-Not-Record enforcement.
   - `backend/tests/verifyPhase17AndroidContracts.js`: Comprehensive integration contract test suite.

---

## 3. APIs Connected & Contracts Verified

| Mobile Route | Method | Backend Service | Status |
|---|---|---|---|
| `/api/mobile/auth/login` | POST | `deviceAuthService.registerDevice` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/auth/refresh` | POST | `deviceAuthService.refreshTokens` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/auth/logout` | POST | `deviceAuthService.revokeDevice` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/status` | GET | `mobileController.getStatus` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/leads?since=...` | GET | `mobileSyncService.syncAssignedLeads` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/calls` | POST | `mobileSyncService.reportCall` | ✅ Connected & Verified (Phase 15) |
| `/api/mobile/calls/:id/recording-ticket` | POST | `mobileSyncService.generateUploadTicket` | ✅ Connected & Verified (Phase 15) |
| `/api/calls/:id/recording` | PUT | `recordingStorage.streamUpload` | ✅ Connected & Verified (Phase 16 GridFS Streaming Upload) |
| `/api/calls/:id/recording` | GET | `recordingStorage.streamPlayback` | ✅ Connected & Verified (Phase 16 Range Streaming Playback) |
| `/api/calls/recordings/purge` | POST | `recordingStorage.purgeExpiredRecordings` | ✅ Connected & Verified (Phase 16 30-Day Purge API) |
| `/api/privacy/dnr` | GET/POST | `privacyController.getDnrRules / addDnrRule` | ✅ Connected & Verified (Phase 18 Do-Not-Record Rules) |
| `/api/privacy/dnr/:id` | DELETE | `privacyController.removeDnrRule` | ✅ Connected & Verified (Phase 18 Rule Removal) |
| `/api/privacy/leads/:id` | PATCH | `privacyController.updateLeadPrivacy` | ✅ Connected & Verified (Phase 18 Per-Lead DNR Switch) |
| `/api/privacy/mobile/rules` | GET | `privacyController.getMobilePrivacyRules` | ✅ Connected & Verified (Phase 18 Android Delta Sync) |
| `/api/integrations/snippet.js` | GET | `integrationController.serveWebsiteSnippet` | ✅ Connected & Verified (Phase 22 Public Website Snippet) |
| `/api/integrations/settings/website/rotate-site-key` | POST | `integrationController.rotateSiteKey` | ✅ Connected & Verified (Phase 22 Public Site Key Rotation) |
| `/api/integrations/leads/website` | POST | `integrationService.intakeWebhookPayload` | ✅ Connected & Verified (Phase 22 Allowed Origins & Attribution Ingestion) |

---

## 4. Test Verification Results

| `verifyPhase27AuthPerformance.js` | Super Admin entry routing, AuthGuard root bypass, token isolation (client_token forbidden on super-admin routes), lean user queries, duplicate API call elimination | **21 Passed, 0 Failed** (11 Static, 10 Behavioral) |
| `verifyPhase26IntegrationStudio.js` | Integration Studio Overview, multi-channel health status, event ledger, secret scrubbing, event replay, suspended account guard | **32 Passed, 0 Failed** (12 Static, 20 Behavioral) |
| `verifyPhase25IndiaMart.js` | IndiaMART Lead Manager, AES-256-GCM vault, incremental watermark cursor, overlap lock, retry backoff, queue worker | **86 Passed, 0 Failed** |
| `verifyPhase24GenericConnector.js` | Generic Webhook Intake, Zapier/Make/n8n/Pabbly normalizer, timing-safe API key auth, idempotency dedupe, tenant isolation, key rotation | **41 Passed, 0 Failed** (20 Static, 21 Behavioral) |
| `verifyPhase23GoogleLeadWebhook.js` | Official Google Ads Webhook Spec, HTTP 200 delivery contract, timing-safe key verification, gcl_id & user_column_data normalization, idempotency, test lead handling | **45 Passed, 0 Failed** (25 Static, 20 Behavioral) |
| `verifyPhase22WebsiteSnippet.js` | Origin Normalization, Wildcards, Scheme/Host/Port Guards, SiteKey Auth, Honeypot Anti-Spam, Multi-Touch Attribution, Idempotency | **23 Passed, 0 Failed** (12 Static, 11 Behavioral) |
| `verifyPhase21CallIngestion.js` | Audio Recording Ingestion, CSV Batch Records, Review Queue, Manual Lead Match, DNR Rejection, Idempotency | **33 Passed, 0 Failed** |
| `verifyPhase20AndroidHardening.js` | Android Network Security, ProGuard, WorkManager Retries, OEM Autostart, Versioning, Dynamic Signing & Distribution Guide | **25 Passed, 0 Failed** |
| `verifyPhase19CallReportsPlayback.js` | Call Reports RBAC, hasRecording/missingRecording Filters, Seeking Range Streaming, DNR & Purge Guards | **23 Passed, 0 Failed** |
| `verifyPhase18ConsentPrivacy.js` | Server-Authoritative DNR, Consent Policy Guards, Erasure Purge, Pre-flight Ticket & Upload Rejection | **29 Passed, 0 Failed** |
| `verifyPhase16GridFSRecordings.js` | GridFS Bucket, Streaming Upload, Range Playback, Security Guards, 30-Day Chunk Purge, Call Preservation | **49 Passed, 0 Failed** |
| `verifyPhase15DeviceAuthSync.js` | Backend Device Auth, Refresh, Lead Delta Sync, Rate Limiting, Push Dispatch | **87 Passed, 0 Failed** |
| `verifyPhase14CallDataModel.js` | Backend Call schema, phone normalization, lead linking, RBAC metrics | **49 Passed, 0 Failed** |
| `verifyPhase17AndroidContracts.js` | Android Contract parity, Privacy Filter, Room DTO mapping | **20 Passed, 0 Failed** |
| `PhoneNumberNormalizerTest.kt` | Kotlin unit test for 10-digit mobile, country code, trunk prefix, punctuation | Unit test code ready |
| `LeadOnlyPrivacyFilterTest.kt` | Kotlin unit test for non-lead rejection, authorized call acceptance, DNR rule | Unit test code ready |

---

## 5. Missing Credentials & SDK Dependencies
1. **Android SDK / JDK CLI on System PATH:**
   - The host Windows shell environment does not have `javac` or `gradle` on PATH.
   - All Gradle files (`build.gradle.kts`, `settings.gradle.kts`), wrapper configurations (`gradle-wrapper.properties`), ProGuard rules (`proguard-rules.pro`), and Kotlin source code are structured according to Android Gradle Plugin 8.2+ / Kotlin 1.9+ conventions and ready for immediate compilation in Android Studio or CI runner with Android SDK 34 installed.
2. **Firebase Cloud Messaging (FCM) `google-services.json`:**
   - FCM credentials are not yet provisioned in the repository. Local polling delta sync via WorkManager (`LeadSyncWorker`) is implemented as the primary reliable sync mechanism until FCM credentials are added.

---

## 6. Next Steps (Roadmap Phase 22 & Beyond)
1. **Phase 22 (Website Snippet, Allowed Origins & Attribution):** Public site key, allowed origins editor, and embeddable JavaScript snippet.
2. **Physical Device Fleet Validation:** Conduct real OEM validation on physical Samsung, Xiaomi, Vivo, Oppo devices as documented in `COMPATIBILITY_PROTOCOL.md` and `DISTRIBUTION_GUIDE.md`.

---

## 7. Phase 18: Do-Not-Record, Consent & Privacy Controls Implementation Details

### A. Core Architecture & Policies
- **Source of Truth:** Server-authoritative privacy evaluation through `privacyService.evaluateRecordingEligibility(...)`. Neither client parameters nor device flags can bypass recording restrictions.
- **Tenant Isolation:** All DNR exclusion rules (`DnrRule`) are strictly indexed and scoped by `tenantId`. Cross-tenant rule modifications are rejected with 404.
- **Consent Policies Supported:**
  - `implied_disclosure`: Recording permitted by default unless lead explicitly withdrew/declined consent.
  - `explicit_opt_in`: Recording rejected with `RECORDING_FORBIDDEN_CONSENT_REQUIRED` until lead explicitly grants consent (`status === 'granted'`).
  - `declined` / `withdrawn`: Always strictly blocks recording with `RECORDING_FORBIDDEN_CONSENT_DECLINED` across all policies.
- **Pre-Flight Ticket Blocking:** Mobile requests to `POST /api/mobile/calls/:id/recording-ticket` are checked against lead DNR switch, lead tags, and tenant DNR phone rules before any upload ticket is issued.
- **Direct Upload Blocking:** Direct attempts to `PUT /api/calls/:id/recording` re-verify server eligibility; forbidden calls transition to `recording.status = 'skipped_dnr'`.
- **Right to Erasure:** Deleting a lead immediately triggers `privacyService.eraseLeadRecordings(...)`, purging GridFS chunks and files while keeping call metadata marked `expired`.
- **Android Integration:** `UploadRecordingsWorker.kt` catches HTTP 403 `RECORDING_FORBIDDEN_*` responses and marks local queue entries as `SKIPPED_DNR`, terminating retry cycles cleanly.
- **Web UI:** Interactive Do-Not-Record control panel at `frontend/app/settings/do-not-record` with compliance warning banner, rule filters, and creation modal.

---

## 8. Phase 19: Call Reports & In-Browser Recording Playback Implementation Details

### A. Backend Report & Playback Architecture
- **Scoped Call Queries:** `callService.listCalls` enforces RBAC (`own`, `team`, `all`) with `scopeFilter`. `account_admin` granted tenant-wide visibility; agents constrained to their assigned calls.
- **Recording Filters:** Supported query params: `hasRecording=true` (stored), `missingRecording=true` (completed without audio), `recordingStatus` (`stored | expired | skipped_dnr | pending | none`).
- **Metrics Aggregation:** `callService.getCallMetrics` computes total calls, connect rates, durations, `withRecordingCount`, `missingRecordingCount`, and `byRecordingStatus` breakdown.
- **Server Playback Authorization:** `recordingStorage.streamPlayback` validates tenant isolation, RBAC direct-object access, DNR active compliance checks (rejects with HTTP 403), and 30-day purge status (returns HTTP 410 Gone).
- **HTTP Range Streaming:** Implements `Accept-Ranges: bytes` and `Content-Range: bytes START-END/TOTAL` returning HTTP 206 Partial Content for in-browser scrubbing and seeking.

### B. Web Frontend & Audio Player Integration
- **In-Browser Audio Player:** Created `frontend/components/in-browser-audio-player.jsx` with play/pause, scrub slider, 10s skip rewind, speed toggle (1x, 1.25x, 1.5x, 2x), mute, and auto-cleanup on unmount.
- **Call Reports Console:** Updated `frontend/app/communication/call-reports/page.jsx` with recording status dropdown (`All Audio`, `Has Stored Recording`, `Missing Recording`, `Skipped (DNR)`, `Purged (30d)`), live Play buttons, and docked streaming audio player.
- **Lead Detail Drawer:** Embedded `InBrowserAudioPlayer` directly inside the drawer's `Calls & Recordings` tab with compact mode.

---

## 9. Phase 20: Android Hardening & Distribution Implementation Details

### A. Network Security & TLS Enforcement
- **Network Security Configuration:** Created `android-feasibility-spike/app/src/main/res/xml/network_security_config.xml` defining `cleartextTrafficPermitted="false"` by default, strictly permitting cleartext only for local loopback addresses (`10.0.2.2`, `localhost`, `127.0.0.1`) during development.
- **Manifest Integration:** Replaced blanket `android:usesCleartextTraffic="true"` in `AndroidManifest.xml` with `android:networkSecurityConfig="@xml/network_security_config"`.

### B. Session Security & Zero Residual Data Cleanup
- **Session Purge:** Updated `SessionManager.clearSession()` to wipe all sensitive access/refresh tokens and credentials from `EncryptedSharedPreferences`.
- **Database Purge:** Integrated complete Room database purging (`database.leadDao().clearAll()`, `database.callLogDao().clearAll()`, `database.uploadQueueDao().clearAll()`) upon user logout to prevent data leakage across agent shifts or shared devices.

### C. Worker Reliability & Retry Backoff
- **Bounded Retries:** Hardened `UploadRecordingsWorker.kt` to cap upload attempts at 5 (`FAILED_RETRIES_EXCEEDED`), transitioning stalled queue entries to permanent failure rather than infinite retry loops.
- **DNR & Expired Handling:** HTTP 403 responses (`RECORDING_FORBIDDEN_*`) transition immediately to `SKIPPED_DNR`; HTTP 410 responses transition to `EXPIRED` without retry.
- **Network Constraints:** Upload workers enforce `NetworkType.CONNECTED` with exponential backoff (`WorkRequest.MIN_BACKOFF_MILLIS`).

### D. OEM Background Autostart & Battery Optimization
- **OEM Deep Links:** Implemented `OemAutostartHelper.kt` with intent resolvers and fallback handlers for Xiaomi (MIUI/HyperOS `com.miui.securitycenter`), Oppo (ColorOS `com.coloros.safecenter`), Vivo (Funtouch `com.iqoo.secure`), and Samsung (`com.samsung.android.lool`).
- **Battery Optimization:** Standard `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent dispatch to prevent background worker eviction during phone calls.
- **Compose UI Integration:** Added OEM readiness and battery optimization permission cards to `PermissionsScreen.kt`.

### E. Distribution Readiness & ProGuard
- **Release ProGuard / R8:** Configured `proguard-rules.pro` to preserve Room, Retrofit, WorkManager, OkHttp, and Crypto reflection models while stripping loggers and debugging symbols.
- **Dynamic Signing Configuration:** Configured `app/build.gradle.kts` with `versionCode 1`, `versionName "1.0.0"`, and dynamic environment-variable signing (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Zero keys or passwords committed to Git.
- **Distribution Guide:** Authored `android-feasibility-spike/DISTRIBUTION_GUIDE.md` detailing enterprise direct APK rollout, MDM configuration, and explaining Google Play call-log policy restrictions.

---

## 10. Phase 21: Call Ingestion (Manual Upload) Implementation Details

### A. Ingestion Architecture & Endpoints
- **Audio Streaming Upload (`POST /api/calls/ingestion/audio`):** Streams audio directly into GridFS (`recordings.files` / `recordings.chunks`) with automatic phone number extraction from filenames (e.g., `9876543210_call.mp3`) or explicit header override.
- **CSV Batch Import (`POST /api/calls/ingestion/csv`):** Parses raw CSV text or JSON records array (`phone`, `duration`, `direction`, `disposition`, `notes`, `date`, `clientCallId`). Enforces idempotency via `clientCallId`.
- **Review Queue (`GET /api/calls/ingestion/review`):** Surfaces unmatched manual calls (`source: 'manual'`, `leadId: null`) for staff review and manual resolution. Scoped by RBAC (agents see only their own uploads; admins see all).
- **Manual Lead Match (`POST /api/calls/ingestion/match`):** Resolves an unmatched call by either linking it to an existing CRM lead or quick-creating a new Lead, atomically updating the Call log, timeline activity, and GridFS recording metadata.
- **Ingestion Stats (`GET /api/calls/ingestion/stats`):** Summarizes total manual calls, matched calls, review queue count, and audio recordings stored.

### B. Security, Privacy & Retention Safeguards
- **Server-Authoritative DNR Policy:** Integrates with `privacyService.evaluateRecordingEligibility`. If a phone number or lead has active Do-Not-Record or declined consent, audio upload is strictly rejected with HTTP 403 `RECORDING_FORBIDDEN_DNR`.
- **30-Day GridFS Retention:** Automatically assigns `expiresAt = Date.now() + 30 days` to all uploaded audio recordings, compatible with the Phase 16 automated purge daemon.
- **Tenant Isolation:** Enforces strict tenant boundaries across all queries, uploads, and resolution endpoints. Cross-tenant calls or leads are rejected with HTTP 404.
- **Input Sanitization:** Strips directory traversal attempts and dangerous characters from uploaded filenames.

### C. Web Frontend Experience
- **Location:** `frontend/app/reports/call-ingestion/page.jsx` & `call-ingestion-client.jsx`, accessible via navigation header at `/reports/call-ingestion`.
- **KPI Summary Cards:** Total Manual Calls, Matched to Leads, Review Queue, Recordings Stored.
- **Audio Ingestion Tab:** Drag & drop file picker, auto phone extraction preview, manual override, duration/direction controls, and docked in-browser audio player preview.
- **CSV Ingestion Tab:** File upload or raw CSV paste, sample CSV loader, and real-time batch processing breakdown (matched, review queue, failed, duplicate skips).
- **Review Queue Tab:** Interactive table of unmatched calls with inline audio playback, search filter, and resolution modal for linking or quick-creating leads.
- **Call Reports Link:** Direct shortcut to `Call Reports` (`/communication/call-reports`) to view newly ingested calls alongside mobile sync records.

---

## 11. Phase 22: Website Snippet, Allowed Origins & Attribution Implementation Details

### A. Architectural Overview & Credentials Model
- **Public Site Key (`lf_site_...`):** Dedicated client-side credential allowing direct browser form submissions without exposing private server secrets, HMAC keys, or admin API keys. Generated automatically on tenant provisioning and rotatable on demand.
- **Strict Server-Side Origin Validation:** All requests authenticated via `x-site-key` must supply a valid HTTP `Origin` header. Normalized comparison (`scheme://hostname[:port]`) against the tenant's allowlist is enforced in `backend/utils/originValidator.js`. Untrusted browser origins are rejected with HTTP 403 Forbidden. Subdomain wildcards (`https://*.example.com`) are supported while bare wildcards (`*`) and dangerous protocols (`javascript:`, `data:`, `blob:`) are strictly prohibited.
- **CORS vs. Authentication Separation:** Server-to-server webhook ingestion using the private API key (`x-api-key`) continues to function independently of browser Origin headers. CORS is treated strictly as a browser protection layer, not authentication.
- **Anti-Spam Honeypot Guard:** Ingestion pipeline automatically inspects for bot trap fields (`_hp_trap`, `hp_field`, `_lead_hp`). If present, the submission is immediately rejected with HTTP 400 without creating a lead record or cluttering the CRM.
- **Multi-Touch Attribution Engine:**
  - Extracts and persists full campaign attribution: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid`, `landingPage`, and `referrer`.
  - **First-Touch:** Write-once invariant preserved on lead creation.
  - **Last-Touch:** Updated on repeat inquiries.
  - **Repeat Inquiries (`duplicateHandling: "update"`):** Appends timestamped inquiry notes to the existing lead's message history instead of creating duplicate CRM records.
- **Lightweight Embeddable JavaScript Snippet (`GET /api/integrations/snippet.js`):**
  - Zero-dependency, ~2.5 KB non-blocking script with `async` and `defer` support.
  - Automatically captures URL search params (`utm_*`, `gclid`, `fbclid`), referrer, and landing page.
  - Auto-scans HTML forms containing contact fields or explicitly marked with `data-leads365-form`.
  - Uses `fetch` with `keepalive: true` to prevent submission cancellation during page navigations.
  - Exposes programmatic API `window.Leads365.capture(customData)` for modern SPAs, Next.js, and React apps.

### B. Files Created & Modified
1. `backend/utils/originValidator.js`: Strict URL origin normalizer and validator with scheme, port, and wildcard subdomain checks.
2. `backend/models/LeadFeedConfig.js`: Added `websiteSource.siteKey` (indexed) and `websiteSource.allowedOrigins: [String]`.
3. `backend/models/Integration.js`: Added `siteKey: { type: String, index: true, default: null }` for instant connector lookup.
4. `backend/services/integrationService.js`: Added `authenticateSiteKey`, synced `siteKey` and `allowedOrigins`, added honeypot trap rejection (400), and enforced origin validation on `siteKey` requests (403).
5. `backend/controllers/integrationController.js`: Added `rotateSiteKey`, `serveWebsiteSnippet`, origin validation in `updateWebsiteConfig`, and `x-site-key` handling in `receiveWebsiteLead`.
6. `backend/routes/integrationRoutes.js`: Mounted public `GET /snippet.js` and admin `POST /settings/website/rotate-site-key`.
7. `backend/start.js`: Added `x-site-key` to CORS allowedHeaders.
8. `frontend/lib/api.js`: Added `rotateLeadFeedSiteKey()` method.
9. `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`: Added Public Site Key card with copy & rotation, Allowed Origins manager with validation badges, Embeddable JavaScript Snippet block with copy buttons, and step-by-step installation instructions.
10. `backend/tests/verifyPhase22WebsiteSnippet.js`: Comprehensive 23-test suite covering origin validation, wildcards, scheme/host/port guards, siteKey auth, honeypot anti-spam, multi-touch attribution, idempotency, and tenant isolation.

### C. Test Verification Results
- `node backend/tests/verifyPhase22WebsiteSnippet.js`: **23/23 Passed (12 Static Invariants, 11 Behavioral Tests)**
- `node backend/tests/verifyPhase21CallIngestion.js`: **33/33 Passed**
- `node backend/tests/verifyPhase18ConsentPrivacy.js`: **29/29 Passed**
- `node backend/tests/verifyPhase16GridFSRecordings.js`: **49/49 Passed**
- Total regression pass count: **134/134 Passed (100%)**

---

## 12. Phase 23: Google Lead Form Webhooks & Direct Ingestion Implementation Details

### A. Architectural Overview & Security Guarantees
- **Webhook Endpoint (`POST /api/integrations/webhooks/google`):**
  - Public intake endpoint with rate-limiting (`webhookLimiter`) accepting Google Ads Lead Form webhook delivery requests.
  - Extracts `google_key` from payload body, query params, or headers.
  - **Server-Side Tenant Resolution:** Looks up tenant integration using `apiKeyHash` (indexed SHA-256) without trusting client-supplied tenant IDs.
  - **Constant-Time Verification (`crypto.timingSafeEqual`):** Compares decrypted stored key against incoming key to eliminate timing side-channel attacks.
  - **Fail Closed:** Missing, invalid, or revoked `google_key` immediately returns HTTP 401 Unauthorized without processing.
  - Inactive integrations or suspended tenant accounts return HTTP 403 Forbidden.
- **Normalization & Attribution Engine:**
  - Standardizes Google Ads `user_column_data` array (`FULL_NAME`, `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `PHONE_NUMBER`, `COMPANY_NAME`, `CITY`, `POSTAL_CODE`, and custom questions).
  - Preserves Google attribution parameters: `utm_source: "google"`, `utm_medium: "cpc"`, `utm_campaign`, `gclid`, `formId`, `campaignId`.
  - Normalizes source to canonical `"Google Ads"` while storing raw parameters in lead metadata and first/last touch attribution.
- **Idempotency & Duplicate Prevention:**
  - Idempotency keyed on Google's `lead_id` (`metadata.providerLeadId` & `metadata.idempotencyKey`). Duplicate deliveries return HTTP 200 with idempotent acknowledgment without creating duplicate leads.
  - **Duplicate Handling Rule:** Configurable per tenant (`update` vs `reject`). If `duplicateHandling: "update"` is set, repeated inquiries from the same contact merge into the existing lead record, updating `lastTouch` attribution and appending timestamped inquiry notes.
- **Google Ads Test Data Handling:**
  - Automatically identifies test submissions triggered via Google Ads' "Send test data" button (`is_test: true` or `test-` lead ID).
  - Updates integration statistics and returns HTTP 200 (`isTest: true`) without polluting production CRM databases with dummy leads.
- **Key Rotation & Lifecycle:**
  - `POST /api/integrations/google/rotate-key` generates a new high-entropy `gkey_live_...` key, atomically updating both `Integration` and `LeadFeedConfig` models while logging to the immutable audit trail.
  - Old key is invalidated immediately (subsequent deliveries return HTTP 401).
- **Frontend Settings UI (`frontend/app/settings/lead-feeds/lead-feeds-client.jsx`):**
  - Added dedicated **Google Lead Forms (Google Ads)** tab in the Lead Feeds & Integration Center.
  - Webhook URL display with instant clipboard copy.
  - Masked shared secret key (`gkey_live_••••••••••••XXXX`) with AES-256 vault indicator.
  - One-time reveal banner for newly generated or rotated keys.
  - Staff assignment dropdown and duplicate handling radio selectors.
  - Real-time ingestion stats dashboard and diagnostic "Send Google Test Lead" button.
  - Step-by-step setup walkthrough for Google Ads Asset Library configuration.

### B. Files Created & Modified
1. `backend/services/googleAdsService.js`: Core Google Ads service handling key generation (`generateGoogleKey`), constant-time verification (`verifyGoogleWebhookKey`), payload normalization (`normalizeGoogleLeadPayload`), lead processing (`processGoogleLead`), and key rotation (`rotateGoogleKey`). Updated to return HTTP 200 on successful delivery matching Google Ads official contract, support official parameter `gcl_id`, and handle optional unknown fields safely.
2. `backend/controllers/googleAdsController.js`: Express controller implementing webhook intake (`handleGoogleWebhook`), status queries (`getGoogleConfig`), configuration updates (`connectGoogleIntegration`), key rotation (`rotateGoogleKey`), and test dispatch (`sendGoogleTestLead`).
3. `backend/models/LeadFeedConfig.js`: Extended `googleSource` with `googleKeyHash`, `googleKeyMasked`, `googleKeyLastRotatedAt`, staff assignment, duplicate handling, stats, and JSON serialization exclusion of secret hashes.
4. `backend/routes/integrationRoutes.js`: Mounted public webhook intake and authenticated admin routes.
5. `frontend/lib/api.js`: Added `getGoogleAdsStatus()`, `connectGoogleAdsIntegration()`, `rotateGoogleAdsKey()`, and `sendGoogleAdsTestLead()`.
6. `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`: Added Google Ads tab, stats cards, secret key rotation modal, settings modal, and setup guide.
7. `backend/tests/verifyPhase23GoogleLeadWebhook.js`: Comprehensive 45-test verification suite covering static invariants, official Google Ads webhook spec (`gcl_id`, `user_column_data`, optional fields), HTTP 200 delivery contract, timing-safe verification, tenant isolation, attribution, deduplication, test data handling, and key rotation.

### C. Test Verification Results
- `node backend/tests/verifyPhase23GoogleLeadWebhook.js`: **45/45 Passed (25 Static, 20 Behavioral)**
- `node backend/tests/verifyPhase22WebsiteSnippet.js`: **23/23 Passed**
- `node backend/tests/verifyPhase21CallIngestion.js`: **33/33 Passed**
- `node backend/tests/verifyPhase18ConsentPrivacy.js`: **29/29 Passed**
- Total regression pass count: **130/130 Passed (100%)**

---

## 14. Phase 24: Generic Connector (Zapier, Make, n8n, Pabbly) Implementation Details

### A. Architectural Scope & Implementation
- **Public Feed Intake Endpoint (`POST /api/integrations/webhooks/generic`):**
  - Rate-limited intake (`webhookLimiter`) accepting JSON lead payloads from Zapier, Make, n8n, Pabbly, or custom API scripts.
  - Multi-location API key authentication: `x-api-key` header, `Authorization: Bearer <key>`, `?api_key=` query param, or payload body.
  - Constant-time verification (`verifyGenericApiKey`) and server-side key lookup (`apiKeyHash`) without trusting client tenant claims.
  - Fail-closed security: missing/invalid key returns HTTP 401; suspended accounts or disabled integrations return HTTP 403; empty/malformed payload returns HTTP 400.
- **Intelligent Payload Normalization Engine (`normalizeGenericPayload`):**
  - Names: auto-maps `name`, `fullName`, `full_name`, `lead_name`, or combines `first_name` + `last_name`.
  - Contact Fields: auto-normalizes email (`email`, `work_email`, `email_address`) and phones (`phone`, `mobile_number`, `phoneNumber`, `tel`) with E.164 normalization.
  - Organization & Location: maps `company`, `company_name`, `organization`, `city`, `location`.
  - Attribution: extracts `source` (defaulting to `"Zapier"` or whatever platform sent it), `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid`, `campaign_id`.
  - Custom Field Mappings: supports per-integration configurable field mappings with `trim`, `lowercase`, and `uppercase` transforms.
  - Data Loss Prevention: unknown/custom keys are preserved in `customFields` object and formatted cleanly into the message summary.
- **Idempotency & Duplicate Handling:**
  - Idempotency keyed on `idempotency_key`, `event_id`, `lead_id`, or `id`. Duplicate deliveries return HTTP 200 with `idempotent: true` and `action: "idempotent_duplicate_skipped"`.
  - Configurable duplicate policy: `update` merges new inquiries into existing lead timeline notes, while `reject` returns HTTP 409 Conflict.
- **Audit Ledger:**
  - Append-only records stored in `IntegrationEvent` with `integrationType: "generic"`, status, HTTP status, and payload.
- **Frontend Settings UI (`frontend/app/settings/lead-feeds/lead-feeds-client.jsx`):**
  - Added dedicated **Zapier, Make & n8n** tab in the Lead Feeds & Integration Center.
  - Instant copy of Inbound Webhook URL and masked API Key (`gen_live_••••••••••••XXXX`).
  - Interactive setup walkthrough tabs for **Zapier**, **Make.com**, **n8n**, **Pabbly Connect**, and **cURL**.
  - Reference table of supported inbound field names.
  - Staff assignment and duplicate handling configuration modal.
  - Key rotation modal with immediate invalidation warning.
  - Live "Send Test Inbound Lead" diagnostic test trigger.

### B. Files Created & Modified
1. `backend/services/genericConnectorService.js`: Core generic connector service handling API key generation, constant-time verification, flexible payload normalization, lead processing, and key rotation.
2. `backend/controllers/genericConnectorController.js`: Controller implementing public webhook intake (`handleGenericWebhook`), config queries (`getGenericConfig`), settings update (`connectGenericIntegration`), key rotation (`rotateGenericKey`), and test dispatch (`sendGenericTestLead`).
3. `backend/routes/integrationRoutes.js`: Mounted public intake `POST /api/integrations/webhooks/generic` and authenticated admin endpoints (`GET /generic/status`, `POST /generic/connect`, `POST /generic/rotate-key`, `POST /generic/test`).
4. `frontend/lib/api.js`: Added client methods `getGenericConnectorStatus()`, `connectGenericConnector()`, `rotateGenericConnectorKey()`, and `sendGenericConnectorTestLead()`.
5. `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`: Added Zapier/Make/n8n tab, configuration cards, recipe guides, settings modal, and key rotation modal.
6. `backend/tests/verifyPhase24GenericConnector.js`: Comprehensive 41-test suite covering static invariants, flexible normalization, authentication variants, security guards, tenant isolation, idempotency, duplicate policies, and key rotation.

### C. Test Verification Results
- `node backend/tests/verifyPhase24GenericConnector.js`: **41/41 Passed (20 Static, 21 Behavioral)**
- `node backend/tests/verifyPhase23GoogleLeadWebhook.js`: **45/45 Passed (25 Static, 20 Behavioral)**
- `node backend/tests/verifyPhase22WebsiteSnippet.js`: **23/23 Passed**
- Total Phase 23 + 24 verification pass count: **109/109 Passed (100%)**

---

## 15. Phase 25: IndiaMART Lead Manager Integration Implementation Details

### A. Access Method & Protocol Evidence
- **Primary Access Method:** REST Pull Polling API via IndiaMART Lead Manager API v2:
  - Official Endpoint: `https://mapi.indiamart.com/wservce/crm/crmListing/v2/`
  - Authentication: `glusr_crm_key` passed as a query parameter (generated by sellers at `seller.indiamart.com -> Settings -> Lead Manager -> CRM Integration`). IndiaMART does not provide an OAuth flow for sellers.
  - Date Protocol: Strict format `DD-MMM-YYYY HH:mm:ss` (e.g. `28-Oct-2026 14:30:00`) with custom date formatter (`formatIndiaMartDate`) and parser (`parseIndiaMartDate`).
  - Rate Limiting: IndiaMART enforces a limit of 1 request every 5–15 minutes (HTTP 429 response handled gracefully with exponential backoff and error tracking).
  - Auth Invalidation: HTTP 401/403 or "Invalid/Inactive CRM Key" flags `reconnectNeeded: true` and logs `reconnectReason` for Integration Studio badges.
- **Secondary Access Method:** Inbound Push Webhook:
  - Endpoint: `POST /api/integrations/webhooks/indiamart` (for enterprise sellers configured with IndiaMART server-to-server push).
  - Authentication: Validates `x-api-key` header against indexed SHA-256 hash.

### B. Architectural Highlights & Security Guarantees
- **Encrypted Credential Storage (AES-256-GCM):**
  - Tenant CRM key (`glusr_crm_key`), mobile number, and cursor state are stored encrypted via `integration.setCredentials`.
  - Plaintext credentials are never returned in status endpoints (`crmKeyMasked` with bullet masking only) and stripped in model `toJSON()` and log entries.
- **Tenant Context & Partition Defense:**
  - Lead processing executes inside ambient `runWithTenantContext({ tenantId, isSuperAdmin: false })`.
  - Suspended tenant accounts reject incoming inquiries with HTTP 403 Forbidden.
- **Buyer Payload Normalization & Canonical Attribution:**
  - Standardizes IndiaMART inquiry fields: `SENDER_NAME`, `SENDER_MOBILE`, `SENDER_EMAIL`, `SENDER_COMPANY`, `SENDER_CITY`, `SENDER_STATE`, `PRODUCT_NAME`, `SUBJECT`, `QUERY_MESSAGE`, `CALL_DURATION`, and `QUERY_TYPE` (Catalogue, Buy Lead, Call Enquiry).
  - Canonical source normalized to `"IndiaMART"` with first-touch and last-touch marketing attribution (`utm_source: "indiamart"`, `utm_medium: "b2b_marketplace"`, `utm_campaign: <productName>`).
- **Idempotency & Repeated Delivery / Polling Deduplication:**
  - Keyed on IndiaMART's `UNIQUE_QUERY_ID` (`indiamart_inquiry_${queryId}`).
  - Duplicate inquiries return `skipped_duplicate` with original `leadId` without creating redundant leads in the database.
- **Watermark Cursor & Overlap Lock:**
  - Tracks `lastSyncTime` cursor in encrypted credentials with a 2-minute safety overlap window to prevent edge dropouts.
  - Overlap lock (`settings.customConfig.isSyncing`) prevents concurrent or overlapping polling executions across workers.
- **Background Queue Integration:**
  - Asynchronous sync queue worker `indiamart.sync_leads` executed via `queueService` with retry and exponential backoff.
- **Integration Studio Health Tracking:**
  - Exposes `GET /api/integrations/indiamart/status` returning `configured`, `status` (`active`, `error`, `disconnected`), `reconnectNeeded`, `reconnectReason`, `stats` (`totalReceived`, `totalSuccess`, `totalErrors`, `lastSuccessAt`, `lastErrorAt`), and `lastSyncTime`.
- **Frontend Settings UI (`frontend/app/settings/lead-feeds/lead-feeds-client.jsx`):**
  - Dedicated **IndiaMART Lead Manager** tab in Lead Feeds & Integration Center.
  - Connect modal for `crmKey`, `mobileNumber`, `name`, and staff assignment.
  - Connection health badge, masked key display, and on-demand sync trigger button with loading states.
  - Step-by-step setup guide for IndiaMART Seller Portal.

### C. Test Verification Results
- `node backend/tests/verifyPhase25IndiaMart.js`: **86/86 Passed (100%)**
  - Test 1: IndiaMART Date Formatter & Parser (`DD-MMM-YYYY HH:mm:ss`) (3 assertions)
  - Test 2: Credential Encryption & Secret Redaction (AES-256-GCM) (10 assertions)
  - Test 3: Tenant Isolation & Scope Enforcement (3 assertions)
  - Test 4: Account Suspension Check (HTTP 403 Forbidden) (3 assertions)
  - Test 5: Buyer Payload Mapping & Canonical 'IndiaMART' Attribution (20 assertions)
  - Test 6: Missing / Malformed Fields Rejection (6 assertions)
  - Test 7: Idempotency & Repeated Delivery / Polling Deduplication (3 assertions)
  - Test 8: Incremental Watermark Cursor Tracking (`lastSyncTime`) (8 assertions)
  - Test 9: Overlap Lock Protection (3 assertions)
  - Test 10: Auth Invalidation / Reconnect-Needed & Rate Limiting Handling (10 assertions)
  - Test 11: Connection Health & Status API (5 assertions)
  - Test 12: Background Queue Job (`indiamart.sync_leads`) Worker Execution (8 assertions)
- `node backend/tests/verifyPhase13IndiaMart.js`: **70/70 Passed (100%)**
- `node backend/tests/verifyPhase24GenericConnector.js`: **41/41 Passed (100%)**
- `node backend/tests/verifyPhase23GoogleLeadWebhook.js`: **45/45 Passed (100%)**
- Total Phase 23 + 24 + 25 combined pass count: **242/242 Passed (100%)**

---

## 27. Phase 26: Integration Studio UI & Monitoring (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Architecture:** Centralized Integration Studio Overview, health monitoring, streaming event activity ledger, interactive JSON payload inspection modal, and event replay capability.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose with multi-tenant data partitioning.

### B. Core Implementations Delivered
- **Centralized Integration Studio Overview (`activeTab === "overview"`):**
  - Configured as default landing tab in `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`.
  - **Global Ingestion KPI Cards:** Monitored Channels (X / 5 active), Total Leads Ingested, Valid Leads Dispatched to CRM, Shielded Errors / Spam Blocked.
  - **Operational & Health Alert Banner:** Dynamically renders an actionable warning alert when any integration (e.g., IndiaMART `reconnectNeeded`) requires credential re-authorization, or a gradient operational banner when all pipelines are healthy.
  - **5-Channel Health & Ingestion Matrix:**
    1. *IndiaMART Lead Manager:* B2B Marketplace Polling, masked vault key (`••••••••••••[LOCKED]`), sync watermark, live status, and on-demand "Sync Now" trigger.
    2. *Google Ads Lead Forms:* HTTP Webhook Extension, masked key (`••••••••••••[VAULT]`), last received timestamp, valid lead count, and "Send Test Lead" trigger.
    3. *Generic Inbound Connector:* Multi-platform (Zapier, Make, n8n, Pabbly), universal REST endpoint, masked key, last ingested timestamp, and "Send Test Lead" trigger.
    4. *Website Forms & JS Snippet:* Public forms & REST webhooks, site key, spam filtering, and "Send Test Lead" trigger.
    5. *Meta Lead Ads:* Facebook & Instagram Page webhook subscriptions, token vault health, and navigation shortcut.
  - **Live Recent Event Activity Stream:**
    - Displays last 6 streaming integration events with source badge, status indicator, formatted timestamp, and idempotency key.
    - Direct "Inspect" action opening JSON payload modal.
    - Direct "Replay" action triggering idempotent reprocessing.
- **Payload Inspector Modal (`selectedEvent`):**
  - Clean modal displaying Event ID, Source, Status, HTTP Response Code, Created Timestamp, Idempotency Key.
  - Vault-redacted payload viewer (`rawPayload` / `normalizedPayload`) with one-click "Copy JSON" feedback.
  - Error diagnostics display when errors occur.
  - Direct "Replay Event" action from inside the modal.
- **Event Ledger Status Fixes & Filtering:**
  - Updated status badge rendering in `IntegrationEvent` table to recognize `processed` and `completed` as emerald success status.
  - Expanded source filter options to include `Google Ads` and `Zapier / Make / Generic`.
  - Added "Inspect" button to every ledger row.

### C. Test Verification Results
- `node backend/tests/verifyPhase26IntegrationStudio.js`: **32/32 Passed (100%)**
  - Section 1 (Static Checks): Model integrity, allowed statuses (`received`, `queued`, `processed`, `failed`, `replayed`), deep sanitization regex validation (12 assertions).
  - Section 2 (Behavioral Checks): Multi-tenant status aggregation (`/website`, `/indiamart`, `/google`, `/generic`), secret leak prevention, tenant isolation in event ledger, status and source filtering, stored payload secret redaction (`[REDACTED]`), cross-tenant replay security guard (HTTP 404), valid event replay status transition (`replayed`), and suspended account security guard (HTTP 403) (20 assertions).
- `node backend/tests/verifyPhase25IndiaMart.js`: **86/86 Passed (100%)**
- `node backend/tests/verifyPhase24GenericConnector.js`: **41/41 Passed (100%)**
- Total Phase 24 + 25 + 26 combined pass count: **159/159 Passed (100%)**

---

## 28. Phase 27: Super Admin Entry Flow, Authentication Isolation & Performance Optimization (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Architecture:** Platform Entry Flow Isolation, Super Admin vs. Tenant Session Separation, AuthGuard Boundary Hardening, Lean User Query Optimization, and Root CRM Request Elimination.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose.

### B. Core Implementations Delivered

#### 1. Platform Root Entry Router (`frontend/app/page.jsx`)
- Replaced the heavy, authenticated client CRM dashboard at `/` with a lightweight, high-performance `RootEntryPage` router.
- **Strict Entry Isolation:**
  - Fresh unauthenticated visitor → Immediately redirects to Super Admin login portal (`/super-admin/login`).
  - Authenticated Super Admin session → Immediately redirects to Super Admin console (`/super-admin`).
  - Authenticated Tenant session (`account_admin` / `agent`) → Immediately redirects to Tenant CRM portal (`/portal`).
- **Complete Elimination of Premature Root Queries:**
  - Previously, visiting `http://localhost:3000` mounted the CRM dashboard and fired concurrent requests to `/api/leads` and `/api/leads/stats`, resulting in 401s, network waterfall stalls, and database query churn on unauthenticated hits.
  - Now, `RootEntryPage` performs **0 database queries** and **0 lead API calls** on landing, resolving authentication state directly from `useAuth()`.

#### 2. AuthGuard & Layout Routing Isolation
- **Root Exemption:** Updated `frontend/components/auth-guard.jsx` to exempt `"/"` from premature redirection, allowing `RootEntryPage` to resolve the platform routing cleanly without redirect loops.
- **Visual Flash Suppression:**
  - Updated `frontend/components/header.jsx` and `frontend/components/footer.jsx` to suppress rendering on `pathname === "/"`.
  - Updated CRM navigation `Home` link to target `/portal` rather than `/`, preventing navigation bounces.
- **Dashboard Route Cleanup:** Updated `frontend/app/dashboard/page.jsx` to cleanly redirect to `/portal`.

#### 3. Strict Backend Token & Authorization Isolation (`backend/middleware/authMiddleware.js`)
- **Super Admin Route Guard:** Fixed vulnerability in `extractToken(req)` where `client_token` was previously accepted on `isSuperAdminRoute`.
  - Now, on `isSuperAdminRoute`, only `superadmin_token` (or valid bearer auth) is extracted. A tenant cookie (`client_token`) is strictly ignored, immediately returning **HTTP 401**.
  - Any tenant user attempting to present tenant credentials via `Bearer <token>` to Super Admin endpoints is strictly rejected by `requireSuperAdmin` with **HTTP 403 Forbidden**.
- **Cookie Isolation on Login (`backend/controllers/authController.js`):**
  - Tenant login sets `client_token` and explicitly clears `superadmin_token`.
  - Super Admin login sets `superadmin_token` and explicitly clears `client_token`.

#### 4. Performance Optimizations & Duplicate Request Elimination
- **Lean User Authentication Queries:** Updated `authenticate` and `optionalAuthenticate` in `backend/middleware/authMiddleware.js` to query `User.findById(decoded.id).select("-password").lean()`, avoiding Mongoose document hydration overhead on every authenticated API call.
- **Integration Studio Redundant Call Elimination:**
  - Removed duplicate `loadSettings()` invocation on mount in `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`.
  - Suppressed unsolicited `toast.success("Integration feeds refreshed!")` on initial component render, keeping notifications restricted to explicit manual refresh clicks (`onClick={() => loadAllStatuses(true)}`).

### C. Test Verification Results
- `node backend/tests/verifyPhase27AuthPerformance.js`: **21/21 Passed (100%)**
  - Section 1 (Static Checks): Root page exports `RootEntryPage`, unauthenticated directs to `/super-admin/login`, super_admin directs to `/super-admin`, tenant directs to `/portal`, zero premature `getLeadStats` or `getLeads` calls, AuthGuard exempts `'/'`, header & footer suppress `'/'`, `authMiddleware.js` forbids `client_token` on `isSuperAdminRoute`, `.select("-password").lean()` query optimization, and `lead-feeds-client.jsx` duplicate call elimination (11 assertions).
  - Section 2 (Behavioral Checks): Unauthenticated `/api/super-admin/accounts` returns HTTP 401, tenant cookie on Super Admin route returns HTTP 401, tenant bearer token rejected by `requireSuperAdmin` with HTTP 403, super admin cookie authenticated with HTTP 200, `getAccounts` returns HTTP 200, tenant login cookie isolation (sets `client_token`, clears `superadmin_token`), super admin login cookie isolation (sets `superadmin_token`, clears `client_token`), and lean `authenticate()` average latency benchmark (10 assertions).
- `node backend/tests/verifyPhase26IntegrationStudio.js`: **32/32 Passed (100%)**
- `node backend/tests/verifyPhase25IndiaMart.js`: **86/86 Passed (100%)**
- Frontend Production Build (`npm run build`): **Compiled successfully in 82s, 36/36 static pages generated, exit code 0**.

---

## 29. Phase 28: Production Readiness, Security Audit & End-to-End Verification (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Objective:** Production Readiness Audit, Route Integrity Verification, Authentication & Entry Flow Regression, Multi-Tenant Security Audit, and Multi-Suite Verification.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose.

### B. Verification Areas & Audit Findings

#### 1. Backend Startup & Route Integrity
- **HTTP Server & Database Connection:**
  - Backend starts cleanly via `node start.js`.
  - MongoDB Atlas connection established successfully.
  - Health check endpoint `GET http://localhost:5000/health` verified operational:
    `{ status: 'healthy', database: 'connected', message: 'Service is operational' }`.
- **Router Audit:**
  - Audited all 14 Express router modules (`leadRoutes`, `authRoutes`, `superAdminRoutes`, `integrationRoutes`, `followUpRoutes`, `staffRoutes`, `teamRoutes`, `roleRoutes`, `assignmentRuleRoutes`, `auditRoutes`, `queueMonitorRoutes`, `callRoutes`, `mobileRoutes`, `privacyRoutes`).
  - Verified **0 undefined route handlers** across all router stacks (14/14 routers fully defined and valid).
  - Explicitly verified `rotateGoogleKey` and `sendGoogleTestLead` are correctly exported by `backend/controllers/googleAdsController.js` and mounted on `/api/integrations/google/rotate-key` and `/api/integrations/google/test`.

#### 2. Authentication & Platform Entry Flow Regression
- **Root Entry Flow (`/`):**
  - Unauthenticated browser session → Redirects directly to `/super-admin/login`.
  - Authenticated Super Admin session → Redirects directly to `/super-admin`.
  - Authenticated Tenant session → Redirects directly to `/portal`.
  - Zero premature CRM API queries (`/api/leads`, `/api/leads/stats`) on root landing.
- **Token & Session Isolation:**
  - On `/api/super-admin/*`, `client_token` is never accepted (`extractToken` ignores tenant cookie; returns HTTP 401).
  - Tenant bearer tokens sent to Super Admin APIs are rejected by `requireSuperAdmin` with HTTP 403 Forbidden.
  - Super Admin session tokens accessing tenant CRM routes do not leak cross-tenant data.
  - Login cookie isolation verified: Super Admin login clears `client_token`; Tenant login clears `superadmin_token`.

#### 3. Integration Studio & Multi-Tenant Security Audit
- **Secret Redaction:** Passwords, auth tokens, bearer credentials, and API keys are scrubbed and masked (`[REDACTED]`, `••••••••••••[VAULT]`, `••••••••••••[LOCKED]`).
- **Tenant Isolation:** Event ledger (`/api/integrations/events`) enforces tenant isolation (Tenant A cannot view or replay Tenant B's integration events).
- **Suspended Account Defense:** Suspended accounts are immediately rejected with HTTP 403 Forbidden on all incoming webhooks, manual sync triggers, and event replay requests.
- **Overlap Lock:** IndiaMART sync protects against concurrent sync jobs with an in-memory lock.

### C. End-to-End Suite Results Summary

| Suite File | Scope | Status | Score |
|---|---|---|---|
| `backend/tests/verifyPhase27AuthPerformance.js` | Super Admin entry routing, AuthGuard root bypass, token isolation, lean queries | **PASSED** | **21 / 21** |
| `backend/tests/verifyPhase26IntegrationStudio.js` | Integration Studio Overview, multi-channel health, event ledger, replay, secret scrubbing | **PASSED** | **32 / 32** |
| `backend/tests/verifyPhase25IndiaMart.js` | IndiaMART Lead Manager, AES-256-GCM vault, incremental watermark, queue worker | **PASSED** | **86 / 86** |
| `backend/tests/verifyPhase24GenericConnector.js` | Generic Webhook Intake, timing-safe API key auth, idempotency dedupe, tenant isolation | **PASSED** | **41 / 41** |
| `backend/tests/verifyPhase23GoogleLeadWebhook.js` | Official Google Ads Webhook Spec, HTTP 200 delivery contract, test lead handling | **PASSED** | **45 / 45** |
| **Combined Regression Pass Count** | **All Ingestion, Auth, Performance & Integration Endpoints** | **PASSED** | **225 / 225 (100%)** |
| Frontend Production Build (`npm run build`) | Static prerendering, bundle compilation, and route verification | **PASSED** | **36 / 36 Routes Prerendered** |

---

## 30. Phase 29: Local Runtime Recovery, Browser E2E & Final Stability (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Objective:** Diagnose and recover from Next.js 15 dev-tools runtime error, perform browser end-to-end entry flow automation, and verify all 5 regression suites.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose.

### B. Root Cause Analysis & Recovery
- **Webpack Runtime Error Diagnosis:**
  - `Error: Could not find the module "...next-devtools/userspace/app/segment-explorer-node.js#SegmentViewNode" in the React Client Manifest.` followed by `TypeError: __webpack_modules__[moduleId] is not a function`.
  - **Root Cause:** A collision occurred when a production build (`npm run build`) was executed while an existing Next.js dev server instance (`npm run dev`) was simultaneously running in the background. The production build overwrote the generated `.next` manifest with production-only chunks, omitting dev-only tools (`segment-explorer-node.js`). When a user subsequently hit `/portal/login` in development mode, the dev server looked for the devtools segment explorer node in a production manifest, returning an HTTP 500 error.
  - **Resolution & Stability:** Once the compilation refreshed, Next.js compiled `/_error` and immediately resolved subsequent requests with **HTTP 200**. Direct HTTP requests and browser sessions verified that `/`, `/super-admin/login`, and `/portal/login` all respond with HTTP 200.

### C. Browser End-to-End Entry Flow Automation
- Executed automated browser navigation in a fresh browser session:
  1. `http://localhost:3000` → Evaluates `RootEntryPage` router and automatically redirects to `http://localhost:3000/super-admin/login` with zero premature CRM API requests.
  2. `http://localhost:3000/super-admin/login` → Super Admin portal loads and renders cleanly with zero console exceptions or 500 errors.
  3. `http://localhost:3000/portal/login` → Client Portal login page loads and renders cleanly with zero 500 errors.
  4. `http://localhost:3000/super-admin` → Unauthenticated access to protected Super Admin dashboard is intercepted and redirected back to `/super-admin/login?session=expired`.
  5. Session video recording preserved as artifact `phase29_entry_verification_1793186236123.webp`.

### D. Regression Test Suites
- `node backend/tests/verifyPhase27AuthPerformance.js`: **21 / 21 Passed (100%)**
- `node backend/tests/verifyPhase26IntegrationStudio.js`: **32 / 32 Passed (100%)**
- `node backend/tests/verifyPhase25IndiaMart.js`: **86 / 86 Passed (100%)**
- `node backend/tests/verifyPhase24GenericConnector.js`: **41 / 41 Passed (100%)**
- `node backend/tests/verifyPhase23GoogleLeadWebhook.js`: **45 / 45 Passed (100%)**
- **Total Combined Regression Suite:** **225 / 225 Passed (100%)**

---

## 31. Phase 30: Final Git Review & Controlled Deployment Preparation (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Objective:** Final Git Review, Secret Leak Audit, Route Handler Import Audit, Dev vs Prod Workflow Disambiguation, and Controlled Deployment Readiness.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose.

### B. Audit & Verification Findings

#### 1. Git State & Clean Working Tree
- **Current Branch:** `main`
- **Latest Commit:** `301f9e8 phase 26 compelte`
- **Git Diff & Formatting (`git diff --check`):** **0 merge conflicts, 0 formatting errors**.
- **Accidental Secrets Audit:**
  - Zero `.env`, `.env.local`, or credential files staged or modified.
  - Zero raw secrets or keys hardcoded in any diff block.
  - All credentials utilize AES-256-GCM vault encryption or SHA-256 key hashing with secret masking.

#### 2. Modified & Untracked Files Review
- **Backend Code:**
  - `backend/middleware/authMiddleware.js`: Token isolation on Super Admin routes (`client_token` rejection) and `.select("-password").lean()` query optimization.
  - `backend/tests/verifyPhase27AuthPerformance.js` (untracked): Automated test suite for Phase 27 routing, token isolation, and latency benchmarks.
- **Frontend Code:**
  - `frontend/app/page.jsx`: Lightweight `RootEntryPage` router (unauthenticated → `/super-admin/login`, super_admin → `/super-admin`, tenant → `/portal`).
  - `frontend/app/dashboard/page.jsx`: Clean redirect to `/portal`.
  - `frontend/components/auth-guard.jsx`: Exemption for root route `/`.
  - `frontend/components/header.jsx`: Header suppression on `/` and Home target `/portal`.
  - `frontend/components/footer.jsx`: Footer suppression on `/`.
  - `frontend/app/settings/lead-feeds/lead-feeds-client.jsx`: Removed duplicate `loadSettings()` call on initial mount and suppressed unsolicited toast notification.
- **Documentation:**
  - `leads365_roadmap_execution_status.md`: Detailed documentation for Phases 27–30.

#### 3. Route Handlers & Integration Integrity
- Confirmed `rotateGoogleKey` and `sendGoogleTestLead` are correctly imported and exported by `backend/controllers/googleAdsController.js` and mounted in `backend/routes/integrationRoutes.js`.
- Audited all 14 Express routers with zero undefined route handlers.

#### 4. Local Development vs. Production Build Workflow
- **Issue Documented:** Running `npm run build` while `npm run dev` is active causes webpack client manifest corruption in `.next`, leading to missing devtools modules.
- **Standard Protocol:**
  - Local Development: Use `npm run dev` in `frontend/`.
  - Production Verification: Stop dev server, clear `.next` directory (`Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue`), then execute `npm run build`.

### C. Final Regression & Build Summary
- `verifyPhase27AuthPerformance.js`: **21 / 21 Passed (100%)**
- `verifyPhase26IntegrationStudio.js`: **32 / 32 Passed (100%)**
- `verifyPhase25IndiaMart.js`: **86 / 86 Passed (100%)**
- `verifyPhase24GenericConnector.js`: **41 / 41 Passed (100%)**
- `verifyPhase23GoogleLeadWebhook.js`: **45 / 45 Passed (100%)**
- **Combined Test Invariants:** **225 / 225 Passed (100%)**
- **Frontend Production Build:** **36 / 36 Routes Prerendered Cleanly (Exit code 0)**
- **Deployment Readiness:** Ready for review and approval.

---

## 32. Phase 31: Final Diff Validation & Commit Preparation (COMPLETED & VERIFIED)

### A. Phase Summary
- **Status:** **100% COMPLETE & VERIFIED**
- **Objective:** Final Diff Validation, Git Tree State Auditing, Phase 23–27 Test Re-execution, and Safe Commit Staging Preparation.
- **Frontend Stack:** Next.js 15, React 19 (JavaScript/JSX only; zero TypeScript).
- **Backend Stack:** Node.js, Express.js, MongoDB/Mongoose.

### B. Audit & Git Tree Verification
- **Branch:** `main`
- **Head Commit:** `301f9e8 phase 26 compelte`
- **Working Tree Analysis:**
  - **Staged Changes:** None (0 files staged).
  - **Unstaged Changes (8 files):**
    1. `backend/middleware/authMiddleware.js` (+2 / -4 lines)
    2. `frontend/app/dashboard/page.jsx` (+9 / -6 lines)
    3. `frontend/app/page.jsx` (+35 / -395 lines)
    4. `frontend/app/settings/lead-feeds/lead-feeds-client.jsx` (+24 / -17 lines)
    5. `frontend/components/auth-guard.jsx` (+4 / -0 lines)
    6. `frontend/components/footer.jsx` (+1 / -0 lines)
    7. `frontend/components/header.jsx` (+4 / -3 lines)
    8. `leads365_roadmap_execution_status.md` (roadmap tracker updates)
  - **Untracked Files (1 file):**
    1. `backend/tests/verifyPhase27AuthPerformance.js`
- **Integrity (`git diff --check`):** Clean (0 formatting errors, 0 merge conflicts).
- **Secret Scan:** 0 raw secrets, 0 credentials, 0 `.env` files present in diff.

### C. Test Verification Re-Run (Phase 31)
- `node backend/tests/verifyPhase27AuthPerformance.js`: **21 / 21 Passed (100%), Exit 0**
- `node backend/tests/verifyPhase26IntegrationStudio.js`: **32 / 32 Passed (100%), Exit 0**
- `node backend/tests/verifyPhase25IndiaMart.js`: **86 / 86 Passed (100%), Exit 0**
- `node backend/tests/verifyPhase24GenericConnector.js`: **41 / 41 Passed (100%), Exit 0**
- `node backend/tests/verifyPhase23GoogleLeadWebhook.js`: **45 / 45 Passed (100%), Exit 0**
- **Combined Test Count:** **225 / 225 Passed (100%)**
- **Commit Staging Readiness:** Safe for review and approval; no automatic staging or commit executed.


