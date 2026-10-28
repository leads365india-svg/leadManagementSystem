package com.leadflow.feasibility.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import java.util.UUID

/**
 * SessionManager - Secure Credentials & Device Identity Storage
 * 
 * Uses Android Keystore-backed EncryptedSharedPreferences to protect:
 * - Device UUID (persisted across sessions)
 * - JWT Access and Refresh tokens
 * - Authenticated Agent metadata
 * - Recordings folder Tree URI
 */
class SessionManager(context: Context) {

    companion object {
        private const val PREFS_FILE = "leadflow_secure_session"
        private const val KEY_DEVICE_UUID = "device_uuid"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_AGENT_ID = "agent_id"
        private const val KEY_AGENT_NAME = "agent_name"
        private const val KEY_AGENT_EMAIL = "agent_email"
        private const val KEY_TENANT_ID = "tenant_id"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_FOLDER_URI = "recordings_folder_uri"
        private const val KEY_WIFI_ONLY = "wifi_only_upload"
        private const val KEY_LAST_SYNC_TIME = "last_sync_time"

        const val DEFAULT_SERVER_URL = "http://10.0.2.2:5000" // Standard Android emulator host
    }

    private val prefs: SharedPreferences = try {
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            PREFS_FILE,
            masterKeyAlias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (_: Exception) {
        // Fallback for unit testing environments where Keystore is unmocked
        context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
    }

    init {
        // Ensure device UUID is generated on first install and retained permanently
        if (!prefs.contains(KEY_DEVICE_UUID)) {
            val newUuid = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_UUID, newUuid).apply()
        }
    }

    val deviceUuid: String
        get() = prefs.getString(KEY_DEVICE_UUID, null) ?: UUID.randomUUID().toString()

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trimEnd('/')).apply()

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_REFRESH_TOKEN, value).apply()

    var agentId: String?
        get() = prefs.getString(KEY_AGENT_ID, null)
        set(value) = prefs.edit().putString(KEY_AGENT_ID, value).apply()

    var agentName: String?
        get() = prefs.getString(KEY_AGENT_NAME, null)
        set(value) = prefs.edit().putString(KEY_AGENT_NAME, value).apply()

    var agentEmail: String?
        get() = prefs.getString(KEY_AGENT_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_AGENT_EMAIL, value).apply()

    var tenantId: String?
        get() = prefs.getString(KEY_TENANT_ID, null)
        set(value) = prefs.edit().putString(KEY_TENANT_ID, value).apply()

    var recordingsFolderUri: String?
        get() = prefs.getString(KEY_FOLDER_URI, null)
        set(value) = prefs.edit().putString(KEY_FOLDER_URI, value).apply()

    var wifiOnlyUpload: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY, false)
        set(value) = prefs.edit().putBoolean(KEY_WIFI_ONLY, value).apply()

    var lastSyncTimestamp: String?
        get() = prefs.getString(KEY_LAST_SYNC_TIME, null)
        set(value) = prefs.edit().putString(KEY_LAST_SYNC_TIME, value).apply()

    val isLoggedIn: Boolean
        get() = !accessToken.isNullOrEmpty() && !agentId.isNullOrEmpty()

    fun saveAuthSession(
        token: String,
        refreshTokenVal: String?,
        agentIdVal: String,
        agentNameVal: String,
        agentEmailVal: String,
        tenantIdVal: String
    ) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, token)
            .putString(KEY_REFRESH_TOKEN, refreshTokenVal)
            .putString(KEY_AGENT_ID, agentIdVal)
            .putString(KEY_AGENT_NAME, agentNameVal)
            .putString(KEY_AGENT_EMAIL, agentEmailVal)
            .putString(KEY_TENANT_ID, tenantIdVal)
            .apply()
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_AGENT_ID)
            .remove(KEY_AGENT_NAME)
            .remove(KEY_AGENT_EMAIL)
            .remove(KEY_TENANT_ID)
            .remove(KEY_LAST_SYNC_TIME)
            .apply()
    }
}
