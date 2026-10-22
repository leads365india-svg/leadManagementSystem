const mongoose = require("mongoose")
const dotenv = require("dotenv")
const crypto = require("crypto")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const Lead = require("../models/Lead")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const User = require("../models/User")
const Account = require("../models/Account")

async function runTests() {
  console.log("=== STARTING COMPREHENSIVE LEAD FEEDS & INTEGRATIONS TEST ===")
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log("Connected to MongoDB Atlas")

  try {
    const tenantA = "TEST-TENANT-ALPHA"
    const tenantB = "TEST-TENANT-BETA"

    // Cleanup any existing test data for these tenants
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

    // Create staff users for Tenant A and Tenant B
    const staffUserA = new User({
      name: "Alice Alpha",
      email: "alice.alpha@test.com",
      password: "Password123!",
      role: "account_admin",
      tenantId: tenantA,
      status: "active",
    })
    await staffUserA.save()

    const staffUserB = new User({
      name: "Bob Beta",
      email: "bob.beta@test.com",
      password: "Password123!",
      role: "account_admin",
      tenantId: tenantB,
      status: "active",
    })
    await staffUserB.save()

    // 1. Generate credentials for both tenants
    const rawKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const keyHashA = crypto.createHash("sha256").update(rawKeyA).digest("hex")

    const rawKeyB = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const keyHashB = crypto.createHash("sha256").update(rawKeyB).digest("hex")

    const configA = new LeadFeedConfig({
      tenantId: tenantA,
      websiteSource: {
        enabled: true,
        apiKeyHash: keyHashA,
        apiKeyMasked: `lf_live_••••••••••••••••${rawKeyA.slice(-4)}`,
        assignedStaffId: staffUserA._id.toString(),
        assignedStaffName: staffUserA.name,
        acceptedForms: ["contact_us_form"],
        blockedDomains: ["mailinator.com", "tempmail.com"],
        duplicateHandling: "reject",
        emailVerification: {
          requireVerifiedEmail: false,
          holdUntilConfirmed: false,
          strictVerification: false,
          allowPhoneOnly: true,
        },
      },
    })
    await configA.save()

    const configB = new LeadFeedConfig({
      tenantId: tenantB,
      websiteSource: {
        enabled: true,
        apiKeyHash: keyHashB,
        apiKeyMasked: `lf_live_••••••••••••••••${rawKeyB.slice(-4)}`,
        assignedStaffId: staffUserB._id.toString(),
        assignedStaffName: staffUserB.name,
        acceptedForms: [],
        blockedDomains: ["spammer.org"],
        duplicateHandling: "update",
        emailVerification: {
          requireVerifiedEmail: true,
          holdUntilConfirmed: false,
          strictVerification: false,
          allowPhoneOnly: false,
        },
      },
    })
    await configB.save()

    console.log("✅ [Test 1] Generated separate credentials and configs for Tenant A & Tenant B")

    // Test API via HTTP request against running backend (http://localhost:5000)
    const backendUrl = "http://localhost:5000/api/integrations/leads/website"

    // 2. Submission to Tenant A using rawKeyA
    const resA = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Customer Alpha",
        email: "customer.alpha@example.com",
        phone: "+1 555 123 4567",
        message: "Inquiry for Tenant A",
        formId: "contact_us_form",
      }),
    })
    const dataA = await resA.json()
    console.log(`[Submission to Tenant A] status: ${resA.status}`, dataA.message || dataA.error)
    if (resA.status !== 201) throw new Error("Tenant A lead creation failed")

    // Verify lead is only in Tenant A
    const leadInA = await Lead.findOne({ email: "customer.alpha@example.com", tenantId: tenantA })
    const leadInB = await Lead.findOne({ email: "customer.alpha@example.com", tenantId: tenantB })
    if (!leadInA || leadInB) {
      throw new Error("Tenant isolation violated! Lead found in incorrect partition.")
    }
    console.log("✅ [Test 2] Lead correctly created ONLY in Tenant A, completely isolated from Tenant B")

    // Verify staff assignment on created lead
    if (leadInA.assignedTo !== "Alice Alpha") {
      throw new Error(`Staff assignment failed! Expected 'Alice Alpha', got '${leadInA.assignedTo}'`)
    }
    console.log("✅ [Test 3] Staff assignment verified: lead assigned to 'Alice Alpha'")

    // 3. Test Invalid Credential
    const resInvalidKey = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "lf_live_invalid_bad_key_12345",
      },
      body: JSON.stringify({
        name: "Intruder",
        email: "intruder@example.com",
      }),
    })
    console.log(`[Invalid Key Test] status: ${resInvalidKey.status} (expected 401)`)
    if (resInvalidKey.status !== 401) throw new Error("Invalid key should be rejected with 401")
    console.log("✅ [Test 4] Invalid API key rejected with HTTP 401")

    // 4. Test Disallowed Form on Tenant A
    const resBadForm = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Bad Form User",
        email: "badform@example.com",
        formId: "unauthorized_form_id",
      }),
    })
    console.log(`[Disallowed Form Test] status: ${resBadForm.status} (expected 422)`)
    if (resBadForm.status !== 422) throw new Error("Disallowed form should be rejected with 422")
    console.log("✅ [Test 5] Disallowed form rejected with HTTP 422")

    // 5. Test Blocked Email Domain on Tenant A
    const resBlockedDomain = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Spammer",
        email: "user123@mailinator.com",
        formId: "contact_us_form",
      }),
    })
    console.log(`[Blocked Domain Test] status: ${resBlockedDomain.status} (expected 422)`)
    if (resBlockedDomain.status !== 422) throw new Error("Blocked domain should be rejected with 422")
    console.log("✅ [Test 6] Blocked domain rejected with HTTP 422")

    // 6. Test Duplicate Handling under 'reject' policy (Tenant A)
    const resDupReject = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Customer Alpha Duplicate",
        email: "customer.alpha@example.com",
        formId: "contact_us_form",
      }),
    })
    console.log(`[Duplicate Reject Test] status: ${resDupReject.status} (expected 409)`)
    if (resDupReject.status !== 409) throw new Error("Duplicate lead should be rejected with 409 under reject policy")
    console.log("✅ [Test 7] Duplicate lead rejected with HTTP 409 under 'reject' policy")

    // 7. Test Cross-Tenant same email: Tenant B CAN create lead with SAME email!
    // (Because Tenant B is a completely separate organization)
    const resTenantBSameEmail = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyB,
      },
      body: JSON.stringify({
        name: "Customer Alpha in Tenant B",
        email: "customer.alpha@example.com",
        phone: "+1 555 999 8888",
        verificationToken: (() => {
          const ts = Date.now()
          const sig = crypto.createHmac("sha256", rawKeyB).update(`customer.alpha@example.com:${ts}`).digest("hex")
          return `${ts}:${sig}`
        })(),
      }),
    })
    console.log(`[Tenant B Same Email Test] status: ${resTenantBSameEmail.status} (expected 201)`)
    if (resTenantBSameEmail.status !== 201) throw new Error("Tenant B should be able to create lead with same email")
    console.log("✅ [Test 8] Multi-tenant cross-account isolation: Same email allowed across separate tenants!")

    // 8. Test Duplicate Handling under 'update' policy (Tenant B)
    const resTenantBUpdate = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyB,
      },
      body: JSON.stringify({
        name: "Customer Alpha in Tenant B",
        email: "customer.alpha@example.com",
        message: "Updated inquiry notes from second submission.",
        verificationToken: (() => {
          const ts = Date.now() + 500
          const sig = crypto.createHmac("sha256", rawKeyB).update(`customer.alpha@example.com:${ts}`).digest("hex")
          return `${ts}:${sig}`
        })(),
      }),
    })
    const updateDataB = await resTenantBUpdate.json()
    console.log(`[Duplicate Update Test] status: ${resTenantBUpdate.status} (expected 200)`, updateDataB)
    if (resTenantBUpdate.status !== 200 || !updateDataB.updated) {
      throw new Error("Duplicate lead under 'update' policy should update existing lead with HTTP 200")
    }
    console.log("✅ [Test 9] Duplicate lead updated successfully with HTTP 200 under 'update' policy")

    // 9. Test Disabled Integration (Toggle off Tenant A)
    configA.websiteSource.enabled = false
    await configA.save()

    const resDisabled = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Disabled Submission",
        email: "disabled@example.com",
        formId: "contact_us_form",
      }),
    })
    console.log(`[Disabled Source Test] status: ${resDisabled.status} (expected 403)`)
    if (resDisabled.status !== 403) throw new Error("Disabled source should return 403 Forbidden")
    console.log("✅ [Test 10] Disabled integration rejects incoming leads with HTTP 403")

    // 10. Test Key Rotation (Invalidates old key)
    const newRawKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const newKeyHashA = crypto.createHash("sha256").update(newRawKeyA).digest("hex")

    configA.websiteSource.apiKeyHash = newKeyHashA
    configA.websiteSource.apiKeyMasked = `lf_live_••••••••••••••••${newRawKeyA.slice(-4)}`
    configA.websiteSource.enabled = true
    await configA.save()

    // Old key must now fail
    const resOldKey = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": rawKeyA,
      },
      body: JSON.stringify({
        name: "Old Key Submission",
        email: "oldkey@example.com",
        formId: "contact_us_form",
      }),
    })
    console.log(`[Old Rotated Key Test] status: ${resOldKey.status} (expected 401)`)
    if (resOldKey.status !== 401) throw new Error("Old rotated key should return 401 Unauthorized")

    // New key must succeed
    const resNewKey = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": newRawKeyA,
      },
      body: JSON.stringify({
        name: "New Key Submission",
        email: "newkey@example.com",
        formId: "contact_us_form",
      }),
    })
    console.log(`[New Key Test] status: ${resNewKey.status} (expected 201)`)
    if (resNewKey.status !== 201) throw new Error("New key after rotation should succeed with 201")
    console.log("✅ [Test 11] API key rotation atomically invalidates previous key and activates new key")

    // 11. Test Phone-only Lead
    const resPhoneOnly = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": newRawKeyA,
      },
      body: JSON.stringify({
        name: "Phone Only Customer",
        phone: "+1 800 555 0199",
        formId: "contact_us_form",
      }),
    })
    console.log(`[Phone-only Lead Test] status: ${resPhoneOnly.status} (expected 201)`)
    if (resPhoneOnly.status !== 201) throw new Error("Phone-only lead should succeed when allowed")
    console.log("✅ [Test 12] Phone-only lead successfully created when email is omitted")

    // 12. Test Diagnostic Test Submission (Does not create production lead)
    const countBefore = await Lead.countDocuments({ tenantId: tenantA })
    const resTestSubmission = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": newRawKeyA,
      },
      body: JSON.stringify({
        name: "Diagnostic Test",
        email: "diagnostic@example.com",
        formId: "contact_us_form",
        isTest: true,
      }),
    })
    const countAfter = await Lead.countDocuments({ tenantId: tenantA })
    console.log(`[Test Submission] status: ${resTestSubmission.status}, countBefore: ${countBefore}, countAfter: ${countAfter}`)
    if (countBefore !== countAfter) {
      throw new Error("Diagnostic test lead created fake production record in database!")
    }
    console.log("✅ [Test 13] Diagnostic test lead validated pipeline without polluting CRM production records")

    // Clean up test data
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

    console.log("\n=======================================================")
    console.log("🎉 ALL 13 INTEGRATION TESTS PASSED WITH 100% SUCCESS!")
    console.log("=======================================================")
  } catch (err) {
    console.error("❌ TEST FAILED:", err)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    process.exit(0)
  }
}

runTests()
