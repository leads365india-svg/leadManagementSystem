package com.leadflow.feasibility.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// =========================================================================
// 1. LEAD ENTITY & DAO (Lead-only local cache)
// =========================================================================

@Entity(tableName = "leads")
data class LeadEntity(
    @PrimaryKey val id: String,
    val name: String,
    val email: String?,
    val phone: String,
    val normalizedPhone: String,
    val status: String,
    val source: String?,
    val company: String?,
    val updatedAt: String
)

@Dao
interface LeadDao {
    @Query("SELECT * FROM leads ORDER BY updatedAt DESC")
    fun getAllLeads(): Flow<List<LeadEntity>>

    @Query("SELECT * FROM leads WHERE name LIKE '%' || :query || '%' OR phone LIKE '%' || :query || '%' ORDER BY updatedAt DESC")
    fun searchLeads(query: String): Flow<List<LeadEntity>>

    @Query("SELECT * FROM leads WHERE normalizedPhone = :normalizedPhone LIMIT 1")
    suspend fun findByNormalizedPhone(normalizedPhone: String): LeadEntity?

    @Query("SELECT normalizedPhone FROM leads")
    suspend fun getAllNormalizedPhones(): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(leads: List<LeadEntity>)

    @Query("DELETE FROM leads WHERE id IN (:leadIds)")
    suspend fun deleteByIds(leadIds: List<String>)

    @Query("DELETE FROM leads")
    suspend fun clearAll()
}

// =========================================================================
// 2. CALL LOG ENTITY & DAO (Local Call History)
// =========================================================================

@Entity(tableName = "call_logs")
data class CallLogEntity(
    @PrimaryKey val id: String, // Server call ID or clientCallId
    val clientCallId: String,
    val leadId: String?,
    val leadName: String?,
    val phone: String,
    val normalizedPhone: String,
    val direction: String, // "outbound" | "inbound"
    val durationSeconds: Long,
    val status: String, // "completed", "busy", "failed", "no-answer"
    val disposition: String?,
    val notes: String?,
    val recordingStatus: String, // "none", "matched", "uploaded", "missing"
    val recordingSha256: String?,
    val timestamp: Long
)

@Dao
interface CallLogDao {
    @Query("SELECT * FROM call_logs ORDER BY timestamp DESC")
    fun getAllCallLogs(): Flow<List<CallLogEntity>>

    @Query("SELECT * FROM call_logs WHERE clientCallId = :clientCallId LIMIT 1")
    suspend fun findByClientCallId(clientCallId: String): CallLogEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(callLog: CallLogEntity)

    @Update
    suspend fun update(callLog: CallLogEntity)

    @Query("DELETE FROM call_logs")
    suspend fun clearAll()
}

// =========================================================================
// 3. UPLOAD QUEUE ENTITY & DAO (Reliable Recording Upload Queue)
// =========================================================================

@Entity(tableName = "upload_queue")
data class UploadQueueEntity(
    @PrimaryKey val id: String, // clientCallId
    val callId: String?, // Backend call _id once reported
    val fileUri: String,
    val filename: String,
    val sizeBytes: Long,
    val sha256Hash: String,
    val status: String, // "pending", "uploading", "completed", "failed"
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Dao
interface UploadQueueDao {
    @Query("SELECT * FROM upload_queue WHERE status = 'pending' OR status = 'failed' ORDER BY createdAt ASC")
    suspend fun getPendingUploads(): List<UploadQueueEntity>

    @Query("SELECT COUNT(*) FROM upload_queue WHERE status = 'pending' OR status = 'uploading'")
    fun getPendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(item: UploadQueueEntity)

    @Update
    suspend fun update(item: UploadQueueEntity)

    @Query("DELETE FROM upload_queue WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM upload_queue WHERE status = 'completed'")
    suspend fun clearCompleted()

    @Query("DELETE FROM upload_queue")
    suspend fun clearAll()
}
