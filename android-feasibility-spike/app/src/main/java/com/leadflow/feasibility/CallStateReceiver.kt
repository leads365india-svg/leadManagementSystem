package com.leadflow.feasibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.CallLog
import android.telephony.TelephonyManager
import android.util.Log
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.leadflow.feasibility.data.AppDatabase
import com.leadflow.feasibility.data.CallLogEntity
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.data.UploadQueueEntity
import com.leadflow.feasibility.network.ApiClient
import com.leadflow.feasibility.network.ReportCallRequest
import com.leadflow.feasibility.telephony.PhoneNumberNormalizer
import com.leadflow.feasibility.worker.UploadRecordingsWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * CallStateReceiver - Telephony State Monitor & Lead-Only Privacy Filter
 * 
 * Complies with Roadmap Phase 2 & 17 requirements:
 * 1. Tracks telephony call state transitions (OFFHOOK -> IDLE = call ended).
 * 2. Queries CallLog for verified number, duration, and direction.
 * 3. Enforces the strict Privacy Filter:
 *    If the dialed/received number does NOT match an authorized CRM lead,
 *    STOP PROCESSING IMMEDIATELY.
 *    No recordings folder access, no audio scanning, zero data egress.
 */
class CallStateReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallStateReceiver"
        private var isOffhook = false

        // In-memory quick whitelist for testing or fast fallback
        val leadPhoneWhitelist = mutableSetOf<String>()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        Log.d(TAG, "Phone state changed to: $stateStr")

        when (stateStr) {
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                isOffhook = true
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (isOffhook) {
                    isOffhook = false
                    Log.i(TAG, "📞 Call terminated. Inspecting call log for lead match...")
                    handleCallEnded(context.applicationContext)
                }
            }
        }
    }

    private fun handleCallEnded(context: Context) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
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
                        val callType = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.TYPE))

                        val normalizedNumber = PhoneNumberNormalizer.normalize(number)
                        Log.d(TAG, "Call ended: raw=$number, norm=$normalizedNumber, duration=${durationSec}s")

                        val db = AppDatabase.getInstance(context)
                        val sessionManager = SessionManager(context)

                        // =========================================================================
                        // STRICT PRIVACY FILTER: LEAD-ONLY MATCHING
                        // =========================================================================
                        val matchedLead = db.leadDao().findByNormalizedPhone(normalizedNumber)
                        val isInMemoryWhitelisted = leadPhoneWhitelist.contains(normalizedNumber) || leadPhoneWhitelist.contains(number)

                        if (matchedLead == null && !isInMemoryWhitelisted) {
                            Log.i(TAG, "🔒 NON-LEAD CALL DETECTED ($number). PRIVACY RULE ENFORCED. No recording action taken.")
                            return@launch
                        }

                        val leadId = matchedLead?.id ?: "lead-test-${System.currentTimeMillis()}"
                        val leadName = matchedLead?.name ?: "Verified Lead"
                        val doNotRecord = matchedLead?.doNotRecord ?: false

                        Log.i(TAG, "🎯 VERIFIED CRM LEAD CALL: $leadName ($normalizedNumber). Lead ID: $leadId")

                        var matchedRecording: RecordingFinder.MatchedRecording? = null

                        // Check Do-Not-Record rule
                        if (!doNotRecord) {
                            val folderUriStr = sessionManager.recordingsFolderUri
                            if (!folderUriStr.isNullOrBlank()) {
                                val finder = RecordingFinder(context)
                                matchedRecording = finder.findMatchingRecording(
                                    treeUri = Uri.parse(folderUriStr),
                                    normalizedPhoneNumber = normalizedNumber,
                                    callEndTimeMs = System.currentTimeMillis(),
                                    callDurationSeconds = durationSec
                                )
                            } else {
                                Log.w(TAG, "Recordings folder URI not configured in settings.")
                            }
                        } else {
                            Log.i(TAG, "Lead has doNotRecord=true. Skipping recording discovery.")
                        }

                        // Insert into local CallLogDao
                        val callDirection = if (callType == CallLog.Calls.OUTGOING_TYPE) "OUTGOING" else "INCOMING"
                        val localLogId = "call_${System.currentTimeMillis()}"

                        val callEntity = CallLogEntity(
                            id = localLogId,
                            phone = number,
                            normalizedPhone = normalizedNumber,
                            leadId = leadId,
                            leadName = leadName,
                            durationSeconds = durationSec,
                            timestamp = dateEpoch,
                            status = "COMPLETED",
                            direction = callDirection,
                            recordingFound = (matchedRecording != null),
                            recordingUri = matchedRecording?.uri?.toString(),
                            recordingFilename = matchedRecording?.filename,
                            sha256 = matchedRecording?.sha256Hash
                        )
                        db.callLogDao().insert(callEntity)

                        // If recording matched, queue for upload
                        if (matchedRecording != null) {
                            val queueEntity = UploadQueueEntity(
                                callLogId = localLogId,
                                leadId = leadId,
                                filename = matchedRecording.filename,
                                uri = matchedRecording.uri.toString(),
                                sha256 = matchedRecording.sha256Hash,
                                fileSize = matchedRecording.sizeBytes,
                                durationMs = matchedRecording.durationMs,
                                status = "PENDING"
                            )
                            db.uploadQueueDao().insert(queueEntity)

                            // Schedule WorkManager upload
                            val constraints = Constraints.Builder()
                                .setRequiredNetworkType(
                                    if (sessionManager.wifiOnlyUploads) NetworkType.UNMETERED
                                    else NetworkType.CONNECTED
                                )
                                .build()

                            val uploadWork = OneTimeWorkRequestBuilder<UploadRecordingsWorker>()
                                .setConstraints(constraints)
                                .build()

                            WorkManager.getInstance(context).enqueue(uploadWork)
                            Log.i(TAG, "Enqueued upload job for ${matchedRecording.filename}")
                        }

                        // Report call metadata to backend POST /api/mobile/calls
                        if (sessionManager.isLoggedIn) {
                            try {
                                val api = ApiClient.getService(context)
                                val response = api.reportCall(
                                    ReportCallRequest(
                                        leadId = leadId,
                                        phoneNumber = number,
                                        duration = durationSec.toInt(),
                                        callType = callDirection.lowercase(),
                                        startedAt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                                            .format(java.util.Date(dateEpoch)),
                                        endedAt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                                            .format(java.util.Date(dateEpoch + durationSec * 1000L)),
                                        recordingDuration = matchedRecording?.durationMs?.div(1000)?.toInt(),
                                        recordingSha256 = matchedRecording?.sha256Hash,
                                        notes = null,
                                        outcome = null
                                    )
                                )
                                Log.i(TAG, "Reported call to backend. Response code: ${response.code()}")
                            } catch (e: Exception) {
                                Log.w(TAG, "Call report backend sync deferred: ${e.message}")
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error handling call ended", e)
            }
        }
    }
}
