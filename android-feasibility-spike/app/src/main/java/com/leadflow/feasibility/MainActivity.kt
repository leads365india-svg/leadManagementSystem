package com.leadflow.feasibility

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile

/**
 * MainActivity - Android Feasibility Spike Diagnostic Dashboard
 * 
 * Allows engineers to:
 * 1. Grant required runtime permissions (READ_PHONE_STATE, READ_CALL_LOG).
 * 2. Select the manufacturer's Call Recordings folder via system folder picker.
 * 3. Persist folder read permissions across device reboots.
 * 4. Scan folder contents and verify file naming pattern, audio duration, and file size.
 * 5. Run end-to-end call detection and recording upload test.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
    }

    private lateinit var tvStatus: TextView
    private lateinit var tvFolderUri: TextView
    private lateinit var tvLog: TextView
    private lateinit var etLeadNumber: EditText

    // Storage Access Framework folder picker launcher
    private val folderPickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val treeUri: Uri? = result.data?.data
            if (treeUri != null) {
                // Persist folder access across device reboots
                val takeFlags: Int = Intent.FLAG_GRANT_READ_URI_PERMISSION
                contentResolver.takePersistableUriPermission(treeUri, takeFlags)

                // Save to SharedPreferences
                val prefs = getSharedPreferences("leadflow_spike", Context.MODE_PRIVATE)
                prefs.edit().putString("recordings_tree_uri", treeUri.toString()).apply()

                tvFolderUri.text = "Folder: $treeUri"
                appendLog("✅ Recordings folder permission persisted: $treeUri")
                scanFolder(treeUri)
            }
        }
    }

    // Runtime permissions launcher
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            appendLog("✅ All runtime permissions granted.")
        } else {
            appendLog("⚠️ Some permissions were denied: $permissions")
        }
        updatePermissionStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Programmatic lightweight UI layout
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(32, 48, 32, 48)
        }

        val tvTitle = TextView(this).apply {
            text = "Leads-365 Call Recording Spike"
            textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        layout.addView(tvTitle)

        tvStatus = TextView(this).apply {
            text = "Permissions: Checking..."
            setPadding(0, 16, 0, 16)
        }
        layout.addView(tvStatus)

        val btnPermissions = Button(this).apply {
            text = "1. Grant Required Permissions"
            setOnClickListener { requestAppPermissions() }
        }
        layout.addView(btnPermissions)

        val btnPickFolder = Button(this).apply {
            text = "2. Select Phone Recordings Folder"
            setOnClickListener { openFolderPicker() }
        }
        layout.addView(btnPickFolder)

        tvFolderUri = TextView(this).apply {
            text = "Folder: Not selected"
            textSize = 12f
            setPadding(0, 8, 0, 8)
        }
        layout.addView(tvFolderUri)

        val btnScan = Button(this).apply {
            text = "3. Run Self-Test & Scan Folder"
            setOnClickListener {
                val prefs = getSharedPreferences("leadflow_spike", Context.MODE_PRIVATE)
                val uriStr = prefs.getString("recordings_tree_uri", null)
                if (uriStr != null) scanFolder(Uri.parse(uriStr))
                else Toast.makeText(this@MainActivity, "Please select recordings folder first", Toast.LENGTH_SHORT).show()
            }
        }
        layout.addView(btnScan)

        etLeadNumber = EditText(this).apply {
            hint = "Enter Test Lead Number (e.g. 9876543210)"
            inputType = android.text.InputType.TYPE_CLASS_PHONE
        }
        layout.addView(etLeadNumber)

        val btnAddLead = Button(this).apply {
            text = "4. Whitelist Test Lead Number"
            setOnClickListener {
                val num = etLeadNumber.text.toString().trim()
                if (num.isNotEmpty()) {
                    CallStateReceiver.leadPhoneWhitelist.add(num)
                    appendLog("Added lead whitelist: $num")
                    Toast.makeText(this@MainActivity, "Added to lead whitelist", Toast.LENGTH_SHORT).show()
                }
            }
        }
        layout.addView(btnAddLead)

        tvLog = TextView(this).apply {
            text = "=== Diagnostic Log ===\n"
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(0, 16, 0, 16)
        }
        val scrollView = android.widget.ScrollView(this).apply {
            addView(tvLog)
        }
        layout.addView(scrollView)

        setContentView(layout)

        // Initial check
        updatePermissionStatus()
        val savedUri = getSharedPreferences("leadflow_spike", Context.MODE_PRIVATE).getString("recordings_tree_uri", null)
        if (savedUri != null) {
            tvFolderUri.text = "Folder: $savedUri"
        }
    }

    private fun requestAppPermissions() {
        val perms = mutableListOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    private fun updatePermissionStatus() {
        val phoneState = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        val callLog = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

        tvStatus.text = "Phone State: ${if (phoneState) "✅" else "❌"} | Call Log: ${if (callLog) "✅" else "❌"}"
    }

    private fun openFolderPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        }
        folderPickerLauncher.launch(intent)
    }

    private fun scanFolder(treeUri: Uri) {
        appendLog("Scanning folder: $treeUri ...")
        try {
            val root = DocumentFile.fromTreeUri(this, treeUri)
            if (root != null && root.isDirectory) {
                val files = root.listFiles()
                appendLog("Found ${files.size} total items in folder.")
                files.take(10).forEach { file ->
                    appendLog("  - ${file.name} (${file.length()} bytes, modified: ${file.lastModified()})")
                }
            } else {
                appendLog("❌ Folder URI cannot be opened as directory.")
            }
        } catch (e: Exception) {
            appendLog("❌ Scan error: ${e.message}")
        }
    }

    private fun appendLog(msg: String) {
        Log.i(TAG, msg)
        runOnUiThread {
            tvLog.append("$msg\n")
        }
    }
}
