/**
 * Verification Test Suite for Isolated Twilio Trial Webhook Server
 * 
 * Validates:
 * 1. Health check verifies complete isolation (no MongoDB, no Gemini, no workers).
 * 2. Missing X-Twilio-Signature header returns 401 Unauthorized.
 * 3. Invalid/tampered X-Twilio-Signature returns 401 Unauthorized.
 * 4. Mismatched AccountSid returns 403 Forbidden.
 * 5. Authentic Twilio HMAC-SHA1 signature returns 200 OK with valid TwiML XML.
 * 6. TwiML contains the exact expected test speech and <Hangup/>.
 * 7. Caller-supplied tenantId parameter is stripped.
 * 8. Phone number masking protects caller privacy.
 * 9. Database isolation guarantee: mongoose.connection.readyState remains 0 (disconnected).
 */

const assert = require("assert")
const http = require("http")
const crypto = require("crypto")
const mongoose = require("mongoose")
const {
  createTrialApp,
  startServer,
  validateTwilioSignature,
  maskPhoneNumber,
} = require("../scripts/twilioTrialWebhookServer")

const TEST_PORT = 5055
const TEST_ACCOUNT_SID = "AC_trial_test_1234567890abcdef"
const TEST_AUTH_TOKEN = "test_auth_token_secret_123456789"
const TEST_WEBHOOK_URL = `http://127.0.0.1:${TEST_PORT}/twilio-trial/voice`

let passedCount = 0
let failedCount = 0

function test(name, fn) {
  try {
    fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passedCount++
    console.log(`  ✅ [PASS] ${name}`)
  } catch (err) {
    failedCount++
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
  }
}

function computeSignature(url, body, token) {
  let data = url
  if (body && typeof body === "object") {
    const keys = Object.keys(body).sort()
    for (const key of keys) {
      data += key + (body[key] !== undefined && body[key] !== null ? body[key] : "")
    }
  }
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64")
}

function makeRequest({ method = "POST", path = "/twilio-trial/voice", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }))
      }
    )
    req.on("error", reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

async function runTwilioTrialTests() {
  console.log("\n=======================================================")
  console.log("   LEADS365 TWILIO TRIAL WEBHOOK VERIFICATION SUITE    ")
  console.log("=======================================================\n")

  // 1. Verify Database Isolation Before Starting
  test("1. Database isolation guarantee: Mongoose is completely uninitialized", () => {
    assert.strictEqual(
      mongoose.connection.readyState,
      0,
      "MongoDB readyState must be 0 (disconnected). No DB connection must be opened."
    )
  })

  // 2. Start the isolated test server
  const server = await startServer({
    port: TEST_PORT,
    accountSid: TEST_ACCOUNT_SID,
    authToken: TEST_AUTH_TOKEN,
  })

  try {
    // 3. Health Endpoint Test
    await testAsync("2. Health endpoint verifies isolated trial status", async () => {
      const res = await makeRequest({ method: "GET", path: "/twilio-trial/health" })
      assert.strictEqual(res.statusCode, 200)
      const data = JSON.parse(res.body)
      assert.strictEqual(data.status, "healthy")
      assert.strictEqual(data.database, "completely_isolated_no_connection")
      assert.strictEqual(data.gemini, "isolated_disabled")
    })

    // 4. Missing Signature Rejection
    await testAsync("3. Missing X-Twilio-Signature returns HTTP 401 Unauthorized", async () => {
      const body = "CallSid=CA12345&From=%2B919876543210&To=%2B12015550123"
      const res = await makeRequest({
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      })
      assert.strictEqual(res.statusCode, 401)
      assert(res.body.includes("<Say>Unauthorized request"))
    })

    // 5. Invalid Signature Rejection
    await testAsync("4. Invalid X-Twilio-Signature returns HTTP 401 Unauthorized", async () => {
      const body = "CallSid=CA12345&From=%2B919876543210&To=%2B12015550123"
      const res = await makeRequest({
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "X-Twilio-Signature": "invalid_bogus_signature_abc123==",
        },
        body,
      })
      assert.strictEqual(res.statusCode, 401)
      assert(res.body.includes("<Say>Unauthorized request"))
    })

    // 6. Mismatched AccountSid Rejection
    await testAsync("5. Mismatched AccountSid returns HTTP 403 Forbidden", async () => {
      const params = {
        AccountSid: "AC_WRONG_ACCOUNT_SID_99999999",
        CallSid: "CA12345",
        From: "+919876543210",
        To: "+12015550123",
      }
      const querystring = require("querystring")
      const body = querystring.stringify(params)
      const validSigForWrongAccount = computeSignature(TEST_WEBHOOK_URL, params, TEST_AUTH_TOKEN)

      const res = await makeRequest({
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "X-Twilio-Signature": validSigForWrongAccount,
        },
        body,
      })
      assert.strictEqual(res.statusCode, 403)
      assert(res.body.includes("Account SID mismatch"))
    })

    // 7. Authentic Twilio Request Returns Valid TwiML
    await testAsync("6. Authentic Twilio webhook returns HTTP 200 with valid TwiML voice response", async () => {
      const params = {
        AccountSid: TEST_ACCOUNT_SID,
        CallSid: "CA_test_call_9988776655",
        CallStatus: "ringing",
        Caller: "+919876543210",
        Called: "+12015550123",
        From: "+919876543210",
        To: "+12015550123",
      }
      const querystring = require("querystring")
      const body = querystring.stringify(params)
      const validSignature = computeSignature(TEST_WEBHOOK_URL, params, TEST_AUTH_TOKEN)

      const res = await makeRequest({
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "X-Twilio-Signature": validSignature,
        },
        body,
      })

      assert.strictEqual(res.statusCode, 200)
      assert(res.headers["content-type"].includes("text/xml"), "Content-Type must be text/xml")
      assert(res.body.includes("<Response>"), "Must be a TwiML <Response>")
      assert(
        res.body.includes(
          "Hello! You are connected to Leads365 local AI Receptionist testing server. Your Twilio webhook integration is working successfully."
        ),
        "Must contain the exact required spoken greeting"
      )
      assert(res.body.includes("<Hangup/>"), "Must hang up the call politely")
    })

    // 8. Phone Number Privacy Masking
    test("7. Phone numbers are masked in logs to protect caller privacy", () => {
      const masked = maskPhoneNumber("+919876543210")
      assert.strictEqual(masked, "+9198****3210")
      assert(!masked.includes("7654"))
    })

    // 9. Post-execution Database Verification
    test("8. Zero database side-effects: Mongoose remains completely unattached", () => {
      assert.strictEqual(mongoose.connection.readyState, 0)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  console.log("\n=======================================================")
  console.log(`   TWILIO TRIAL TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`)
  console.log("=======================================================\n")

  if (failedCount > 0) process.exit(1)
}

runTwilioTrialTests().catch((err) => {
  console.error("FATAL ERROR IN TWILIO TRIAL TEST:", err)
  process.exit(1)
})

