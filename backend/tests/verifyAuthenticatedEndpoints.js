const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

async function testAuthEndpoints() {
  console.log("=== VERIFYING AUTHENTICATED LEAD FEEDS API ENDPOINTS ===")

  // 1. Log in as sara@test.com
  const loginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sara@test.com",
      password: "Password123!",
    }),
  })

  const loginData = await loginRes.json()
  console.log("Login status:", loginRes.status, "User role:", loginData.data?.user?.role, "Tenant:", loginData.data?.user?.tenantId)
  if (loginRes.status !== 200) {
    throw new Error("Failed to log in as sara@test.com")
  }

  // Extract auth cookie
  const cookieHeader = loginRes.headers.get("set-cookie")
  const clientTokenCookie = cookieHeader ? cookieHeader.split(";")[0] : ""
  console.log("Acquired session cookie successfully")

  // 2. GET /api/integrations/settings/website
  const getRes = await fetch("http://localhost:5000/api/integrations/settings/website", {
    method: "GET",
    headers: {
      Cookie: clientTokenCookie,
    },
  })
  const getData = await getRes.json()
  console.log("GET /settings/website status:", getRes.status)
  if (getRes.status !== 200 || !getData.success) {
    throw new Error("GET settings failed")
  }
  console.log("Config retrieved: tenantId =", getData.data.config.tenantId, "MaskedKey =", getData.data.config.websiteSource.apiKeyMasked)
  console.log("Staff list count:", getData.data.staff.length)

  // 3. PUT /api/integrations/settings/website
  const updateRes = await fetch("http://localhost:5000/api/integrations/settings/website", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: clientTokenCookie,
    },
    body: JSON.stringify({
      enabled: true,
      assignedStaffId: "unassigned",
      acceptedForms: ["contact_us_form", "quote_request_form"],
      blockedDomains: ["bademail.com", "throwaway.org"],
      duplicateHandling: "reject",
      emailVerification: {
        requireVerifiedEmail: false,
        holdUntilConfirmed: false,
        strictVerification: false,
        allowPhoneOnly: true,
      },
    }),
  })
  const updateData = await updateRes.json()
  console.log("PUT /settings/website status:", updateRes.status, updateData.message)
  if (updateRes.status !== 200 || !updateData.success) {
    throw new Error("PUT settings failed")
  }

  // 4. POST /api/integrations/settings/website/test
  const testRes = await fetch("http://localhost:5000/api/integrations/settings/website/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: clientTokenCookie,
    },
  })
  const testData = await testRes.json()
  console.log("POST /settings/website/test status:", testRes.status, testData.message)
  if (testRes.status !== 200 || !testData.success) {
    throw new Error("POST test failed")
  }

  // 5. POST /api/integrations/settings/website/rotate-key
  const rotateRes = await fetch("http://localhost:5000/api/integrations/settings/website/rotate-key", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: clientTokenCookie,
    },
  })
  const rotateData = await rotateRes.json()
  console.log("POST /settings/website/rotate-key status:", rotateRes.status, rotateData.message)
  console.log("New raw rotated key received:", rotateData.data.rawApiKey?.slice(0, 15) + "...")
  if (rotateRes.status !== 200 || !rotateData.success) {
    throw new Error("POST rotate-key failed")
  }

  console.log("\n✅ ALL AUTHENTICATED CRM SETTINGS ENDPOINTS WORKING PERFECTLY!")
  process.exit(0)
}

testAuthEndpoints().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
