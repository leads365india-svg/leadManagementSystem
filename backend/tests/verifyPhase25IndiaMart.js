const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const indiamartService = require("../services/indiamartService")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const Lead = require("../models/Lead")
const User = require("../models/User")
const Account = require("../models/Account")
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

async function runPhase25Tests() {
  console.log("================================================================================")
  console.log("=== PHASE 25: INDIAMART INTEGRATION - COMPREHENSIVE VERIFICATION SUITE       ===")
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

  const tenantA = "TEST-TENANT-P25-ALPHA"
  const tenantB = "TEST-TENANT-P25-BETA"
  const tenantSuspended = "TEST-TENANT-P25-SUSPENDED"

  try {
    // 0. Register background queue handlers
    registerAllHandlers()

    // Clean previous test artifacts
    await Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB, tenantSuspended] } })
    await IntegrationEvent.deleteMany({ tenantId: { $in: [tenantA, tenantB, tenantSuspended] } })
    await Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB, tenantSuspended] } })
    await User.deleteMany({ tenantId: { $in: [tenantA, tenantB, tenantSuspended] } })
    await Job.deleteMany({ tenantId: { $in: [tenantA, tenantB, tenantSuspended] } })
    await Account.deleteMany({ accountId: { $in: [tenantA, tenantB, tenantSuspended] } })

    // Seed test accounts
    await Account.create({
      accountId: tenantA,
      companyName: "Alpha Industrial Supplies",
      displayName: "Alpha Industrial",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Alpha Admin",
      adminEmail: "admin@alpha-industrial.test",
      status: "active",
    })

    await Account.create({
      accountId: tenantB,
      companyName: "Beta Machinery Hub",
      displayName: "Beta Machinery",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Beta Admin",
      adminEmail: "admin@beta-machinery.test",
      status: "active",
    })

    await Account.create({
      accountId: tenantSuspended,
      companyName: "Suspended Traders",
      displayName: "Suspended",
      adminUserId: new mongoose.Types.ObjectId(),
      adminName: "Suspended Admin",
      adminEmail: "admin@suspended-traders.test",
      status: "suspended",
    })

    // Seed staff member for Tenant A
    const staffA = await User.create({
      tenantId: tenantA,
      name: "Sunil Verma",
      email: "sunil.verma@alpha-industrial.test",
      password: "HashedPassword123!",
      role: "agent",
      status: "active",
      isActive: true,
    })

    const testCrmKeyA = "glusr_crm_key_alpha_p25_9988776655"
    const testCrmKeyB = "glusr_crm_key_beta_p25_1122334455"

    console.log("--------------------------------------------------------------------------------")
    console.log("TEST 1: IndiaMART Date Formatter & Date Parser (DD-MMM-YYYY HH:mm:ss)")
    console.log("--------------------------------------------------------------------------------")
    {
      const sampleDate = new Date(2026, 9, 28, 14, 30, 45) // 28-Oct-2026 14:30:45
      const formatted = indiamartService.formatIndiaMartDate(sampleDate)
      assert(formatted === "28-Oct-2026 14:30:45", `Formatted date matches exact IndiaMART API contract: ${formatted}`)

      const parsed = indiamartService.parseIndiaMartDate("28-Oct-2026 14:30:45")
      assert(parsed instanceof Date && !isNaN(parsed.getTime()), "Parsed string into valid JavaScript Date")
      assert(parsed.getFullYear() === 2026 && parsed.getMonth() === 9 && parsed.getDate() === 28, "Date components match parsed values")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 2: Credential Encryption & Secret Redaction (AES-256-GCM)")
    console.log("--------------------------------------------------------------------------------")
    let integrationA = null
    {
      const mockReq = {
        tenantId: tenantA,
        body: {
          crmKey: testCrmKeyA,
          mobileNumber: "+91 98222 33445",
          name: "IndiaMART Alpha Ingestion",
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
      assert(responseBody?.success === true, "Response confirmed success: true")
      assert(responseBody?.integration?.crmKeyMasked && responseBody.integration.crmKeyMasked !== testCrmKeyA, "Masked CRM key returned in response")
      assert(!JSON.stringify(responseBody).includes(testCrmKeyA), "Plaintext CRM key NEVER exposed in connect response")

      integrationA = await Integration.findOne({ tenantId: tenantA, type: "indiamart" }).setOptions({ skipTenantFilter: true })
      assert(integrationA !== null, "Integration record persisted in database")
      assert(typeof integrationA.credentials === "object", "Credentials stored as structured encrypted object")
      assert(!JSON.stringify(integrationA.credentials).includes(testCrmKeyA), "Ciphertext does not contain raw plaintext key")

      const decrypted = integrationA.getDecryptedCredentials()
      assert(decrypted.crmKey === testCrmKeyA, "getDecryptedCredentials recovers plaintext CRM key accurately")
      assert(decrypted.mobileNumber === "+91 98222 33445", "Decrypted mobile number matches")

      const jsonOutput = JSON.stringify(integrationA.toJSON())
      assert(!jsonOutput.includes("credentials"), "credentials field stripped from model toJSON()")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 3: Tenant Isolation & Scope Enforcement")
    console.log("--------------------------------------------------------------------------------")
    let integrationB = null
    {
      // Connect Tenant B independently
      const mockReqB = {
        tenantId: tenantB,
        body: {
          crmKey: testCrmKeyB,
          name: "IndiaMART Beta Ingestion",
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
      assert(integrationB !== null, "Integration created for Tenant B")

      // Cross-tenant access attempt by Tenant A
      await runWithTenantContext({ tenantId: tenantA }, async () => {
        const found = await Integration.findOne({ _id: integrationB._id })
        assert(!found, "Tenant A cannot access Tenant B's IndiaMART connection (tenant boundary preserved)")
      })
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 4: Account Suspension Check (Tenant Partition Defense)")
    console.log("--------------------------------------------------------------------------------")
    {
      // Attempt to process inquiry for suspended tenant
      let suspendedError = null
      try {
        await indiamartService.processIndiaMartInquiry({
          inquiry: {
            UNIQUE_QUERY_ID: "im_query_susp_1",
            SENDER_NAME: "Suspended Buyer",
            SENDER_MOBILE: "+91 99999 00000",
            SENDER_EMAIL: "buyer@suspended.test",
          },
          integration: { _id: new mongoose.Types.ObjectId(), name: "Suspended Feed", stats: {} },
          tenantId: tenantSuspended,
        })
      } catch (err) {
        suspendedError = err
      }
      assert(suspendedError !== null, "Suspended tenant inquiry rejected with exception")
      assert(suspendedError?.statusCode === 403, "Suspended tenant rejected with HTTP 403 Forbidden")
      assert(suspendedError?.message.includes("is suspended"), "Error message explicitly indicates tenant account is suspended")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 5: Buyer Payload Mapping & Canonical 'IndiaMART' Attribution")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry1 = {
      UNIQUE_QUERY_ID: "im_p25_query_001",
      QUERY_TYPE: "W",
      QUERY_TIME: "28-Oct-2026 14:15:00",
      SENDER_NAME: "Rajesh Singhania",
      SENDER_MOBILE: "+91-98100-88990",
      SENDER_EMAIL: "rajesh.singhania@singhaniasteel.test",
      SENDER_COMPANY: "Singhania Steel Tubes Ltd",
      SENDER_ADDRESS: "Industrial Area Phase 2, Okhla",
      SENDER_CITY: "New Delhi",
      SENDER_STATE: "Delhi",
      SENDER_COUNTRY_ISO: "IN",
      PRODUCT_NAME: "Hydraulic Pipe Bending Machine 3 Inch",
      SUBJECT: "Enquiry for 3 Inch Pipe Bender",
      QUERY_MESSAGE: "We need 2 units of heavy-duty hydraulic pipe bending machines. Deliver to Okhla plant.",
    }
    {
      const crmPayload = indiamartService.mapIndiaMartInquiryToCrmPayload(testInquiry1, integrationA)
      assert(crmPayload.name === "Rajesh Singhania", "Buyer name correctly mapped")
      assert(crmPayload.email === "rajesh.singhania@singhaniasteel.test", "Buyer email mapped & normalized to lowercase")
      assert(crmPayload.phone === "+91-98100-88990", "Buyer mobile number mapped")
      assert(crmPayload.company === "Singhania Steel Tubes Ltd", "Company name mapped")
      assert(crmPayload.city === "New Delhi", "City correctly mapped")
      assert(crmPayload.state === "Delhi", "State correctly mapped")
      assert(crmPayload.message.includes("Hydraulic Pipe Bending Machine 3 Inch"), "Product name present in message body")
      assert(crmPayload.message.includes("Direct Catalogue Enquiry"), "Query type descriptive label formatted in message")
      assert(crmPayload.utm_source === "indiamart", "Attribution utm_source set to 'indiamart'")
      assert(crmPayload.utm_medium === "b2b_marketplace", "Attribution utm_medium set to 'b2b_marketplace'")
      assert(crmPayload.utm_campaign === "Hydraulic Pipe Bending Machine 3 Inch", "Attribution utm_campaign captures product name")
      assert(crmPayload.metadata.indiamartQueryId === "im_p25_query_001", "UNIQUE_QUERY_ID stamped in metadata")

      // Ingest via processIndiaMartInquiry
      const ingestResult = await indiamartService.processIndiaMartInquiry({
        inquiry: testInquiry1,
        integration: integrationA,
        tenantId: tenantA,
      })
      assert(ingestResult.action === "created", "Lead ingested and created successfully")
      assert(ingestResult.inquiryId === "im_p25_query_001", "Returned correct inquiryId")

      // Verify lead in CRM
      const lead = await Lead.findOne({ tenantId: tenantA, email: "rajesh.singhania@singhaniasteel.test" }).lean()
      assert(lead !== null, "Lead record exists in CRM collection")
      assert(lead.source === "IndiaMART", "Canonical source assigned as 'IndiaMART'")
      assert(lead.assignedTo === staffA.name, "Lead assigned to configured staff member")
      assert(lead.attribution?.firstTouch?.source?.toLowerCase() === "indiamart", "Attribution firstTouch source set to 'indiamart'")
      assert(lead.attribution?.firstTouch?.medium === "b2b_marketplace", "Attribution firstTouch medium set to 'b2b_marketplace'")

      // Verify IntegrationEvent ledger
      const event = await IntegrationEvent.findOne({
        tenantId: tenantA,
        idempotencyKey: "indiamart_inquiry_im_p25_query_001",
      }).lean()
      assert(event !== null, "IntegrationEvent ledger record created")
      assert(event.status === "processed", "Ledger status transitioned to 'processed'")
      assert(event.result?.leadId?.toString() === lead._id.toString(), "Ledger links to created lead ID")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 6: Missing / Malformed Fields Rejection")
    console.log("--------------------------------------------------------------------------------")
    {
      // Missing UNIQUE_QUERY_ID
      let missingQueryIdErr = null
      try {
        await indiamartService.processIndiaMartInquiry({
          inquiry: { SENDER_NAME: "Test", SENDER_MOBILE: "9988776655" },
          integration: integrationA,
          tenantId: tenantA,
        })
      } catch (err) {
        missingQueryIdErr = err
      }
      assert(missingQueryIdErr !== null, "Inquiry missing UNIQUE_QUERY_ID rejected with exception")
      assert(missingQueryIdErr.message.includes("Missing UNIQUE_QUERY_ID"), "Clear error message for missing UNIQUE_QUERY_ID")

      // Missing buyer contact info (no mobile and no email)
      let missingContactErr = null
      try {
        await indiamartService.processIndiaMartInquiry({
          inquiry: {
            UNIQUE_QUERY_ID: "im_malformed_001",
            SENDER_NAME: "Contactless Buyer",
            PRODUCT_NAME: "Widgets",
          },
          integration: integrationA,
          tenantId: tenantA,
        })
      } catch (err) {
        missingContactErr = err
      }
      assert(missingContactErr !== null, "Inquiry missing both phone and email rejected with exception")
      assert(missingContactErr.message.includes("Missing buyer contact info"), "Clear error message for missing contact information")

      // Empty CRM key in API client
      let emptyKeyErr = null
      try {
        await indiamartService.fetchIndiaMartLeads({ crmKey: "" })
      } catch (err) {
        emptyKeyErr = err
      }
      assert(emptyKeyErr !== null, "Empty CRM key in fetch rejected with exception")
      assert(emptyKeyErr.message.includes("Missing required IndiaMART CRM key"), "Clear error message for missing CRM key")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 7: Idempotency & Repeated Delivery / Polling Deduplication")
    console.log("--------------------------------------------------------------------------------")
    {
      // Re-submit identical inquiry
      const duplicateResult = await indiamartService.processIndiaMartInquiry({
        inquiry: testInquiry1,
        integration: integrationA,
        tenantId: tenantA,
      })
      assert(duplicateResult.action === "skipped_duplicate", "Duplicate inquiry recognized and skipped")
      assert(duplicateResult.leadId !== null, "Original lead ID returned upon skipped duplicate")

      // Verify no duplicate lead created in CRM
      const leadCount = await Lead.countDocuments({
        tenantId: tenantA,
        email: "rajesh.singhania@singhaniasteel.test",
      })
      assert(leadCount === 1, "Exactly 1 lead record in database; zero duplicate leads created")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 8: Incremental Watermark Cursor Tracking (lastSyncTime)")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry2 = {
      UNIQUE_QUERY_ID: "im_p25_query_002",
      QUERY_TYPE: "P", // Buy Lead
      QUERY_TIME: "28-Oct-2026 15:00:00",
      SENDER_NAME: "Meera Krishnan",
      SENDER_MOBILE: "+91-98400-55667",
      SENDER_EMAIL: "meera.krishnan@krishnanlabs.test",
      SENDER_COMPANY: "Krishnan Bio Labs",
      SENDER_CITY: "Chennai",
      SENDER_STATE: "Tamil Nadu",
      PRODUCT_NAME: "Laminar Airflow Workstation Clean Bench",
      SUBJECT: "Quote for Clean Bench Class 100",
      QUERY_MESSAGE: "Requirement for 3 Class 100 Laminar airflows.",
    }
    {
      let capturedUrl = null
      const mockFetch = async (url) => {
        capturedUrl = url
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
        lookbackHours: 24,
      })

      assert(syncResult.success === true, "Sync executed successfully")
      assert(syncResult.processedCount === 1, "Exactly 1 new inquiry processed")
      assert(capturedUrl.includes("glusr_crm_key="), "Request URL included glusr_crm_key")
      assert(capturedUrl.includes("start_time="), "Request URL included formatted start_time")
      assert(capturedUrl.includes("end_time="), "Request URL included formatted end_time")

      // Verify second lead created
      const lead2 = await Lead.findOne({ tenantId: tenantA, email: "meera.krishnan@krishnanlabs.test" }).lean()
      assert(lead2 !== null, "Second lead created in CRM from API sync")
      assert(lead2.source === "IndiaMART", "Canonical source assigned as 'IndiaMART'")

      // Reload integration and check watermark cursor
      const reloaded = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      const updatedCreds = reloaded.getDecryptedCredentials()
      assert(updatedCreds.lastSyncTime !== null, "lastSyncTime watermark cursor stored in encrypted credentials")
      assert(reloaded.stats.totalSuccess >= 2, "Integration totalSuccess stats incremented")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 9: Overlap Lock Protection (Preventing Concurrent Sync Jobs)")
    console.log("--------------------------------------------------------------------------------")
    {
      // Manually set isSyncing lock to simulate a running job
      await Integration.updateOne(
        { _id: integrationA._id },
        {
          $set: {
            "settings.customConfig.isSyncing": true,
            "settings.customConfig.lastSyncAttemptAt": new Date(),
          },
        }
      )

      // Attempt another sync call while lock is held
      const concurrentResult = await indiamartService.syncIndiaMartLeads(integrationA._id)
      assert(concurrentResult.success === false, "Concurrent sync call prevented")
      assert(concurrentResult.skipped === true, "Concurrent sync marked as skipped: true")
      assert(concurrentResult.reason.includes("already in progress"), "Clear explanation provided: sync already in progress")

      // Release lock
      await Integration.updateOne(
        { _id: integrationA._id },
        {
          $set: {
            "settings.customConfig.isSyncing": false,
          },
        }
      )
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 10: Auth Invalidation / Reconnect-Needed & Rate Limiting Handling")
    console.log("--------------------------------------------------------------------------------")
    {
      // 10A: 401 Auth Error
      const mockAuthFail = async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          CODE: 401,
          STATUS: "FAILURE",
          MESSAGE: "Invalid or Inactive CRM Key. Please generate new key in Seller portal.",
        }),
      })

      let authErr = null
      try {
        await indiamartService.syncIndiaMartLeads(integrationA._id, { customFetch: mockAuthFail })
      } catch (err) {
        authErr = err
      }
      assert(authErr !== null, "Authentication failure thrown as exception")
      assert(authErr.reconnectNeeded === true, "Error tagged with reconnectNeeded: true")

      const reloadedAuth = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      assert(reloadedAuth.status === "error", "Integration status transitioned to 'error'")
      const authCreds = reloadedAuth.getDecryptedCredentials()
      assert(authCreds.reconnectNeeded === true, "Credentials stamped with reconnectNeeded: true")
      assert(authCreds.reconnectReason.includes("Invalid or Inactive"), "Clear reconnectReason saved in credentials")

      // 10B: 429 Rate Limit
      const mockRateLimit = async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          CODE: 429,
          STATUS: "FAILURE",
          MESSAGE: "Rate limit reached: Maximum 1 request allowed per 5 minutes.",
        }),
      })

      let rateErr = null
      try {
        await indiamartService.syncIndiaMartLeads(integrationA._id, { customFetch: mockRateLimit })
      } catch (err) {
        rateErr = err
      }
      assert(rateErr !== null, "Rate limit error trapped cleanly")
      assert(rateErr.rateLimited === true, "Error tagged with rateLimited: true")
      assert(rateErr.statusCode === 429, "Status code 429 preserved on rate limit error")

      const reloadedRate = await Integration.findOne({ _id: integrationA._id, tenantId: tenantA }).setOptions({ skipTenantFilter: true })
      assert(reloadedRate.stats.totalErrors >= 2, "Integration error stats incremented")
      assert(reloadedRate.stats.lastErrorMessage.includes("Rate limit"), "Last error message records rate limit details")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 11: Connection Health & Status API (Integration Studio Contract)")
    console.log("--------------------------------------------------------------------------------")
    {
      const mockReqStatus = { tenantId: tenantA }
      let statusData = null
      const mockResStatus = {
        status: (code) => {
          assert(code === 200, "Status endpoint returned HTTP 200")
          return {
            json: (data) => {
              statusData = data
            },
          }
        },
      }

      await getIndiaMartStatus(mockReqStatus, mockResStatus)
      assert(statusData?.configured === true, "Status reports configured: true")
      assert(statusData?.reconnectNeeded === true, "Status flags reconnectNeeded: true for Integration Studio warning badge")
      assert(statusData?.integration?.crmKeyMasked && statusData.integration.crmKeyMasked !== testCrmKeyA, "Masked key returned in status response")
      assert(statusData?.integration?.stats?.totalSuccess >= 2, "Stats show successful imports")
      assert(statusData?.integration?.stats?.totalErrors >= 2, "Stats show tracked error count")
    }

    console.log("\n--------------------------------------------------------------------------------")
    console.log("TEST 12: Background Queue Job ('indiamart.sync_leads') Worker Execution")
    console.log("--------------------------------------------------------------------------------")
    const testInquiry3 = {
      UNIQUE_QUERY_ID: "im_p25_query_003",
      QUERY_TYPE: "C", // Call Inquiry
      QUERY_TIME: "28-Oct-2026 15:30:00",
      SENDER_NAME: "Karan Johar",
      SENDER_MOBILE: "+91-98200-77889",
      SENDER_EMAIL: "karan@joharindustries.test",
      SENDER_CITY: "Mumbai",
      SENDER_STATE: "Maharashtra",
      PRODUCT_NAME: "Industrial Centrifugal Pump 10 HP",
      SUBJECT: "Call Enquiry for Centrifugal Pump",
      QUERY_MESSAGE: "Buyer called regarding industrial pump quotation.",
      CALL_DURATION: "210",
    }
    {
      // 1. Controller queues background job
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

      // 2. Queue worker claims job
      const claimedJob = await queue.claimNextJob("test-p25-worker", {
        name: "indiamart.sync_leads",
        tenantId: tenantA,
      })
      assert(claimedJob !== null, "Queue worker claimed 'indiamart.sync_leads' job from database")

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

      assert(workerResult.success === true, "Background worker completed sync successfully")
      assert(workerResult.processedCount === 1, "Processed 1 inquiry via background queue execution")

      // Verify lead created by background worker
      const lead3 = await Lead.findOne({ tenantId: tenantA, email: "karan@joharindustries.test" }).lean()
      assert(lead3 !== null, "Lead created in CRM via background worker execution")
      assert(lead3.message.includes("Call Duration: 210s"), "Call duration captured in lead message")
    }

    console.log("\n================================================================================")
    console.log(`=== PHASE 25 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
    console.log("================================================================================\n")
  } catch (outerErr) {
    console.error("FATAL SUITE ERROR:", outerErr)
    failed++
  } finally {
    await mongoose.disconnect()
    console.log("Disconnected from MongoDB")
    process.exit(failed > 0 ? 1 : 0)
  }
}

runPhase25Tests()
