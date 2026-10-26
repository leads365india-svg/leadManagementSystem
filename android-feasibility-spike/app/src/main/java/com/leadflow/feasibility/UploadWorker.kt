package com.leadflow.feasibility

import android.content.Context
import android.util.Log
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * UploadWorker - Background Audio Streamer
 * 
 * Streams matched audio files to a designated HTTP endpoint with SHA-256 header.
 */
class UploadWorker {

    companion object {
        private const val TAG = "UploadWorker"

        fun enqueueUpload(context: Context, recording: RecordingFinder.MatchedRecording) {
            Thread {
                performUpload(context, recording)
            }.start()
        }

        private fun performUpload(context: Context, recording: RecordingFinder.MatchedRecording) {
            val prefs = context.getSharedPreferences("leadflow_spike", Context.MODE_PRIVATE)
            val uploadUrlStr = prefs.getString("upload_endpoint_url", "http://10.0.2.2:5000/api/calls/test-upload") ?: return

            Log.i(TAG, "Uploading ${recording.filename} (${recording.sizeBytes} bytes) to $uploadUrlStr")

            try {
                val url = URL(uploadUrlStr)
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    doOutput = true
                    setFixedLengthStreamingMode(recording.sizeBytes)
                    setRequestProperty("Content-Type", recording.mimeType)
                    setRequestProperty("X-Audio-SHA256", recording.sha256Hash)
                    setRequestProperty("X-Audio-Duration-Ms", recording.durationMs.toString())
                    setRequestProperty("X-Filename", recording.filename)
                    connectTimeout = 30_000
                    readTimeout = 60_000
                }

                val inputStream = context.contentResolver.openInputStream(recording.uri)
                val outputStream: OutputStream = connection.outputStream

                if (inputStream != null) {
                    val buffer = ByteArray(16384)
                    var bytesRead: Int
                    var totalUploaded = 0L

                    while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                        outputStream.write(buffer, 0, bytesRead)
                        totalUploaded += bytesRead
                    }

                    outputStream.flush()
                    outputStream.close()
                    inputStream.close()
                }

                val responseCode = connection.responseCode
                Log.i(TAG, "Upload finished with response code: $responseCode")
            } catch (e: Exception) {
                Log.e(TAG, "Failed uploading recording: ${e.message}", e)
            }
        }
    }
}
