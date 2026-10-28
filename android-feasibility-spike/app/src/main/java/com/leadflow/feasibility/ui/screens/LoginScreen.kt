package com.leadflow.feasibility.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.network.ApiClient
import com.leadflow.feasibility.network.DeviceLoginRequest
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit
) {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }
    val scope = rememberCoroutineScope()

    var serverUrl by remember { mutableStateOf(sessionManager.serverUrl) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showServerConfig by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.PhoneInTalk,
            contentDescription = "Leads-365 Logo",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(64.dp)
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "Leads-365 Mobile",
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )

        Text(
            text = "Field Agent Call Companion & Lead Sync",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it; errorMessage = null },
            label = { Text("Agent Email") },
            leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it; errorMessage = null },
            label = { Text("Password") },
            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth()
        )

        if (showServerConfig) {
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it; sessionManager.serverUrl = it },
                label = { Text("Backend URL") },
                leadingIcon = { Icon(Icons.Default.Dns, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }

        TextButton(
            onClick = { showServerConfig = !showServerConfig },
            modifier = Modifier.align(Alignment.End)
        ) {
            Text(if (showServerConfig) "Hide Server URL" else "Edit Server URL")
        }

        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = errorMessage!!,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                    fontSize = 13.sp
                )
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        Button(
            onClick = {
                if (email.isBlank() || password.isBlank()) {
                    errorMessage = "Please enter both email and password."
                    return@Button
                }
                isLoading = true
                errorMessage = null
                scope.launch {
                    try {
                        sessionManager.serverUrl = serverUrl.trim()
                        ApiClient.resetInstance()
                        val api = ApiClient.getService(context)
                        val req = DeviceLoginRequest(
                            email = email.trim(),
                            password = password,
                            deviceUuid = sessionManager.deviceUuid,
                            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}",
                            osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                            appVersion = "1.0.0-phase17"
                        )
                        val response = api.login(req)
                        if (response.isSuccessful && response.body() != null) {
                            val data = response.body()!!
                            sessionManager.saveTokens(
                                access = data.accessToken ?: "",
                                refresh = data.refreshToken ?: ""
                            )
                            sessionManager.agentId = data.agentId ?: email
                            sessionManager.tenantId = data.tenantId ?: "default"
                            isLoading = false
                            onLoginSuccess()
                        } else {
                            isLoading = false
                            errorMessage = "Login failed (${response.code()}): ${response.message() ?: "Invalid credentials"}"
                        }
                    } catch (e: Exception) {
                        isLoading = false
                        errorMessage = "Network connection error: ${e.message}"
                    }
                }
            },
            enabled = !isLoading,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text("Sign In with Device Binding", fontSize = 16.sp)
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Device UUID: ${sessionManager.deviceUuid.take(8)}...",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.outline
        )
    }
}
