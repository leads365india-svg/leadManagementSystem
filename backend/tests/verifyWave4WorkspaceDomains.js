/**
 * Verification Test: Wave 4 — Workspace White-label Domains & Final Integration
 *
 * Verifies:
 * 1. Mode A Standalone account custom domain compatibility (zero regression)
 * 2. Workspace Custom Domain configuration & verification token generation
 * 3. Domain uniqueness conflict rejection (duplicate hostname across workspaces/tenants)
 * 4. DNS TXT verification & cache invalidation
 * 5. White-label login & branding on first server response (/api/auth/branding & /api/auth/tenant-info)
 * 6. Domain-bound workspace context & anti-spoofing header rejection (403 DOMAIN_WORKSPACE_CONFLICT)
 * 7. Cross-tenant & cross-workspace session isolation (403 CROSS_TENANT_SESSION_MISMATCH)
 * 8. Multi-workspace mode disable safety guards:
 *    - Multiple active workspaces -> 409 CANNOT_DISABLE_MULTI_WORKSPACE_MULTIPLE_ACTIVE
 *    - Active workspace custom domain -> 409 CANNOT_DISABLE_MULTI_WORKSPACE_ACTIVE_DOMAINS
 *    - Partitioned CRM data -> 409 CANNOT_DISABLE_MULTI_WORKSPACE_PARTITIONED_DATA
 *    - Safe consolidation & disable -> 200 Success
 * 9. Workspace domain removal API (DELETE /api/workspaces/:wsId/domain)
 * 10. Complete synthetic data cleanup
 */

const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

process.env.NODE_ENV = "test"
const app = require("../start")
const request = require("supertest")(app)

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/leadflow"
const JWT_SECRET = process.env.JWT_SECRET || "leadflow_secret_key"

// Models
const Account = require("../models/Account")
const User = require("../models/User")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const DomainMapping = require("../models/DomainMapping")
const Lead = require("../models/Lead")
const { invalidateCustomDomainCache } = require("../utils/customDomainCache")
const { invalidateAccountWorkspaceModeCache } = require("../middleware/tenantContext")

let createdTenantIds = []
let createdUserIds = []
let createdWorkspaceIds = []
let createdMappingIds = []
let createdLeadIds = []

const makeToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      userId: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )
}

async function runTests() {
  console.log("=== WAVE 4: WORKSPACE WHITE-LABEL DOMAINS & FINAL INTEGRATION VERIFICATION ===")

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI)
  }

  const prefix = `SYNTH_W4_${Date.now()}`
  const standaloneTenantId = `${prefix}_STANDALONE`
  const multiTenantId = `${prefix}_MULTI`
  const foreignTenantId = `${prefix}_FOREIGN`
  createdTenantIds.push(standaloneTenantId, multiTenantId, foreignTenantId)

  let passed = 0
  let failed = 0

  const assert = (condition, msg) => {
    if (condition) {
      console.log(`  [PASS] ${msg}`)
      passed++
    } else {
      console.error(`  [FAIL] ${msg}`)
      failed++
    }
  }

  try {
    // -------------------------------------------------------------
    // 1. SETUP STANDALONE ACCOUNT WITH CUSTOM DOMAIN (MODE A)
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 1: MODE A STANDALONE ACCOUNT CUSTOM DOMAIN ---")
    const cleanPrefix = prefix.toLowerCase().replace(/_/g, "-")
    const standaloneDomain = `${cleanPrefix}-standalone.leads365.test`

    const standaloneAdmin = await User.create({
      tenantId: standaloneTenantId,
      name: "Standalone Admin",
      email: `${prefix}_admin@standalone.com`,
      role: "account_admin",
      status: "active",
      password: "hashedpassword123",
    })
    createdUserIds.push(standaloneAdmin._id)

    const standaloneAccount = await Account.create({
      accountId: standaloneTenantId,
      companyName: "Standalone Corp",
      displayName: "Standalone Corp",
      adminEmail: standaloneAdmin.email,
      adminName: standaloneAdmin.name,
      adminUserId: standaloneAdmin._id,
      workspaceModeEnabled: false,
      customDomain: standaloneDomain,
      logoUrl: "https://standalone.com/logo.png",
      primaryColor: "#059669",
      isCustomDomainActive: true,
      status: "active",
    })

    invalidateCustomDomainCache()

    // Test 1.1: Standalone public branding returns standalone account branding
    const standaloneBrandingRes = await request
      .get(`/api/auth/branding?domain=${standaloneDomain}`)
      .set("Host", standaloneDomain)

    assert(standaloneBrandingRes.status === 200, "Standalone custom domain returns HTTP 200 on branding")
    assert(
      standaloneBrandingRes.body?.data?.companyName === "Standalone Corp",
      "Standalone branding returns correct companyName"
    )
    assert(
      standaloneBrandingRes.body?.data?.brandPrimaryColor === "#059669",
      "Standalone branding returns correct primaryColor"
    )
    assert(
      !standaloneBrandingRes.body?.data?.isWorkspaceDomain,
      "Standalone domain is NOT flagged as workspace domain"
    )

    // -------------------------------------------------------------
    // 2. SETUP MULTI-WORKSPACE TENANT (MODE B)
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 2: MULTI-WORKSPACE SETUP & DOMAIN CONFIGURATION ---")
    const multiParentDomain = `${cleanPrefix}-parent.leads365.test`
    const ws1Domain = `${cleanPrefix}-realty.leads365.test`

    const orgAdmin = await User.create({
      tenantId: multiTenantId,
      name: "Org Admin",
      email: `${prefix}_orgadmin@multi.com`,
      role: "account_admin",
      status: "active",
      password: "hashedpassword123",
    })
    const orgAdminToken = makeToken(orgAdmin)
    createdUserIds.push(orgAdmin._id)

    const staffA = await User.create({
      tenantId: multiTenantId,
      name: "Staff Alice (Realty)",
      email: `${prefix}_alice@multi.com`,
      role: "agent",
      status: "active",
      password: "hashedpassword123",
    })
    const staffAToken = makeToken(staffA)
    createdUserIds.push(staffA._id)

    const staffB = await User.create({
      tenantId: multiTenantId,
      name: "Staff Bob (Leasing)",
      email: `${prefix}_bob@multi.com`,
      role: "agent",
      status: "active",
      password: "hashedpassword123",
    })
    const staffBToken = makeToken(staffB)
    createdUserIds.push(staffB._id)

    const foreignUser = await User.create({
      tenantId: foreignTenantId,
      name: "Foreign Staff",
      email: `${prefix}_foreign@foreign.com`,
      role: "agent",
      status: "active",
      password: "hashedpassword123",
    })
    const foreignToken = makeToken(foreignUser)
    createdUserIds.push(foreignUser._id)

    const superAdmin = await User.create({
      tenantId: null,
      name: "Platform Super Admin",
      email: `${prefix}_superadmin@platform.com`,
      role: "super_admin",
      status: "active",
      password: "hashedpassword123",
    })
    const superAdminToken = makeToken(superAdmin)
    createdUserIds.push(superAdmin._id)

    const multiAccount = await Account.create({
      accountId: multiTenantId,
      companyName: "Apex Holdings",
      displayName: "Apex Holdings",
      adminEmail: orgAdmin.email,
      adminName: orgAdmin.name,
      adminUserId: orgAdmin._id,
      workspaceModeEnabled: true,
      customDomain: multiParentDomain,
      isCustomDomainActive: true,
      primaryColor: "#4f46e5",
      status: "active",
    })

    const foreignAccount = await Account.create({
      accountId: foreignTenantId,
      companyName: "Foreign Corp",
      displayName: "Foreign Corp",
      adminEmail: foreignUser.email,
      adminName: foreignUser.name,
      adminUserId: foreignUser._id,
      workspaceModeEnabled: false,
      status: "active",
    })

    // Create Workspaces
    const wsDefault = await Workspace.create({
      tenantId: multiTenantId,
      name: "Corporate Default",
      slug: `${prefix.toLowerCase()}-default`,
      isDefault: true,
      status: "active",
    })
    createdWorkspaceIds.push(wsDefault._id)

    const wsRealty = await Workspace.create({
      tenantId: multiTenantId,
      name: "Apex Luxury Realty",
      slug: `${prefix.toLowerCase()}-realty`,
      description: "Luxury Residential Properties",
      isDefault: false,
      status: "active",
      branding: {
        displayName: "Apex Luxury Realty",
        primaryColor: "#d97706",
      },
    })
    const wsRealtyId = wsRealty._id
    createdWorkspaceIds.push(wsRealtyId)

    const wsLeasing = await Workspace.create({
      tenantId: multiTenantId,
      name: "Apex Commercial Leasing",
      slug: `${prefix.toLowerCase()}-leasing`,
      description: "Commercial Offices & Retails",
      isDefault: false,
      status: "active",
      branding: {
        displayName: "Apex Commercial Leasing",
        primaryColor: "#2563eb",
      },
    })
    const wsLeasingId = wsLeasing._id
    createdWorkspaceIds.push(wsLeasingId)

    // Assign memberships
    await WorkspaceMembership.create([
      {
        tenantId: multiTenantId,
        workspaceId: wsRealtyId,
        userId: staffA._id,
        role: "agent",
        status: "active",
      },
      {
        tenantId: multiTenantId,
        workspaceId: wsLeasingId,
        userId: staffB._id,
        role: "agent",
        status: "active",
      },
    ])

    // Test 2.1: Non-admin staff attempting to set custom domain rejected with 403
    const staffSetDomainRes = await request
      .post(`/api/workspaces/${wsRealtyId}/domain`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ domain: ws1Domain })

    assert(staffSetDomainRes.status === 403, "Staff cannot configure workspace custom domain (HTTP 403)")
    assert(staffSetDomainRes.body?.code === "PERMISSION_DENIED", "Error code is PERMISSION_DENIED")

    // Test 2.2: Org Admin successfully configures custom domain for wsRealty
    const adminSetDomainRes = await request
      .post(`/api/workspaces/${wsRealtyId}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ domain: ws1Domain })

    assert(adminSetDomainRes.status === 200, "Org Admin successfully configured workspace domain (HTTP 200)")
    assert(adminSetDomainRes.body?.data?.domain === ws1Domain, "Domain returned matches configured hostname")
    assert(
      adminSetDomainRes.body?.data?.status === "pending_verification",
      "Status is pending_verification before DNS check"
    )
    assert(
      Boolean(adminSetDomainRes.body?.data?.verificationToken),
      "Verification token generated"
    )
    assert(
      Boolean(adminSetDomainRes.body?.data?.dnsInstructions?.host),
      "DNS verification instructions returned"
    )

    // -------------------------------------------------------------
    // 3. GLOBAL DOMAIN UNIQUENESS ENFORCEMENT (BIDIRECTIONAL)
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 3: GLOBAL DOMAIN UNIQUENESS (BIDIRECTIONAL) ---")
    // Test 3.1: Attempt to map same domain to wsLeasing
    const duplicateWsRes = await request
      .post(`/api/workspaces/${wsLeasingId}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ domain: ws1Domain })

    assert(duplicateWsRes.status === 409, "Duplicate domain in another workspace rejected with HTTP 409")
    assert(duplicateWsRes.body?.code === "DOMAIN_ALREADY_MAPPED", "Error code is DOMAIN_ALREADY_MAPPED")

    // Test 3.2: Direction 1 - Attempt to map existing standalone account domain to workspace
    const standaloneDupRes = await request
      .post(`/api/workspaces/${wsDefault._id}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ domain: standaloneDomain })

    assert(standaloneDupRes.status === 409, "Workspace claiming standalone Account domain rejected with HTTP 409")
    assert(standaloneDupRes.body?.code === "DOMAIN_ALREADY_MAPPED", "Error code is DOMAIN_ALREADY_MAPPED")

    // Test 3.3: Direction 1 - Attempt to map parent account's own domain to workspace
    const parentDupRes = await request
      .post(`/api/workspaces/${wsDefault._id}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ domain: multiParentDomain })

    assert(parentDupRes.status === 409, "Workspace claiming parent Account domain rejected with HTTP 409")
    assert(parentDupRes.body?.code === "DOMAIN_ALREADY_MAPPED", "Error code is DOMAIN_ALREADY_MAPPED")

    // Test 3.4: Direction 2 - Attempt to claim existing Workspace domain on new Account
    const accountClaimWsDomainRes = await request
      .post("/api/super-admin/accounts")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        companyName: "Hijack Corp",
        displayName: "Hijack Corp",
        adminName: "Hijacker",
        adminEmail: `${prefix}_hijack@test.com`,
        password: "Password123!",
        customDomain: ws1Domain,
      })

    assert(accountClaimWsDomainRes.status === 400, "Account claiming existing Workspace domain rejected with HTTP 400")
    assert(accountClaimWsDomainRes.body?.code === "DOMAIN_ALREADY_MAPPED", "Error code is DOMAIN_ALREADY_MAPPED")

    // Test 3.5: Accuracy of DNS TXT & CNAME Hosting instructions
    const dnsInst = adminSetDomainRes.body?.data?.dnsInstructions
    assert(dnsInst?.recordType === "TXT", "DNS instructions specify recordType: 'TXT'")
    assert(dnsInst?.host === `_leads365-challenge.${ws1Domain}`, "DNS instructions specify challenge host")
    assert(dnsInst?.cnameTarget === (process.env.CNAME_TARGET || "cname.vercel-dns.com"), "DNS instructions specify Vercel CNAME target")
    assert(adminSetDomainRes.body?.data?.status === "pending_verification", "Domain initially reports pending_verification (does not claim live activation prematurely)")

    // -------------------------------------------------------------
    // 4. DNS VERIFICATION & CACHE INVALIDATION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 4: DNS VERIFICATION & CACHE ACTIVATION ---")
    const verifyRes = await request
      .post(`/api/workspaces/${wsRealtyId}/domain/verify`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ bypassDns: true })

    assert(verifyRes.status === 200, "Workspace custom domain verified successfully with HTTP 200")
    assert(verifyRes.body?.data?.status === "verified", "Domain status updated to 'verified'")

    const realtyWsDoc = await Workspace.findById(wsRealtyId).lean()
    assert(realtyWsDoc.domainStatus === "verified", "Workspace model domainStatus persisted as 'verified'")
    assert(realtyWsDoc.customDomain === ws1Domain, "Workspace model customDomain persisted")

    // -------------------------------------------------------------
    // 5. WHITE-LABEL LOGIN & BRANDING RESOLUTION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 5: FIRST RESPONSE WHITE-LABEL BRANDING ---")
    // Test 5.1: Request to /api/auth/branding on workspace domain
    const wsBrandingRes = await request
      .get(`/api/auth/branding?domain=${ws1Domain}`)
      .set("Host", ws1Domain)

    assert(wsBrandingRes.status === 200, "Workspace domain branding returns HTTP 200")
    assert(wsBrandingRes.body?.data?.isWorkspaceDomain === true, "Branding marked as isWorkspaceDomain: true")
    assert(
      wsBrandingRes.body?.data?.workspaceId?.toString() === wsRealtyId.toString(),
      "Branding bound to correct workspaceId"
    )
    assert(
      wsBrandingRes.body?.data?.companyName === "Apex Luxury Realty",
      "Branding companyName reflects child workspace displayName"
    )
    assert(
      wsBrandingRes.body?.data?.brandPrimaryColor === "#d97706",
      "Branding brandPrimaryColor reflects child workspace primaryColor (#d97706)"
    )

    // Test 5.2: Request to /api/auth/tenant-info on workspace domain
    const wsTenantInfoRes = await request
      .get(`/api/auth/tenant-info?domain=${ws1Domain}`)
      .set("Host", ws1Domain)

    assert(wsTenantInfoRes.status === 200, "Workspace domain tenant-info returns HTTP 200")
    assert(wsTenantInfoRes.body?.data?.isWorkspaceDomain === true, "Tenant-info marked as isWorkspaceDomain: true")
    assert(
      wsTenantInfoRes.body?.data?.workspaceId?.toString() === wsRealtyId.toString(),
      "Tenant-info reports correct workspaceId"
    )

    // Test 5.3: Request to /api/auth/branding on parent domain returns parent organization branding
    const parentBrandingRes = await request
      .get(`/api/auth/branding?domain=${multiParentDomain}`)
      .set("Host", multiParentDomain)

    assert(parentBrandingRes.status === 200, "Parent domain branding returns HTTP 200")
    assert(
      parentBrandingRes.body?.data?.companyName === "Apex Holdings",
      "Parent branding reflects parent companyName"
    )
    assert(
      !parentBrandingRes.body?.data?.isWorkspaceDomain,
      "Parent domain is NOT flagged as workspace domain"
    )

    // -------------------------------------------------------------
    // 6. DOMAIN-BOUND WORKSPACE CONTEXT & ANTI-SPOOFING
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 6: ANTI-SPOOFING & CONTEXT LOCKING ---")
    // Test 6.1: Staff A accesses API on workspace domain with NO header -> Context locked to wsRealty
    const cleanStaffReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${staffAToken}`)
      .set("Host", ws1Domain)

    assert(cleanStaffReq.status === 200, "Staff A on dedicated workspace domain succeeds with HTTP 200")

    // Test 6.2: Staff A accesses API on workspace domain with CONFLICTING header x-workspace-id
    const spoofHeaderReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${staffAToken}`)
      .set("Host", ws1Domain)
      .set("x-workspace-id", wsLeasingId.toString())

    assert(
      spoofHeaderReq.status === 403,
      "Request on workspace domain with conflicting x-workspace-id rejected with HTTP 403"
    )
    assert(
      spoofHeaderReq.body?.code === "DOMAIN_WORKSPACE_CONFLICT",
      "Rejection code is DOMAIN_WORKSPACE_CONFLICT"
    )

    // Test 6.3: Client sends 'all' header on dedicated workspace domain -> Rejected
    const spoofAllReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .set("Host", ws1Domain)
      .set("x-workspace-id", "all")

    assert(
      spoofAllReq.status === 403,
      "Request on workspace domain with 'all' header rejected with HTTP 403"
    )
    assert(
      spoofAllReq.body?.code === "DOMAIN_WORKSPACE_CONFLICT",
      "Rejection code is DOMAIN_WORKSPACE_CONFLICT"
    )

    // -------------------------------------------------------------
    // 7. CROSS-TENANT & CROSS-WORKSPACE SESSION ISOLATION
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 7: SESSION BOUNDARY ISOLATION ---")
    // Test 7.1: Foreign staff from another tenant accessing workspace domain -> 403 CROSS_TENANT_SESSION_MISMATCH
    const foreignReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${foreignToken}`)
      .set("Host", ws1Domain)

    assert(
      foreignReq.status === 403,
      "Foreign tenant user accessing workspace domain rejected with HTTP 403"
    )
    assert(
      foreignReq.body?.code === "CROSS_TENANT_SESSION_MISMATCH",
      "Error code is CROSS_TENANT_SESSION_MISMATCH"
    )

    // Test 7.2: Staff B (assigned ONLY to Leasing) accessing Realty domain -> 403 CROSS_TENANT_SESSION_MISMATCH
    const staffBMismatchReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${staffBToken}`)
      .set("Host", ws1Domain)

    assert(
      staffBMismatchReq.status === 403,
      "Staff B accessing unauthorized workspace domain rejected with HTTP 403"
    )
    assert(
      staffBMismatchReq.body?.code === "CROSS_TENANT_SESSION_MISMATCH",
      "Error code is CROSS_TENANT_SESSION_MISMATCH"
    )

    // Test 7.3: Org Admin accessing Realty domain -> Allowed (Org Admin has org-wide privileges)
    const orgAdminOnWsDomainReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .set("Host", ws1Domain)

    assert(
      orgAdminOnWsDomainReq.status === 200,
      "Org Admin on workspace domain allowed with HTTP 200"
    )

    // Test 7.4: Platform Super Admin accessing child workspace domain in read-only support mode -> Allowed (200 OK)
    const superAdminReadReq = await request
      .get("/api/leads")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("Host", ws1Domain)
      .set("x-tenant-id", multiTenantId)

    assert(
      superAdminReadReq.status === 200,
      "Super Admin allowed read-only inspection on child workspace domain (HTTP 200)"
    )

    // Test 7.5: Platform Super Admin attempting write mutation on child workspace domain -> Strictly rejected (403)
    const superAdminWriteOnWsDomainReq = await request
      .post("/api/leads")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("Host", ws1Domain)
      .set("x-tenant-id", multiTenantId)
      .send({
        name: "SuperAdmin Unauthorized Lead",
        phone: "+919999999999",
      })

    assert(
      superAdminWriteOnWsDomainReq.status === 403,
      "Child workspace domain strictly blocks Super Admin write operations (HTTP 403)"
    )
    assert(
      superAdminWriteOnWsDomainReq.body?.code === "SUPERADMIN_READONLY_SUPPORT_MODE",
      "Rejection code is SUPERADMIN_READONLY_SUPPORT_MODE"
    )

    // Test 7.6: Platform Super Admin attempting workspace domain configuration -> Rejected (403)
    const superAdminDomainConfigReq = await request
      .post(`/api/workspaces/${wsRealtyId}/domain`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("x-tenant-id", multiTenantId)
      .send({ domain: "test-superadmin-config.com" })

    assert(
      superAdminDomainConfigReq.status === 403,
      "Super Admin prevented from configuring workspace domains (HTTP 403)"
    )

    // Test 7.7: Platform Super Admin attempting workspace mode toggle -> Rejected (403)
    const superAdminToggleReq = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .set("x-tenant-id", multiTenantId)
      .send({ enabled: false })

    assert(
      superAdminToggleReq.status === 403,
      "Super Admin prevented from toggling workspace mode (HTTP 403)"
    )

    // -------------------------------------------------------------
    // 8. MULTI-WORKSPACE MODE DISABLE SAFETY GUARDS
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 8: MODE DISABLE SAFETY GUARDS ---")
    // Test 8.1: Attempt to disable mode when multiple active workspaces exist
    const disableFailActiveWsRes = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ enabled: false })

    assert(
      disableFailActiveWsRes.status === 409,
      "Disabling multi-workspace mode with multiple active workspaces rejected with HTTP 409"
    )
    assert(
      disableFailActiveWsRes.body?.code === "CANNOT_DISABLE_MULTI_WORKSPACE_MULTIPLE_ACTIVE",
      "Error code is CANNOT_DISABLE_MULTI_WORKSPACE_MULTIPLE_ACTIVE"
    )

    // Inactivate Leasing and Realty workspaces
    await Workspace.findByIdAndUpdate(wsLeasingId, { status: "inactive" })
    await Workspace.findByIdAndUpdate(wsRealtyId, { status: "inactive" })

    // Test 8.2: Attempt to disable mode when active workspace custom domain exists
    const disableFailDomainsRes = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ enabled: false })

    assert(
      disableFailDomainsRes.status === 409,
      "Disabling mode with active workspace domain rejected with HTTP 409"
    )
    assert(
      disableFailDomainsRes.body?.code === "CANNOT_DISABLE_MULTI_WORKSPACE_ACTIVE_DOMAINS",
      "Error code is CANNOT_DISABLE_MULTI_WORKSPACE_ACTIVE_DOMAINS"
    )

    // Delete domain mapping
    await DomainMapping.deleteMany({ tenantId: multiTenantId, targetType: "WORKSPACE" })
    await Workspace.findByIdAndUpdate(wsRealtyId, { customDomain: null, domainStatus: "unconfigured" })
    invalidateCustomDomainCache()

    // Test 8.3: Attempt to disable mode when partitioned leads exist in other workspaces
    const synthLead1 = await Lead.create({
      tenantId: multiTenantId,
      workspaceId: wsRealtyId,
      name: "Luxury Lead 1",
      phone: "+919876500001",
      status: "New",
    })
    const synthLead2 = await Lead.create({
      tenantId: multiTenantId,
      workspaceId: wsDefault._id,
      name: "Corporate Lead 2",
      phone: "+919876500002",
      status: "New",
    })
    createdLeadIds.push(synthLead1._id, synthLead2._id)

    const disableFailDataRes = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ enabled: false })

    assert(
      disableFailDataRes.status === 409,
      "Disabling mode with partitioned CRM data rejected with HTTP 409"
    )
    assert(
      disableFailDataRes.body?.code === "CANNOT_DISABLE_MULTI_WORKSPACE_PARTITIONED_DATA",
      "Error code is CANNOT_DISABLE_MULTI_WORKSPACE_PARTITIONED_DATA"
    )

    // Consolidate lead into default workspace
    await Lead.findByIdAndUpdate(synthLead1._id, { workspaceId: wsDefault._id })

    // Test 8.4: Successfully disable multi-workspace mode after consolidation
    const disableSuccessRes = await request
      .post("/api/workspaces/mode/toggle")
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ enabled: false })

    assert(
      disableSuccessRes.status === 200,
      "Successfully disabled multi-workspace mode after consolidating data (HTTP 200)"
    )
    assert(
      disableSuccessRes.body?.workspaceModeEnabled === false,
      "Account workspaceModeEnabled persisted as false"
    )

    // -------------------------------------------------------------
    // 9. WORKSPACE DOMAIN REMOVAL API
    // -------------------------------------------------------------
    console.log("\n--- TEST SUITE 9: DOMAIN REMOVAL API ---")
    // Re-enable mode and add a domain to test clean removal API
    await Account.findOneAndUpdate({ accountId: multiTenantId }, { workspaceModeEnabled: true })
    invalidateAccountWorkspaceModeCache()

    await request
      .post(`/api/workspaces/${wsDefault._id}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)
      .send({ domain: `${cleanPrefix}-remove.leads365.test` })

    const removeDomainRes = await request
      .delete(`/api/workspaces/${wsDefault._id}/domain`)
      .set("Authorization", `Bearer ${orgAdminToken}`)

    assert(removeDomainRes.status === 200, "DELETE workspace domain returns HTTP 200")
    assert(removeDomainRes.body?.success === true, "Workspace domain removed successfully")

    const removedDomainMapping = await DomainMapping.findOne({
      tenantId: multiTenantId,
      targetId: wsDefault._id,
    }).setOptions({ skipTenantFilter: true })

    assert(!removedDomainMapping, "DomainMapping record deleted from database")

  } catch (err) {
    console.error("Test execution exception:", err)
    failed++
  } finally {
    // -------------------------------------------------------------
    // 10. CLEANUP SYNTHETIC TEST FIXTURES
    // -------------------------------------------------------------
    console.log("\n--- CLEANUP SYNTHETIC FIXTURES ---")
    await Promise.all([
      Account.deleteMany({ accountId: { $in: createdTenantIds } }),
      User.deleteMany({ tenantId: { $in: createdTenantIds } }),
      Workspace.deleteMany({ tenantId: { $in: createdTenantIds } }),
      WorkspaceMembership.deleteMany({ tenantId: { $in: createdTenantIds } }),
      DomainMapping.deleteMany({ tenantId: { $in: createdTenantIds } }),
      Lead.deleteMany({ tenantId: { $in: createdTenantIds } }),
    ])
    invalidateCustomDomainCache()
    invalidateAccountWorkspaceModeCache()
    console.log("Synthetic fixtures cleanly removed.")

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`)
    process.exit(failed > 0 ? 1 : 0)
  }
}

runTests()
