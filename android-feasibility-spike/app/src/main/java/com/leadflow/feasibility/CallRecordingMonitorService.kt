package com.leadflow.feasibility

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * CallRecordingMonitorService - Foreground Service for Aggressive Battery Optimization Survival
 */
class CallRecordingMonitorService : Service() {

    companion object {
        private const val CHANNEL_ID = "leadflow_call_monitor"
        private const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "LeadFlow Call Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitors lead calls and synchronizes audio recordings"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Leads-365 Call Monitor Active")
                .setContentText("Monitoring lead call recordings for your agency")
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Leads-365 Call Monitor Active")
                .setContentText("Monitoring lead call recordings for your agency")
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .build()
        }
    }
}
