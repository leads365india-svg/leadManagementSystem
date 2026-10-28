package com.leadflow.feasibility.telephony

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * OemAutostartHelper - Roadmap Phase 20: Android Hardening & Distribution
 * 
 * Provides manufacturer-specific autostart and battery optimization deep links
 * for Xiaomi, Oppo, Vivo, Samsung, and standard Android devices.
 * Prevents aggressive OEM background process killing while keeping apps compliant.
 */
object OemAutostartHelper {

    private const val TAG = "OemAutostartHelper"

    enum class OemBrand {
        XIAOMI,
        OPPO,
        VIVO,
        SAMSUNG,
        GENERIC
    }

    fun getDeviceBrand(): OemBrand {
        val manufacturer = Build.MANUFACTURER.lowercase()
        return when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> OemBrand.XIAOMI
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> OemBrand.OPPO
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> OemBrand.VIVO
            manufacturer.contains("samsung") -> OemBrand.SAMSUNG
            else -> OemBrand.GENERIC
        }
    }

    /**
     * Checks whether battery optimization is currently exempted for this application.
     */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    }

    /**
     * Returns a manufacturer-tailored Intent to open the OEM Autostart or Battery management screen.
     * Falls back to standard Android app details or battery optimization if OEM intent cannot be resolved.
     */
    fun getAutostartIntent(context: Context): Intent {
        val brand = getDeviceBrand()
        val oemIntents = when (brand) {
            OemBrand.XIAOMI -> listOf(
                Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
                Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"))
            )
            OemBrand.OPPO -> listOf(
                Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
                Intent().setComponent(ComponentName("com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity")),
                Intent().setComponent(ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"))
            )
            OemBrand.VIVO -> listOf(
                Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
                Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")),
                Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"))
            )
            OemBrand.SAMSUNG -> listOf(
                Intent().setComponent(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")),
                Intent().setComponent(ComponentName("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity")),
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            )
            OemBrand.GENERIC -> emptyList()
        }

        val packageManager = context.packageManager
        for (intent in oemIntents) {
            try {
                if (intent.resolveActivity(packageManager) != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    Log.i(TAG, "Resolved OEM autostart intent for ${brand.name}")
                    return intent
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed resolving OEM intent: ${e.message}")
            }
        }

        // Standard Android Fallback 1: Battery optimization settings
        val batteryIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (batteryIntent.resolveActivity(packageManager) != null) {
            return batteryIntent
        }

        // Standard Android Fallback 2: Application details settings
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    /**
     * Launch manufacturer settings safely with catch-all.
     */
    fun openAutostartSettings(context: Context): Boolean {
        return try {
            val intent = getAutostartIntent(context)
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error launching autostart settings", e)
            false
        }
    }
}
