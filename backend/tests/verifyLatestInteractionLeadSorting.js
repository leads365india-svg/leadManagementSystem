require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const mongoose = require("mongoose")
const dns = require("dns")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const connectDB = require("../db/connection")
const Account = require("../models/Account")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const User = require("../models/User")
const Lead = require("../models/Lead")
const Call = require("../models/Call")
const { Activity } = require("../models/Activity")
const leadController = require("../controllers/leadController")
const mobileController = require("../controllers/mobileController")
const callService = require("../services/callService")
const mobileSyncService = require("../services/mobileSyncService")
const leadService = require("../services/leadService")
const { runWithTenantContext } = require("../middleware/tenantContext")

let passed = 0
let failed = 0

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ""}`)
    failed++
  }
}

function createMockRes() {
  let statusCode = 200
  let payload = null
  return {
    status(code) {
      statusCode = code
      return this
    },
    json(data) {
      payload = data
      return this
    },
    getStatus: () => statusCode,
    getData: () => payload,
  }
}

async function queryLeadsApi(user, { query = {}, tenantContext = null } = {}) {
  const plainUser = typeof user.toObject === "function" ? user.toObject() : { ...user }
  const req = {
    user: { ...plainUser, id: user._id.toString() },
    query: { ...query },
    headers: {},
    tenantContext: tenantContext || {
      tenantId: plainUser.tenantId,
      mode: "all_workspaces",
      isSuperAdmin: false,
    },
  }
  const res = createMockRes()
  await runWithTenantContext(req.tenantContext, () => leadController.getLeads(req, res))
  const data = res.getData()
  return { status: res.getStatus(), body: data, leads: data?.data?.leads || [] }
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== VERIFY LATEST INTERACTION BASED LEAD SORTING (NORMAL & WHATSAPP CALLS)    ===")
  console.log("================================================================================")

  await connectDB()

  const suffix = Date.now()
  const TENANT_A = `ACC-INT-A-${suffix}`
  const TENANT_B = `ACC-INT-B-${suffix}`

  const adminAId = new mongoose.Types.ObjectId()
  const adminBId = new mongoose.Types.ObjectId()

  const cleanup = async () => {
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await Call.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await Activity.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await WorkspaceMembership.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await Workspace.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
  }

  try {
    await cleanup()

    await Account.create({
      accountId: TENANT_A,
      companyName: "Interaction Sort Co A",
      displayName: "Interaction Sort Co A",
      adminUserId: adminAId,
      adminName: "Admin A",
      adminEmail: `admin_a_${suffix}@test.com`,
      status: "active",
      metadata: { autoLeadCaptureEnabled: false },
    })

    await Account.create({
      accountId: TENANT_B,
      companyName: "Interaction Sort Co B",
      displayName: "Interaction Sort Co B",
      adminUserId: adminBId,
      adminName: "Admin B",
      adminEmail: `admin_b_${suffix}@test.com`,
      status: "active",
      metadata: { autoLeadCaptureEnabled: false },
    })

    const adminUserA = await User.create({
      _id: adminAId,
      tenantId: TENANT_A,
      name: "Admin A",
      email: `admin_a_${suffix}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    const adminUserB = await User.create({
      _id: adminBId,
      tenantId: TENANT_B,
      name: "Admin B",
      email: `admin_b_${suffix}@test.com`,
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    const wsAlpha = await Workspace.create({
      tenantId: TENANT_A,
      name: "Project Alpha",
      slug: `project-alpha-${suffix}`,
      code: "ALPHA",
      isDefault: true,
      createdBy: adminUserA._id,
    })

    const wsBeta = await Workspace.create({
      tenantId: TENANT_A,
      name: "Project Beta",
      slug: `project-beta-${suffix}`,
      code: "BETA",
      isDefault: false,
      createdBy: adminUserA._id,
    })

    await WorkspaceMembership.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      userId: adminUserA._id,
      role: "workspace_admin",
      isDefault: true,
    })

    const now = Date.now()
    const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000)

    const leadA = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Lead A Oldest",
      phone: "+919876100001",
      phoneNormalized: "+919876100001",
      status: "New",
      createdAt: daysAgo(10),
    })

    const leadB = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Lead B Middle",
      phone: "+919876100002",
      phoneNormalized: "+919876100002",
      status: "Engaged",
      createdAt: daysAgo(2),
    })

    const leadC = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Priya Client",
      phone: "+919876100003",
      phoneNormalized: "+919876100003",
      status: "New",
      createdAt: daysAgo(5),
    })

    const leadD = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Lead D Newest Uncontacted",
      phone: "+919876100004",
      phoneNormalized: "+919876100004",
      status: "New",
      createdAt: daysAgo(0),
    })

    const leadE = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsBeta._id,
      name: "Lead E Beta",
      phone: "+919876100005",
      phoneNormalized: "+919876100005",
      status: "New",
      createdAt: daysAgo(8),
    })

    const leadAmbig1 = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Shared Phone Lead 1",
      phone: "+919876100099",
      phoneNormalized: "+919876100099",
      status: "New",
      createdAt: daysAgo(12),
    })

    const leadAmbig2 = await Lead.create({
      tenantId: TENANT_A,
      workspaceId: wsAlpha._id,
      name: "Shared Phone Lead 2",
      phone: "+919876100099",
      phoneNormalized: "+919876100099",
      status: "New",
      createdAt: daysAgo(13),
    })

    const leadTenantB = await Lead.create({
      tenantId: TENANT_B,
      name: "Tenant B Lead",
      phone: "+919876100001",
      phoneNormalized: "+919876100001",
      status: "New",
      createdAt: daysAgo(1),
    })

    // -----------------------------------------------------------------------
    // 1. Initial fallback sort when zero calls exist
    // -----------------------------------------------------------------------
    console.log("\n[1] Initial All Leads ordering falls back to createdAt desc")
    const initRes = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    const initNames = initRes.leads.map((l) => l.name)
    assert(initRes.status === 200 && initRes.body.success, "GET /leads returns 200")
    assert(
      initNames[0] === "Lead D Newest Uncontacted" && initNames[1] === "Lead B Middle",
      `Uncontacted leads ordered newest createdAt first (got ${initNames.slice(0, 3).join(", ")})`
    )

    // -----------------------------------------------------------------------
    // 2. Incoming normal phone call moves Lead A (10 days old) to #1
    // -----------------------------------------------------------------------
    console.log("\n[2] Scenario 1: Incoming normal phone call moves Lead A to top")
    const tInNormal = now - 600000
    const resT2 = createMockRes()
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: `norm_in_${suffix}`,
            lead_id: "", // omit explicit lead_id to verify phone match on existing lead
            phone_number: "+919876100001",
            call_direction: "INCOMING",
            call_type: 1,
            start_time_ms: tInNormal,
            duration_seconds: 65,
            call_outcome: "Connected",
            source: "android_sync",
          },
        },
        resT2
      )
    )
    const leadAAfterT2 = await Lead.findById(leadA._id).setOptions({ skipTenantFilter: true })
    assert(resT2.getStatus() === 201, `Incoming normal call returned 201 (got ${resT2.getStatus()})`)
    assert(Boolean(leadAAfterT2.lastInteractionAt), "Lead A lastInteractionAt populated")
    assert(leadAAfterT2.lastInteractionChannel === "phone", `Channel recorded as phone (got ${leadAAfterT2.lastInteractionChannel})`)
    assert(leadAAfterT2.lastInteractionDirection === "inbound", `Direction recorded as inbound (got ${leadAAfterT2.lastInteractionDirection})`)

    const listAfterT2 = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    assert(
      listAfterT2.leads[0]._id === leadA._id.toString(),
      `Lead A moved to #1 in All Leads (got ${listAfterT2.leads[0]?.name})`
    )

    // -----------------------------------------------------------------------
    // 3. Outgoing WhatsApp voice call moves Lead B above Lead A
    // -----------------------------------------------------------------------
    console.log("\n[3] Scenario 4: Outgoing WhatsApp voice call moves Lead B above Lead A")
    const tOutWa = now - 480000
    const resT3 = createMockRes()
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: `wa_voip_${TENANT_A}_dev1_${tOutWa}`,
            lead_id: "",
            phone_number: "+919876100002",
            call_direction: "OUTGOING",
            call_type: 2,
            start_time_ms: tOutWa,
            duration_seconds: 120,
            source: "whatsapp_voip",
            call_channel: "WHATSAPP_VOIP",
            source_app: "com.whatsapp",
          },
        },
        resT3
      )
    )
    const leadBAfterT3 = await Lead.findById(leadB._id).setOptions({ skipTenantFilter: true })
    assert(leadBAfterT3.lastInteractionChannel === "whatsapp_voice", "Channel recorded as whatsapp_voice")
    assert(leadBAfterT3.lastInteractionDirection === "outbound", "Direction recorded as outbound")

    const listAfterT3 = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    assert(
      listAfterT3.leads[0]._id === leadB._id.toString() && listAfterT3.leads[1]._id === leadA._id.toString(),
      `Order is now Lead B > Lead A (got ${listAfterT3.leads.slice(0, 2).map((l) => l.name).join(" > ")})`
    )

    // -----------------------------------------------------------------------
    // 4. Incoming WhatsApp voice call via contact name moves Lead C to top
    // -----------------------------------------------------------------------
    console.log("\n[4] Scenario 3: Incoming WhatsApp voice call via contact name moves Lead C to #1")
    const tInWa = now - 360000
    const resT4 = createMockRes()
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: `wa_voip_${TENANT_A}_dev1_${tInWa}`,
            lead_id: "",
            phone_number: "Priya Client",
            contact_name: "Priya Client",
            call_direction: "INCOMING",
            call_type: 1,
            start_time_ms: tInWa,
            duration_seconds: 90,
            source: "whatsapp_voip",
            source_app: "com.whatsapp.w4b",
          },
        },
        resT4
      )
    )
    const leadCAfterT4 = await Lead.findById(leadC._id).setOptions({ skipTenantFilter: true })
    assert(leadCAfterT4.lastInteractionChannel === "whatsapp_voice", "Lead C WhatsApp channel stored")
    assert(leadCAfterT4.lastInteractionDirection === "inbound", "Lead C inbound direction stored")

    const listAfterT4 = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    assert(
      listAfterT4.leads[0]._id === leadC._id.toString(),
      `Lead C is now #1 above Lead B and Lead A (got ${listAfterT4.leads.slice(0, 3).map((l) => l.name).join(" > ")})`
    )

    // -----------------------------------------------------------------------
    // 5. Outgoing normal phone call via callService & mobileSyncService moves Lead A back to #1
    // -----------------------------------------------------------------------
    console.log("\n[5] Scenario 2: Outgoing normal phone call moves Lead A back above Lead C and Lead B")
    const tOutNormalStart = now - 240000
    const tOutNormalEnd = now - 165000
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        number: "+919876100001",
        direction: "outbound",
        duration: 75,
        status: "completed",
        disposition: "Interested",
        startedAt: new Date(tOutNormalStart),
        endedAt: new Date(tOutNormalEnd),
        source: "android_sync",
      })
    )

    const listAfterT5 = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    assert(
      listAfterT5.leads[0]._id === leadA._id.toString() &&
        listAfterT5.leads[1]._id === leadC._id.toString() &&
        listAfterT5.leads[2]._id === leadB._id.toString(),
      `Order is Lead A > Lead C > Lead B (got ${listAfterT5.leads.slice(0, 3).map((l) => l.name).join(" > ")})`
    )

    // -----------------------------------------------------------------------
    // 6. Missed, Rejected (with ring duration), Busy, Failed, Ringing, 0s calls excluded
    // -----------------------------------------------------------------------
    console.log("\n[6] Non-connected calls (Missed/Rejected/Busy/Failed/Ringing/0s) must NOT update interaction")
    const nonConnectedPayloads = [
      {
        client_call_id: `missed_${suffix}`,
        phone_number: "+919876100004",
        call_direction: "MISSED",
        call_type: 3,
        start_time_ms: now - 100000,
        duration_seconds: 0,
        call_outcome: "Missed",
      },
      {
        client_call_id: `rejected_ring_${suffix}`,
        phone_number: "+919876100004",
        call_direction: "INCOMING",
        call_type: 5, // REJECTED_TYPE with ring duration
        start_time_ms: now - 90000,
        duration_seconds: 28,
        call_outcome: "Rejected",
      },
      {
        client_call_id: `zero_sec_${suffix}`,
        phone_number: "+919876100004",
        call_direction: "INCOMING",
        call_type: 1,
        start_time_ms: now - 80000,
        duration_seconds: 0,
      },
      {
        client_call_id: `busy_wa_${suffix}`,
        phone_number: "+919876100004",
        call_direction: "OUTGOING",
        call_type: 2,
        start_time_ms: now - 70000,
        duration_seconds: 15,
        call_outcome: "Busy",
        source: "whatsapp_voip",
      },
    ]

    for (const body of nonConnectedPayloads) {
      await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
        mobileController.reportMobileCall(
          {
            user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
            tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
            body,
          },
          createMockRes()
        )
      )
    }

    // Ringing and failed via callService.logCall
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, async () => {
      await callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        number: "+919876100004",
        direction: "outbound",
        duration: 12,
        status: "ringing",
        startedAt: new Date(now - 60000),
      })
      await callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        number: "+919876100004",
        direction: "outbound",
        duration: 0,
        status: "failed",
        disposition: "Failed",
        startedAt: new Date(now - 50000),
      })
    })

    const leadDAfterNonConn = await Lead.findById(leadD._id).setOptions({ skipTenantFilter: true })
    assert(leadDAfterNonConn.lastInteractionAt === null, "Lead D lastInteractionAt remains null after non-connected calls")
    assert(leadDAfterNonConn.lastContactedAt === null, "Lead D lastContactedAt remains null after non-connected calls")

    // -----------------------------------------------------------------------
    // 7. Ordinary WhatsApp text message updating lastContactedAt does NOT hijack sort order
    // -----------------------------------------------------------------------
    console.log("\n[7] Ordinary WhatsApp text messages must not move Lead D above connected voice calls")
    await Lead.updateOne(
      { _id: leadD._id },
      { $set: { lastContactedAt: new Date() } }
    ).setOptions({ skipTenantFilter: true })

    const listAfterTextMsg = await queryLeadsApi(adminUserA, { query: { limit: 20 } })
    assert(
      listAfterTextMsg.leads[0]._id === leadA._id.toString() &&
        listAfterTextMsg.leads[1]._id === leadC._id.toString() &&
        listAfterTextMsg.leads[2]._id === leadB._id.toString() &&
        listAfterTextMsg.leads[3]._id === leadD._id.toString(),
      `Lead D stays below contacted leads (got ${listAfterTextMsg.leads.slice(0, 4).map((l) => l.name).join(" > ")})`
    )

    // -----------------------------------------------------------------------
    // 8. Ringing -> Connected completion upgrade via clientCallId upsert
    // -----------------------------------------------------------------------
    console.log("\n[8] Idempotent upgrade from initiated/0s to completed updates interaction once connected")
    const upgradeCallId = `upgrade_${suffix}`
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: upgradeCallId,
            phone_number: "+919876100005", // Lead E (Project Beta)
            call_direction: "OUTGOING",
            start_time_ms: now - 100000,
            duration_seconds: 0,
            call_outcome: "Ringing",
          },
        },
        createMockRes()
      )
    )
    let leadECheck = await Lead.findById(leadE._id).setOptions({ skipTenantFilter: true })
    assert(leadECheck.lastInteractionAt === null, "Ringing call did not set Lead E lastInteractionAt")

    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: upgradeCallId,
            phone_number: "+919876100005",
            call_direction: "OUTGOING",
            start_time_ms: now - 100000,
            ended_at_ms: now - 40000,
            duration_seconds: 60,
            call_outcome: "Connected",
          },
        },
        createMockRes()
      )
    )
    leadECheck = await Lead.findById(leadE._id).setOptions({ skipTenantFilter: true })
    assert(Boolean(leadECheck.lastInteractionAt), "Upgraded completed call updated Lead E lastInteractionAt")

    // -----------------------------------------------------------------------
    // 9. Monotonic protection: older synced call never downgrades newer timestamp
    // -----------------------------------------------------------------------
    console.log("\n[9] Monotonic guard: late sync of older call does not downgrade Lead E timestamp")
    const expectedETime = new Date(leadECheck.lastInteractionAt).getTime()
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        leadId: leadE._id.toString(),
        number: "+919876100005",
        direction: "inbound",
        duration: 45,
        status: "completed",
        startedAt: daysAgo(20),
        endedAt: new Date(daysAgo(20).getTime() + 45000),
      })
    )
    const leadEMonotonic = await Lead.findById(leadE._id).setOptions({ skipTenantFilter: true })
    assert(
      new Date(leadEMonotonic.lastInteractionAt).getTime() === expectedETime,
      "Older synced call left Lead E lastInteractionAt unchanged"
    )

    // -----------------------------------------------------------------------
    // 10. Unknown caller (no auto-create) & Ambiguous shared phone safety
    // -----------------------------------------------------------------------
    console.log("\n[10] Unknown caller never auto-creates lead; ambiguous shared phone never updates arbitrarily")
    const beforeLeadCount = await Lead.countDocuments({ tenantId: TENANT_A }).setOptions({ skipTenantFilter: true })
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: `unknown_${suffix}`,
            phone_number: "+919876999888",
            call_direction: "INCOMING",
            start_time_ms: now - 30000,
            duration_seconds: 50,
            call_outcome: "Connected",
          },
        },
        createMockRes()
      )
    )
    const afterUnknownCount = await Lead.countDocuments({ tenantId: TENANT_A }).setOptions({ skipTenantFilter: true })
    assert(afterUnknownCount === beforeLeadCount, "No Lead auto-created for unknown number")

    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, () =>
      mobileController.reportMobileCall(
        {
          user: { ...adminUserA.toObject(), id: adminUserA._id.toString() },
          tenantContext: { tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false },
          body: {
            client_call_id: `ambig_${suffix}`,
            phone_number: "+919876100099",
            call_direction: "INCOMING",
            start_time_ms: now - 25000,
            duration_seconds: 40,
            call_outcome: "Connected",
          },
        },
        createMockRes()
      )
    )
    const ambigCheck1 = await Lead.findById(leadAmbig1._id).setOptions({ skipTenantFilter: true })
    const ambigCheck2 = await Lead.findById(leadAmbig2._id).setOptions({ skipTenantFilter: true })
    assert(
      ambigCheck1.lastInteractionAt === null && ambigCheck2.lastInteractionAt === null,
      "Neither ambiguous lead received lastInteractionAt update"
    )

    // -----------------------------------------------------------------------
    // 11. Tenant isolation, workspace isolation, pagination, search, explicit sort override
    // -----------------------------------------------------------------------
    console.log("\n[11] Tenant isolation, workspace scopes, pagination, search & explicit sort")
    const tenantBCheck = await Lead.findById(leadTenantB._id).setOptions({ skipTenantFilter: true })
    assert(tenantBCheck.lastInteractionAt === null, "Tenant B lead unaffected by Tenant A calls")

    const alphaOnly = await queryLeadsApi(adminUserA, {
      query: { limit: 20 },
      tenantContext: { tenantId: TENANT_A, workspaceId: wsAlpha._id.toString(), mode: "single_workspace", isSuperAdmin: false },
    })
    assert(
      alphaOnly.leads.every((l) => l.workspaceId === wsAlpha._id.toString()) &&
        alphaOnly.leads[0]._id === leadA._id.toString(),
      "Project Alpha single-workspace view isolates & orders correctly"
    )

    const allProjectsP1 = await queryLeadsApi(adminUserA, { query: { page: 1, limit: 2 } })
    const allProjectsP2 = await queryLeadsApi(adminUserA, { query: { page: 2, limit: 2 } })
    assert(
      allProjectsP1.leads.length === 2 &&
        allProjectsP2.leads.length === 2 &&
        allProjectsP1.leads[0]._id === leadE._id.toString() &&
        allProjectsP1.leads[1]._id === leadA._id.toString() &&
        allProjectsP2.leads[0]._id === leadC._id.toString() &&
        allProjectsP2.leads[1]._id === leadB._id.toString(),
      `Pagination preserves exact latest-interaction sequence: Lead E > Lead A | Lead C > Lead B`
    )

    const searchRes = await queryLeadsApi(adminUserA, {
      query: { search: "Lead", limit: 20 },
    })
    assert(
      searchRes.leads[0]._id === leadE._id.toString() &&
        searchRes.leads[1]._id === leadA._id.toString() &&
        searchRes.leads[2]._id === leadB._id.toString(),
      "Search preserves latest-interaction ordering among matching leads"
    )

    const statusRes = await queryLeadsApi(adminUserA, {
      query: { status: "New", limit: 20 },
    })
    assert(
      statusRes.leads[0]._id === leadE._id.toString() &&
        statusRes.leads[1]._id === leadA._id.toString() &&
        statusRes.leads[2]._id === leadC._id.toString(),
      "Status filter preserves latest-interaction ordering"
    )

    const createdSortOverride = await queryLeadsApi(adminUserA, {
      query: { sortBy: "createdAt", sortOrder: "desc", limit: 20 },
    })
    assert(
      createdSortOverride.leads[0]._id === leadD._id.toString(),
      "Explicit sortBy=createdAt still sorts newest created lead first"
    )

    // -----------------------------------------------------------------------
    // 12. Historical call reconciliation sets lastInteractionAt from connected calls only
    // -----------------------------------------------------------------------
    console.log("\n[12] Historical reconciliation ignores missed call and uses latest connected call")
    const histPhone = "+919876100777"
    await runWithTenantContext({ tenantId: TENANT_A, mode: "all_workspaces", isSuperAdmin: false }, async () => {
      await callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        number: histPhone,
        direction: "inbound",
        duration: 50,
        status: "completed",
        startedAt: new Date(now - 300000),
      })
      await callService.logCall({
        tenantId: TENANT_A,
        agentId: adminUserA._id,
        number: histPhone,
        direction: "missed",
        duration: 0,
        status: "missed",
        disposition: "Missed",
        startedAt: new Date(now - 10000), // Newer missed call must NOT beat older connected call
      })
    })
    const recLeadRes = await runWithTenantContext(
      { tenantId: TENANT_A, workspaceId: wsBeta._id.toString(), mode: "single_workspace", isSuperAdmin: false },
      () =>
        leadService.createOrMergeLead({
          tenantId: TENANT_A,
          source: "Manual Entry",
          payload: {
            name: "Reconciled Hist Lead",
            phone: histPhone,
            workspaceId: wsBeta._id,
          },
          actor: adminUserA,
        })
    )
    const recLead = await Lead.findById(recLeadRes.lead._id).setOptions({ skipTenantFilter: true })
    assert(
      recLead.lastInteractionAt && new Date(recLead.lastInteractionAt).getTime() === now - 250000,
      `Reconciled lead lastInteractionAt uses completed call end timestamp (expected ${now - 250000}, got ${recLead.lastInteractionAt ? new Date(recLead.lastInteractionAt).getTime() : null})`
    )
  } finally {
    await cleanup()
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== LATEST INTERACTION SORTING SUMMARY: ${passed} PASSED, ${failed} FAILED ===`)
  console.log("================================================================================")
  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
