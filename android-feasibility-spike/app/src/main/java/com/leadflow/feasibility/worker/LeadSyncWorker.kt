package com.leadflow.feasibility.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.leadflow.feasibility.data.AppDatabase
import com.leadflow.feasibility.data.LeadEntity
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.network.ApiClient
import com.leadflow.feasibility.telephony.PhoneNumberNormalizer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * LeadSyncWorker - Performs background delta-sync of assigned leads
 * 
 * Complies with Roadmap Phase 15 contract:
 * - Queries GET /api/mobile/leads?since=<timestamp>
 * - Upserts new and modified leads into local Room database
 * - Deletes leads in removedLeadIds to enforce agent lead isolation
 * - Updates lastSyncTimestamp in encrypted preferences
 */
class LeadSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val TAG = "LeadSyncWorker"
        const val WORK_NAME = "lead_delta_sync_work"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val sessionManager = SessionManager(applicationContext)
        if (!sessionManager.isLoggedIn) {
            Log.d(TAG, "Skipping lead sync: Agent not logged in.")
            return@withContext Result.success()
        }

        try {
            val api = ApiClient.getService(applicationContext)
            val db = AppDatabase.getInstance(applicationContext)

            val sinceTimestamp = sessionManager.lastSyncTimestamp
            Log.i(TAG, "Starting lead delta-sync (since=$sinceTimestamp)...")

            val response = api.syncLeads(since = sinceTimestamp)
            if (!response.isSuccessful || response.body() == null) {
                Log.w(TAG, "Lead sync request failed with code: ${response.code()}")
                return@withContext Result.retry()
            }

            val syncData = response.body()!!
            val leads = syncData.leads ?: emptyList()
            val removedIds = syncData.removedLeadIds ?: emptyList()

            // 1. Process removed / reassigned leads to guarantee strict tenant/agent isolation
            if (removedIds.isNotEmpty()) {
                Log.i(TAG, "Pruning ${removedIds.size} removed leads from local cache...")
                db.leadDao().deleteByIds(removedIds)
            }

            // 2. Upsert synced leads into Room cache
            if (leads.isNotEmpty()) {
                val leadEntities = leads.map { dto ->
                    LeadEntity(
                        id = dto.id ?: dto._id ?: "",
                        name = dto.name ?: "Unknown",
                        phone = dto.phone ?: "",
                        normalizedPhone = PhoneNumberNormalizer.normalize(dto.phone),
                        email = dto.email,
                        status = dto.status ?: "New",
                        doNotRecord = dto.doNotRecord ?: false,
                        assignedTo = dto.assignedTo ?: sessionManager.agentId ?: "",
                        updatedAt = dto.updatedAt ?: System.currentTimeMillis().toString()
                    )
                }.filter { it.id.isNotEmpty() && it.normalizedPhone.isNotEmpty() }

                db.leadDao().insertAll(leadEntities)
                Log.i(TAG, "Successfully upserted ${leadEntities.size} leads into local cache.")
            }

            // 3. Update sync timestamp watermark
            val serverWatermark = syncData.serverTimestamp ?: System.currentTimeMillis().toString()
            sessionManager.lastSyncTimestamp = serverWatermark

            Log.i(TAG, "Delta sync completed successfully at $serverWatermark.")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Exception during lead delta sync", e)
            Result.retry()
        }
    }
}
