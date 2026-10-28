package com.leadflow.feasibility

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import com.leadflow.feasibility.ui.AppNavigation

/**
 * MainActivity - Primary Entry Point for Leads-365 Android MVP
 * 
 * Complies with Roadmap Phase 17:
 * - Jetpack Compose Material3 Design
 * - Authenticated Navigation Flow (Login -> Readiness -> Leads -> Post-Call -> History -> Settings)
 * - Persistent Room & WorkManager binding
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val colorScheme = if (isSystemInDarkTheme()) {
                darkColorScheme()
            } else {
                lightColorScheme()
            }

            MaterialTheme(colorScheme = colorScheme) {
                AppNavigation()
            }
        }
    }
}
