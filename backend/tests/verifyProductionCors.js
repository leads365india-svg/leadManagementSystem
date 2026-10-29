/**
 * Leads-365 Production CORS & Preflight Verification Suite
 *
 * Validates:
 * 1. Exact Access-Control-Allow-Origin returned for Vercel production & preview domains (never '*')
 * 2. Access-Control-Allow-Credentials: true
 * 3. Preflight OPTIONS requests for /api/auth/me and /api/auth/login
 * 4. Safe rejection of unauthorized, spoofed, and malicious origins (no Allow-Origin header)
 * 5. FRONTEND_URL parsing resilience (quotes, trailing slashes, missing protocols, spaces)
 * 6. CSRF verification integration and login endpoint exemption
 */

const http = require("http")
const express = require("express")
const cors = require("cors")
const cookieParser = require("cookie-parser")
const { parseAllowedOrigins, isOriginAllowed } = require("../utils/corsHelper")
const { verifyCSRF } = require("../middleware/authMiddleware")

const runTestSuite = async () => {
  console.log("==================================================================")
  console.log("  Leads-365: Production CORS & Preflight Verification Suite")
  console.log("==================================================================\n")

  let passed = 0
  let failed = 0

  const assert = (condition, desc, detail = "") => {
    if (condition) {
      console.log(`  [PASS] ${desc}`)
      passed++
    } else {
      console.error(`  [FAIL] ${desc} ${detail ? `(${detail})` : ""}`)
      failed++
    }
  }

  // Section 1: Helper Parsing & Matching Invariants
  console.log("--- Section 1: FRONTEND_URL Parsing & Wildcard Matching Invariants ---")
  const parsed = parseAllowedOrigins('https://*.vercel.app, "https://leads-365.vercel.app/", custom-tenant.vercel.app')
  assert(parsed.includes("https://*.vercel.app"), "Wildcard pattern parsed cleanly")
  assert(parsed.includes("https://leads-365.vercel.app"), "Surrounding quotes and trailing slashes stripped")
  assert(parsed.includes("https://custom-tenant.vercel.app"), "Missing protocol automatically prepended with https://")

  assert(isOriginAllowed("https://leads-365.vercel.app", parsed, false), "Exact production Vercel domain allowed")
  assert(isOriginAllowed("https://leads_365.vercel.app", parsed, false), "Underscores in Vercel subdomains allowed by wildcard")
  assert(isOriginAllowed("https://preview-123.git-branch.vercel.app", parsed, false), "Nested Vercel preview branch subdomains allowed")
  assert(isOriginAllowed("https://custom-tenant.vercel.app", parsed, false), "Custom domain without protocol in env allowed")
  assert(!isOriginAllowed("https://evil-vercel.app", parsed, false), "Spoofed prefix evil-vercel.app strictly rejected")
  assert(!isOriginAllowed("https://vercel.app.attacker.com", parsed, false), "Spoofed suffix vercel.app.attacker.com strictly rejected")
  assert(!isOriginAllowed("https://untrusted-site.com", parsed, false), "Arbitrary third-party domain rejected")
  assert(!isOriginAllowed("http://localhost:3000", parsed, false), "Localhost rejected in production mode when not listed")
  assert(isOriginAllowed("http://localhost:3000", parsed, true), "Localhost permitted in development mode")

  // Section 2: Real Express Server HTTP Request & Preflight Verification
  console.log("\n--- Section 2: Real HTTP Server Preflight & Header Verification ---")

  const app = express()
  const allowedOrigins = [
    ...new Set([
      ...parsed,
      "http://localhost:3000",
    ]),
  ]

  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (isOriginAllowed(origin, allowedOrigins, false)) {
        return callback(null, true)
      }
      callback(null, false)
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  }

  app.use(cors(corsOptions))
  app.options("/api/*", cors(corsOptions))
  app.options("*", cors(corsOptions))
  app.use(express.json())
  app.use(cookieParser())
  app.use(verifyCSRF(allowedOrigins))

  app.get("/api/auth/me", (req, res) => {
    res.json({ success: true, user: { role: "super_admin", email: "admin@leads365.io" } })
  })

  app.post("/api/auth/login", (req, res) => {
    res.json({ success: true, token: "mock-jwt-token" })
  })

  app.post("/api/leads", (req, res) => {
    res.json({ success: true, lead: { id: "lead-123", name: req.body.name } })
  })

  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    // Test 2.1: Preflight OPTIONS on /api/auth/me with Vercel Production Origin
    const preflightMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://leads-365.vercel.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    })

    assert(preflightMeRes.status === 204 || preflightMeRes.status === 200, "OPTIONS /api/auth/me returns HTTP 200/204")
    assert(
      preflightMeRes.headers.get("access-control-allow-origin") === "https://leads-365.vercel.app",
      "OPTIONS /api/auth/me returns exact requesting origin (not '*')"
    )
    assert(
      preflightMeRes.headers.get("access-control-allow-credentials") === "true",
      "OPTIONS /api/auth/me returns access-control-allow-credentials: true"
    )
    assert(
      preflightMeRes.headers.get("access-control-allow-methods")?.includes("GET"),
      "OPTIONS /api/auth/me returns allowed methods"
    )
    assert(
      preflightMeRes.headers.get("access-control-allow-headers")?.toLowerCase().includes("authorization"),
      "OPTIONS /api/auth/me allows Authorization header"
    )

    // Test 2.2: Preflight OPTIONS on /api/auth/login with Vercel Preview Branch Origin
    const preflightLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://preview-123.git-branch.vercel.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    })

    assert(
      preflightLoginRes.headers.get("access-control-allow-origin") === "https://preview-123.git-branch.vercel.app",
      "OPTIONS /api/auth/login returns exact preview branch origin"
    )
    assert(
      preflightLoginRes.headers.get("access-control-allow-credentials") === "true",
      "OPTIONS /api/auth/login returns access-control-allow-credentials: true"
    )

    // Test 2.3: Actual GET /api/auth/me request
    const getMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      method: "GET",
      headers: {
        Origin: "https://leads-365.vercel.app",
        Authorization: "Bearer mock-token",
      },
    })

    assert(getMeRes.status === 200, "GET /api/auth/me returns HTTP 200")
    assert(
      getMeRes.headers.get("access-control-allow-origin") === "https://leads-365.vercel.app",
      "GET /api/auth/me returns exact requesting origin in response header"
    )
    assert(
      getMeRes.headers.get("access-control-allow-credentials") === "true",
      "GET /api/auth/me returns access-control-allow-credentials: true"
    )

    // Test 2.4: Actual POST /api/auth/login request
    const postLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        Origin: "https://leads-365.vercel.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "admin@leads365.io", password: "Password123!" }),
    })

    assert(postLoginRes.status === 200, "POST /api/auth/login returns HTTP 200")
    assert(
      postLoginRes.headers.get("access-control-allow-origin") === "https://leads-365.vercel.app",
      "POST /api/auth/login returns exact requesting origin in response header"
    )

    // Test 2.5: Rejected malicious origin receives NO Access-Control-Allow-Origin header
    const preflightEvilRes = await fetch(`${baseUrl}/api/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "GET",
      },
    })

    assert(
      preflightEvilRes.headers.get("access-control-allow-origin") === null,
      "OPTIONS from evil.com returns NO access-control-allow-origin header"
    )

    const getEvilRes = await fetch(`${baseUrl}/api/auth/me`, {
      method: "GET",
      headers: {
        Origin: "https://evil.com",
      },
    })

    assert(
      getEvilRes.headers.get("access-control-allow-origin") === null,
      "GET from evil.com returns NO access-control-allow-origin header"
    )

    // Test 2.6: CSRF Protection verifies origin for mutating requests with session cookies
    const cookieCsrfPassRes = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        Origin: "https://leads-365.vercel.app",
        "Content-Type": "application/json",
        Cookie: "client_token=valid-session",
      },
      body: JSON.stringify({ name: "ACME Corp" }),
    })
    assert(cookieCsrfPassRes.status === 200, "Cookie request with valid origin passes CSRF verification")

    const cookieCsrfBlockRes = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        Origin: "https://evil.com",
        "Content-Type": "application/json",
        Cookie: "client_token=valid-session",
      },
      body: JSON.stringify({ name: "ACME Corp" }),
    })
    assert(cookieCsrfBlockRes.status === 403, "Cookie request with unallowed origin is rejected with HTTP 403 by CSRF")

  } finally {
    server.close()
  }

  console.log("\n==================================================================")
  console.log(`  SUMMARY: ${passed} Passed, ${failed} Failed`)
  console.log("==================================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

runTestSuite().catch((err) => {
  console.error("Test Suite crashed:", err)
  process.exit(1)
})
