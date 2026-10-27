const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const cryptoUtils = require("../utils/cryptoUtils")
const { Integration, ALLOWED_INTEGRATION_TYPES } = require("../models/Integration")
const { LeadSource, DEFAULT_CANONICAL_SOURCES, seedDefaultSources, normalizeSource } = require("../models/LeadSource")
const { IntegrationEvent, deepSanitizePayload } = require("../models/IntegrationEvent")
const LeadFeedConfig = require("../models/LeadFeedConfig")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
const Job = require("../models/Job")
const DeadLetterJob = require("../models/DeadLetterJob")
const queue = require("../services/queueService")
const { registerAllHandlers } = require("../jobs/index")
const integrationService = require("../services/integrationService")
const { runWithTenantContext } = require("../middleware/tenantContext")

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 11: INTEGRATION CORE & SOURCE REGISTRY - VERIFICATION SUITE       ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not configured in environment")
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log("Connected to MongoDB Atlas\n")

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`)
      passed++
    } else {
      console.error(`  [FAIL] ${message}`)
      failed++
    }
  }

  const tenantA = "TEST-TENANT-P11-ALPHA"
  const tenantB = "TEST-TENANT-P11-BETA"

  try {
    // Register background job handlers
    registerAllHandlers()

    // Clean up test data
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      LeadSource.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      Job.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      DeadLetterJob.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
    ])

    // Create staff users first
    const staffA = await User.create({
      tenantId: tenantA,
      name: "Alice Agent",
      email: "alice.agent@alpha.test",
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    const staffB = await User.create({
      tenantId: tenantB,
      name: "Bob Agent",
      email: "bob.agent@beta.test",
      password: "Password123!",
      role: "account_admin",
      status: "active",
    })

    // Create active accounts with required admin references
    await Account.create([
      {
        accountId: tenantA,
        companyName: "Alpha Corp",
        displayName: "Alpha Corp",
        adminUserId: staffA._id,
        adminName: staffA.name,
        adminEmail: staffA.email,
        status: "active",
      },
      {
        accountId: tenantB,
        companyName: "Beta Corp",
        displayName: "Beta Corp",
        adminUserId: staffB._id,
        adminName: staffB.name,
        adminEmail: staffB.email,
        status: "active",
      },
    ])

    console.log("--------------------------------------------------------------------------------")
    console.log("TEST 1: Secure AES-256-GCM Encryption Utilities & Fail-Closed Behavior")
    console.log("--------------------------------------------------------------------------------")
    {
      // 1. String encryption & decryption
      const plainStr = "super_secret_meta_page_access_token_2026"
      const encStr = cryptoUtils.encrypt(plainStr)
      assert(encStr.serialized && encStr.serialized.startsWith("v1:s:"), "Serialized string format includes v1 text prefix")
      const decStr = cryptoUtils.decrypt(encStr.serialized)
      assert(decStr === plainStr, "Decrypted string matches original plaintext exactly")

      // 2. Object serialization & decryption
      const credsObj = { apiKey: "imart_api_999", secret: "xyz_token", client: 42 }
      const encObj = cryptoUtils.encrypt(credsObj)
      assert(encObj.serialized.startsWith("v1:j:"), "Serialized object format includes v1 JSON prefix")
      const decObj = cryptoUtils.decrypt(encObj.serialized)
      assert(decObj.apiKey === "imart_api_999" && decObj.client === 42, "Decrypted object attributes match original")

      // 3. Tamper detection (GCM auth tag verification)
      let tamperDetected = false
      try {
        const tampered = encStr.serialized.slice(0, -4) + "0000"
        cryptoUtils.decrypt(tampered)
      } catch (e) {
        tamperDetected = e.message.includes("tampered") || e.message.includes("failed")
      }
      assert(tamperDetected, "Ciphertext tampering or auth-tag alteration correctly rejected with explicit error")

      // 4. Secret masking
      const maskedLive = cryptoUtils.maskSecret("lf_live_0123456789abcdef1234567890abcdef12345678")
      assert(maskedLive === "lf_live_••••••••••••••••5678", "Live API key masking keeps prefix and trailing 4 characters")

      // 5. Secure API Key Generation & Constant-Time Hashing
      const key1 = cryptoUtils.generateApiKey()
      const key2 = cryptoUtils.generateApiKey()
      assert(key1.startsWith("lf_live_") && key1.length === 56, "Generated API key has correct prefix and 48-char random hex")
      assert(key1 !== key2, "API keys generated with cryptographically strong entropy are unique")

      const hash1 = cryptoUtils.hashApiKey(key1)
      const hash2 = cryptoUtils.hashApiKey(key1)
      assert(hash1 === hash2 && hash1.length === 64, "Consistent SHA-256 hash output produced for constant-time lookup")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 2: Multi-Tenant Integration Model & Encrypted Credentials")
    console.log("--------------------------------------------------------------------------------")
    {
      const rawMetaKey = cryptoUtils.generateApiKey()
      const integrationA = new Integration({
        tenantId: tenantA,
        name: "Tenant A Facebook Lead Form",
        type: "meta",
        status: "active",
        apiKeyHash: cryptoUtils.hashApiKey(rawMetaKey),
        apiKeyMasked: cryptoUtils.maskSecret(rawMetaKey),
        assignedStaffId: staffA._id.toString(),
        assignedStaffName: staffA.name,
        settings: {
          duplicateHandling: "update",
          acceptedForms: ["lead_form_alpha"],
        },
      })

      // Encrypt sensitive Meta credentials
      integrationA.setCredentials({
        pageAccessToken: "EAABxxxxxx_long_lived_token",
        appSecret: "app_secret_abc123",
      })
      await integrationA.save()

      assert(integrationA._id, "Integration document saved successfully")
      assert(integrationA.credentials && integrationA.credentials.encryptedData, "Credentials stored in encrypted GCM format")

      // Verify toJSON never exposes credentials or apiKeyHash
      const jsonOutput = integrationA.toJSON()
      assert(jsonOutput.credentials === undefined, "Encrypted credentials stripped from toJSON output")
      assert(jsonOutput.apiKeyHash === undefined, "apiKeyHash stripped from toJSON output")

      // Decrypt credentials safely via instance method
      const decryptedCreds = integrationA.getDecryptedCredentials()
      assert(
        decryptedCreds.pageAccessToken === "EAABxxxxxx_long_lived_token" &&
        decryptedCreds.appSecret === "app_secret_abc123",
        "Instance method getDecryptedCredentials() safely recovers plaintext credentials"
      )

      // Verify tenant isolation
      await runWithTenantContext({ tenantId: tenantB }, async () => {
        const foundInB = await Integration.findOne({ _id: integrationA._id })
        assert(!foundInB, "Tenant B cannot query or access Tenant A's integration (multi-tenant boundary verified)")
      })
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 3: Canonical Lead Source Registry & Normalization Service")
    console.log("--------------------------------------------------------------------------------")
    {
      // Seed default sources for Tenant A
      const sourcesA = await seedDefaultSources(tenantA)
      assert(sourcesA.length === DEFAULT_CANONICAL_SOURCES.length, "Default canonical sources seeded cleanly for Tenant A")

      // Idempotency: re-seeding does not duplicate sources
      const reseedeA = await seedDefaultSources(tenantA)
      assert(reseedeA.length === DEFAULT_CANONICAL_SOURCES.length, "Source seeding is idempotent; zero duplicates created")

      // Normalization tests
      const normInsta = await normalizeSource(tenantA, "insta")
      const normIG = await normalizeSource(tenantA, "IG")
      const normIgAd = await normalizeSource(tenantA, "instagram_ad")
      assert(normInsta === "Instagram" && normIG === "Instagram" && normIgAd === "Instagram", "Instagram aliases normalized to 'Instagram'")

      const normFb = await normalizeSource(tenantA, "fb")
      const normFbLead = await normalizeSource(tenantA, "facebook_lead_ad")
      assert(normFb === "Facebook" && normFbLead === "Facebook", "Facebook aliases normalized to 'Facebook'")

      const normGoogle = await normalizeSource(tenantA, "adwords")
      assert(normGoogle === "Google Ads", "Google Ads aliases normalized to 'Google Ads'")

      const normImart = await normalizeSource(tenantA, "imart")
      assert(normImart === "IndiaMART", "IndiaMART aliases normalized to 'IndiaMART'")

      // Legitimate custom source preservation
      const normCustom = await normalizeSource(tenantA, "medical_expo_delhi_2026")
      assert(normCustom === "Medical Expo Delhi 2026", "Legitimate custom source preserved and properly formatted")

      // Tenant-specific custom source with custom alias
      await LeadSource.create({
        tenantId: tenantA,
        name: "Doctor Outreach",
        code: "doctor_outreach",
        aliases: ["doc_call", "clinic_visit"],
        color: "#059669",
        isSystem: false,
      })

      const normDoc = await normalizeSource(tenantA, "doc_call")
      assert(normDoc === "Doctor Outreach", "Tenant-defined custom alias normalized to custom canonical source")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 4: Append-Only Integration Event Ledger & Payload Sanitization")
    console.log("--------------------------------------------------------------------------------")
    {
      const dirtyPayload = {
        name: "John Inquirer",
        email: "john@example.com",
        password: "SuperSecretPassword123!",
        bearerToken: "eyJh...sensitive_jwt_token",
        apiKey: "api_key_confidential",
        nested: {
          clientSecret: "client_secret_999",
          phone: "+91 98765 43210",
        },
      }

      const dirtyHeaders = {
        authorization: "Bearer secret_auth_token",
        "x-api-key": "lf_live_12345678",
        "content-type": "application/json",
      }

      const event = new IntegrationEvent({
        tenantId: tenantA,
        rawPayload: dirtyPayload,
        headers: dirtyHeaders,
        source: "Website",
        status: "received",
      })
      await event.save()

      assert(event._id, "IntegrationEvent document saved successfully")
      assert(event.rawPayload.name === "John Inquirer", "Legitimate fields preserved in event payload")
      assert(event.rawPayload.password === "[REDACTED_PASSWORD]", "Password automatically redacted in pre-save hook")
      assert(event.rawPayload.bearerToken === "[REDACTED_BEARERTOKEN]", "Bearer token automatically redacted")
      assert(event.rawPayload.nested.clientSecret === "[REDACTED_CLIENTSECRET]", "Nested sensitive secrets redacted")
      assert(event.headers.authorization === "[REDACTED]", "Authorization header redacted")
      assert(event.headers["x-api-key"] === "[REDACTED]", "x-api-key header redacted")
      assert(event.headers["content-type"] === "application/json", "Standard headers retained")

      // Immutability test on original createdAt timestamp
      const originalCreatedAt = event.createdAt
      event.status = "processed"
      await event.save()
      assert(
        event.createdAt.getTime() === originalCreatedAt.getTime(),
        "Event original submission timestamp (createdAt) is strictly immutable"
      )
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 5: Central Intake Pipeline (Synchronous Webhook Intake)")
    console.log("--------------------------------------------------------------------------------")
    let rawWebsiteKeyA = ""
    let websiteIntegrationA = null
    {
      rawWebsiteKeyA = cryptoUtils.generateApiKey()
      websiteIntegrationA = await Integration.create({
        tenantId: tenantA,
        name: "Tenant A Main Website",
        type: "website",
        status: "active",
        apiKeyHash: cryptoUtils.hashApiKey(rawWebsiteKeyA),
        apiKeyMasked: cryptoUtils.maskSecret(rawWebsiteKeyA),
        assignedStaffId: staffA._id.toString(),
        assignedStaffName: staffA.name,
        settings: {
          duplicateHandling: "reject",
          acceptedForms: ["contact_us", "quote_request"],
          blockedDomains: ["throwawaymail.com"],
        },
      })

      const intakeRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawWebsiteKeyA,
        headers: { "content-type": "application/json" },
        body: {
          name: "Deepak Sharma",
          email: "deepak.sharma@domain.in",
          phone: "+91 98111 22233",
          message: "Interested in Leads-365 CRM subscription",
          formId: "contact_us",
          source: "insta", // Should normalize to Instagram!
          idempotencyKey: "test_idem_001",
        },
      })

      assert(intakeRes.success === true && intakeRes.status === 201, "Webhook intake accepted and created new lead (201)")
      assert(intakeRes.data && intakeRes.data.id, "Created lead ID returned in response")

      // Verify Lead created in database
      const createdLead = await Lead.findById(intakeRes.data.id).lean()
      assert(createdLead && createdLead.tenantId === tenantA, "Lead created in Tenant A partition")
      assert(createdLead.source === "Instagram", "Lead source normalized from 'insta' to 'Instagram'")
      assert(createdLead.assignedTo === staffA.name, "Lead assigned to configured staff member")

      // Verify Integration stats incremented
      const updatedIntegration = await Integration.findById(websiteIntegrationA._id).lean()
      assert(updatedIntegration.stats.totalReceived === 1, "Integration stats totalReceived incremented to 1")
      assert(updatedIntegration.stats.totalSuccess === 1, "Integration stats totalSuccess incremented to 1")

      // Verify IntegrationEvent status
      const eventRecord = await IntegrationEvent.findOne({
        tenantId: tenantA,
        idempotencyKey: "test_idem_001",
      }).lean()
      assert(eventRecord && eventRecord.status === "processed", "IntegrationEvent ledger recorded with status 'processed'")
      assert(eventRecord.result && eventRecord.result.action === "created", "IntegrationEvent captured result action 'created'")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 6: Webhook Idempotency Protection")
    console.log("--------------------------------------------------------------------------------")
    {
      const retryRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawWebsiteKeyA,
        headers: { "x-idempotency-key": "test_idem_001" },
        body: {
          name: "Deepak Sharma",
          email: "deepak.sharma@domain.in",
          phone: "+91 98111 22233",
          message: "Duplicate submission retry",
        },
      })

      assert(retryRes.success === true && retryRes.idempotent === true, "Duplicate submission with same idempotencyKey returns 200 with idempotent: true")
      
      const leadCount = await Lead.countDocuments({ tenantId: tenantA, email: "deepak.sharma@domain.in" })
      assert(leadCount === 1, "No duplicate lead record created on retry delivery")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 7: Form & Domain Filtering Security Rules")
    console.log("--------------------------------------------------------------------------------")
    {
      // 1. Unaccepted form
      const unacceptedFormRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawWebsiteKeyA,
        body: {
          name: "Spam Submitter",
          email: "spam@domain.in",
          phone: "+91 98000 00000",
          formId: "unapproved_hacker_form",
        },
      })
      assert(unacceptedFormRes.status === 422, "Submission with unapproved formId rejected with 422 Unprocessable Entity")

      // 2. Blocked email domain
      const blockedDomainRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawWebsiteKeyA,
        body: {
          name: "Temp User",
          email: "tempuser@throwawaymail.com",
          phone: "+91 98000 00000",
          formId: "contact_us",
        },
      })
      assert(blockedDomainRes.status === 422, "Submission with blocked disposable email domain rejected with 422")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 8: Integration Event Replay Mechanism")
    console.log("--------------------------------------------------------------------------------")
    {
      // Inject a failed event (e.g. invalid phone number previously submitted)
      const failedEvent = await IntegrationEvent.create({
        tenantId: tenantA,
        integrationId: websiteIntegrationA._id,
        integrationType: "website",
        rawPayload: {
          name: "Replay Candidate",
          email: "replay.candidate@domain.in",
          phone: "+91 99988 77766",
          message: "Recovered inquiry after service correction",
          formId: "contact_us",
        },
        source: "Website",
        status: "failed",
        httpStatus: 500,
        errorMessage: "Simulated upstream temporary outage",
      })

      const originalEventDate = failedEvent.createdAt

      // Trigger replay
      const replayRes = await integrationService.replayEvent(failedEvent._id.toString(), {
        tenantId: tenantA,
        actor: { id: staffA._id, name: staffA.name, role: staffA.role },
      })

      assert(replayRes.success === true, "Replay execution returned success")
      assert(replayRes.status === "replayed", "Event status transitioned to 'replayed'")
      assert(replayRes.replayCount === 1, "replayCount incremented to 1")

      // Verify lead now created
      const replayedLead = await Lead.findOne({ tenantId: tenantA, email: "replay.candidate@domain.in" }).lean()
      assert(replayedLead !== null, "Lead successfully created upon event replay")

      // Verify original createdAt is retained
      const replayedEventDoc = await IntegrationEvent.findById(failedEvent._id).lean()
      assert(
        replayedEventDoc.createdAt.getTime() === originalEventDate.getTime(),
        "Original submission timestamp strictly preserved upon event replay"
      )
      assert(replayedEventDoc.lastReplayedAt !== null, "lastReplayedAt timestamp recorded")
      assert(replayedEventDoc.replayedBy && replayedEventDoc.replayedBy.name === staffA.name, "replayedBy actor recorded")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 9: Legacy LeadFeedConfig Backward Compatibility & Seamless Dual-Lookup")
    console.log("--------------------------------------------------------------------------------")
    {
      // Seed legacy LeadFeedConfig in Tenant B (WITHOUT creating an Integration record)
      const rawLegacyKeyB = cryptoUtils.generateApiKey()
      const legacyConfigB = new LeadFeedConfig({
        tenantId: tenantB,
        websiteSource: {
          enabled: true,
          apiKeyHash: cryptoUtils.hashApiKey(rawLegacyKeyB),
          apiKeyMasked: cryptoUtils.maskSecret(rawLegacyKeyB),
          assignedStaffId: staffB._id.toString(),
          assignedStaffName: staffB.name,
          acceptedForms: [],
          duplicateHandling: "reject",
        },
      })
      await legacyConfigB.save()

      // Submit webhook using legacy key
      const legacyIntakeRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawLegacyKeyB,
        body: {
          name: "Beta Customer",
          email: "beta.customer@example.com",
          phone: "+1 555 234 5678",
          message: "Inquiry via legacy API key",
        },
      })

      assert(legacyIntakeRes.success === true && legacyIntakeRes.status === 201, "Legacy API key accepted seamlessly via dual-lookup (201 Created)")

      // Verify lead created in Tenant B
      const betaLead = await Lead.findOne({ tenantId: tenantB, email: "beta.customer@example.com" }).lean()
      assert(betaLead && betaLead.tenantId === tenantB, "Lead created in Tenant B using legacy credentials")

      // Verify seamless auto-sync created corresponding Integration record
      const syncedIntegration = await Integration.findOne({ tenantId: tenantB, type: "website" }).lean()
      assert(syncedIntegration !== null, "Integration record automatically synced for legacy tenant without downtime")
      assert(syncedIntegration.apiKeyHash === cryptoUtils.hashApiKey(rawLegacyKeyB), "Synced integration retains exact same API key hash")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 10: Background Queue Async Intake ('integration.intake')")
    console.log("--------------------------------------------------------------------------------")
    {
      const asyncRes = await integrationService.intakeWebhookPayload({
        rawApiKey: rawWebsiteKeyA,
        async: true, // Request background queue offloading
        body: {
          name: "Async Customer",
          email: "async.customer@company.com",
          phone: "+91 91234 56789",
          message: "Async lead submission",
          formId: "contact_us",
          idempotencyKey: "async_job_test_001",
        },
      })

      assert(asyncRes.status === 202 && asyncRes.queued === true, "Async intake returns 202 Accepted with queued: true")
      assert(asyncRes.jobId !== undefined, "Background queue jobId returned")

      // Verify event is in 'queued' state
      const queuedEvent = await IntegrationEvent.findById(asyncRes.eventId).lean()
      assert(queuedEvent && queuedEvent.status === "queued", "IntegrationEvent ledger state set to 'queued'")

      // Process the queued job via queue engine
      const claimedJob = await queue.claimNextJob("test-worker-p11", { jobId: asyncRes.jobId })
      assert(claimedJob !== null, "Worker successfully claims queued 'integration.intake' job")

      const jobHandler = queue.getHandler(claimedJob.name)
      assert(typeof jobHandler === "function", "Handler registered for 'integration.intake'")

      const handlerResult = await jobHandler(claimedJob)
      await queue.completeJob(claimedJob._id, handlerResult)

      // Verify lead was created by background job
      const asyncLead = await Lead.findOne({ tenantId: tenantA, email: "async.customer@company.com" }).lean()
      assert(asyncLead !== null, "Lead created by background worker processing")

      // Verify event transitioned to 'processed'
      const finalizedEvent = await IntegrationEvent.findById(asyncRes.eventId).lean()
      assert(finalizedEvent.status === "processed", "IntegrationEvent ledger updated to 'processed' after background execution")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 11: Multi-Tenant Boundary & RBAC Scope Enforcement")
    console.log("--------------------------------------------------------------------------------")
    {
      // 1. Cross-tenant event replay rejection
      const eventInA = await IntegrationEvent.findOne({ tenantId: tenantA })
      let crossReplayBlocked = false
      try {
        await integrationService.replayEvent(eventInA._id.toString(), {
          tenantId: tenantB, // Malicious Tenant B trying to replay Tenant A event
          actor: { id: staffB._id, name: staffB.name, role: staffB.role },
        })
      } catch (err) {
        crossReplayBlocked = err.message.includes("not found")
      }
      assert(crossReplayBlocked, "Cross-tenant event replay rejected with 'not found' (IDOR prevented)")

      // 2. Cross-tenant integration query isolation
      await runWithTenantContext({ tenantId: tenantB }, async () => {
        const integrations = await Integration.find()
        const hasA = integrations.some((i) => i.tenantId === tenantA)
        assert(!hasA, "Tenant isolation plugin strictly isolates integration queries across tenants")
      })
    }

    console.log("\n================================================================================")
    console.log(`=== PHASE 11 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("================================================================================")

    if (failed > 0) {
      process.exit(1)
    }
  } finally {
    // Cleanup test data
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      LeadSource.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      LeadFeedConfig.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      Job.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
      DeadLetterJob.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }),
    ])
    await mongoose.disconnect()
  }

}

runTests().catch((err) => {
  console.error("FATAL ERROR in Phase 11 verification suite:", err)
  process.exit(1)
})
