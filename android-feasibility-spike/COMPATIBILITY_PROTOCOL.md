# Android Call Recording Feasibility Spike: Device Compatibility Protocol & Decision Matrix

Complies with **Roadmap Phase 2: Android Feasibility Spike**.

---

## 1. Goal & Testing Methodology

This spike tests whether native phone dialer recordings can be detected, matched to CRM leads, and uploaded via Storage Access Framework (SAF) without root or private APIs.

### Test Protocol (Executed per phone):
1. **Enable Auto-Call Recording**: Open native Phone app → Settings → Record calls → Enable Auto record calls ("All calls").
2. **Launch Feasibility Spike App**:
   - Grant `READ_PHONE_STATE` and `READ_CALL_LOG` runtime permissions.
   - Tap "2. Select Phone Recordings Folder" and choose the manufacturer's call recordings folder via the system document tree picker.
   - Tap "3. Run Self-Test & Scan Folder" to verify readability of files.
   - Enter a test lead phone number into "4. Whitelist Test Lead Number".
3. **Execute Test Call 1 (Lead Call)**:
   - Call the whitelisted lead number for 35 seconds. Hang up.
   - Observe diagnostic log: Call termination detected, CallLog entry retrieved, filename matched by number + timestamp + duration (35s), SHA-256 computed.
4. **Execute Test Call 2 (Non-Lead Call)**:
   - Call any non-whitelisted number (e.g. personal contact).
   - Verify privacy filter: Receiver logs `NON-LEAD CALL DETECTED. PRIVACY RULE ENFORCED.` Zero folder access, zero file read, zero data upload.
5. **Background Survival Check**:
   - Lock the phone for 30 minutes. Reboot phone. Verify receiver and foreground service survive.

---

## 2. Manufacturer Compatibility Matrix

| Brand | Default Call Recorder Folder Path | Typical Filename Pattern | Audio Format | Auto-Record Availability | Background Survival (MIUI/ColorOS etc.) | Decision |
|---|---|---|---|---|---|---|
| **Samsung** (Galaxy S/A/M series, One UI 5/6, Android 13-15) | `Internal Storage/Recordings/Call` | `Call_<NameOrNumber>_<YYYYMMDD>_<HHMMSS>.m4a` | AAC/M4A (stereo, 64-128 kbps) | Available natively in India/SE Asia regions (Dialer Settings → Record calls) | High (Standard Android Doze rules; exempt battery in Settings) | **GO** |
| **Xiaomi / Redmi / POCO** (MIUI 13/14, HyperOS) | `Internal Storage/MIUI/sound_recorder/call_rec` | `Call@<NameOrNumber>(<YYYYMMDDHHMMSS>).mp3` | MP3 / AAC | Available natively in regional dialer | Requires: "Autostart: ON" + "Battery Saver: No restrictions" | **GO** (With onboarding guide) |
| **Vivo / iQOO** (Funtouch OS 13/14) | `Internal Storage/Record/Call` or `Internal Storage/Recordings/Call` | `<NameOrNumber>_<YYYYMMDDHHMMSS>.m4a` | M4A / AMR | Available natively in Phone Settings → Call recording | Requires: Background power consumption allowed | **GO** (With onboarding guide) |
| **Oppo / Realme / OnePlus** (ColorOS / Realme UI / OxygenOS) | `Internal Storage/Music/Recordings/Call Recordings` | `<NameOrNumber>_<YYYYMMDD_HHMMSS>.aac` | AAC / MP3 | Available natively in regional dialer | Requires: Auto-launch allowed + Battery optimization off | **GO** (With onboarding guide) |
| **Google Pixel / Stock Android with Google Phone Dialer** | N/A (Google Dialer stores in sandboxed internal database, not exposed via SAF) | N/A | Proprietary / Encrypted | Google Dialer announces "This call is now being recorded" and does not export files | N/A | **NO-GO** → Route to Phase 33 Telephony Fallback |

---

## 3. Go / No-Go Decision Criteria

1. **Brand Status = GO**:
   - Phone auto-records calls without user having to press record manually each time.
   - Recordings folder is accessible via Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`).
   - File appears in folder within 60 seconds of call termination.
   - Filename contains dialed phone number or contact name.
   - Audio duration matches call log duration within ±5 seconds.

2. **Brand Status = NO-GO (Telephony Fallback)**:
   - Phone uses Google Dialer without file export capability (Stock Android, European/US models).
   - Government/Carrier firmware disables native call recording menu.
   - Manufacturer kills background services within 10 minutes despite battery exemptions.
   - **Action**: Devices on the NO-GO list utilize **Phase 33 Cloud Telephony Fallback** (Exotel / Twilio click-to-call) where the recording is captured at the telecom switch.
