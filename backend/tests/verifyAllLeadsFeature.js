/**
 * LeadFlow CRM — Feature 1: Complete All Leads Management Verification Suite
 * 
 * Executes end-to-end local tests against MongoDB Atlas and running Express API:
 * 1. Add lead and confirm it appears in All Leads.
 * 2. Refresh simulation: confirm lead remains visible with all persisted schema fields.
 * 3. Search for existing lead by name, email, and company.
 * 4. Filter by supported statuses ("New", "Engaged", etc.) and verify stats aggregation.
 * 5. Pagination test with page navigation, limit controls, and total counts.
 * 6. Empty state, not-found state, and input error states.
 * 7. Multi-tenant isolation and unauthorized access protections.
 * 8. Dashboard metrics integration and lead update/delete life cycle.
 */

const assert = require("assert")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const API_BASE = "http://localhost:5000/api"

let passed = 0
let failed = 0

function logPass(msg) {
  console.log(`  ✅ PASS: ${msg}`)
  passed++
}

function logFail(msg, err) {
  console.error(`  ❌ FAIL: ${msg} -> ${err.message || err}`)
  failed++
}

async function run() {
  console.log("=======================================================")
  console.log("   FEATURE 1: ALL LEADS MANAGEMENT VERIFICATION SUITE  ")
  console.log("=======================================================\n")

  // --------------------------------------------------------------------------
  // STEP 0: Authenticate as Account Admin (Sara Khan)
  // --------------------------------------------------------------------------
  console.log("🔑 Step 0: Authenticating as Account Admin (sara@test.com)...")
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sara@test.com",
      password: "Password123!",
    }),
  })
  const loginData = await loginRes.json()
  assert.strictEqual(loginRes.status, 200, "Login must return 200 OK")
  assert.strictEqual(loginData.success, true, "Login must succeed")
  const adminCookie = loginRes.headers.get("set-cookie")?.split(";")[0] || ""
  const tenantId = loginData.data?.user?.tenantId
  assert(adminCookie, "Session cookie must be acquired")
  assert(tenantId, "TenantId must be present on user session")
  console.log(`   Logged in as: ${loginData.data.user.name} | Tenant: ${tenantId}\n`)

  const testTag = Date.now().toString().slice(-6)
  let createdLeadId = null

  // --------------------------------------------------------------------------
  // TEST 1: Add a lead and confirm it appears in All Leads
  // --------------------------------------------------------------------------
  console.log("📋 Test 1: Add Lead and Confirm Appearance in All Leads")
  try {
    const leadPayload = {
      name: `LeadFlow Test Lead ${testTag}`,
      email: `prospect_${testTag}@example.com`,
      phone: "+1 555-0199",
      company: `Vance Health Corp ${testTag}`,
      status: "New",
      source: "Manual Entry",
      assignedTo: "Sarah Jenkins",
      message: "Inquiring about multi-tenant CRM enterprise features.",
    }

    const createRes = await fetch(`${API_BASE}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify(leadPayload),
    })

    const createData = await createRes.json()
    assert.strictEqual(createRes.status, 201, "Create lead must return 201 Created")
    assert.strictEqual(createData.success, true, "Create lead response success must be true")
    assert(createData.data?._id || createData.data?.id, "Created lead must return ID")
    createdLeadId = createData.data?._id || createData.data?.id

    // Confirm it appears in GET /api/leads
    const listRes = await fetch(`${API_BASE}/leads`, {
      headers: { Cookie: adminCookie },
    })
    const listData = await listRes.json()
    assert.strictEqual(listRes.status, 200, "GET /leads must return 200 OK")
    const found = listData.data?.leads?.find((l) => l._id === createdLeadId)
    assert(found, "Newly added lead must appear in All Leads list")
    assert.strictEqual(found.name, leadPayload.name, "Name must match")
    assert.strictEqual(found.email, leadPayload.email.toLowerCase(), "Email must match")
    assert.strictEqual(found.phone, leadPayload.phone, "Phone must match")
    assert.strictEqual(found.company, leadPayload.company, "Company must match")
    assert.strictEqual(found.status, "New", "Status must be New")
    logPass("Lead created successfully and immediately visible in All Leads")
  } catch (err) {
    logFail("Add lead and confirm in All Leads", err)
  }

  // --------------------------------------------------------------------------
  // TEST 2: Refresh simulation: confirm lead remains visible with all persisted data
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 2: Page Refresh / Independent Query Persistence")
  try {
    const refreshRes = await fetch(`${API_BASE}/leads?page=1&limit=10&sortBy=createdAt&sortOrder=desc`, {
      headers: { Cookie: adminCookie },
    })
    const refreshData = await refreshRes.json()
    assert.strictEqual(refreshRes.status, 200, "Refreshed query returns 200")
    const refreshedLead = refreshData.data?.leads?.find((l) => l._id === createdLeadId)
    assert(refreshedLead, "Lead remains visible after refresh/new request")
    assert.strictEqual(refreshedLead.name, `LeadFlow Test Lead ${testTag}`)
    assert.strictEqual(refreshedLead.company, `Vance Health Corp ${testTag}`)
    assert(refreshedLead.createdAt, "Lead has persistent createdAt timestamp")
    logPass("Persisted lead confirmed on reload with all schema attributes")
  } catch (err) {
    logFail("Refresh persistence check", err)
  }

  // --------------------------------------------------------------------------
  // TEST 3: Search for existing lead by name, email, and company
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 3: Search Functionality Across Supported Fields")
  try {
    // 3a. Search by Name
    const nameSearchRes = await fetch(`${API_BASE}/leads?search=Test%20Lead%20${testTag}`, {
      headers: { Cookie: adminCookie },
    })
    const nameSearchData = await nameSearchRes.json()
    assert(nameSearchData.data?.leads?.some((l) => l._id === createdLeadId), "Search by name finds lead")
    logPass("Search by lead name successfully finds record")

    // 3b. Search by Email
    const emailSearchRes = await fetch(`${API_BASE}/leads?search=prospect_${testTag}`, {
      headers: { Cookie: adminCookie },
    })
    const emailSearchData = await emailSearchRes.json()
    assert(emailSearchData.data?.leads?.some((l) => l._id === createdLeadId), "Search by email finds lead")
    logPass("Search by lead email successfully finds record")

    // 3c. Search by Company
    const compSearchRes = await fetch(`${API_BASE}/leads?search=Vance%20Health%20Corp%20${testTag}`, {
      headers: { Cookie: adminCookie },
    })
    const compSearchData = await compSearchRes.json()
    assert(compSearchData.data?.leads?.some((l) => l._id === createdLeadId), "Search by company finds lead")
    logPass("Search by lead company successfully finds record")
  } catch (err) {
    logFail("Search functionality test", err)
  }

  // --------------------------------------------------------------------------
  // TEST 4: Filter by supported statuses and update lifecycle
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 4: Status Filtering & Live Status Transition")
  try {
    // 4a. Filter by "New" -> must include lead
    const newFilterRes = await fetch(`${API_BASE}/leads?status=New`, {
      headers: { Cookie: adminCookie },
    })
    const newFilterData = await newFilterRes.json()
    assert(newFilterData.data?.leads?.some((l) => l._id === createdLeadId), "Filter status=New includes lead")
    logPass("Filter by status='New' returns matching record")

    // 4b. Filter by "Engaged" -> must NOT include lead currently
    const engagedFilterRes = await fetch(`${API_BASE}/leads?status=Engaged`, {
      headers: { Cookie: adminCookie },
    })
    const engagedFilterData = await engagedFilterRes.json()
    assert(!engagedFilterData.data?.leads?.some((l) => l._id === createdLeadId), "Filter status=Engaged excludes New lead")
    logPass("Filter by status='Engaged' correctly excludes New lead")

    // 4c. Update lead to "Engaged" via PUT /api/leads/:id
    const updateRes = await fetch(`${API_BASE}/leads/${createdLeadId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        status: "Engaged",
        assignedTo: "Senior Agent Vance",
        message: "Discovery call completed. Proposal pending.",
      }),
    })
    const updateData = await updateRes.json()
    assert.strictEqual(updateRes.status, 200, "Update lead returns 200 OK")
    assert.strictEqual(updateData.data?.status, "Engaged", "Lead status updated to Engaged")
    logPass("Lead status updated to 'Engaged' via PUT /api/leads/:id")

    // 4d. Re-filter by "Engaged" -> must now include lead
    const reEngagedRes = await fetch(`${API_BASE}/leads?status=Engaged`, {
      headers: { Cookie: adminCookie },
    })
    const reEngagedData = await reEngagedRes.json()
    assert(reEngagedData.data?.leads?.some((l) => l._id === createdLeadId), "Filter status=Engaged now includes updated lead")
    logPass("Filter by status='Engaged' now matches lead after update")

    // 4e. Verify lead stats counts
    const statsRes = await fetch(`${API_BASE}/leads/stats`, {
      headers: { Cookie: adminCookie },
    })
    const statsData = await statsRes.json()
    assert.strictEqual(statsRes.status, 200, "GET /leads/stats returns 200")
    assert(statsData.data?.statusCounts?.Engaged >= 1, "Status count for Engaged reflects at least 1")
    logPass("Aggregated status counts in GET /leads/stats accurately update")
  } catch (err) {
    logFail("Status filtering and update lifecycle test", err)
  }

  // --------------------------------------------------------------------------
  // TEST 5: Pagination with accurate total counts and page limits
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 5: Pagination Navigation, Limit Control, and Total Counts")
  const createdExtraIds = []
  try {
    // Add 2 extra leads to ensure at least 3 records for pagination testing
    for (let i = 1; i <= 2; i++) {
      const extraRes = await fetch(`${API_BASE}/leads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          name: `Pagination Test Lead ${testTag} - ${i}`,
          email: `pag_${testTag}_${i}@example.com`,
          status: "New",
        }),
      })
      const extraData = await extraRes.json()
      if (extraData.data?._id || extraData.data?.id) {
        createdExtraIds.push(extraData.data?._id || extraData.data?.id)
      }
    }

    // Page 1 with limit=2
    const p1Res = await fetch(`${API_BASE}/leads?page=1&limit=2`, {
      headers: { Cookie: adminCookie },
    })
    const p1Data = await p1Res.json()
    assert.strictEqual(p1Data.data?.page, 1, "Page number is 1")
    assert.strictEqual(p1Data.data?.limit, 2, "Limit is 2")
    assert.strictEqual(p1Data.data?.leads?.length, 2, "Page 1 contains exactly 2 leads")
    assert(p1Data.data?.total >= 3, "Total count is at least 3")
    assert(p1Data.data?.totalPages >= 2, "Total pages is at least 2")
    logPass("Pagination Page 1 returns exact limit (2 records) and metadata")

    // Page 2 with limit=2
    const p2Res = await fetch(`${API_BASE}/leads?page=2&limit=2`, {
      headers: { Cookie: adminCookie },
    })
    const p2Data = await p2Res.json()
    assert.strictEqual(p2Data.data?.page, 2, "Page number is 2")
    assert(p2Data.data?.leads?.length >= 1, "Page 2 contains remaining leads")
    logPass("Pagination Page 2 returns next page of records")

    // Clean up extra leads
    for (const extraId of createdExtraIds) {
      await fetch(`${API_BASE}/leads/${extraId}`, {
        method: "DELETE",
        headers: { Cookie: adminCookie },
      })
    }
  } catch (err) {
    logFail("Pagination test", err)
  }

  // --------------------------------------------------------------------------
  // TEST 6: Loading, Empty, and Error States
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 6: Empty States and API Error Validations")
  try {
    // 6a. Empty search state
    const emptySearchRes = await fetch(`${API_BASE}/leads?search=nonexistent_query_xyz_999999`, {
      headers: { Cookie: adminCookie },
    })
    const emptySearchData = await emptySearchRes.json()
    assert.strictEqual(emptySearchRes.status, 200, "Empty search returns 200")
    assert.strictEqual(emptySearchData.data?.leads?.length, 0, "Empty search returns 0 leads")
    assert.strictEqual(emptySearchData.data?.total, 0, "Empty search total is 0")
    logPass("Empty filter state handled gracefully (0 results, no crashes)")

    // 6b. Invalid ObjectId format on GET /api/leads/:id
    const invalidIdRes = await fetch(`${API_BASE}/leads/invalid-lead-id`, {
      headers: { Cookie: adminCookie },
    })
    const invalidIdData = await invalidIdRes.json()
    assert.strictEqual(invalidIdRes.status, 400, "Invalid ID returns 400 Bad Request")
    assert.strictEqual(invalidIdData.success, false, "Response success is false")
    assert(invalidIdData.error?.includes("Invalid lead ID format"), "Readable error message returned")
    logPass("Readable error returned for malformed lead ID")

    // 6c. Nonexistent lead ID on GET /api/leads/:id
    const notFoundRes = await fetch(`${API_BASE}/leads/507f1f77bcf86cd799439011`, {
      headers: { Cookie: adminCookie },
    })
    const notFoundData = await notFoundRes.json()
    assert.strictEqual(notFoundRes.status, 404, "Nonexistent ID returns 404 Not Found")
    assert.strictEqual(notFoundData.success, false, "Response success is false")
    logPass("Nonexistent lead returns 404 Not Found")

    // 6d. Create lead with missing name
    const missingNameRes = await fetch(`${API_BASE}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        email: "noname@example.com",
      }),
    })
    assert.strictEqual(missingNameRes.status, 400, "Missing name rejected with 400")
    logPass("Input validation correctly rejects incomplete lead creation")
  } catch (err) {
    logFail("Empty and error states test", err)
  }

  // --------------------------------------------------------------------------
  // TEST 7: Tenant Isolation & Unauthorized Access Protections
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 7: Multi-Tenant Isolation & Security Protections")
  try {
    // 7a. Anonymous access to GET /api/leads
    const anonGetRes = await fetch(`${API_BASE}/leads`)
    assert.strictEqual(anonGetRes.status, 401, "Anonymous GET /leads rejected with 401")
    logPass("Anonymous access to GET /api/leads is blocked (401)")

    // 7b. Anonymous access to POST /api/leads
    const anonPostRes = await fetch(`${API_BASE}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hacker", email: "hacker@test.com" }),
    })
    assert.strictEqual(anonPostRes.status, 401, "Anonymous POST /leads rejected with 401")
    logPass("Anonymous lead creation is blocked (401)")

    // 7c. Parameter tampering: Account Admin passing ?tenantId=other-tenant
    const tamperRes = await fetch(`${API_BASE}/leads?tenantId=ACC-OTHER-TENANT`, {
      headers: { Cookie: adminCookie },
    })
    assert.strictEqual(tamperRes.status, 403, "Tampering with query tenantId rejected with 403")
    logPass("Cross-tenant query parameter tampering strictly blocked (403 Forbidden)")

    // 7d. Parameter tampering: Account Admin passing body tenantId on create
    const tamperBodyRes = await fetch(`${API_BASE}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Tamper Attempt",
        email: `tamper_${testTag}@test.com`,
        tenantId: "ACC-OTHER-TENANT",
      }),
    })
    assert.strictEqual(tamperBodyRes.status, 403, "Tampering with body tenantId rejected with 403")
    logPass("Cross-tenant body parameter tampering strictly blocked (403 Forbidden)")
  } catch (err) {
    logFail("Tenant isolation and security test", err)
  }

  // --------------------------------------------------------------------------
  // TEST 8: Dashboard Integration, Single View, and Safe Deletion Lifecycle
  // --------------------------------------------------------------------------
  console.log("\n📋 Test 8: Single Lead View, Row Actions, and Deletion Lifecycle")
  try {
    // 8a. Single Lead View GET /api/leads/:id
    const singleRes = await fetch(`${API_BASE}/leads/${createdLeadId}`, {
      headers: { Cookie: adminCookie },
    })
    const singleData = await singleRes.json()
    assert.strictEqual(singleRes.status, 200, "Single lead GET returns 200")
    assert.strictEqual(singleData.data?._id || singleData.data?.id, createdLeadId, "Single lead ID matches")
    assert.strictEqual(singleData.data?.name, `LeadFlow Test Lead ${testTag}`, "Name matches")
    logPass("Single lead details modal API retrieval verified")

    // 8b. Dashboard Recent Leads Sorting Integration
    const dashRes = await fetch(`${API_BASE}/leads?limit=5&sortBy=createdAt&sortOrder=desc`, {
      headers: { Cookie: adminCookie },
    })
    const dashData = await dashRes.json()
    assert.strictEqual(dashRes.status, 200, "Dashboard recent leads query returns 200")
    assert(dashData.data?.leads?.length > 0, "Dashboard leads query returns records")
    logPass("Dashboard recent leads API sorting integration verified")

    // 8c. Delete Lead permission enforcement & execution
    // Account Admin by default does not have 'leads.delete' permission, so attempting delete returns 403
    const delAttemptRes = await fetch(`${API_BASE}/leads/${createdLeadId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie },
    })
    const delAttemptData = await delAttemptRes.json()
    assert.strictEqual(delAttemptRes.status, 403, "DELETE without leads.delete permission is blocked with 403")
    assert.strictEqual(delAttemptData.success, false, "Delete response success is false")
    assert(delAttemptData.error?.includes("leads.delete"), "Readable permission error returned")
    logPass("Business rule enforced: Deletion blocked when 'leads.delete' permission is not granted (403)")

    // Authorized deletion test: Using Super Admin session (bypasses role restrictions)
    const superLoginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "superadmin@leadflow.io",
        password: "SuperAdmin@2026!",
      }),
    })
    const superLoginCookie = superLoginRes.headers.get("set-cookie")?.split(";")[0] || ""

    const superDelRes = await fetch(`${API_BASE}/leads/${createdLeadId}`, {
      method: "DELETE",
      headers: { Cookie: superLoginCookie },
    })
    const superDelData = await superDelRes.json()
    assert.strictEqual(superDelRes.status, 200, "DELETE with authorized admin returns 200 OK")
    assert.strictEqual(superDelData.success, true, "DELETE success is true")
    logPass("Authorized deletion successfully removes lead record from MongoDB Atlas")

    // 8d. Confirm lead is gone
    const verifyDelRes = await fetch(`${API_BASE}/leads/${createdLeadId}`, {
      headers: { Cookie: superLoginCookie },
    })
    assert.strictEqual(verifyDelRes.status, 404, "Deleted lead GET returns 404 Not Found")
    logPass("Deleted lead confirmed removed from MongoDB Atlas")
  } catch (err) {
    logFail("Dashboard integration and deletion lifecycle test", err)
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n=======================================================")
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("=======================================================")

  if (failed > 0) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error("FATAL TEST RUNNER ERROR:", err)
  process.exit(1)
})
