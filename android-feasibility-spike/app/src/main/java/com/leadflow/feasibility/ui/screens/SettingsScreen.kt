package com.leadflow.feasibility.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.leadflow.feasibility.data.AppDatabase
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.network.ApiClient
import com.leadflow.feasibility.worker.LeadSyncWorker
import com.leadflow.feasibility.worker.UploadRecordingsWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onLogout: () -> Unit
) {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }
    val db = remember { AppDatabase.getInstance(context) }
    val scope = rememberCoroutineScope()

    var wifiOnly by remember { mutableStateOf(sessionManager.wifiOnlyUploads) }
    var pendingUploadsCount by remember { mutableStateOf(0) }
    var blockedPhase16Count by remember { mutableStateOf(0) }
    var leadsCount by remember { mutableStateOf(0) }
    var isSyncing by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            pendingUploadsCount = db.uploadQueueDao().getPending().size
            leadsCount = db.leadDao().count()
        }
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log Out Device?") },
            text = { Text("Logging out will revoke current access tokens and securely clear cached lead phone numbers and upload queue from this device.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLogoutDialog = false
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                try {
                                    ApiClient.getService(context).logout()
                                } catch (_: Exception) {}
                                sessionManager.clearSession()
                                db.leadDao().clearAll()
                                db.uploadQueueDao().clearAll()
                            }
                            onLogout()
                        }
                    }
                ) {
                    Text("Confirm Logout", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings & Diagnostics", fontWeight = FontWeight.Bold) }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Agent & Device Identity
            item {
                Text("Identity & Device Binding", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(modifier = Modifier.height(6.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        DetailRow("Agent ID", sessionManager.agentId ?: "Not signed in")
                        DetailRow("Tenant ID", sessionManager.tenantId ?: "Default")
                        DetailRow("Device UUID", sessionManager.deviceUuid)
                        DetailRow("Backend URL", sessionManager.serverUrl)
                        DetailRow("Last Sync Watermark", sessionManager.lastSyncTimestamp ?: "Never")
                    }
                }
            }

            // Sync & Upload Queue
            item {
                Text("Storage & Queue Status", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(modifier = Modifier.height(6.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        DetailRow("Cached Leads Count", "$leadsCount active CRM leads")
                        DetailRow("Pending Uploads", "$pendingUploadsCount recording(s)")
                        DetailRow("Phase 16 Status", "Backend GridFS storage pending")

                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Button(
                                onClick = {
                                    isSyncing = true
                                    val syncReq = OneTimeWorkRequestBuilder<LeadSyncWorker>().build()
                                    WorkManager.getInstance(context).enqueue(syncReq)
                                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                                        isSyncing = false
                                        scope.launch {
                                            withContext(Dispatchers.IO) {
                                                leadsCount = db.leadDao().count()
                                            }
                                        }
                                    }, 1500)
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                if (isSyncing) {
                                    CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
                                } else {
                                    Text("Sync Leads Now")
                                }
                            }

                            FilledTonalButton(
                                onClick = {
                                    val uploadReq = OneTimeWorkRequestBuilder<UploadRecordingsWorker>().build()
                                    WorkManager.getInstance(context).enqueue(uploadReq)
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Retry Uploads")
                            }
                        }
                    }
                }
            }

            // Preferences
            item {
                Text("Data & Upload Preferences", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(modifier = Modifier.height(6.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Wi-Fi Only Audio Uploads", fontWeight = FontWeight.Medium, fontSize = 14.sp)
                            Text("Only upload recordings when connected to unmetered Wi-Fi network", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = wifiOnly,
                            onCheckedChange = {
                                wifiOnly = it
                                sessionManager.wifiOnlyUploads = it
                            }
                        )
                    }
                }
            }

            // Folder & Privacy diagnostics
            item {
                Text("Folder & Privacy Configuration", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(modifier = Modifier.height(6.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text("Recordings Folder Path:", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                        Text(
                            text = sessionManager.recordingsFolderUri ?: "No folder selected yet",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Privacy Enforcement: Lead-Only. Personal calls are rejected before reading disk or connecting to network.",
                            fontSize = 11.sp,
                            color = Color(0xFF2E7D32)
                        )
                    }
                }
            }

            // Logout
            item {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { showLogoutDialog = true },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                ) {
                    Icon(Icons.Default.Logout, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Log Out & Clear Local Data")
                }
            }
        }
    }
}

@Composable
fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text = value, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
    }
}
