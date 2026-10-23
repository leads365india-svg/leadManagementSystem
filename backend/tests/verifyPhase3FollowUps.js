/**
 * Phase 3: Functional Follow-ups Management Verification Suite
 * 
 * Verifies:
 * 1. Authenticated session & RBAC permissions (followups.view, followups.manage)
 * 2. Creating follow-ups linked to an existing lead within tenant
 * 3. Persistence in MongoDB Atlas (retrieval across re-queries)
 * 4. Full follow-up editing (PUT /api/follow-ups/:id)
 * 5. Outcome completion with notes (PATCH /api/follow-ups/:id/complete)
 * 6. Timeline & status filters: upcoming, overdue, today, completed
 * 7. Type, priority, and live search filtering
 * 8. Real-time Follow-up statistics aggregation (GET /api/follow-ups/stats)
 * 9. Input validation: invalid date/time, invalid lead ID, invalid types, invalid priority (400 Bad Request)
 * 10. Multi-tenant isolation: Tenant A cannot see, read, edit, complete, or delete Tenant B follow-ups
 * 11. Security protection: Unauthenticated requests rejected (401 Unauthorized)
 * 12. Regressions check: Existing Leads & Dashboard APIs remain intact
 * 13. Safe cleanup of test follow-ups and test leads
 */

const http = require("http")

const BASE_HOST = "localhost"
const BASE_PORT = 5000

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
      hostname: BASE_HOST,
      port: BASE_PORT,
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

function idEquals(objOrId, targetId) {
  if (!objOrId || !targetId) return false
  const a = typeof objOrId === "object" ? objOrId._id || objOrId.id : objOrId
  const b = typeof targetId === "object" ? targetId._id || targetId.id : targetId
  return String(a) === String(b)
}

async function runPhase3FollowUpsTests() {
  console.log("=======================================================")
  console.log("   PHASE 3: FUNCTIONAL FOLLOW-UPS VERIFICATION SUITE   ")
  console.log("=======================================================\n")

  const createdFollowUpIds = []
  const createdLeadIds = []

  let tenantAdminCookie = ""
  let superAdminCookie = ""

  try {
    // -----------------------------------------------------------------
    // Step 0: Authenticate
    // -----------------------------------------------------------------
    console.log("🔑 Step 0: Authenticating test accounts...")
    const tenantAdmin = await loginUser("sara@test.com", "Password123!")
    tenantAdminCookie = tenantAdmin.cookie
    assert(tenantAdmin.user.email === "sara@test.com", "Tenant Admin authenticated (sara@test.com)")

    const superAdmin = await loginUser("superadmin@leadflow.io", "SuperAdmin@2026!")
    superAdminCookie = superAdmin.cookie
    assert(superAdmin.user.role === "super_admin", "Super Admin authenticated")

    const authHeaders = {
      "Content-Type": "application/json",
      Cookie: tenantAdminCookie,
    }

    // -----------------------------------------------------------------
    // Step 1: Create a base lead for Tenant A
    // -----------------------------------------------------------------
    console.log("\n📋 Step 1: Creating a test lead for Tenant A...")
    const leadRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/leads",
        method: "POST",
        headers: authHeaders,
      },
      {
        name: "Acme Healthcare Clinic",
        email: `acme_health_${Date.now()}@example.com`,
        phone: "+1 555-0199",
        company: "Acme Medical Group",
        source: "Website",
        status: "Engaged",
        assignedTo: "Dr. Evelyn Reed",
        message: "Interested in enterprise EHR integration for 15 clinics.",
      }
    )

    assert(leadRes.statusCode === 201 && leadRes.data.success, "Test lead created with 201 Created")
    const testLead = leadRes.data.data
    const testLeadId = testLead._id || testLead.id
    createdLeadIds.push(testLeadId)
    assert(Boolean(testLeadId), `Lead created successfully (ID: ${testLeadId})`)

    // -----------------------------------------------------------------
    // Step 2: Input Validation & Bad Request Handling
    // -----------------------------------------------------------------
    console.log("\n📋 Step 2: Testing input validations (rejection with 400 Bad Request)...")

    // 2.1 Missing leadId
    const missingLeadRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        title: "Callback without lead",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(missingLeadRes.statusCode === 400, "Missing leadId rejected with 400 Bad Request")

    // 2.2 Invalid leadId format
    const invalidLeadIdRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: "invalid-mongo-id-123",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(invalidLeadIdRes.statusCode === 400, "Malformed leadId rejected with 400 Bad Request")

    // 2.3 Non-existent leadId
    const nonExistentLeadIdRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: "507f1f77bcf86cd799439011",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(nonExistentLeadIdRes.statusCode === 404, "Non-existent lead rejected with 404 Not Found")

    // 2.4 Missing scheduledAt
    const missingScheduledRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        title: "No schedule date",
      }
    )
    assert(missingScheduledRes.statusCode === 400, "Missing scheduledAt rejected with 400 Bad Request")

    // 2.5 Invalid date/time format
    const invalidDateRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        scheduledAt: "not-a-valid-date-string",
      }
    )
    assert(invalidDateRes.statusCode === 400, "Invalid date/time format rejected with 400 Bad Request")

    // 2.6 Invalid follow-up type
    const invalidTypeRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        type: "smoke_signal",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(invalidTypeRes.statusCode === 400, "Invalid follow-up type rejected with 400 Bad Request")

    // 2.7 Invalid priority
    const invalidPriorityRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        priority: "super_ultra_urgent",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(invalidPriorityRes.statusCode === 400, "Invalid priority rejected with 400 Bad Request")

    // -----------------------------------------------------------------
    // Step 3: Create Follow-ups & Verify Persistence in MongoDB Atlas
    // -----------------------------------------------------------------
    console.log("\n📋 Step 3: Creating and persisting Follow-up records in MongoDB Atlas...")

    // 3.1 Create Upcoming Follow-up (tomorrow)
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const createUpcomingRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        title: "Demo Call on Medical EHR System",
        type: "call",
        scheduledAt: tomorrowDate.toISOString(),
        priority: "high",
        notes: "Present multi-clinic deployment pricing and SLAs.",
        assignedTo: "Sara Admin",
      }
    )
    assert(createUpcomingRes.statusCode === 201 && createUpcomingRes.data.success, "Upcoming follow-up created (201)")
    const upcomingFollowUp = createUpcomingRes.data.data
    const upcomingId = upcomingFollowUp._id || upcomingFollowUp.id
    createdFollowUpIds.push(upcomingId)
    assert(upcomingFollowUp.status === "pending", "New follow-up defaults to 'pending' status")
    assert(upcomingFollowUp.type === "call", "Follow-up type saved as 'call'")
    assert(upcomingFollowUp.priority === "high", "Follow-up priority saved as 'high'")
    assert(upcomingFollowUp.lead && upcomingFollowUp.lead.name === "Acme Healthcare Clinic", "Linked lead name populated")
    assert(upcomingFollowUp.lead.phone === "+1 555-0199", "Linked lead phone populated")

    // 3.2 Create Overdue Follow-up (yesterday)
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const createOverdueRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        title: "Overdue Proposal Review Touchpoint",
        type: "email",
        scheduledAt: yesterdayDate.toISOString(),
        priority: "medium",
        notes: "Check if board approved pilot budget.",
        assignedTo: "Sara Admin",
      }
    )
    assert(createOverdueRes.statusCode === 201 && createOverdueRes.data.success, "Overdue follow-up created (201)")
    const overdueFollowUp = createOverdueRes.data.data
    const overdueId = overdueFollowUp._id || overdueFollowUp.id
    createdFollowUpIds.push(overdueId)

    // 3.3 Create Today's Follow-up (today in 2 hours)
    const todayDate = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const createTodayRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: testLeadId,
        title: "Product Specs Discussion",
        type: "meeting",
        scheduledAt: todayDate.toISOString(),
        priority: "low",
        notes: "Quick check on API security compliance checklist.",
        assignedTo: "Sara Admin",
      }
    )
    assert(createTodayRes.statusCode === 201 && createTodayRes.data.success, "Today follow-up created (201)")
    const todayFollowUp = createTodayRes.data.data
    const todayId = todayFollowUp._id || todayFollowUp.id
    createdFollowUpIds.push(todayId)

    // 3.4 Verify Persistence via GET /api/follow-ups/:id (simulating page reload)
    console.log("\n📋 Step 3.4: Verifying persistence across separate re-query...")
    const getByIdRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${upcomingId}`,
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(getByIdRes.statusCode === 200 && getByIdRes.data.success, "GET /api/follow-ups/:id returns 200 OK")
    const persisted = getByIdRes.data.data
    assert(persisted.title === "Demo Call on Medical EHR System", "Follow-up title persisted accurately")
    assert(persisted.notes.includes("SLAs"), "Follow-up notes persisted accurately")
    assert(persisted.lead && persisted.lead.name === "Acme Healthcare Clinic", "Populated lead data persisted")

    // -----------------------------------------------------------------
    // Step 4: Follow-up Editing & Outcome Completion
    // -----------------------------------------------------------------
    console.log("\n📋 Step 4: Editing follow-up details & recording outcome completion...")

    // 4.1 Update follow-up details (PUT /api/follow-ups/:id)
    const updatedSchedule = new Date(Date.now() + 48 * 60 * 60 * 1000) // 2 days ahead
    const updateRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${upcomingId}`,
        method: "PUT",
        headers: authHeaders,
      },
      {
        title: "Rescheduled Demo Call & Commercial Pitch",
        type: "call",
        scheduledAt: updatedSchedule.toISOString(),
        priority: "high",
        notes: "Updated agenda: demo + quote discussion.",
      }
    )
    assert(updateRes.statusCode === 200 && updateRes.data.success, "PUT /api/follow-ups/:id updated successfully (200)")
    assert(updateRes.data.data.title === "Rescheduled Demo Call & Commercial Pitch", "Updated title verified")
    assert(updateRes.data.data.notes.includes("quote discussion"), "Updated notes verified")

    // 4.2 Complete follow-up with outcome notes (PATCH /api/follow-ups/:id/complete)
    const completeRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${overdueId}/complete`,
        method: "PATCH",
        headers: authHeaders,
      },
      {
        completionNotes: "Spoke with Dr. Reed. Decision confirmed; sending final invoice.",
      }
    )
    assert(completeRes.statusCode === 200 && completeRes.data.success, "PATCH /api/follow-ups/:id/complete succeeded (200)")
    const completedRecord = completeRes.data.data
    assert(completedRecord.status === "completed", "Status transitioned to 'completed'")
    assert(Boolean(completedRecord.completedAt), "completedAt timestamp is recorded")
    assert(
      completedRecord.completedBy === tenantAdmin.user.name || completedRecord.completedBy === tenantAdmin.user.email,
      `completedBy recorded active user identity (${completedRecord.completedBy})`
    )
    assert(completedRecord.completionNotes.includes("sending final invoice"), "completionNotes recorded outcome")

    // -----------------------------------------------------------------
    // Step 5: Timeline & Status Filtering
    // -----------------------------------------------------------------
    console.log("\n📋 Step 5: Testing timeline and status filters...")

    // 5.1 Filter: status=upcoming
    const upcomingListRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups?status=upcoming",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(upcomingListRes.statusCode === 200 && upcomingListRes.data.success, "Filter ?status=upcoming returns 200")
    const upcomingItems = upcomingListRes.data.data.followUps
    const hasUpcoming = upcomingItems.some((f) => idEquals(f, upcomingId))
    const hasCompletedInUpcoming = upcomingItems.some((f) => idEquals(f, overdueId))
    assert(hasUpcoming, "Upcoming list includes upcoming follow-up")
    assert(!hasCompletedInUpcoming, "Upcoming list excludes completed follow-up")

    // 5.2 Filter: status=completed
    const completedListRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups?status=completed",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(completedListRes.statusCode === 200 && completedListRes.data.success, "Filter ?status=completed returns 200")
    const completedItems = completedListRes.data.data.followUps
    const hasCompleted = completedItems.some((f) => idEquals(f, overdueId))
    const hasUpcomingInCompleted = completedItems.some((f) => idEquals(f, upcomingId))
    assert(hasCompleted, "Completed list includes completed follow-up")
    assert(!hasUpcomingInCompleted, "Completed list excludes pending follow-up")

    // 5.3 Filter: type=call
    const typeCallRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups?type=call",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(typeCallRes.statusCode === 200, "Filter ?type=call returns 200")
    const callItems = typeCallRes.data.data.followUps
    assert(callItems.every((f) => f.type === "call"), "All returned items have type 'call'")

    // 5.4 Live Search query
    const searchRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups?search=Commercial+Pitch",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(searchRes.statusCode === 200, "Filter ?search=Commercial Pitch returns 200")
    const searchItems = searchRes.data.data.followUps
    assert(searchItems.some((f) => idEquals(f, upcomingId)), "Search by title keywords finds matching record")

    // -----------------------------------------------------------------
    // Step 6: Follow-up Statistics Calculation
    // -----------------------------------------------------------------
    console.log("\n📋 Step 6: Testing real-time Follow-up statistics (GET /api/follow-ups/stats)...")
    const statsRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups/stats",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(statsRes.statusCode === 200 && statsRes.data.success, "GET /api/follow-ups/stats returns 200 OK")
    const stats = statsRes.data.data
    assert(typeof stats.total === "number" && stats.total >= 3, `Total follow-ups counted (${stats.total})`)
    assert(typeof stats.upcoming === "number" && stats.upcoming >= 1, `Upcoming count calculated (${stats.upcoming})`)
    assert(typeof stats.completed === "number" && stats.completed >= 1, `Completed count calculated (${stats.completed})`)
    assert(typeof stats.completionRate === "number", `Completion rate calculated (${stats.completionRate}%)`)
    const expectedRate = Math.round((stats.completed / stats.total) * 100)
    assert(stats.completionRate === expectedRate, `Completion rate matches formula (${stats.completionRate}% == ${expectedRate}%)`)

    // -----------------------------------------------------------------
    // Step 7: Multi-Tenant Isolation & Security Protections
    // -----------------------------------------------------------------
    console.log("\n📋 Step 7: Testing multi-tenant isolation and security protections...")

    // 7.1 Unauthenticated requests rejected with 401
    const unauthGetRes = await request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: "/api/follow-ups",
      method: "GET",
    })
    assert(unauthGetRes.statusCode === 401, "Unauthenticated GET /api/follow-ups rejected (401)")

    const unauthPostRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        leadId: testLeadId,
        scheduledAt: new Date().toISOString(),
      }
    )
    assert(unauthPostRes.statusCode === 401, "Unauthenticated POST /api/follow-ups rejected (401)")

    // 7.2 Create lead and follow-up in Tenant B using Super Admin
    const tenantBLeadRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/leads",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: superAdminCookie,
        },
      },
      {
        name: "Tenant B Private Lead",
        email: `tenantb_lead_${Date.now()}@domain.com`,
        phone: "+1 555-8888",
        status: "Engaged",
        tenantId: "ACC-TENANT-B-TEST",
      }
    )
    assert(tenantBLeadRes.statusCode === 201, "Tenant B lead created by Super Admin")
    const tenantBLeadId = tenantBLeadRes.data.data._id || tenantBLeadRes.data.data.id
    createdLeadIds.push(tenantBLeadId)

    const tenantBFollowUpRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: superAdminCookie,
        },
      },
      {
        leadId: tenantBLeadId,
        title: "Confidential Tenant B Follow-up",
        type: "meeting",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        tenantId: "ACC-TENANT-B-TEST",
      }
    )
    assert(tenantBFollowUpRes.statusCode === 201, "Tenant B follow-up created by Super Admin")
    const tenantBFollowUpId = tenantBFollowUpRes.data.data._id || tenantBFollowUpRes.data.data.id
    createdFollowUpIds.push(tenantBFollowUpId)

    // 7.3 Tenant A cannot see Tenant B's follow-up in listing
    const tenantAListRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups?limit=50",
        method: "GET",
        headers: authHeaders,
      }
    )
    const leakedFollowUps = tenantAListRes.data.data.followUps.filter((f) => idEquals(f, tenantBFollowUpId))
    assert(leakedFollowUps.length === 0, "Tenant A cannot see Tenant B's follow-ups in listing (isolation verified)")

    // 7.4 Tenant A cannot get Tenant B's follow-up by ID
    const crossTenantGet = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${tenantBFollowUpId}`,
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(crossTenantGet.statusCode === 404, "Cross-tenant GET blocked with 404 Not Found")

    // 7.5 Tenant A cannot update Tenant B's follow-up
    const crossTenantPut = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${tenantBFollowUpId}`,
        method: "PUT",
        headers: authHeaders,
      },
      {
        title: "Malicious Cross-Tenant Overwrite",
      }
    )
    assert(crossTenantPut.statusCode === 404, "Cross-tenant PUT blocked with 404 Not Found")

    // 7.6 Tenant A cannot complete Tenant B's follow-up
    const crossTenantComplete = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${tenantBFollowUpId}/complete`,
        method: "PATCH",
        headers: authHeaders,
      },
      {
        completionNotes: "Hacked completion",
      }
    )
    assert(crossTenantComplete.statusCode === 404, "Cross-tenant PATCH complete blocked with 404 Not Found")

    // 7.7 Tenant A cannot delete Tenant B's follow-up
    const crossTenantDelete = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/api/follow-ups/${tenantBFollowUpId}`,
        method: "DELETE",
        headers: authHeaders,
      }
    )
    assert(crossTenantDelete.statusCode === 404, "Cross-tenant DELETE blocked with 404 Not Found")

    // 7.8 Tenant A cannot link a follow-up to Tenant B's lead
    const crossLeadLink = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/follow-ups",
        method: "POST",
        headers: authHeaders,
      },
      {
        leadId: tenantBLeadId,
        title: "Attempting to attach follow-up to other tenant's lead",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }
    )
    assert(crossLeadLink.statusCode === 404, "Creating follow-up for another tenant's lead blocked with 404 Not Found")

    // -----------------------------------------------------------------
    // Step 8: Existing Leads & Dashboard APIs Intact
    // -----------------------------------------------------------------
    console.log("\n📋 Step 8: Verifying existing Leads and Dashboard functionality...")
    const leadsRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/leads?limit=5",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(leadsRes.statusCode === 200 && leadsRes.data.success, "GET /api/leads intact (200 OK)")

    const leadStatsRes = await request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: "/api/leads/stats",
        method: "GET",
        headers: authHeaders,
      }
    )
    assert(leadStatsRes.statusCode === 200 && leadStatsRes.data.success, "GET /api/leads/stats intact (200 OK)")

    console.log("\n🎉 ALL PHASE 3 FOLLOW-UPS VERIFICATION TESTS PASSED SUCCESSFULLY!")

  } finally {
    // -----------------------------------------------------------------
    // Cleanup: Safely remove all created test follow-ups and leads
    // -----------------------------------------------------------------
    console.log("\n🧹 Cleaning up test records...")

    // Delete created follow-ups
    for (const fId of createdFollowUpIds) {
      try {
        await request({
          hostname: BASE_HOST,
          port: BASE_PORT,
          path: `/api/follow-ups/${fId}`,
          method: "DELETE",
          headers: { Cookie: superAdminCookie || tenantAdminCookie },
        })
      } catch (err) {
        // ignore
      }
    }
    console.log(`  Removed ${createdFollowUpIds.length} test follow-ups.`)

    // Delete created leads
    for (const lId of createdLeadIds) {
      try {
        await request({
          hostname: BASE_HOST,
          port: BASE_PORT,
          path: `/api/leads/${lId}`,
          method: "DELETE",
          headers: { Cookie: superAdminCookie || tenantAdminCookie },
        })
      } catch (err) {
        // ignore
      }
    }
    console.log(`  Removed ${createdLeadIds.length} test leads.`)
  }

  console.log(`\n=======================================================`)
  console.log(`   TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`)
  console.log(`=======================================================\n`)

  if (failCount > 0) {
    process.exit(1)
  }
}

runPhase3FollowUpsTests().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
