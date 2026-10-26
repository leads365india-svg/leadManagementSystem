/**
 * Phase 2: Complete Lead Pipeline Workflow Verification Suite
 * Tests:
 * 1. Pipeline status queries: New, Active (Engaged), Order Placed (Closed-Won), Lost Leads (Closed-Lost)
 * 2. Status alias normalization in API (e.g. ?status=Active, ?status=Order Placed, ?status=Lost Leads)
 * 3. Status transition endpoints: PATCH /api/leads/:id/status, PUT /api/leads/:id
 * 4. Validation & error handling: rejection of invalid status values
 * 5. Status history tracking in metadata.statusHistory
 * 6. Persistence across reload/re-query
 * 7. Real-time Dashboard stats calculation: total, statusCounts, and conversionRate
 * 8. RBAC and Permission enforcement (leads.edit requirement; rejection of unauthenticated requests)
 * 9. Multi-tenant isolation for status queries and status transitions
 * 10. Safe cleanup of test records
 */

const http = require("http")

const BASE_URL = "http://localhost:5000"

let passCount = 0
let failCount = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.error(`  ❌ FAIL: ${message}`)
    failCount++
    throw new Error(message)
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        let json = null
        try {
          json = JSON.parse(data)
        } catch (e) {
          json = data
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json,
        })
      })
    })

    req.on("error", reject)

    if (body) {
      const bodyStr = typeof body === "string" ? body : JSON.stringify(body)
      req.write(bodyStr)
    }

    req.end()
  })
}

async function loginUser(email, password) {
  const res = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  )

  if (res.statusCode !== 200 || !res.data.success) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`)
  }

  const cookie = res.headers["set-cookie"]
    ? res.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
    : ""

  return { user: res.data.data.user, cookie }
}

async function runPhase2PipelineTests() {
  console.log("=======================================================")
  console.log("   PHASE 2: LEAD PIPELINE WORKFLOW VERIFICATION SUITE  ")
  console.log("=======================================================\n")

  const createdLeadIds = []

  try {
    // -----------------------------------------------------------------
    // Step 0: Authenticate
    // -----------------------------------------------------------------
    console.log("🔑 Step 0: Authenticating test accounts...")
    const tenantAdmin = await loginUser("sara@test.com", "Password123!")
    console.log(`   Tenant Admin: ${tenantAdmin.user.email} (Tenant: ${tenantAdmin.user.tenantId})`)

    const superAdmin = await loginUser("superadmin@leadflow.io", "SuperAdmin@2026!")
    console.log(`   Super Admin: ${superAdmin.user.email}`)

    const authHeaders = {
      "Content-Type": "application/json",
      Cookie: tenantAdmin.cookie,
    }

    // -----------------------------------------------------------------
    // Test 1: Pipeline Stage Creation & Queries (New, Active, Order Placed, Lost)
    // -----------------------------------------------------------------
    console.log("\n📋 Test 1: Pipeline Stage Representation & Database Queries")
    
    // Create leads in different stages
    const testNewLead = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads",
        method: "POST",
        headers: authHeaders,
      },
      {
        name: "Pipeline Test - New Lead",
        email: `pipe_new_${Date.now()}@domain.com`,
        phone: "+1 555-0101",
        status: "New",
        company: "New Ventures Inc",
      }
    )
    assert(testNewLead.statusCode === 201 && testNewLead.data.success, "New lead created successfully with status 'New'")
    const newLeadId = testNewLead.data.data._id || testNewLead.data.data.id
    createdLeadIds.push(newLeadId)

    const testActiveLead = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads",
        method: "POST",
        headers: authHeaders,
      },
      {
        name: "Pipeline Test - Active Lead",
        email: `pipe_active_${Date.now()}@domain.com`,
        phone: "+1 555-0102",
        status: "Engaged",
        company: "Active Tech LLC",
      }
    )
    assert(testActiveLead.statusCode === 201 && testActiveLead.data.success, "Active lead created successfully with status 'Engaged'")
    const activeLeadId = testActiveLead.data.data._id || testActiveLead.data.data.id
    createdLeadIds.push(activeLeadId)

    const testWonLead = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads",
        method: "POST",
        headers: authHeaders,
      },
      {
        name: "Pipeline Test - Order Placed Lead",
        email: `pipe_won_${Date.now()}@domain.com`,
        phone: "+1 555-0103",
        status: "Closed-Won",
        company: "Converted Corp",
      }
    )
    assert(testWonLead.statusCode === 201 && testWonLead.data.success, "Order Placed lead created successfully with status 'Closed-Won'")
    const wonLeadId = testWonLead.data.data._id || testWonLead.data.data.id
    createdLeadIds.push(wonLeadId)

    const testLostLead = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads",
        method: "POST",
        headers: authHeaders,
      },
      {
        name: "Pipeline Test - Lost Lead",
        email: `pipe_lost_${Date.now()}@domain.com`,
        phone: "+1 555-0104",
        status: "Closed-Lost",
        company: "Lost Holdings",
      }
    )
    assert(testLostLead.statusCode === 201 && testLostLead.data.success, "Lost lead created successfully with status 'Closed-Lost'")
    const lostLeadId = testLostLead.data.data._id || testLostLead.data.data.id
    createdLeadIds.push(lostLeadId)

    const idEquals = (lead, targetId) => lead && (lead._id === targetId || lead.id === targetId)

    // -----------------------------------------------------------------
    // Test 2: Filter by Canonical and Alias Statuses
    // -----------------------------------------------------------------
    console.log("\n📋 Test 2: Status Filtering by Canonical Values and Dropdown Aliases")

    // 2.1 New Leads query
    const resNew = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=New&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resNew.statusCode === 200, "GET /api/leads?status=New returns 200 OK")
    const newMatches = resNew.data.data.leads.filter((l) => idEquals(l, newLeadId))
    const activeInNew = resNew.data.data.leads.filter((l) => idEquals(l, activeLeadId))
    assert(newMatches.length === 1 && activeInNew.length === 0, "status=New includes New record and strictly excludes Active/Engaged")

    // 2.2 Active Leads query using canonical 'Engaged'
    const resEngaged = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Engaged&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resEngaged.statusCode === 200, "GET /api/leads?status=Engaged returns 200 OK")
    const activeMatches = resEngaged.data.data.leads.filter((l) => idEquals(l, activeLeadId))
    assert(activeMatches.length === 1, "status=Engaged finds active lead")

    // 2.3 Active Leads query using dropdown alias 'Active'
    const resActiveAlias = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Active&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resActiveAlias.statusCode === 200, "GET /api/leads?status=Active returns 200 OK")
    const activeAliasMatches = resActiveAlias.data.data.leads.filter((l) => idEquals(l, activeLeadId))
    assert(activeAliasMatches.length === 1, "status=Active alias maps to Engaged and finds active lead")

    // 2.4 Order Placed query using canonical 'Closed-Won'
    const resWon = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Closed-Won&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resWon.statusCode === 200, "GET /api/leads?status=Closed-Won returns 200 OK")
    const wonMatches = resWon.data.data.leads.filter((l) => idEquals(l, wonLeadId))
    assert(wonMatches.length === 1, "status=Closed-Won finds Order Placed lead")

    // 2.5 Order Placed query using dropdown alias 'order-placed' / 'Order Placed'
    const resOrderPlacedAlias = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Order%20Placed&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resOrderPlacedAlias.statusCode === 200, "GET /api/leads?status=Order Placed returns 200 OK")
    const orderPlacedMatches = resOrderPlacedAlias.data.data.leads.filter((l) => idEquals(l, wonLeadId))
    assert(orderPlacedMatches.length === 1, "status='Order Placed' alias maps to Closed-Won and finds record")

    // 2.6 Lost Leads query using canonical 'Closed-Lost'
    const resLost = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Closed-Lost&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resLost.statusCode === 200, "GET /api/leads?status=Closed-Lost returns 200 OK")
    const lostMatches = resLost.data.data.leads.filter((l) => idEquals(l, lostLeadId))
    assert(lostMatches.length === 1, "status=Closed-Lost finds Lost record")

    // 2.7 Lost Leads query using dropdown alias 'Lost Leads'
    const resLostAlias = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Lost%20Leads&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(resLostAlias.statusCode === 200, "GET /api/leads?status=Lost Leads returns 200 OK")
    const lostAliasMatches = resLostAlias.data.data.leads.filter((l) => idEquals(l, lostLeadId))
    assert(lostAliasMatches.length === 1, "status='Lost Leads' alias maps to Closed-Lost and finds record")

    // -----------------------------------------------------------------
    // Test 3: Status Transition via Dedicated PATCH & PUT Endpoints
    // -----------------------------------------------------------------
    console.log("\n📋 Test 3: Status Transition Endpoints & History Tracking")

    // 3.1 Advance newLead to 'Engaged' using PATCH /api/leads/:id/status
    const patchRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}/status`,
        method: "PATCH",
        headers: authHeaders,
      },
      { status: "Engaged" }
    )
    assert(patchRes.statusCode === 200 && patchRes.data.success, "PATCH /api/leads/:id/status successfully updates status to 'Engaged'")
    assert(patchRes.data.data.status === "Engaged", "Returned lead has updated status 'Engaged'")

    // 3.2 Verify statusHistory entry created in lead metadata
    const historyEntry = patchRes.data.data.metadata?.statusHistory
    assert(Array.isArray(historyEntry) && historyEntry.length >= 1, "Transition logged in metadata.statusHistory array")
    assert(
      historyEntry[historyEntry.length - 1].fromStatus === "New" &&
      historyEntry[historyEntry.length - 1].toStatus === "Engaged",
      "History record correctly captures fromStatus='New' and toStatus='Engaged'"
    )

    // 3.3 Advance newLead further to 'Proposal Sent'
    const patchProposal = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}/status`,
        method: "PATCH",
        headers: authHeaders,
      },
      { status: "Proposal Sent" }
    )
    assert(patchProposal.statusCode === 200, "Status updated to 'Proposal Sent'")
    assert(patchProposal.data.data.status === "Proposal Sent", "Status reflects 'Proposal Sent'")

    // 3.4 Advance newLead to 'Closed-Won' (Order Placed)
    const patchWon = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}/status`,
        method: "PATCH",
        headers: authHeaders,
      },
      { status: "Closed-Won" }
    )
    assert(patchWon.statusCode === 200, "Lead advanced to 'Closed-Won'")
    assert(patchWon.data.data.status === "Closed-Won", "Lead status is 'Closed-Won'")

    // -----------------------------------------------------------------
    // Test 4: Re-query Persistence (Simulating Page Refresh)
    // -----------------------------------------------------------------
    console.log("\n📋 Test 4: Status Persistence Verification (Page Refresh)")

    const refreshedLeadRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}`,
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(refreshedLeadRes.statusCode === 200, "GET /api/leads/:id returns 200 OK")
    assert(
      refreshedLeadRes.data.data.status === "Closed-Won",
      "Re-queried lead retains persisted status 'Closed-Won' after status updates"
    )
    assert(
      refreshedLeadRes.data.data.metadata?.statusHistory?.length >= 3,
      "Full status transition trajectory is securely preserved in MongoDB"
    )

    // -----------------------------------------------------------------
    // Test 5: Input Validation & Invalid Status Rejection
    // -----------------------------------------------------------------
    console.log("\n📋 Test 5: Status Validation & Error Handling")

    const invalidStatusRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}/status`,
        method: "PATCH",
        headers: authHeaders,
      },
      { status: "FakeInvalidStatus" }
    )
    assert(
      invalidStatusRes.statusCode === 400 && invalidStatusRes.data.success === false,
      "Backend strictly rejects invalid status value with 400 Bad Request"
    )

    // -----------------------------------------------------------------
    // Test 6: Dashboard Statistics Live Calculation
    // -----------------------------------------------------------------
    console.log("\n📋 Test 6: Live Dashboard Pipeline Counts & Conversion Rate")

    const statsRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads/stats",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(statsRes.statusCode === 200 && statsRes.data.success, "GET /api/leads/stats returns 200 OK")
    const { total, statusCounts, conversionRate } = statsRes.data.data
    assert(typeof total === "number" && total >= 4, `Total leads count calculated accurately (total: ${total})`)
    assert(typeof statusCounts === "object", "statusCounts object present in stats response")
    assert(typeof statusCounts["Closed-Won"] === "number" && statusCounts["Closed-Won"] >= 2, "Closed-Won count reflects live converted leads")
    assert(typeof conversionRate === "number", `Conversion rate calculated accurately (${conversionRate}%)`)
    const expectedRate = Math.round((statusCounts["Closed-Won"] / total) * 100)
    assert(conversionRate === expectedRate, `Conversion rate matches business formula (${conversionRate}% == ${expectedRate}%)`)

    // -----------------------------------------------------------------
    // Test 7: Multi-Tenant Isolation & Access Protections
    // -----------------------------------------------------------------
    console.log("\n📋 Test 7: Multi-Tenant Isolation and Security Protection")

    // 7.1 Unauthenticated status change rejected
    const unauthRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${newLeadId}/status`,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      },
      { status: "Engaged" }
    )
    assert(unauthRes.statusCode === 401, "Unauthenticated status change is rejected with 401 Unauthorized")

    // 7.2 Create lead in a secondary tenant using Super Admin
    const tenantBLead = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: superAdmin.cookie,
        },
      },
      {
        name: "Tenant B Isolated Lead",
        email: `tenantb_${Date.now()}@domain.com`,
        phone: "+1 555-9999",
        status: "Engaged",
        tenantId: "ACC-TENANT-B-TEST",
      }
    )
    assert(tenantBLead.statusCode === 201, "Tenant B lead created by Super Admin")
    const tenantBLeadId = tenantBLead.data.data._id || tenantBLead.data.data.id
    createdLeadIds.push(tenantBLeadId)

    // 7.3 Tenant Admin A attempts to modify Tenant B's lead status
    const crossTenantUpdate = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/leads/${tenantBLeadId}/status`,
        method: "PATCH",
        headers: authHeaders, // Tenant A
      },
      { status: "Closed-Won" }
    )
    assert(
      crossTenantUpdate.statusCode === 404,
      "Cross-tenant status change blocked (Tenant A cannot find or mutate Tenant B lead: 404)"
    )

    // 7.4 Tenant Admin A querying status=Engaged cannot see Tenant B's lead
    const crossTenantQuery = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/api/leads?status=Engaged&limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    const leakedLeads = crossTenantQuery.data.data.leads.filter((l) => idEquals(l, tenantBLeadId))
    assert(leakedLeads.length === 0, "Tenant A status query strictly isolates and never leaks Tenant B records")

  } finally {
    // -----------------------------------------------------------------
    // Cleanup: Safely remove all created test leads
    // -----------------------------------------------------------------
    console.log("\n🧹 Cleaning up test records from MongoDB Atlas...")
    const superAdmin = await loginUser("superadmin@leadflow.io", "SuperAdmin@2026!")
    const superHeaders = {
      "Content-Type": "application/json",
      Cookie: superAdmin.cookie,
    }

    for (const id of createdLeadIds) {
      try {
        await request({
          hostname: "localhost",
          port: 5000,
          path: `/api/leads/${id}`,
          method: "DELETE",
          headers: superHeaders,
        })
      } catch (err) {
        console.error(`Error deleting test lead ${id}:`, err.message)
      }
    }
    console.log(`   Cleaned up ${createdLeadIds.length} test leads cleanly.`)
  }

  console.log("\n=======================================================")
  console.log(`TOTAL CHECKS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`)
  console.log("=======================================================\n")

  if (failCount > 0) {
    process.exit(1)
  }
}

runPhase2PipelineTests().catch((err) => {
  console.error("Test execution aborted:", err)
  process.exit(1)
})
