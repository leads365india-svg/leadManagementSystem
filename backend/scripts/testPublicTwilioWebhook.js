/**
 * Leads365 — Public Twilio Webhook Connectivity Test Runner
 * 
 * Tests the active Cloudflare tunnel:
 * https://insider-margin-clan-loop.trycloudflare.com/twilio-trial/voice
 * 
 * Safety & Privacy:
 * - Reads TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN from backend/.env.
 * - NEVER prints or logs secret values.
 * - Zero live phone calls placed (synthetic HTTP webhook probe only).
 * - Zero MongoDB connection or CRM records created.
 */

const path = require("path")
const https = require("https")
const crypto = require("crypto")
const querystring = require("querystring")

// Load .env
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const PUBLIC_WEBHOOK_URL = "https://insider-margin-clan-loop.trycloudflare.com/twilio-trial/voice"
const PUBLIC_HEALTH_URL = "https://insider-margin-clan-loop.trycloudflare.com/twilio-trial/health"

const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim()
const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim()

if (!accountSid || !authToken) {
  console.error("❌ ERROR: TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing in backend/.env")
  process.exit(1)
}

/**
 * Computes Twilio's standard HMAC-SHA1 webhook signature.
 * 
 * Algorithm:
 * 1. Start with exact public URL.
 * 2. Sort body keys alphabetically.
 * 3. Concatenate key + value without delimiters.
 * 4. HMAC-SHA1 using authToken and Base64-encode.
 */
function computeTwilioSignature(url, bodyParams, token) {
  let data = url
  if (bodyParams && typeof bodyParams === "object") {
    const keys = Object.keys(bodyParams).sort()
    for (const key of keys) {
      data += key + (bodyParams[key] !== undefined && bodyParams[key] !== null ? bodyParams[key] : "")
    }
  }
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64")
}

/**
 * Dispatches an HTTPS request to the public tunnel.
 */
function sendRequest(urlStr, { method = "GET", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr)
    const reqHeaders = { ...headers }
    if (body) {
      reqHeaders["Content-Length"] = Buffer.byteLength(body)
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout: 15000,
      },
      (res) => {
        let responseBody = ""
        res.on("data", (chunk) => (responseBody += chunk))
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody,
          })
        })
      }
    )

    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("Request timed out after 15s"))
    })

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

async function runPublicTwilioConnectivityTest() {
  console.log("\n=======================================================")
  console.log("   LEADS365 PUBLIC TWILIO WEBHOOK CONNECTIVITY TEST     ")
  console.log("=======================================================\n")
  console.log(`🌐 Target Public URL: ${PUBLIC_WEBHOOK_URL}`)
  console.log(`🔒 Credentials Loaded:`)
  console.log(`   - Account SID: ${accountSid.slice(0, 4)}...${accountSid.slice(-4)} (Configured ✅)`)
  console.log(`   - Auth Token:  •••••••••••••••••••••••••••••••• (Loaded securely ✅)`)
  console.log(`   - Secret Leakage Protection: Zero secrets printed or stored.\n`)

  let passedCount = 0
  let failedCount = 0

  // -------------------------------------------------------------
  // Test 1: Check Health & Complete Isolation
  // -------------------------------------------------------------
  try {
    const healthRes = await sendRequest(PUBLIC_HEALTH_URL, { method: "GET" })
    if (healthRes.statusCode === 200) {
      const data = JSON.parse(healthRes.body)
      if (
        data.status === "healthy" &&
        data.database === "completely_isolated_no_connection" &&
        data.gemini === "isolated_disabled" &&
        data.accountSidConfigured === true &&
        data.authTokenConfigured === true
      ) {
        passedCount++
        console.log(`  ✅ [PASS] 1. Public tunnel is live & verified completely isolated:`)
        console.log(`            - Database: ${data.database}`)
        console.log(`            - Gemini:   ${data.gemini}`)
        console.log(`            - Account SID Configured: ${data.accountSidConfigured}`)
        console.log(`            - Auth Token Configured:  ${data.authTokenConfigured}`)
      } else {
        throw new Error(`Unexpected health payload: ${healthRes.body}`)
      }
    } else {
      throw new Error(`Expected HTTP 200, got ${healthRes.statusCode}`)
    }
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] 1. Health check failed: ${err.message}`)
  }

  // -------------------------------------------------------------
  // Test 2: Unsigned Request Returns HTTP 401
  // -------------------------------------------------------------
  const testPayload = {
    AccountSid: accountSid,
    ApiVersion: "2010-04-01",
    CallSid: `CA_test_${Date.now()}_probe`,
    CallStatus: "ringing",
    Called: "+12015550123",
    Caller: "+919876543210",
    Direction: "inbound",
    From: "+919876543210",
    To: "+12015550123",
  }
  const formBody = querystring.stringify(testPayload)

  try {
    const unsignedRes = await sendRequest(PUBLIC_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    })

    if (unsignedRes.statusCode === 401) {
      passedCount++
      console.log(`  ✅ [PASS] 2. Unsigned request is safely rejected with HTTP 401 Unauthorized`)
    } else {
      throw new Error(`Expected HTTP 401, got ${unsignedRes.statusCode}`)
    }
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] 2. Unsigned request test failed: ${err.message}`)
  }

  // -------------------------------------------------------------
  // Test 3: Invalid / Tampered Signature Returns HTTP 401
  // -------------------------------------------------------------
  try {
    const badSigRes = await sendRequest(PUBLIC_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": "invalid_forged_signature_xyz123==",
      },
      body: formBody,
    })

    if (badSigRes.statusCode === 401) {
      passedCount++
      console.log(`  ✅ [PASS] 3. Tampered signature request is safely rejected with HTTP 401 Unauthorized`)
    } else {
      throw new Error(`Expected HTTP 401, got ${badSigRes.statusCode}`)
    }
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] 3. Invalid signature test failed: ${err.message}`)
  }

  // -------------------------------------------------------------
  // Test 4: Correctly Signed Request Returns HTTP 200 with TwiML
  // -------------------------------------------------------------
  try {
    const validSignature = computeTwilioSignature(PUBLIC_WEBHOOK_URL, testPayload, authToken)

    const signedRes = await sendRequest(PUBLIC_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": validSignature,
      },
      body: formBody,
    })

    if (signedRes.statusCode === 200) {
      const isXml = signedRes.headers["content-type"] && signedRes.headers["content-type"].includes("text/xml")
      const containsGreeting = signedRes.body.includes(
        "Hello! You are connected to Leads365 local AI Receptionist testing server. Your Twilio webhook integration is working successfully."
      )
      const containsHangup = signedRes.body.includes("<Hangup/>")

      if (isXml && containsGreeting && containsHangup) {
        passedCount++
        console.log(`  ✅ [PASS] 4. Correctly signed request returns HTTP 200 OK`)
        console.log(`            - Content-Type: ${signedRes.headers["content-type"]}`)
        console.log(`            - Valid TwiML <Response> with expected test greeting verified!`)
        console.log(`            - Includes polite <Hangup/> tag`)
      } else {
        throw new Error(`Response body missing expected TwiML tags:\n${signedRes.body}`)
      }
    } else {
      throw new Error(`Expected HTTP 200, got ${signedRes.statusCode}:\n${signedRes.body}`)
    }
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] 4. Correctly signed request test failed: ${err.message}`)
  }

  // -------------------------------------------------------------
  // Test 5: Re-verify Database Isolation Post-Request
  // -------------------------------------------------------------
  try {
    const healthPostRes = await sendRequest(PUBLIC_HEALTH_URL, { method: "GET" })
    const data = JSON.parse(healthPostRes.body)
    if (data.database === "completely_isolated_no_connection" && data.gemini === "isolated_disabled") {
      passedCount++
      console.log(`  ✅ [PASS] 5. Confirmed zero MongoDB or Gemini side-effects post-request`)
    } else {
      throw new Error("Isolation state changed during tests")
    }
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] 5. Post-request isolation check failed: ${err.message}`)
  }

  console.log("\n=======================================================")
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("=======================================================\n")

  if (failedCount > 0) {
    process.exit(1)
  }
}

runPublicTwilioConnectivityTest().catch((err) => {
  console.error("FATAL ERROR IN PUBLIC TWILIO TEST:", err)
  process.exit(1)
})

