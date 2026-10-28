package com.leadflow.feasibility.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import com.leadflow.feasibility.data.AppDatabase
import com.leadflow.feasibility.data.CallLogEntity
import com.leadflow.feasibility.network.ApiClient
import com.leadflow.feasibility.network.ReportCallRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostCallScreen(
    callLogId: String? = null,
    onDone: () -> Unit
) {
    val context = LocalContext.current
    val db = remember { AppDatabase.getInstance(context) }
    val scope = rememberCoroutineScope()

    var latestCall by remember { mutableStateOf<CallLogEntity?>(null) }
    var outcome by remember { mutableStateOf("Interested") }
    var notes by remember { mutableStateOf("") }
    var isSaving by remember { mutableStateOf(false) }
    var saveSuccess by remember { mutableStateOf(false) }

    val outcomes = listOf(
        "Interested", "Follow-up Needed", "Left Message", "Not Interested", "Wrong Number", "Won Deal"
    )

    LaunchedEffect(callLogId) {
        withContext(Dispatchers.IO) {
            val call = if (!callLogId.isNullOrBlank()) {
                db.callLogDao().getById(callLogId)
            } else {
                db.callLogDao().getRecentCall()
            }
            withContext(Dispatchers.Main) {
                latestCall = call
                call?.outcome?.let { outcome = it }
                call?.notes?.let { notes = it }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Post-Call Feedback", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        if (latestCall == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("No recent call log available to log.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            val call = latestCall!!
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f))
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = call.leadName,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "${call.durationSeconds}s",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(text = "Phone: ${call.phone}", fontSize = 14.sp)
                            Text(text = "Direction: ${call.direction}", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)

                            Spacer(modifier = Modifier.height(8.dp))
                            HorizontalDivider()
                            Spacer(modifier = Modifier.height(8.dp))

                            // Recording discovery status
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = if (call.recordingFound) Icons.Default.Mic else Icons.Default.MicOff,
                                    contentDescription = null,
                                    tint = if (call.recordingFound) Color(0xFF2E7D32) else MaterialTheme.colorScheme.outline,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = if (call.recordingFound) "Recording matched: ${call.recordingFilename ?: "audio"}"
                                    else "No recording detected or Do-Not-Record active",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }

                item {
                    Text("Select Call Outcome", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(outcomes) { item ->
                            FilterChip(
                                selected = (outcome == item),
                                onClick = { outcome = item },
                                label = { Text(item) },
                                leadingIcon = if (outcome == item) {
                                    { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
                                } else null
                            )
                        }
                    }
                }

                item {
                    Text("Call Notes & Action Items", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it },
                        placeholder = { Text("Customer agreed to meeting next Tuesday, send pricing PDF...") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                    )
                }

                if (saveSuccess) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF2E7D32))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Call feedback saved and queued for sync.", color = Color(0xFF1B5E20), fontSize = 13.sp)
                            }
                        }
                    }
                }

                item {
                    Button(
                        onClick = {
                            isSaving = true
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    db.callLogDao().updateFeedback(call.id, outcome, notes)

                                    // Best-effort sync to backend
                                    try {
                                        val api = ApiClient.getService(context)
                                        api.reportCall(
                                            ReportCallRequest(
                                                leadId = call.leadId,
                                                phoneNumber = call.phone,
                                                duration = call.durationSeconds.toInt(),
                                                callType = call.direction.lowercase(),
                                                startedAt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                                                    .format(java.util.Date(call.timestamp)),
                                                endedAt = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                                                    .format(java.util.Date(call.timestamp + call.durationSeconds * 1000L)),
                                                recordingDuration = call.durationSeconds.toInt(),
                                                recordingSha256 = call.sha256,
                                                notes = notes,
                                                outcome = outcome
                                            )
                                        )
                                    } catch (_: Exception) {}
                                }
                                isSaving = false
                                saveSuccess = true
                            }
                        },
                        enabled = !isSaving,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                        } else {
                            Text("Save Call Log")
                        }
                    }
                }
            }
        }
    }
}
