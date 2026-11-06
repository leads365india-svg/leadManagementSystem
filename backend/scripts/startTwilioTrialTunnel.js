/**
 * Leads365 — Automated Twilio Trial Webhook & HTTPS Tunnel Runner
 * 
 * One-command trial connectivity setup:
 * 1. Spawns isolated Twilio Trial Webhook Server on port 5055.
 * 2. Spawns temporary Cloudflare Quick Tunnel (cloudflared.exe) to port 5055.
 * 3. Extracts and presents the live public HTTPS webhook URL.
 * 4. Zero MongoDB connection, Zero Gemini, Zero background queue workers.
 */

const { spawn } = require("child_process")
const path = require("path")
const http = require("http")
const { startServer } = require("./twilioTrialWebhookServer")

const PORT = process.env.TWILIO_TRIAL_PORT || 5055
const CLOUDFLARED_BIN = path.join(__dirname, "cloudflared.exe")

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: Cannot run Twilio trial runner in production.")
    process.exit(1)
  }

  process.env.TWILIO_TRIAL_TEST_ENABLED = "true"

  console.log("\n=======================================================")
  console.log("   LEADS365 — TWILIO TRIAL HTTPS TUNNEL SETUP         ")
  console.log("=======================================================\n")
  console.log("1. Starting isolated local webhook server on port " + PORT + "...")

  let server
  try {
    server = await startServer({ port: PORT })
  } catch (err) {
    console.error("❌ Failed to start local server:", err.message)
    process.exit(1)
  }

  console.log("2. Launching Cloudflare HTTPS tunnel...")

  const tunnelProcess = spawn(
    CLOUDFLARED_BIN,
    ["tunnel", "--protocol", "http2", "--url", `http://127.0.0.1:${PORT}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  let publicUrl = null

  const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

  function handleOutput(data) {
    const text = data.toString()
    if (!publicUrl) {
      const match = text.match(urlRegex)
      if (match) {
        publicUrl = match[0]
        const webhookUrl = `${publicUrl}/twilio-trial/voice`
        process.env.TWILIO_PUBLIC_URL = webhookUrl

        console.log("\n🎉 ======================================================")
        console.log("   PUBLIC TWILIO WEBHOOK IS READY FOR TRIAL CALLS!       ")
        console.log("==========================================================")
        console.log("🔗 Public Webhook URL:")
        console.log(`   ${webhookUrl}\n`)
        console.log("📋 How to configure in Twilio Console:")
        console.log("   1. Open: https://console.twilio.com/develop/phone-numbers/manage/active")
        console.log("   2. Select your Twilio Trial Phone Number.")
        console.log("   3. Scroll to 'Voice Configuration' -> 'A CALL COMES IN'.")
        console.log("   4. Select: 'Webhook' with HTTP POST.")
        console.log(`   5. Paste: ${webhookUrl}`)
        console.log("   6. Click 'Save configuration'.\n")
        console.log("📞 When you dial your Twilio number, Twilio will send the webhook")
        console.log("   to your local server and speak the Leads365 test greeting!")
        console.log("==========================================================\n")
        console.log("Press Ctrl+C to stop the tunnel and server.\n")
      }
    }
  }

  tunnelProcess.stdout.on("data", handleOutput)
  tunnelProcess.stderr.on("data", handleOutput)

  tunnelProcess.on("error", (err) => {
    console.error("❌ Tunnel process error:", err.message)
  })

  tunnelProcess.on("exit", (code) => {
    console.log(`Tunnel process exited with code ${code}`)
    server.close()
    process.exit(0)
  })

  // Graceful shutdown
  const cleanup = () => {
    console.log("\nStopping trial server and tunnel...")
    tunnelProcess.kill("SIGINT")
    server.close(() => {
      console.log("Trial server stopped.")
      process.exit(0)
    })
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
}

if (require.main === module) {
  main()
}

module.exports = { main }
