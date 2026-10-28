package com.leadflow.feasibility.network

import com.google.gson.annotations.SerializedName

// =========================================================================
// AUTH DTOs
// =========================================================================

data class DeviceLoginRequest(
    val email: String,
    val password: String,
    val deviceUuid: String,
    val deviceModel: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = "1.0-mvp",
    val pushToken: String? = null
)

data class DeviceLoginResponse(
    val success: Boolean,
    val accessToken: String?,
    val refreshToken: String?,
    val expiresIn: String?,
    val user: UserDto?,
    val device: DeviceDto?,
    val error: String?,
    val code: String?
)

data class UserDto(
    val id: String,
    val name: String,
    val email: String,
    val role: String,
    val tenantId: String
)

data class DeviceDto(
    val id: String,
    val status: String
)

data class DeviceRefreshRequest(
    val refreshToken: String,
    val deviceUuid: String
)

data class DeviceRefreshResponse(
    val success: Boolean,
    val accessToken: String?,
    val refreshToken: String?,
    val expiresIn: String?,
    val error: String?
)

data class BaseResponse(
    val success: Boolean,
    val message: String?,
    val error: String?,
    val code: String?
)

// =========================================================================
// SYNC DTOs
// =========================================================================

data class SyncLeadsResponse(
    val success: Boolean,
    val leads: List<LeadDto>?,
    val removedLeadIds: List<String>?,
    val nextCursor: String?,
    val hasMore: Boolean?,
    val serverTime: String?,
    val error: String?
)

data class LeadDto(
    val id: String,
    val name: String,
    val email: String?,
    val phone: String,
    val normalizedPhone: String?,
    val status: String,
    val source: String?,
    val company: String?,
    val updatedAt: String?
)

// =========================================================================
// CALL REPORTING DTOs
// =========================================================================

data class ReportCallRequest(
    val clientCallId: String,
    val phone: String,
    val duration: Long,
    val startedAt: String,
    val endedAt: String,
    val direction: String = "outbound",
    val status: String = "completed",
    val disposition: String? = null,
    val notes: String? = null
)

data class ReportCallResponse(
    val success: Boolean,
    val callId: String?,
    val leadId: String?,
    val leadMatched: Boolean?,
    val recordingAllowed: Boolean?,
    val isDuplicate: Boolean?,
    val error: String?
)

data class RecordingTicketResponse(
    val success: Boolean,
    val ticket: String?,
    val uploadUrl: String?,
    val maxSizeBytes: Long?,
    val expiresAt: String?,
    val error: String?
)
