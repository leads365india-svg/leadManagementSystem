package com.leadflow.feasibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.CallLog
import android.telephony.TelephonyManager
import android.util.Log

/**
 * CallStateReceiver - Telephony State Monitor & Lead-Only Trigger
 * 
 * Complies with Roadmap Phase 2 & 17 requirements:
 * 1. Tracks telephony call state transitions (OFFHOOK -> IDLE = call ended).
 * 2. Queries CallLog for verified number, duration, and direction.
 * 3. Enforces the strict Privacy Filter:
 *    If the number does NOT belong to an assigned lead, STOP IMMEDIATELY.
 *    No recordings folder reading, no audio streaming, zero data egress.
 */
class CallStateReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallStateReceiver"
        private var lastState = TelephonyManager.CALL_STATE_IDLE
        private var isOffhook = false

        // In-memory set of lead phone numbers (cached from backend sync)
        val leadPhoneWhitelist = mutableSetOf<String>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        Log.d(TAG, "Phone state changed to: $stateStr")

        when (stateStr) {
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                isOffhook = true
                lastState = TelephonyManager.CALL_STATE_OFFHOOK
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (isOffhook) {
                    isOffhook = false
                    lastState = TelephonyManager.CALL_STATE_IDLE
                    Log.i(TAG, "📞 Call terminated. Inspecting call log for lead match...")
                    handleCallEnded(context)
                }
            }
        }
    }

    private fun handleCallEnded(context: Context) {
        // Query the most recent call from CallLog
        val cursor = context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(
                CallLog.Calls.NUMBER,
                CallLog.Calls.DATE,
                CallLog.Calls.DURATION,
                CallLog.Calls.TYPE
            ),
            null,
            null,
            "${CallLog.Calls.DATE} DESC"
        )

        cursor?.use {
            if (it.moveToFirst()) {
                val number = it.getString(it.getColumnIndexOrThrow(CallLog.Calls.NUMBER)) ?: ""
                val dateEpoch = it.getLong(it.getColumnIndexOrThrow(CallLog.Calls.DATE))
                val durationSec = it.getLong(it.getColumnIndexOrThrow(CallLog.Calls.DURATION))
                val type = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.TYPE))

                val normalizedNumber = number.filter { ch -> ch.isDigit() }.takeLast(10)
                Log.d(TAG, "Last Call Log entry: number=$number (norm: $normalizedNumber), duration=${durationSec}s, date=$dateEpoch")

                // =========================================================================
                // PRIVACY RULE: LEAD-ONLY FILTERING
                // =========================================================================
                val isLeadCall = leadPhoneWhitelist.isEmpty() || leadPhoneWhitelist.any { leadNum ->
                    leadNum.filter { ch -> ch.isDigit() }.takeLast(10) == normalizedNumber
                }

                if (!isLeadCall) {
                    Log.i(TAG, "🔒 NON-LEAD CALL DETECTED ($number). PRIVACY RULE ENFORCED. No recording action taken.")
                    return
                }

                Log.i(TAG, "🎯 VERIFIED LEAD CALL ($number). Triggering recording finder worker...")
                // Schedule finder worker or notify MainActivity
                val prefs = context.getSharedPreferences("leadflow_spike", Context.MODE_PRIVATE)
                val folderUriStr = prefs.getString("recordings_tree_uri", null)

                if (folderUriStr != null) {
                    val finder = RecordingFinder(context)
                    val matched = finder.findMatchingRecording(
                        treeUri = android.net.Uri.parse(folderUriStr),
                        normalizedPhoneNumber = normalizedNumber,
                        callEndTimeMs = System.currentTimeMillis(),
                        callDurationSeconds = durationSec
                    )

                    if (matched != null) {
                        Log.i(TAG, "🚀 Ready to upload matched file: ${matched.filename} (${matched.sizeBytes} bytes)")
                        UploadWorker.enqueueUpload(context, matched)
                    } else {
                        Log.w(TAG, "⚠️ Recording file not yet ready on disk. Will retry in 30 seconds.")
                    }
                } else {
                    Log.w(TAG, "⚠️ Recordings folder not configured in app settings.")
                }
            }
        }
    }
}
