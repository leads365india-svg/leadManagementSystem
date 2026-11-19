const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")
const crypto = require("crypto")

dotenv.config({ path: path.join(__dirname, "../.env") })

const whatsappService = require("../services/whatsappService")
const { Integration } = require("../models/Integration")
const { WhatsAppMessage } = require("../models/WhatsAppMessage")
const { Activity } = require("../models/Activity")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const SystemConfig = require("../models/SystemConfig")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  handleWhatsAppWebhookHandshake,
  handleWhatsAppWebhookNotification,
} = require("../controllers/whatsappWebhookController")
const {
  getWhatsAppGlobalConfig,
  updateWhatsAppGlobalConfig,
  saveTenantWhatsAppConfig,
} = require("../controllers/whatsappAdminController")
const {
  getLeadWhatsAppMessages,
  sendLeadWhatsAppMessage,
} = require("../controllers/whatsappController")

// Helper: Mock Express Response Object
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    type(t) {
      this.headers["content-type"] = t
      return this
    },
    send(data) {
      this.body = data
      return this
    },
    json(data) {
      this.body = data
      return this
    },
  }
  return res
}

async function runTests() {
  console.log("================================================================================")
  console.log("=== MULTI-TENANT WHATSAPP CLOUD API INTEGRATION - VERIFICATION SUITE         ===")
  console.log("================================================================================")

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error("MONGODB_URI not found in environment!")
    process.exit(1)
  }

  process.env.NODE_ENV = "test"
  process.env.MOCK_META_GRAPH = "true"

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

  const tenantA = "TEST-WA-TENANT-ALPHA"
  const tenantB = "TEST-WA-TENANT-BETA"
  const phoneIdA = "109876543210001"
  const phoneIdB = "109876543210002"
  const unknownPhoneId = "999999999999999"

  try {
    // 0. Clean up test records
    console.log("Phase 0: Cleaning up test artifacts...")
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      WhatsAppMessage.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      SystemConfig.deleteOne({ key: "whatsapp_global_config" }),
    ])

    // Seed test accounts
    await Account.create([
      {
        accountId: tenantA,
        companyName: "Alpha Medical Center",
        displayName: "Alpha Medical",
        adminName: "Dr. Alpha",
        adminEmail: "admin@alpha.test",
        adminUserId: new mongoose.Types.ObjectId(),
        status: "active",
      },
      {
        accountId: tenantB,
        companyName: "Beta Dental Clinic",
        displayName: "Beta Dental",
        adminName: "Dr. Beta",
        adminEmail: "admin@beta.test",
        adminUserId: new mongoose.Types.ObjectId(),
        status: "active",
      },
    ])
    console.log("  Test accounts initialized.\n")

    // =========================================================================
    // TEST SUITE 1: Global Config & GET Webhook Handshake Verification
    // =========================================================================
    console.log("--- TEST SUITE 1: Webhook Handshake & Global Meta Configuration ---")
    const testVerifyToken = "leadflow_wa_secret_handshake_test_token"
    const testAppSecret = "mock_meta_app_secret_32_characters_long_123"

    // Update global config via service
    await whatsappService.updateGlobalConfig({
      verifyToken: testVerifyToken,
      appSecret: testAppSecret,
      graphApiVersion: "v21.0",
    })

    const globalCfg = await whatsappService.getGlobalConfig()
    assert(globalCfg.verifyToken === testVerifyToken, "Global verifyToken saved and retrieved")
    assert(globalCfg.appSecret === testAppSecret, "Global appSecret safely decrypted via AES-256-GCM")
    assert(globalCfg.hasAppSecret === true, "hasAppSecret reports true")
    assert(
      globalCfg.appSecretMasked.includes("••••") || globalCfg.appSecretMasked.includes("***"),
      "appSecretMasked obscures sensitive key"
    )

    // Handshake Test 1: Valid handshake
    const validReq = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": testVerifyToken,
        "hub.challenge": "1158201444",
      },
    }
    const validRes = createMockRes()
    await handleWhatsAppWebhookHandshake(validReq, validRes)
    assert(validRes.statusCode === 200, "Handshake returned HTTP 200")
    assert(validRes.body === "1158201444", "Handshake returned raw hub.challenge text")

    // Handshake Test 2: Invalid verify_token rejected with 403
    const invalidTokenReq = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token_here",
        "hub.challenge": "1158201444",
      },
    }
    const invalidTokenRes = createMockRes()
    await handleWhatsAppWebhookHandshake(invalidTokenReq, invalidTokenRes)
    assert(invalidTokenRes.statusCode === 403, "Handshake with wrong token rejected with HTTP 403")

    // Handshake Test 3: Invalid mode rejected with 403
    const invalidModeReq = {
      query: {
        "hub.mode": "unsubscribe",
        "hub.verify_token": testVerifyToken,
        "hub.challenge": "1158201444",
      },
    }
    const invalidModeRes = createMockRes()
    await handleWhatsAppWebhookHandshake(invalidModeReq, invalidModeRes)
    assert(invalidModeRes.statusCode === 403, "Handshake with invalid mode rejected with HTTP 403\n")

    // =========================================================================
    // TEST SUITE 2: Super Admin Per-Tenant Setup & Unique Index Constraints
    // =========================================================================
    console.log("--- TEST SUITE 2: Super Admin Tenant Assignment & Phone Number Uniqueness ---")

    // Assign phoneIdA to Tenant A
    await whatsappService.saveTenantConfig(tenantA, {
      phoneNumberId: phoneIdA,
      wabaId: "WABA_ALPHA_99",
      displayPhoneNumber: "+91 98765 43210",
      accessToken: "EAAB_mock_system_user_token_alpha",
      status: "active",
    })

    const tenantAConfig = await whatsappService.getTenantConfig(tenantA)
    assert(tenantAConfig.configured === true, "Tenant A WhatsApp successfully configured")
    assert(tenantAConfig.phoneNumberId === phoneIdA, "Tenant A mapped to phoneIdA")
    assert(tenantAConfig.hasAccessToken === true, "Tenant A accessToken stored securely")

    // Assign phoneIdB to Tenant B
    await whatsappService.saveTenantConfig(tenantB, {
      phoneNumberId: phoneIdB,
      wabaId: "WABA_BETA_99",
      displayPhoneNumber: "+1 555-0199",
      accessToken: "EAAB_mock_system_user_token_beta",
      status: "active",
    })
    const tenantBConfig = await whatsappService.getTenantConfig(tenantB)
    assert(tenantBConfig.configured === true, "Tenant B WhatsApp successfully configured")
    assert(tenantBConfig.phoneNumberId === phoneIdB, "Tenant B mapped to phoneIdB")

    // Duplicate Phone Number ID rejection test:
    // Tenant B attempts to claim Tenant A's active phoneIdA -> Must be rejected with 409 Conflict
    let duplicateRejected = false
    try {
      await whatsappService.saveTenantConfig(tenantB, {
        phoneNumberId: phoneIdA,
        status: "active",
      })
    } catch (err) {
      if (err.statusCode === 409 || err.message.includes("already actively assigned")) {
        duplicateRejected = true
      }
    }
    assert(
      duplicateRejected,
      "Cross-tenant collision prevention: Tenant B prevented from claiming Tenant A's phone number ID (409 Conflict)\n"
    )

    // =========================================================================
    // TEST SUITE 3: Central Webhook Routing & Strict Multi-Tenant Isolation
    // =========================================================================
    console.log("--- TEST SUITE 3: Central Multi-Tenant Webhook Routing (Zero Leakage) ---")

    // Construct Meta Webhook Payload for Tenant A
    const msgIdA = `wamid.HBgLM_TEST_MSG_A_${Date.now()}`
    const senderPhoneA = "919876543210" // Will be normalized to +919876543210
    const payloadA = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ALPHA_99",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "919876543210",
                  phone_number_id: phoneIdA,
                },
                contacts: [
                  {
                    profile: { name: "Pawan Harish (Alpha Patient)" },
                    wa_id: senderPhoneA,
                  },
                ],
                messages: [
                  {
                    from: senderPhoneA,
                    id: msgIdA,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Hello Alpha Clinic, I need an appointment" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    // Deliver payloadA through controller
    const resA = createMockRes()
    const reqA = {
      body: payloadA,
      rawBody: JSON.stringify(payloadA),
      headers: {
        "x-hub-signature-256": `sha256=${crypto
          .createHmac("sha256", testAppSecret)
          .update(JSON.stringify(payloadA))
          .digest("hex")}`,
      },
    }
    await handleWhatsAppWebhookNotification(reqA, resA)
    assert(resA.statusCode === 200, "Webhook processed Tenant A message and returned 200 OK")

    // Verify Tenant A Lead created
    const leadA = await Lead.findOne({ tenantId: tenantA, "phoneNormalized": "+919876543210" }).setOptions({ skipTenantFilter: true })
    assert(Boolean(leadA), "Lead automatically created under Tenant A with normalized E.164 phone")
    assert(leadA?.name === "Pawan Harish (Alpha Patient)", "Lead name parsed from Meta contacts profile")
    assert(leadA?.source === "WhatsApp Cloud API", "Lead source correctly set to 'WhatsApp Cloud API'")

    // Verify Tenant A WhatsAppMessage created
    const savedMsgA = await WhatsAppMessage.findOne({
      tenantId: tenantA,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })
    assert(Boolean(savedMsgA), "WhatsAppMessage persisted for Tenant A")
    assert(savedMsgA?.direction === "inbound", "Message direction is 'inbound'")
    assert(savedMsgA?.body === "Hello Alpha Clinic, I need an appointment", "Message body correctly stored")

    // Verify Tenant A Activity entry
    const actA = await Activity.findOne({
      tenantId: tenantA,
      leadId: leadA._id,
      type: "whatsapp.message_received",
    }).setOptions({ skipTenantFilter: true })
    assert(Boolean(actA), "Activity timeline event recorded for Tenant A lead")

    // ZERO CROSS-TENANT LEAKAGE CHECK:
    // Ensure Tenant B has ZERO records of msgIdA or leadA!
    const leakCheckMsg = await WhatsAppMessage.findOne({
      tenantId: tenantB,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })
    assert(leakCheckMsg === null, "Zero leakage: Message A does NOT exist in Tenant B workspace")

    const leakCheckLead = await Lead.findOne({
      tenantId: tenantB,
      phoneNormalized: "+919876543210",
    }).setOptions({ skipTenantFilter: true })
    assert(leakCheckLead === null, "Zero leakage: Lead A does NOT exist in Tenant B workspace")

    // Deliver payload for Tenant B
    const msgIdB = `wamid.HBgLM_TEST_MSG_B_${Date.now()}`
    const senderPhoneB = "15550199222"
    const payloadB = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_BETA_99",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550199",
                  phone_number_id: phoneIdB,
                },
                contacts: [
                  {
                    profile: { name: "Sarah Connor (Beta Client)" },
                    wa_id: senderPhoneB,
                  },
                ],
                messages: [
                  {
                    from: senderPhoneB,
                    id: msgIdB,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Beta Dental question regarding tooth whitening" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const resB = createMockRes()
    const reqB = {
      body: payloadB,
      rawBody: JSON.stringify(payloadB),
      headers: {
        "x-hub-signature-256": `sha256=${crypto
          .createHmac("sha256", testAppSecret)
          .update(JSON.stringify(payloadB))
          .digest("hex")}`,
      },
    }
    await handleWhatsAppWebhookNotification(reqB, resB)
    assert(resB.statusCode === 200, "Webhook processed Tenant B message and returned 200 OK")

    const savedMsgB = await WhatsAppMessage.findOne({
      tenantId: tenantB,
      externalMessageId: msgIdB,
    }).setOptions({ skipTenantFilter: true })
    assert(Boolean(savedMsgB), "WhatsAppMessage persisted for Tenant B")
    assert(savedMsgB?.phoneNumberId === phoneIdB, "Tenant B message assigned to phoneIdB")

    // Zero cross-tenant leakage reverse check
    const leakCheckReverse = await WhatsAppMessage.findOne({
      tenantId: tenantA,
      externalMessageId: msgIdB,
    }).setOptions({ skipTenantFilter: true })
    assert(leakCheckReverse === null, "Zero leakage: Message B does NOT exist in Tenant A workspace\n")

    // =========================================================================
    // TEST SUITE 4: Unknown / Inactive Phone Number Handling (Silent Drop)
    // =========================================================================
    console.log("--- TEST SUITE 4: Unknown Phone Number Safe Silent Drop ---")
    const unknownPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_UNKNOWN",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  phone_number_id: unknownPhoneId,
                },
                messages: [
                  {
                    from: "919999999999",
                    id: "wamid.UNKNOWN_MSG_123",
                    type: "text",
                    text: { body: "Spam or unmapped tenant message" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const resUnknown = createMockRes()
    const reqUnknown = {
      body: unknownPayload,
      rawBody: JSON.stringify(unknownPayload),
      headers: {
        "x-hub-signature-256": `sha256=${crypto
          .createHmac("sha256", testAppSecret)
          .update(JSON.stringify(unknownPayload))
          .digest("hex")}`,
      },
    }
    await handleWhatsAppWebhookNotification(reqUnknown, resUnknown)
    assert(resUnknown.statusCode === 200, "Unknown phone_number_id safely returns 200 OK to Meta")

    const unknownMsgCheck = await WhatsAppMessage.findOne({
      externalMessageId: "wamid.UNKNOWN_MSG_123",
    }).setOptions({ skipTenantFilter: true })
    assert(unknownMsgCheck === null, "Unknown phone_number_id dropped silently without creating records\n")

    // =========================================================================
    // TEST SUITE 5: Deduplication & Idempotency
    // =========================================================================
    console.log("--- TEST SUITE 5: Idempotency & Deduplication ---")
    const initialMsgCount = await WhatsAppMessage.countDocuments({
      tenantId: tenantA,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })

    // Send payloadA AGAIN with exact same msgIdA
    const resDuplicate = createMockRes()
    await handleWhatsAppWebhookNotification(reqA, resDuplicate)
    assert(resDuplicate.statusCode === 200, "Duplicate webhook payload returned 200 OK")

    const finalMsgCount = await WhatsAppMessage.countDocuments({
      tenantId: tenantA,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })
    assert(
      finalMsgCount === initialMsgCount && finalMsgCount === 1,
      "Duplicate externalMessageId discarded idempotently without duplicating record\n"
    )

    // =========================================================================
    // TEST SUITE 6: Delivery Status Receipts (delivered, read, failed)
    // =========================================================================
    console.log("--- TEST SUITE 6: Delivery Status Receipts Scoped by Tenant ---")

    // 1. Send status 'delivered'
    const statusPayloadDelivered = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ALPHA_99",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  phone_number_id: phoneIdA,
                },
                statuses: [
                  {
                    id: msgIdA,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: senderPhoneA,
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const resDelivered = createMockRes()
    const reqDelivered = {
      body: statusPayloadDelivered,
      rawBody: JSON.stringify(statusPayloadDelivered),
      headers: {
        "x-hub-signature-256": `sha256=${crypto
          .createHmac("sha256", testAppSecret)
          .update(JSON.stringify(statusPayloadDelivered))
          .digest("hex")}`,
      },
    }
    await handleWhatsAppWebhookNotification(reqDelivered, resDelivered)
    assert(resDelivered.statusCode === 200, "Status delivered returned 200 OK")

    const deliveredMsg = await WhatsAppMessage.findOne({
      tenantId: tenantA,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })
    assert(deliveredMsg?.status === "delivered", "WhatsAppMessage.status updated to 'delivered'")

    // 2. Send status 'read'
    const statusPayloadRead = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ALPHA_99",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  phone_number_id: phoneIdA,
                },
                statuses: [
                  {
                    id: msgIdA,
                    status: "read",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: senderPhoneA,
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    const resRead = createMockRes()
    const reqRead = {
      body: statusPayloadRead,
      rawBody: JSON.stringify(statusPayloadRead),
      headers: {
        "x-hub-signature-256": `sha256=${crypto
          .createHmac("sha256", testAppSecret)
          .update(JSON.stringify(statusPayloadRead))
          .digest("hex")}`,
      },
    }
    await handleWhatsAppWebhookNotification(reqRead, resRead)
    assert(resRead.statusCode === 200, "Status read returned 200 OK")

    const readMsg = await WhatsAppMessage.findOne({
      tenantId: tenantA,
      externalMessageId: msgIdA,
    }).setOptions({ skipTenantFilter: true })
    assert(readMsg?.status === "read", "WhatsAppMessage.status updated to 'read'\n")

    // =========================================================================
    // TEST SUITE 7: Outbound Messaging & Chat History API
    // =========================================================================
    console.log("--- TEST SUITE 7: Tenant Outbound Reply & Chat History Retrieval ---")

    // Send Outbound Message for Tenant A via Controller
    const outboundReq = {
      tenantId: tenantA,
      user: {
        _id: new mongoose.Types.ObjectId(),
        tenantId: tenantA,
        name: "Dr. Ramesh (Admin)",
        email: "dr.ramesh@alphamed.com",
        role: "admin",
      },
      params: { id: leadA._id.toString() },
      body: { message: "Hello Pawan, we have confirmed your appointment for 4:00 PM today." },
    }
    const outboundRes = createMockRes()
    await sendLeadWhatsAppMessage(outboundReq, outboundRes)
    assert(outboundRes.statusCode === 200, "sendLeadWhatsAppMessage returned HTTP 200")
    assert(Boolean(outboundRes.body?.data), "Outbound message record returned")

    // Verify Outbound WhatsAppMessage persisted
    const savedOutbound = await WhatsAppMessage.findOne({
      tenantId: tenantA,
      leadId: leadA._id,
      direction: "outbound",
    }).setOptions({ skipTenantFilter: true })
    assert(Boolean(savedOutbound), "Outbound message stored in WhatsAppMessage")
    assert(savedOutbound?.status === "sent", "Outbound message status initialized to 'sent'")
    assert(savedOutbound?.body.includes("confirmed your appointment"), "Outbound message body matches")

    // Verify Outbound Activity persisted
    const outboundAct = await Activity.findOne({
      tenantId: tenantA,
      leadId: leadA._id,
      type: "whatsapp.message_sent",
    }).setOptions({ skipTenantFilter: true })
    assert(Boolean(outboundAct), "Outbound message recorded in Lead Activity Timeline")

    // Retrieve Chat History for Lead A via Controller
    const historyReq = {
      tenantId: tenantA,
      params: { id: leadA._id.toString() },
    }
    const historyRes = createMockRes()
    await getLeadWhatsAppMessages(historyReq, historyRes)
    assert(historyRes.statusCode === 200, "getLeadWhatsAppMessages returned HTTP 200")
    assert(Array.isArray(historyRes.body?.data), "Chat history returned as array")
    assert(historyRes.body.data.length === 2, "Chat history contains 2 messages (1 inbound + 1 outbound)")
    assert(historyRes.body.data[0].direction === "inbound", "First message is inbound")
    assert(historyRes.body.data[1].direction === "outbound", "Second message is outbound")

    // Cross-tenant chat history isolation:
    // Tenant B attempting to read Lead A's messages gets empty array or 404
    const crossHistoryReq = {
      tenantId: tenantB,
      params: { id: leadA._id.toString() },
    }
    const crossHistoryRes = createMockRes()
    await getLeadWhatsAppMessages(crossHistoryReq, crossHistoryRes)
    assert(
      crossHistoryRes.body?.data?.length === 0,
      "Cross-tenant isolation: Tenant B query on Lead A returns zero messages"
    )

    console.log("\n================================================================================")
    console.log(`=== TEST SUMMARY: ${passed} PASSED | ${failed} FAILED ===`)
    console.log("================================================================================")

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error("Test execution failed with error:", err)
    process.exit(1)
  } finally {
    // Clean up test data
    await Promise.all([
      Integration.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      WhatsAppMessage.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Activity.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Lead.deleteMany({ tenantId: { $in: [tenantA, tenantB] } }).setOptions({ skipTenantFilter: true }),
      Account.deleteMany({ accountId: { $in: [tenantA, tenantB] } }),
      SystemConfig.deleteOne({ key: "whatsapp_global_config" }),
    ])
    await mongoose.disconnect()
    console.log("Disconnected from database.")
  }
}

runTests()
