package com.leadflow.feasibility.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import com.leadflow.feasibility.data.SessionManager
import com.leadflow.feasibility.ui.screens.*

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Leads : Screen("leads", "Leads", Icons.Default.Group)
    object History : Screen("history", "History", Icons.Default.History)
    object PostCall : Screen("post_call", "Post-Call", Icons.Default.RateReview)
    object Readiness : Screen("readiness", "Readiness", Icons.Default.Security)
    object Settings : Screen("settings", "Settings", Icons.Default.Settings)
}

@Composable
fun AppNavigation() {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }
    var isLoggedIn by remember { mutableStateOf(sessionManager.isLoggedIn) }
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Leads) }
    var selectedCallId by remember { mutableStateOf<String?>(null) }

    if (!isLoggedIn) {
        LoginScreen(
            onLoginSuccess = {
                isLoggedIn = true
                currentScreen = Screen.Leads
            }
        )
    } else {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    val navItems = listOf(
                        Screen.Leads,
                        Screen.History,
                        Screen.PostCall,
                        Screen.Readiness,
                        Screen.Settings
                    )
                    navItems.forEach { screen ->
                        NavigationBarItem(
                            icon = { Icon(screen.icon, contentDescription = screen.title) },
                            label = { Text(screen.title) },
                            selected = (currentScreen.route == screen.route),
                            onClick = { currentScreen = screen }
                        )
                    }
                }
            }
        ) { paddingValues ->
            Surface(modifier = Modifier.padding(paddingValues)) {
                when (currentScreen) {
                    Screen.Leads -> MyLeadsScreen(
                        onLeadSelected = { lead ->
                            // Open dialer or post-call
                        }
                    )
                    Screen.History -> CallHistoryScreen(
                        onCallClick = { call ->
                            selectedCallId = call.id
                            currentScreen = Screen.PostCall
                        }
                    )
                    Screen.PostCall -> PostCallScreen(
                        callLogId = selectedCallId,
                        onDone = {
                            currentScreen = Screen.History
                        }
                    )
                    Screen.Readiness -> PermissionsScreen(
                        onReady = {
                            currentScreen = Screen.Leads
                        }
                    )
                    Screen.Settings -> SettingsScreen(
                        onLogout = {
                            isLoggedIn = false
                        }
                    )
                }
            }
        }
    }
}
