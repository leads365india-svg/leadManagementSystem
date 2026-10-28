package com.leadflow.feasibility.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.leadflow.feasibility.data.SessionManager

@Composable
fun PermissionsScreen(
    onReady: () -> Unit
) {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }

    var phoneStateGranted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED)
    }
    var callLogGranted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED)
    }
    var notificationGranted by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            } else true
        )
    }
    var folderUri by remember { mutableStateOf(sessionManager.recordingsFolderUri) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        phoneStateGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        callLogGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        }
    }

    val folderPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri: Uri? = result.data?.data
        if (uri != null) {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            try {
                context.contentResolver.takePersistableUriPermission(uri, flags)
            } catch (_: Exception) {}
            sessionManager.recordingsFolderUri = uri.toString()
            folderUri = uri.toString()
        }
    }

    val allReady = phoneStateGranted && callLogGranted && !folderUri.isNullOrBlank()

    Scaffold(
        bottomBar = {
            Surface(tonalElevation = 4.dp) {
                Button(
                    onClick = onReady,
                    enabled = allReady,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                        .height(48.dp)
                ) {
                    Text(if (allReady) "Continue to Leads" else "Complete Readiness Steps First")
                }
            }
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Text(
                    text = "Device Readiness & Privacy",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Leads-365 operates with a strict Lead-Only Privacy filter. Required permissions are used exclusively to match active CRM leads and protect non-lead personal calls.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            item {
                PermissionCard(
                    title = "Phone State & Call Detection",
                    description = "Used to detect when a phone call starts and ends so call duration can be recorded.",
                    isGranted = phoneStateGranted,
                    icon = Icons.Default.PhoneCallback,
                    buttonText = "Grant Phone State",
                    onRequest = {
                        val perms = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            perms.add(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        permissionLauncher.launch(perms.toTypedArray())
                    }
                )
            }

            item {
                PermissionCard(
                    title = "Call Log Access",
                    description = "Allows normalizing the dialed number to match against your assigned CRM leads. If a number does not match an assigned lead, call processing halts immediately.",
                    isGranted = callLogGranted,
                    icon = Icons.Default.Call,
                    buttonText = "Grant Call Log",
                    onRequest = {
                        permissionLauncher.launch(arrayOf(Manifest.permission.READ_CALL_LOG))
                    }
                )
            }

            item {
                PermissionCard(
                    title = "Call Recordings Folder",
                    description = if (folderUri.isNullOrBlank())
                        "Select the directory where your phone manufacturer saves call recordings (via Storage Access Framework)."
                    else "Folder: $folderUri",
                    isGranted = !folderUri.isNullOrBlank(),
                    icon = Icons.Default.FolderSpecial,
                    buttonText = if (folderUri.isNullOrBlank()) "Select Recordings Folder" else "Change Folder",
                    onRequest = {
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        }
                        folderPickerLauncher.launch(intent)
                    }
                )
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                item {
                    PermissionCard(
                        title = "Foreground Notifications",
                        description = "Enables background upload status alerts and post-call feedback notifications.",
                        isGranted = notificationGranted,
                        icon = Icons.Default.Notifications,
                        buttonText = "Grant Notifications",
                        onRequest = {
                            permissionLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                        }
                    )
                }
            }

            item {
                val brand = com.leadflow.feasibility.telephony.OemAutostartHelper.getDeviceBrand()
                val isExempted = com.leadflow.feasibility.telephony.OemAutostartHelper.isIgnoringBatteryOptimizations(context)
                PermissionCard(
                    title = "Background Execution & Autostart (${brand.name})",
                    description = "Prevents OEM battery managers from terminating call detection and recording discovery when the phone is locked.",
                    isGranted = isExempted,
                    icon = Icons.Default.BatteryChargingFull,
                    buttonText = "Configure Autostart Settings",
                    onRequest = {
                        com.leadflow.feasibility.telephony.OemAutostartHelper.openAutostartSettings(context)
                    }
                )
            }
        }
    }
}

@Composable
fun PermissionCard(
    title: String,
    description: String,
    isGranted: Boolean,
    icon: ImageVector,
    buttonText: String,
    onRequest: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isGranted) MaterialTheme.colorScheme.surfaceVariant
            else MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = if (isGranted) Color(0xFF2E7D32) else MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(text = title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
                Icon(
                    imageVector = if (isGranted) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = null,
                    tint = if (isGranted) Color(0xFF2E7D32) else MaterialTheme.colorScheme.error
                )
            }

            Spacer(modifier = Modifier.height(6.dp))
            Text(text = description, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

            if (!isGranted) {
                Spacer(modifier = Modifier.height(10.dp))
                FilledTonalButton(
                    onClick = onRequest,
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text(buttonText)
                }
            }
        }
    }
}
