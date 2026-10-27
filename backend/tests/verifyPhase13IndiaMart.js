const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const indiamartService = require("../services/indiamartService")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Job = require("../models/Job")
const queue = require("../services/queueService")
const { registerAllHandlers } = require("../jobs/index")
const cryptoUtils = require("../utils/cryptoUtils")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  connectIndiaMartIntegration,
  getIndiaMartStatus,
  triggerIndiaMartSync,
  handleIndiaMartWebhook,
} = require("../controllers/indiamartController")

async function runTests() {
  console.log("================================================================================")
  console.log("=== PHASE 13: INDIAMART INTEGRATION - COMPREHENSIVE VERIFICATION SUITE      ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
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

  const tenantA = "TEST-TENANT-P13-ALPHA"
  const tenantB = "TEST-TENANT-P13-BETA"

  try {
    // 0. Register background queue handlers
    registerAllHandlers()

    // Clean previous test artifacts for both tenants
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })
    await Job.deleteMany({ tenantId: { $in: [tenantA, tenantB] } })

    // Create staff member for Tenant A
    const staffA = await User.create({
      tenantId: tenantA,
      name: "Ramesh Sharma",
      email: "ramesh.sharma@tenant-alpha.test",
      password: "HashedPassword123!",
      role: "agent",
      status: "active",
      isActive: true,
    })

    const testCrmKeyA = "glusr_crm_key_alpha_secure_998877665544"
    const testCrmKeyB = "glusr_crm_key_beta_secure_112233445566"

    console.log("--------------------------------------------------------------------------------")
    console.log("TEST 1: Credential Encryption & Masking (AES-256-GCM)")
    console.log("--------------------------------------------------------------------------------")
    let integrationA = null
    {
      const mockReq = {
        tenantId: tenantA,
        body: {
          crmKey: testCrmKeyA,
          mobileNumber: "+91 98111 22334",
          name: "IndiaMART Alpha Feed",
          assignedStaffId: staffA._id.toString(),
          assignedStaffName: staffA.name,
          settings: { duplicateHandling: "update" },
        },
      }
      let statusCode = null
      let responseBody = null
      const mockRes = {
        status: (code) => {
          statusCode = code
          return {
            json: (data) => {
              responseBody = data
            },
          }
        },
      }

      await connectIndiaMartIntegration(mockReq, mockRes)
      assert(statusCode === 200, "IndiaMART connect endpoint returned HTTP 200")
      assert(responseBody?.success === true, "Response reports success: true")
      assert(responseBody?.integration?.crmKeyMasked?.includes("••••"), "Masked CRM key returned in response")
      assert(!JSON.stringify(responseBody).includes(testCrmKeyA), "Plaintext CRM key NEVER exposed in connect response")

      // Query raw database document
      integrationA = await Integration.findOne({ tenantId: tenantA, type: "indiamart" }).setOptions({ skipTenantFilter: true })
      assert(integrationA !== null, "Integration document persisted in database")
      assert(integrationA.credentials && integrationA.credentials.encryptedData, "Credentials field stored as encrypted ciphertext object")
      assert(!JSON.stringify(integrationA.credentials).includes(testCrmKeyA), "Ciphertext does not contain raw plaintext key")

      // Decrypt credentials via helper
      const decrypted = integrationA.getDecryptedCredentials()
      assert(decrypted.crmKey === testCrmKeyA, "getDecryptedCredentials accurately recovers plaintext CRM key")
      assert(decrypted.mobileNumber === "+91 98111 22334", "Decrypted mobile number verified")

      // Verify toJSON() strips credentials
      const jsonOutput = integrationA.toJSON()
      assert(jsonOutput.credentials === undefined, "credentials stripped from toJSON() output")
      assert(jsonOutput.apiKeyHash === undefined, "apiKeyHash stripped from toJSON() output")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 2: Multi-Tenant Boundary & RBAC Scope Enforcement")
    console.log("--------------------------------------------------------------------------------")
    let integrationB = null
    {
      // Connect Tenant B
      const mockReqB = {
        tenantId: tenantB,
        body: {
          crmKey: testCrmKeyB,
          name: "IndiaMART Beta Feed",
        },
      }
      let statusCodeB = null
      const mockResB = {
        status: (code) => {
          statusCodeB = code
          return { json: () => {} }
        },
      }
      await connectIndiaMartIntegration(mockReqB, mockResB)
      assert(statusCodeB === 200, "Tenant B connected IndiaMART independently")

      integrationB = await Integration.findOne({ tenantId: tenantB, type: "indiamart" }).setOptions({ skipTenantFilter: true })
      assert(integrationB !== null, "Integration document created for Tenant B")

      // Cross-tenant query attempt by Tenant A
      await runWithTenantContext({ tenantId: tenantA }, async () => {
        const found = await Integration.findOne({ _id: integrationB._id })
        assert(!found, "Tenant A cannot access Tenant B's IndiaMART connection (tenant boundary preserved)")
      })
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 3: IndiaMART API Response Parsing & Field Mapping")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry1 = {
      UNIQUE_QUERY_ID: "im_query_1001",
      QUERY_TYPE: "W",
      QUERY_TIME: "24-Mar-2026 11:20:00",
      SENDER_NAME: "Vikram Malhotra",
      SENDER_MOBILE: "+91-98200-11223",
      SENDER_EMAIL: "vikram@malhotrapharma.test",
      SENDER_COMPANY: "Malhotra Pharma Machinery Ltd",
      SENDER_ADDRESS: "Phase 4, GIDC Industrial Estate",
      SENDER_CITY: "Ahmedabad",
      SENDER_STATE: "Gujarat",
      SENDER_COUNTRY_ISO: "IN",
      PRODUCT_NAME: "Automatic Capsule Filling Machine",
      SUBJECT: "Requirement for 50000 capsules/hr Machine",
      QUERY_MESSAGE: "We require 2 units of automatic capsule filling machines for our Ahmedabad plant. Please share catalog and quotation.",
    }
    {
      const crmPayload = indiamartService.mapIndiaMartInquiryToCrmPayload(testInquiry1, integrationA)
      assert(crmPayload.name === "Vikram Malhotra", "Buyer name correctly mapped")
      assert(crmPayload.email === "vikram@malhotrapharma.test", "Buyer email normalized to lowercase")
      assert(crmPayload.phone === "+91-98200-11223", "Buyer phone number mapped")
      assert(crmPayload.company === "Malhotra Pharma Machinery Ltd", "Company name mapped")
      assert(crmPayload.city === "Ahmedabad", "City correctly mapped")
      assert(crmPayload.state === "Gujarat", "State correctly mapped")
      assert(crmPayload.message.includes("Automatic Capsule Filling Machine"), "Product included in inquiry message")
      assert(crmPayload.message.includes("Direct Catalogue Enquiry"), "Query type descriptive label included")
      assert(crmPayload.metadata.indiamartQueryId === "im_query_1001", "UNIQUE_QUERY_ID stamped in metadata")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 4: Canonical 'IndiaMART' Source Assignment & Lead Ingestion")
    console.log("--------------------------------------------------------------------------------")
    {
      const ingestResult = await indiamartService.processIndiaMartInquiry({
        inquiry: testInquiry1,
        integration: integrationA,
        tenantId: tenantA,
      })

      assert(ingestResult.action === "created", "Lead created in CRM via processIndiaMartInquiry")
      assert(ingestResult.inquiryId === "im_query_1001", "Returned correct inquiryId")

      // Verify Lead document in CRM
      const createdLead = await Lead.findOne({
        tenantId: tenantA,
        email: "vikram@malhotrapharma.test",
      }).lean()

      assert(createdLead !== null, "Lead record exists in CRM database")
      assert(createdLead.name === "Vikram Malhotra", "Lead name matches IndiaMART buyer")
      assert(createdLead.source === "IndiaMART", "Canonical source assigned as 'IndiaMART'")
      assert(createdLead.attribution?.firstTouch?.source?.toLowerCase() === "indiamart", "Attribution source stamped as 'indiamart'")
      assert(createdLead.attribution?.firstTouch?.medium === "b2b_marketplace", "Attribution medium stamped as 'b2b_marketplace'")
      assert(createdLead.attribution?.firstTouch?.campaign === "Automatic Capsule Filling Machine", "Attribution campaign captures product name")
      assert(createdLead.assignedTo === staffA.name, "Lead assigned to configured staff member")
      assert(createdLead.metadata?.indiamartQueryId === "im_query_1001", "Query ID preserved in lead metadata")

      // Verify IntegrationEvent ledger
      const event = await IntegrationEvent.findOne({
        tenantId: tenantA,
        idempotencyKey: "indiamart_inquiry_im_query_1001",
      }).lean()

      assert(event !== null, "IntegrationEvent ledger record created")
      assert(event.status === "processed", "Ledger status transitioned to 'processed'")
      assert(event.result?.leadId?.toString() === createdLead._id.toString(), "Event links to created lead ID")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 5: Idempotency & Duplicate Prevention")
    console.log("--------------------------------------------------------------------------------")
    {
      // Ingest identical inquiry second time
      const duplicateResult = await indiamartService.processIndiaMartInquiry({
        inquiry: testInquiry1,
        integration: integrationA,
        tenantId: tenantA,
      })

      assert(duplicateResult.action === "skipped_duplicate", "Duplicate inquiry recognized and skipped")

      // Verify lead count in tenant partition did not increment
      const count = await Lead.countDocuments({
        tenantId: tenantA,
        email: "vikram@malhotrapharma.test",
      })
      assert(count === 1, "Exactly 1 lead record in database; zero duplicate leads created")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 6: Incremental Watermark & Sync Cursor Tracking")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry2 = {
      UNIQUE_QUERY_ID: "im_query_1002",
      QUERY_TYPE: "P", // Buy Lead
      QUERY_TIME: "24-Mar-2026 12:45:00",
      SENDER_NAME: "Priya Nair",
      SENDER_MOBILE: "+91-98450-33445",
      SENDER_EMAIL: "priya.nair@biotechcare.test",
      SENDER_COMPANY: "BioTech Care Instruments",
      SENDER_CITY: "Bengaluru",
      SENDER_STATE: "Karnataka",
      PRODUCT_NAME: "Centrifuge Machine 10000 RPM",
      SUBJECT: "Enquiry for Centrifuge Machine",
      QUERY_MESSAGE: "Need pricing for high speed centrifuge machine with rotor.",
    }
    {
      const mockFetch = async (url) => {
        assert(url.includes("glusr_crm_key="), "API request includes glusr_crm_key parameter")
        assert(url.includes("start_time="), "API request includes start_time parameter")
        assert(url.includes("end_time="), "API request includes end_time parameter")
        return {
          ok: true,
          status: 200,
          json: async () => ({
            CODE: 200,
            STATUS: "SUCCESS",
            MESSAGE: "Records fetched successfully",
            TOTAL_RECORDS: 1,
            RESPONSE: [testInquiry2],
          }),
        }
      }

      const syncResult = await indiamartService.syncIndiaMartLeads(integrationA._id, {
        customFetch: mockFetch,
        lookbackHours: 12,
      })

      assert(syncResult.success === true, "Sync executed successfully")
      assert(syncResult.processedCount === 1, "Exactly 1 new inquiry processed")

      // Verify second lead created
      const lead2 = await Lead.findOne({ tenantId: tenantA, email: "priya.nair@biotechcare.test" }).lean()
      assert(lead2 !== null, "Second lead created in CRM from API sync")
      assert(lead2.source === "IndiaMART", "Canonical source assigned as 'IndiaMART'")

      // Reload integration and check watermark cursor
      const reloaded = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      const updatedCreds = reloaded.getDecryptedCredentials()
      assert(updatedCreds.lastSyncTime !== null, "lastSyncTime watermark cursor stored in credentials")
      assert(reloaded.stats.totalSuccess >= 2, "Integration totalSuccess stats incremented")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 7: Background Queue Worker Processing ('indiamart.sync_leads')")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry3 = {
      UNIQUE_QUERY_ID: "im_query_1003",
      QUERY_TYPE: "C", // Call enquiry
      QUERY_TIME: "24-Mar-2026 13:00:00",
      SENDER_NAME: "Amit Joshi",
      SENDER_MOBILE: "+91-98700-55667",
      SENDER_EMAIL: "amit.joshi@joshimedical.test",
      SENDER_CITY: "Pune",
      PRODUCT_NAME: "Dental Autoclave Class B",
      SUBJECT: "Call inquiry for Autoclave",
      QUERY_MESSAGE: "Buyer called regarding Dental Autoclave price.",
      CALL_DURATION: "145",
    }
    {
      // 1. Trigger sync via controller with async: true
      const mockReq = {
        tenantId: tenantA,
        params: { id: integrationA._id.toString() },
        body: { async: true, lookbackHours: 6 },
      }
      let statusCode = null
      let responseBody = null
      const mockRes = {
        status: (code) => {
          statusCode = code
          return {
            json: (data) => {
              responseBody = data
            },
          }
        },
      }

      await triggerIndiaMartSync(mockReq, mockRes)
      assert(statusCode === 202, "triggerIndiaMartSync returns HTTP 202 Accepted")
      assert(responseBody?.queued === true, "Response confirms queued: true")
      assert(responseBody?.jobId !== undefined, "Job ID returned to caller")

      // 2. Queue worker claims the job
      const claimedJob = await queue.claimNextJob("test-worker-indiamart", {
        name: "indiamart.sync_leads",
        tenantId: tenantA,
      })
      assert(claimedJob !== null, "Queue worker claimed 'indiamart.sync_leads' job")

      // 3. Worker executes sync with mock fetch returning testInquiry3
      const mockWorkerFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          CODE: 200,
          STATUS: "SUCCESS",
          TOTAL_RECORDS: 1,
          RESPONSE: [testInquiry3],
        }),
      })

      const workerResult = await indiamartService.syncIndiaMartLeads(claimedJob.payload.integrationId, {
        ...claimedJob.payload.options,
        customFetch: mockWorkerFetch,
      })
      await queue.completeJob(claimedJob._id, workerResult)

      assert(workerResult.success === true, "Worker finished IndiaMART sync successfully")
      assert(workerResult.processedCount === 1, "Processed 1 inquiry via background queue")

      // Verify Lead created by background queue
      const lead3 = await Lead.findOne({ tenantId: tenantA, email: "amit.joshi@joshimedical.test" }).lean()
      assert(lead3 !== null, "Lead created in CRM via background queue execution")
      assert(lead3.message.includes("Call Duration: 145s"), "Call duration captured in lead message")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 8: Authentication Invalidation & Reconnect-Needed Detection")
    console.log("--------------------------------------------------------------------------------")
    {
      // Mock IndiaMART API returning HTTP 401 / Invalid Key
      const mockAuthFailFetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          CODE: 401,
          STATUS: "FAILURE",
          MESSAGE: "Invalid or Inactive CRM Key. Please generate new key in Seller portal.",
        }),
      })

      let caughtErr = null
      try {
        await indiamartService.syncIndiaMartLeads(integrationA._id, {
          customFetch: mockAuthFailFetch,
        })
      } catch (err) {
        caughtErr = err
      }

      assert(caughtErr !== null, "Auth failure thrown as exception")
      assert(caughtErr.reconnectNeeded === true, "Error tagged with reconnectNeeded: true")

      // Verify integration document updated with error status
      const updatedIntegration = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      assert(updatedIntegration.status === "error", "Integration status transitioned to 'error'")
      const creds = updatedIntegration.getDecryptedCredentials()
      assert(creds.reconnectNeeded === true, "Credentials stamped with reconnectNeeded: true")
      assert(creds.reconnectReason.includes("Invalid or Inactive"), "Clear reconnectReason saved for user")

      // Test status endpoint reflects reconnectNeeded
      const mockReqStatus = { tenantId: tenantA }
      let statusData = null
      const mockResStatus = {
        status: () => ({
          json: (data) => {
            statusData = data
          },
        }),
      }
      await getIndiaMartStatus(mockReqStatus, mockResStatus)
      assert(statusData.reconnectNeeded === true, "Status API warns admin that reconnect is needed")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 9: Rate Limit (429) & Transient Failure Resilience")
    console.log("--------------------------------------------------------------------------------")
    {
      const mockRateLimitFetch = async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          CODE: 429,
          STATUS: "FAILURE",
          MESSAGE: "Rate limit reached: Maximum 1 request allowed per 5 minutes.",
        }),
      })

      let rateLimitErr = null
      try {
        await indiamartService.syncIndiaMartLeads(integrationA._id, {
          customFetch: mockRateLimitFetch,
        })
      } catch (err) {
        rateLimitErr = err
      }

      assert(rateLimitErr !== null, "Rate limit error trapped cleanly")
      assert(rateLimitErr.rateLimited === true, "Error tagged with rateLimited: true")

      const updated = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      assert(updated.stats.totalErrors >= 1, "Integration stats recorded error count")
      assert(updated.stats.lastErrorMessage.includes("Rate limit reached"), "Last error message records rate limit")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 10: Missing Credentials & Setup Guidance")
    console.log("--------------------------------------------------------------------------------")
    {
      const tenantUnconfigured = "TEST-TENANT-P13-EMPTY"

      const mockReq = { tenantId: tenantUnconfigured }
      let statusRes = null
      const mockRes = {
        status: () => ({
          json: (data) => {
            statusRes = data
          },
        }),
      }

      await getIndiaMartStatus(mockReq, mockRes)
      assert(statusRes.configured === false, "Returns configured: false when integration is absent")
      assert(statusRes.status === "disconnected", "Returns status: 'disconnected'")
      assert(statusRes.setupGuide?.step1 !== undefined, "Returns step-by-step setup guide for IndiaMART seller portal")

      // Attempt to connect with empty crmKey
      const mockConnectReq = {
        tenantId: tenantUnconfigured,
        body: { crmKey: "" },
      }
      let connectCode = null
      let connectErr = null
      const mockConnectRes = {
        status: (code) => {
          connectCode = code
          return {
            json: (data) => {
              connectErr = data
            },
          }
        },
      }
      await connectIndiaMartIntegration(mockConnectReq, mockConnectRes)
      assert(connectCode === 400, "Empty CRM key rejected with HTTP 400 Bad Request")
      assert(connectErr.error.includes("Valid IndiaMART glusr_crm_key is required"), "Clear error message returned for missing key")
    }

    console.log("\n================================================================================")
    console.log(`=== PHASE 13 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("================================================================================\n")

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error("Test execution threw uncaught error:", err)
    process.exit(1)
  } finally {
    // Cleanup test partitions
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB, "TEST-TENANT-P13-EMPTY"] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB, "TEST-TENANT-P13-EMPTY"] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB, "TEST-TENANT-P13-EMPTY"] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB, "TEST-TENANT-P13-EMPTY"] } })
    await Job.deleteMany({ tenantId: { $in: [tenantA, tenantB, "TEST-TENANT-P13-EMPTY"] } })
    await mongoose.disconnect()
  }
}

runTests()
