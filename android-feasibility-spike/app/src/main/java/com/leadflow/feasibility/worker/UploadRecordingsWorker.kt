package com.leadflow.feasibility.worker

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.leadflow.feasibility.data.AppDatabase
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * UploadRecordingsWorker - Background upload processor for call recordings
 * 
 * Complies with Roadmap Phase 16 & 17:
 * - Checks Wi-Fi requirement if configured
 * - Sends recording metadata and SHA-256 integrity hash
 * - Connects to Phase 16 upload route when available
 * - Cleanly documents Phase 16 dependency blocker when backend storage is unmounted (no fake uploads)
 */
class UploadRecordingsWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "UploadRecordingsWorker"
        const val WORK_NAME = "upload_recordings_work"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val sessionManager = SessionManager(applicationContext)
        val db = AppDatabase.getInstance(applicationContext)

        // 1. Check Wi-Fi constraint if enabled
        if (sessionManager.wifiOnlyUploads && !isConnectedToWifi()) {
            Log.i(TAG, "Wi-Fi only constraint active and device is on cellular. Upload deferred.")
            return@withContext Result.retry()
        }

        val pendingUploads = db.uploadQueueDao().getPending()
        if (pendingUploads.isEmpty()) {
            Log.d(TAG, "No pending recordings in upload queue.")
            return@withContext Result.success()
        }

        Log.i(TAG, "Found ${pendingUploads.size} pending recording(s) to process.")
        val api = ApiClient.getService(applicationContext)

        for (item in pendingUploads) {
            try {
                db.uploadQueueDao().updateStatus(item.id, "UPLOADING")

                // Step A: Request Phase 16 recording ticket / presigned destination
                val ticketResponse = try {
                    api.getRecordingTicket(item.callLogId)
                } catch (e: Exception) {
                    null
                }

                if (ticketResponse == null || !ticketResponse.isSuccessful || ticketResponse.body() == null) {
                    val code = ticketResponse?.code() ?: -1
                    Log.w(TAG, "Backend recording ticket response code: $code.")
                    
                    if (code == 403) {
                        Log.i(TAG, "Server rejected recording ticket due to Do-Not-Record or consent policy. Dropping upload.")
                        db.uploadQueueDao().updateError(
                            id = item.id,
                            status = "SKIPPED_DNR",
                            errorMessage = "Recording forbidden: Lead has Do-Not-Record or consent restricted"
                        )
                        continue
                    }

                    val blockerMsg = if (code == 404 || code == 501 || code == -1) {
                        "Recording ticket route unavailable on backend"
                    } else {
                        "Server rejected recording ticket: code $code"
                    }

                    db.uploadQueueDao().updateError(
                        id = item.id,
                        status = "RETRY",
                        errorMessage = blockerMsg
                    )
                    continue
                }

                val ticket = ticketResponse.body()!!
                val rawUrl = ticket.uploadUrl ?: "/api/calls/${item.callLogId}/recording"
                val fullUploadUrl = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
                    rawUrl
                } else {
                    "${sessionManager.serverUrl.trimEnd('/')}/${rawUrl.trimStart('/')}"
                }

                // Step B: Stream audio bytes with SHA-256 header
                val audioUri = Uri.parse(item.uri)
                val inputStream = applicationContext.contentResolver.openInputStream(audioUri)
                if (inputStream == null) {
                    db.uploadQueueDao().updateError(item.id, "FAILED", "Cannot open audio file URI")
                    continue
                }

                val url = URL(fullUploadUrl)
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    doOutput = true
                    setFixedLengthStreamingMode(item.fileSize)
                    setRequestProperty("Content-Type", "audio/mp4")
                    setRequestProperty("X-Audio-SHA256", item.sha256)
                    setRequestProperty("X-Call-Log-Id", item.callLogId)
                    setRequestProperty("X-Filename", item.filename)
                    setRequestProperty("Authorization", "Bearer ${sessionManager.accessToken}")
                    if (!ticket.ticket.isNullOrBlank()) {
                        setRequestProperty("X-Recording-Ticket", ticket.ticket)
                    }
                    connectTimeout = 30_000
                    readTimeout = 60_000
                }

                val outputStream: OutputStream = conn.outputStream
                val buffer = ByteArray(16384)
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                }
                outputStream.flush()
                outputStream.close()
                inputStream.close()

                val respCode = conn.responseCode
                if (respCode in 200..299) {
                    db.uploadQueueDao().updateStatus(item.id, "COMPLETED")
                    Log.i(TAG, "Recording ${item.filename} uploaded successfully.")
                } else if (respCode == 403) {
                    Log.i(TAG, "Server rejected upload due to Do-Not-Record or consent restriction.")
                    db.uploadQueueDao().updateError(item.id, "SKIPPED_DNR", "Server upload forbidden by compliance policy")
                } else if (respCode == 410) {
                    db.uploadQueueDao().updateError(item.id, "EXPIRED", "Call recording retention expired on server")
                } else {
                    val nextAttempts = item.attempts + 1
                    if (nextAttempts >= 5) {
                        db.uploadQueueDao().updateError(item.id, "FAILED_RETRIES_EXCEEDED", "Upload exceeded max retries ($respCode)")
                    } else {
                        db.uploadQueueDao().updateError(item.id, "RETRY", "Upload HTTP $respCode")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed processing upload for ${item.filename}", e)
                val nextAttempts = item.attempts + 1
                if (nextAttempts >= 5) {
                    db.uploadQueueDao().updateError(item.id, "FAILED_RETRIES_EXCEEDED", e.message ?: "Max retries reached")
                } else {
                    db.uploadQueueDao().updateError(item.id, "RETRY", e.message)
                }
            }
        }

        Result.success()
    }

    private fun isConnectedToWifi(): Boolean {
        val cm = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }
}
