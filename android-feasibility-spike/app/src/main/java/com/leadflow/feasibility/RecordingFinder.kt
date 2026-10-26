package com.leadflow.feasibility

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.abs

/**
 * RecordingFinder - Core File Detection & Matching Engine
 * 
 * Implements the Roadmap Phase 2 & Phase 17 recording matching algorithm:
 * 1. Checks user-selected recordings folder via Storage Access Framework (SAF).
 * 2. Matches audio file based on:
 *    a) Dialed / received phone number pattern in the filename.
 *    b) File lastModified timestamp within call end window (+/- 180 seconds).
 *    c) Extracted audio duration matching telephony call log duration (+/- 5 seconds).
 * 3. Computes SHA-256 integrity hash for safe retries and deduplication.
 */
class RecordingFinder(private val context: Context) {

    companion object {
        private const val TAG = "RecordingFinder"
        private val SUPPORTED_AUDIO_EXTENSIONS = setOf("m4a", "amr", "mp3", "aac", "wav", "3gp")
        private const val TIMESTAMP_WINDOW_MS = 180_000L // 3 minutes post-call buffer
        private const val DURATION_TOLERANCE_MS = 5_000L // 5 seconds margin
    }

    data class MatchedRecording(
        val uri: Uri,
        val filename: String,
        val sizeBytes: Long,
        val durationMs: Long,
        val mimeType: String,
        val sha256Hash: String,
        val lastModified: Long
    )

    /**
     * Locate recording file matching a specific completed call
     *
     * @param treeUri Persisted folder tree URI granted via ACTION_OPEN_DOCUMENT_TREE
     * @param normalizedPhoneNumber Cleaned E.164 phone number (e.g. +919876543210 or 9876543210)
     * @param callEndTimeMs Epoch timestamp when call terminated
     * @param callDurationSeconds Call duration reported by Android CallLog
     */
    fun findMatchingRecording(
        treeUri: Uri,
        normalizedPhoneNumber: String,
        callEndTimeMs: Long,
        callDurationSeconds: Long
    ): MatchedRecording? {
        val rootFolder = DocumentFile.fromTreeUri(context, treeUri)
        if (rootFolder == null || !rootFolder.exists() || !rootFolder.isDirectory) {
            Log.e(TAG, "Root folder URI is invalid or inaccessible: $treeUri")
            return null
        }

        // Clean digits for fuzzy filename matching (e.g. last 10 digits in India)
        val plainDigits = normalizedPhoneNumber.filter { it.isDigit() }.takeLast(10)

        val files = rootFolder.listFiles()
        Log.d(TAG, "Scanning ${files.size} files in recordings directory for number: $plainDigits")

        val candidates = mutableListOf<DocumentFile>()

        for (file in files) {
            if (!file.isFile) continue
            val name = file.name ?: continue
            val extension = name.substringAfterLast(".", "").lowercase()

            if (!SUPPORTED_AUDIO_EXTENSIONS.contains(extension)) continue

            // 1. Check timestamp window (within 3 minutes of call termination)
            val modifiedTime = file.lastModified()
            val timeDiff = abs(modifiedTime - callEndTimeMs)
            if (timeDiff > TIMESTAMP_WINDOW_MS) {
                continue
            }

            // 2. Check filename number or contact match
            val nameContainsNumber = plainDigits.isNotEmpty() && name.replace("-", "").contains(plainDigits)

            if (nameContainsNumber || timeDiff < 60_000L) {
                candidates.add(file)
            }
        }

        Log.d(TAG, "Found ${candidates.size} potential candidate recording files.")

        // 3. For each candidate, inspect audio metadata duration
        for (candidate in candidates) {
            val candidateUri = candidate.uri
            val durationMs = extractAudioDuration(candidateUri)
            val expectedDurationMs = callDurationSeconds * 1000L

            val durationMatches = if (callDurationSeconds > 0) {
                abs(durationMs - expectedDurationMs) <= DURATION_TOLERANCE_MS
            } else {
                true // Zero-duration or missed calls
            }

            if (durationMatches) {
                val sizeBytes = candidate.length()
                val sha256 = calculateSha256(candidateUri)

                Log.i(TAG, "✅ MATCH CONFIRMED: ${candidate.name} (size: $sizeBytes bytes, duration: ${durationMs}ms, SHA256: $sha256)")

                return MatchedRecording(
                    uri = candidateUri,
                    filename = candidate.name ?: "recording.m4a",
                    sizeBytes = sizeBytes,
                    durationMs = durationMs,
                    mimeType = candidate.type ?: "audio/mp4",
                    sha256Hash = sha256,
                    lastModified = candidate.lastModified()
                )
            }
        }

        Log.w(TAG, "No recording candidate matched duration criteria ($callDurationSeconds seconds).")
        return null
    }

    private fun extractAudioDuration(uri: Uri): Long {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            durationStr?.toLongOrNull() ?: 0L
        } catch (e: Exception) {
            Log.w(TAG, "Could not extract duration from $uri: ${e.message}")
            0L
        } finally {
            try { retriever.release() } catch (_: Exception) {}
        }
    }

    private fun calculateSha256(uri: Uri): String {
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val buffer = ByteArray(8192)
            var bytesRead: Int
            if (inputStream != null) {
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
                inputStream.close()
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Failed calculating SHA-256: ${e.message}")
            "unknown_sha256"
        }
    }
}
