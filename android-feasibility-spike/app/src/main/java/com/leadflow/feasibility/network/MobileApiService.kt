package com.leadflow.feasibility.network

import retrofit2.Response
import retrofit2.http.*

interface MobileApiService {

    @POST("/api/mobile/auth/login")
    suspend fun login(
        @Body request: DeviceLoginRequest
    ): Response<DeviceLoginResponse>

    @POST("/api/mobile/auth/refresh")
    suspend fun refresh(
        @Body request: DeviceRefreshRequest
    ): Response<DeviceRefreshResponse>

    @POST("/api/mobile/auth/logout")
    suspend fun logout(): Response<BaseResponse>

    @GET("/api/mobile/status")
    suspend fun getStatus(): Response<BaseResponse>

    @GET("/api/mobile/leads")
    suspend fun syncLeads(
        @Query("since") since: String? = null,
        @Query("limit") limit: Int = 100,
        @Query("cursor") cursor: String? = null
    ): Response<SyncLeadsResponse>

    @POST("/api/mobile/calls")
    suspend fun reportCall(
        @Body request: ReportCallRequest
    ): Response<ReportCallResponse>

    @POST("/api/mobile/calls/{id}/recording-ticket")
    suspend fun getRecordingTicket(
        @Path("id") callId: String
    ): Response<RecordingTicketResponse>
}
