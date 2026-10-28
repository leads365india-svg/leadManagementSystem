package com.leadflow.feasibility.network

import android.content.Context
import android.util.Log
import com.leadflow.feasibility.data.SessionManager
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    private const val TAG = "ApiClient"
    private var serviceInstance: MobileApiService? = null
    private var currentBaseUrl: String? = null

    @Synchronized
    fun getService(context: Context): MobileApiService {
        val sessionManager = SessionManager(context)
        var baseUrl = sessionManager.serverUrl.trim()
        if (!baseUrl.endsWith("/")) {
            baseUrl += "/"
        }

        if (serviceInstance != null && currentBaseUrl == baseUrl) {
            return serviceInstance!!
        }

        currentBaseUrl = baseUrl

        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val requestBuilder = original.newBuilder()
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("X-Device-Id", sessionManager.deviceUuid)

            val token = sessionManager.accessToken
            if (!token.isNullOrBlank() && !original.url.encodedPath.contains("/auth/login") && !original.url.encodedPath.contains("/auth/refresh")) {
                requestBuilder.header("Authorization", "Bearer $token")
            }

            chain.proceed(requestBuilder.build())
        }

        // Automatic Token Refresh Authenticator
        val tokenAuthenticator = Authenticator { _: Route?, response: Response ->
            if (response.request.header("Authorization") == null) {
                return@Authenticator null // No auth was provided, nothing to refresh
            }

            synchronized(this) {
                val refreshToken = sessionManager.refreshToken
                if (refreshToken.isNullOrBlank()) {
                    sessionManager.clearSession()
                    return@Authenticator null
                }

                // Make direct refresh call
                try {
                    val directClient = OkHttpClient.Builder().build()
                    val refreshBody = okhttp3.RequestBody.create(
                        okhttp3.MediaType.parse("application/json"),
                        "{\"refreshToken\":\"$refreshToken\"}"
                    )
                    val refreshReq = Request.Builder()
                        .url("${baseUrl}api/mobile/auth/refresh")
                        .post(refreshBody)
                        .header("X-Device-Id", sessionManager.deviceUuid)
                        .build()

                    val refreshResp = directClient.newCall(refreshReq).execute()
                    if (refreshResp.isSuccessful) {
                        val bodyStr = refreshResp.body()?.string() ?: ""
                        val gson = com.google.gson.Gson()
                        val refreshData = gson.fromJson(bodyStr, DeviceRefreshResponse::class.java)
                        val newAccessToken = refreshData.accessToken
                        val newRefreshToken = refreshData.refreshToken ?: refreshToken

                        if (!newAccessToken.isNullOrBlank()) {
                            sessionManager.saveTokens(newAccessToken, newRefreshToken)
                            Log.i(TAG, "Access token refreshed successfully.")
                            return@Authenticator response.request.newBuilder()
                                .header("Authorization", "Bearer $newAccessToken")
                                .build()
                        }
                    } else {
                        Log.w(TAG, "Token refresh rejected (${refreshResp.code()}). Clearing session.")
                        sessionManager.clearSession()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Exception during token refresh", e)
                }
                null
            }
        }

        val loggingInterceptor = HttpLoggingInterceptor { message ->
            // Prevent logging of sensitive bearer tokens in production
            if (!message.contains("Authorization: Bearer") && !message.contains("password")) {
                Log.d("OkHttp", message)
            }
        }.apply {
            level = HttpLoggingInterceptor.Level.HEADERS
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .authenticator(tokenAuthenticator)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        serviceInstance = retrofit.create(MobileApiService::class.java)
        return serviceInstance!!
    }

    /**
     * Resets the cached Retrofit instance when server URL changes.
     */
    fun resetInstance() {
        serviceInstance = null
        currentBaseUrl = null
    }
}
