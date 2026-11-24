/**
 * Multi-Workspace SaaS Core Foundation Verification Test Suite
 *
 * Verifies:
 * 1. Mode A Standalone Account backward compatibility (zero workspace headers needed).
 * 2. Mode B Organization Account activation and workspace creation.
 * 3. Workspace staff isolation (Agent in Alpha cannot access Beta; rejected with 403).
 * 4. Org Admin cross-workspace ("All Projects") oversight vs staff rejection.
 * 5. Cross-tenant workspace anti-tampering (passing foreign workspaceId rejected).
 * 6. Immediate membership revocation effect.
 * 7. Background queue context rehydration (tenantId and workspaceId preserved).
 * 8. SMTP configuration inheritance and workspace overrides.
 * 9. Service catalog creation and public discovery.
 */

const assert = require("assert")
const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const connectDB = require("../db/connection")
const Account = require("../models/Account")
const User = require("../models/User")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const ServiceCatalog = require("../models/ServiceCatalog")
const Lead = require("../models/Lead")
const TenantEmailConfig = require("../models/TenantEmailConfig")
const Job = require("../models/Job")
const queue = require("../services/queueService")
const {
  runWithTenantContext,
  getTenantContext,
  tenantContextMiddleware,
  invalidateAccountWorkspaceModeCache,
} = require("../middleware/tenantContext")

const TEST_PREFIX = `SYNTH_WS_${Date.now()}`
const TENANT_A = `${TEST_PREFIX}_STANDALONE`
const TENANT_B = `${TEST_PREFIX}_ORG`
const TENANT_C = `${TEST_PREFIX}_FOREIGN`

let testPassed = 0
let testFailed = 0

async function runTest(name, fn) {
  try {
    process.stdout.write(`Testing: ${name} ... `)
    await fn()
    console.log("✅ PASS")
    testPassed++
  } catch (err) {
    console.log("❌ FAIL")
    console.error(`  Error: ${err.message}`)
    if (err.stack) console.error(`  Stack: ${err.stack.split("\n")[1]}`)
    testFailed++
  }
}

// Helper to simulate tenantContextMiddleware
function simulateContext(req) {
  return new Promise((resolve) => {
    const res = {
      status(code) {
        this.statusCode = code
        return this
      },
      json(data) {
        this.body = data
        resolve({ status: this.statusCode || 200, body: data, context: req.tenantContext || null })
      },
    }
    tenantContextMiddleware(req, res, () => {
      resolve({ status: 200, context: req.tenantContext || null, body: null })
    })
  })
}

async function main() {
  await connectDB()
  console.log("=== STARTING MULTI-WORKSPACE CORE FOUNDATION TEST SUITE ===")
  if (TenantEmailConfig.ensureUniqueIndexes) {
    await TenantEmailConfig.ensureUniqueIndexes()
  }

  // Synthetic Test Fixtures
  let standaloneAccount, orgAccount, foreignAccount
  let orgAdminUser, agentAlphaUser, agentBetaUser, foreignUser
  let workspaceAlpha, workspaceBeta, foreignWorkspace

  try {
    // ----------------------------------------------------
    // Fixture Setup
    // ----------------------------------------------------
    standaloneAccount = await Account.create({
      accountId: TENANT_A,
      companyName: "Synthetic Standalone Corp",
      displayName: "Standalone Corp",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Standalone Admin",
      adminEmail: `admin_${TENANT_A.toLowerCase()}@test.com`,
      workspaceModeEnabled: false,
      status: "active",
    })

    orgAccount = await Account.create({
      accountId: TENANT_B,
      companyName: "Synthetic Org Corp",
      displayName: "Org Corp",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Org Admin",
      adminEmail: `admin_${TENANT_B.toLowerCase()}@test.com`,
      workspaceModeEnabled: true,
      status: "active",
    })

    foreignAccount = await Account.create({
      accountId: TENANT_C,
      companyName: "Foreign Corp",
      displayName: "Foreign Corp",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Foreign Admin",
      adminEmail: `admin_${TENANT_C.toLowerCase()}@test.com`,
      workspaceModeEnabled: true,
      status: "active",
    })

    orgAdminUser = await User.create({
      tenantId: TENANT_B,
      name: "Org Administrator",
      email: `admin_${TENANT_B.toLowerCase()}@test.com`,
      password: "HashedPassword123!",
      role: "account_admin",
      status: "active",
    })

    agentAlphaUser = await User.create({
      tenantId: TENANT_B,
      name: "Agent Alpha",
      email: `alpha_${TENANT_B.toLowerCase()}@test.com`,
      password: "HashedPassword123!",
      role: "agent",
      status: "active",
    })

    agentBetaUser = await User.create({
      tenantId: TENANT_B,
      name: "Agent Beta",
      email: `beta_${TENANT_B.toLowerCase()}@test.com`,
      password: "HashedPassword123!",
      role: "agent",
      status: "active",
    })

    foreignUser = await User.create({
      tenantId: TENANT_C,
      name: "Foreign User",
      email: `user_${TENANT_C.toLowerCase()}@test.com`,
      password: "HashedPassword123!",
      role: "agent",
      status: "active",
    })

    // Workspaces
    workspaceAlpha = await Workspace.create({
      tenantId: TENANT_B,
      name: "Workspace Alpha",
      slug: "alpha",
      isDefault: true,
      status: "active",
    })

    workspaceBeta = await Workspace.create({
      tenantId: TENANT_B,
      name: "Workspace Beta",
      slug: "beta",
      isDefault: false,
      status: "active",
    })

    foreignWorkspace = await Workspace.create({
      tenantId: TENANT_C,
      name: "Foreign Workspace",
      slug: "foreign",
      isDefault: true,
      status: "active",
    })

    // Assign memberships
    await WorkspaceMembership.create({
      tenantId: TENANT_B,
      workspaceId: workspaceAlpha._id,
      userId: agentAlphaUser._id,
      role: "agent",
      status: "active",
    })

    await WorkspaceMembership.create({
      tenantId: TENANT_B,
      workspaceId: workspaceBeta._id,
      userId: agentBetaUser._id,
      role: "agent",
      status: "active",
    })

    // ----------------------------------------------------
    // Test 1: Mode A Standalone Account Backward Compatibility
    // ----------------------------------------------------
    await runTest("Mode A: Standalone account resolves 'standalone' mode without workspace header", async () => {
      const req = {
        user: { id: standaloneAccount.adminUserId, tenantId: TENANT_A, role: "account_admin" },
        headers: {},
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 200)
      assert.strictEqual(outcome.context.mode, "standalone")
      assert.strictEqual(outcome.context.workspaceId, null)
      assert.strictEqual(outcome.context.tenantId, TENANT_A)
    })

    await runTest("Mode A: Lead creation and query work cleanly with workspaceId null", async () => {
      const standaloneContext = { tenantId: TENANT_A, mode: "standalone", workspaceId: null, isSuperAdmin: false }
      let createdLeadId = null

      await runWithTenantContext(standaloneContext, async () => {
        const lead = new Lead({
          name: "Standalone Customer",
          phone: "+919876543210",
          phoneNormalized: "+919876543210",
          status: "New",
          source: "Website",
        })
        await lead.save()
        createdLeadId = lead._id
        assert.strictEqual(lead.workspaceId, null)
        assert.strictEqual(lead.tenantId, TENANT_A)

        // Query within standalone context
        const found = await Lead.find({})
        assert.strictEqual(found.length, 1)
        assert.strictEqual(found[0].name, "Standalone Customer")
      })
    })

    // ----------------------------------------------------
    // Test 2: Mode B Workspace Staff Isolation
    // ----------------------------------------------------
    await runTest("Mode B: Staff with 1 membership auto-binds to their single workspace when header omitted", async () => {
      const req = {
        user: { id: agentAlphaUser._id, tenantId: TENANT_B, role: "agent" },
        headers: {},
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 200)
      assert.strictEqual(outcome.context.mode, "single_workspace")
      assert.strictEqual(String(outcome.context.workspaceId), String(workspaceAlpha._id))
    })

    await runTest("Mode B: Staff in Alpha creates lead, automatically stamped with Alpha workspaceId", async () => {
      const alphaContext = {
        tenantId: TENANT_B,
        mode: "single_workspace",
        workspaceId: workspaceAlpha._id,
        isSuperAdmin: false,
      }
      await runWithTenantContext(alphaContext, async () => {
        const leadAlpha = new Lead({
          name: "Customer for Alpha",
          phone: "+919111111111",
          phoneNormalized: "+919111111111",
          status: "New",
          source: "Website",
        })
        await leadAlpha.save()
        assert.strictEqual(String(leadAlpha.workspaceId), String(workspaceAlpha._id))
        assert.strictEqual(leadAlpha.tenantId, TENANT_B)
      })
    })

    await runTest("Mode B: Staff in Beta queries leads, cannot see Alpha's lead", async () => {
      const betaContext = {
        tenantId: TENANT_B,
        mode: "single_workspace",
        workspaceId: workspaceBeta._id,
        isSuperAdmin: false,
      }
      await runWithTenantContext(betaContext, async () => {
        // Create Beta lead
        const leadBeta = new Lead({
          name: "Customer for Beta",
          phone: "+919222222222",
          phoneNormalized: "+919222222222",
          status: "New",
          source: "Website",
        })
        await leadBeta.save()

        // Query within Beta context
        const leads = await Lead.find({})
        assert.strictEqual(leads.length, 1)
        assert.strictEqual(leads[0].name, "Customer for Beta")
        assert.strictEqual(String(leads[0].workspaceId), String(workspaceBeta._id))
      })
    })

    await runTest("Mode B: Agent Alpha requesting Beta workspace is rejected with 403 Forbidden", async () => {
      const req = {
        user: { id: agentAlphaUser._id, tenantId: TENANT_B, role: "agent" },
        headers: { "x-workspace-id": workspaceBeta._id.toString() },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 403)
      assert.strictEqual(outcome.body.code, "NOT_A_WORKSPACE_MEMBER")
    })

    // ----------------------------------------------------
    // Test 3: Org Admin Cross-Workspace ("All Projects")
    // ----------------------------------------------------
    await runTest("Mode B: Org Admin requesting 'all' enters authorized_all_workspaces and sees both Alpha and Beta", async () => {
      const req = {
        user: { id: orgAdminUser._id, tenantId: TENANT_B, role: "account_admin" },
        headers: { "x-workspace-id": "all" },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 200)
      assert.strictEqual(outcome.context.mode, "authorized_all_workspaces")
      assert.strictEqual(outcome.context.workspaceId, null)

      await runWithTenantContext(outcome.context, async () => {
        const allLeads = await Lead.find({}).sort({ createdAt: 1 })
        assert.strictEqual(allLeads.length, 2)
        const names = allLeads.map((l) => l.name)
        assert.ok(names.includes("Customer for Alpha"))
        assert.ok(names.includes("Customer for Beta"))
      })
    })

    await runTest("Mode B: Regular Agent requesting 'all' is strictly rejected with 403 Forbidden", async () => {
      const req = {
        user: { id: agentAlphaUser._id, tenantId: TENANT_B, role: "agent" },
        headers: { "x-workspace-id": "all" },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 403)
      assert.strictEqual(outcome.body.code, "CROSS_WORKSPACE_DENIED")
    })

    // ----------------------------------------------------
    // Test 4: Cross-Tenant Anti-Tampering
    // ----------------------------------------------------
    await runTest("Anti-Tampering: User in Tenant B requesting Workspace in Tenant C is rejected with 404", async () => {
      const req = {
        user: { id: orgAdminUser._id, tenantId: TENANT_B, role: "account_admin" },
        headers: { "x-workspace-id": foreignWorkspace._id.toString() },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 404)
      assert.strictEqual(outcome.body.code, "WORKSPACE_NOT_FOUND")
    })

    await runTest("Anti-Tampering: Malformed workspace ID string is rejected with 400 Bad Request", async () => {
      const req = {
        user: { id: orgAdminUser._id, tenantId: TENANT_B, role: "account_admin" },
        headers: { "x-workspace-id": "invalid-non-objectid-123" },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 400)
      assert.strictEqual(outcome.body.code, "INVALID_WORKSPACE_ID")
    })

    // ----------------------------------------------------
    // Test 5: Immediate Membership Revocation
    // ----------------------------------------------------
    await runTest("Revocation: Deleting membership immediately blocks subsequent access", async () => {
      // Agent Beta currently has membership in Beta.
      await WorkspaceMembership.findOneAndDelete({
        tenantId: TENANT_B,
        workspaceId: workspaceBeta._id,
        userId: agentBetaUser._id,
      })

      const req = {
        user: { id: agentBetaUser._id, tenantId: TENANT_B, role: "agent" },
        headers: { "x-workspace-id": workspaceBeta._id.toString() },
      }
      const outcome = await simulateContext(req)
      assert.strictEqual(outcome.status, 403)
      assert.strictEqual(outcome.body.code, "NOT_A_WORKSPACE_MEMBER")
    })

    // ----------------------------------------------------
    // Test 6: Background Queue Context Propagation
    // ----------------------------------------------------
    await runTest("Queue: Background job restores both tenantId and workspaceId ambient context", async () => {
      let handlerRan = false
      let observedTenant = null
      let observedWorkspace = null
      let observedMode = null

      queue.registerHandler("test.workspace_job", async (job, workerContext) => {
        handlerRan = true
        const ambient = getTenantContext()
        observedTenant = ambient?.tenantId
        observedWorkspace = ambient?.workspaceId ? ambient.workspaceId.toString() : null
        observedMode = ambient?.mode
        return { success: true }
      })

      const enqueueResult = await queue.addJob({
        name: "test.workspace_job",
        tenantId: TENANT_B,
        workspaceId: workspaceAlpha._id,
        payload: { testData: 123 },
      })

      assert.strictEqual(enqueueResult.duplicate, false)
      assert.strictEqual(String(enqueueResult.job.workspaceId), String(workspaceAlpha._id))

      // Process job through queueService
      await queue.processJob(enqueueResult.job, "test_worker_1")

      assert.strictEqual(handlerRan, true)
      assert.strictEqual(observedTenant, TENANT_B)
      assert.strictEqual(observedWorkspace, workspaceAlpha._id.toString())
      assert.strictEqual(observedMode, "single_workspace")
    })

    // ----------------------------------------------------
    // Test 7: SMTP Configuration Inheritance & Overrides
    // ----------------------------------------------------
    await runTest("SMTP: Organization default and workspace override can coexist per tenant", async () => {
      // 1. Org-wide default SMTP (workspaceId: null)
      const orgSmtp = await TenantEmailConfig.create({
        tenantId: TENANT_B,
        workspaceId: null,
        isDefault: true,
        smtpHost: "smtp.orgdefault.com",
        senderEmail: "notifications@orgcorp.com",
        isActive: true,
      })
      assert.strictEqual(orgSmtp.workspaceId, null)

      // 2. Workspace Alpha specific override (workspaceId: Alpha._id)
      const alphaSmtp = await TenantEmailConfig.create({
        tenantId: TENANT_B,
        workspaceId: workspaceAlpha._id,
        isDefault: false,
        smtpHost: "smtp.alpha.com",
        senderEmail: "alpha@orgcorp.com",
        isActive: true,
      })
      assert.strictEqual(String(alphaSmtp.workspaceId), String(workspaceAlpha._id))

      // Verify query resolution:
      // Workspace Alpha query finds alphaSmtp
      const foundAlpha = await TenantEmailConfig.findOne({
        tenantId: TENANT_B,
        workspaceId: workspaceAlpha._id,
        isActive: true,
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(foundAlpha.smtpHost, "smtp.alpha.com")

      // Workspace Beta query finds no workspace override, falls back to orgSmtp
      const foundBetaOverride = await TenantEmailConfig.findOne({
        tenantId: TENANT_B,
        workspaceId: workspaceBeta._id,
        isActive: true,
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(foundBetaOverride, null)

      const fallbackSmtp = await TenantEmailConfig.findOne({
        tenantId: TENANT_B,
        workspaceId: null,
        isActive: true,
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(fallbackSmtp.smtpHost, "smtp.orgdefault.com")
    })

    // ----------------------------------------------------
    // Test 8: ServiceCatalog Dynamic Public Discovery
    // ----------------------------------------------------
    await runTest("ServiceCatalog: Public services discoverable with code and targetWorkspaceId", async () => {
      const service = await ServiceCatalog.create({
        tenantId: TENANT_B,
        name: "Residential Real Estate",
        code: "SVC_RESIDENTIAL",
        targetWorkspaceId: workspaceAlpha._id,
        isActive: true,
        displayOrder: 1,
      })

      assert.strictEqual(service.code, "SVC_RESIDENTIAL")
      assert.strictEqual(String(service.targetWorkspaceId), String(workspaceAlpha._id))

      const catalogItems = await ServiceCatalog.find({ tenantId: TENANT_B, isActive: true })
        .sort({ displayOrder: 1 })
        .setOptions({ skipTenantFilter: true })

      assert.strictEqual(catalogItems.length, 1)
      assert.strictEqual(catalogItems[0].name, "Residential Real Estate")
    })
  } finally {
    // ----------------------------------------------------
    // Fixture Cleanup
    // ----------------------------------------------------
    console.log("Cleaning up synthetic test fixtures...")
    await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await Workspace.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await WorkspaceMembership.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await ServiceCatalog.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await TenantEmailConfig.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    await Job.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B, TENANT_C] } })
    invalidateAccountWorkspaceModeCache()
  }

  console.log(`\n=== TEST RESULTS: ${testPassed} Passed, ${testFailed} Failed ===\n`)
  if (testFailed > 0) {
    process.exit(1)
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error("FATAL SUITE ERROR:", err)
    process.exit(1)
  })
