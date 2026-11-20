const assert = require("assert")
const mongoose = require("mongoose")
require("dotenv").config({ path: "d:/LEADS/Leads-365/backend/.env" })

const WhatsAppQrSession = require("../models/WhatsAppQrSession")
const WhatsAppQrAuth = require("../models/WhatsAppQrAuth")
const { WhatsAppMessage } = require("../models/WhatsAppMessage")
const Lead = require("../models/Lead")
const TenantPhoneContact = require("../models/TenantPhoneContact")
const WhatsAppSuppressedNumber = require("../models/WhatsAppSuppressedNumber")
const whatsappQrService = require("../services/whatsappQrService")
const {
  useMongoAuthState,
  handleMessagesUpsert,
  extractMessageContent,
  extractPhoneFromJid,
  disconnectSession,
  getSessionStatus,
} = whatsappQrService
const {
  getQrStatus,
  connectQrSession,
  disconnectQrSession,
  syncContacts,
} = require("../controllers/whatsappQrController")
const { createLead, deleteLead } = require("../controllers/leadController")

async function runTestSuite() {
  console.log("==================================================================")
  console.log("  FREE MULTI-TENANT WHATSAPP QR SYNC VERIFICATION SUITE")
  console.log("  (Including Contact-Aware Filtering & Suppression/Recovery)")
  console.log("==================================================================\n")

  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/leads365"
  await mongoose.connect(mongoUri)
  console.log("✅ Connected to MongoDB\n")

  const TENANT_A = "ACC-TEST-WA-A-" + Date.now()
  const TENANT_B = "ACC-TEST-WA-B-" + Date.now()

  let passed = 0
  let failed = 0

  async function test(name, fn) {
    try {
      await fn()
      console.log(`  ✔ PASS: ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`)
      console.error("    Error:", err.message)
      failed++
    }
  }

  try {
    // -------------------------------------------------------------
    // 1. BufferJSON MongoDB Auth Adapter State Test
    // -------------------------------------------------------------
    await test("MongoDB Auth Adapter: Persists and revives creds & Signal keys via BufferJSON", async () => {
      const auth = await useMongoAuthState(TENANT_A)
      assert(auth.state.creds, "creds object must exist")
      assert(typeof auth.saveCreds === "function", "saveCreds must be a function")

      // Update creds and save
      auth.state.creds.me = { id: "919999000001:1@s.whatsapp.net", name: "Test Merchant" }
      await auth.saveCreds()

      // Set Signal keys
      const sampleKeyBuffer = Buffer.from("baileys-crypto-signal-key-payload-12345", "utf-8")
      await auth.state.keys.set({
        "pre-key": {
          "1": { keyPair: { public: sampleKeyBuffer, private: sampleKeyBuffer } },
        },
        "session": {
          "919876543210@s.whatsapp.net": sampleKeyBuffer,
        },
      })

      // Retrieve via a fresh adapter instance
      const freshAuth = await useMongoAuthState(TENANT_A)
      assert.strictEqual(freshAuth.state.creds.me.name, "Test Merchant")
      assert.strictEqual(freshAuth.state.creds.me.id, "919999000001:1@s.whatsapp.net")

      const keys = await freshAuth.state.keys.get("session", ["919876543210@s.whatsapp.net"])
      assert(keys["919876543210@s.whatsapp.net"], "session key must be retrieved")
      assert(Buffer.isBuffer(keys["919876543210@s.whatsapp.net"]), "session key must be revived as Buffer")
      assert.strictEqual(
        keys["919876543210@s.whatsapp.net"].toString("utf-8"),
        "baileys-crypto-signal-key-payload-12345"
      )

      // Verify raw docs in WhatsAppQrAuth collection
      const credsDoc = await WhatsAppQrAuth.findOne({ tenantId: TENANT_A, keyId: "creds" })
        .setOptions({ skipTenantFilter: true })
      assert(credsDoc, "creds document must exist in WhatsAppQrAuth")
    })

    // -------------------------------------------------------------
    // 2. Message Parsing & Phone Extraction
    // -------------------------------------------------------------
    await test("extractPhoneFromJid & extractMessageContent parse peer number and payload", async () => {
      const phone1 = extractPhoneFromJid("919876543210@s.whatsapp.net")
      assert.strictEqual(phone1, "+919876543210")

      const textMsg = extractMessageContent({
        message: { conversation: "Hello from customer" },
      })
      assert.strictEqual(textMsg.body, "Hello from customer")
      assert.strictEqual(textMsg.type, "text")

      const imgMsg = extractMessageContent({
        message: { imageMessage: { caption: "Look at this product" } },
      })
      assert.strictEqual(imgMsg.body, "Look at this product")
      assert.strictEqual(imgMsg.type, "image")
    })

    // -------------------------------------------------------------
    // 3. Scenario 1: Unknown Unsaved Number -> Creates Lead + Saves Inbound & Outbound Messages
    // -------------------------------------------------------------
    await test("Scenario 1: Unknown unsaved number -> auto-creates Lead & mirrors inbound/outbound messages with normalizedPhone", async () => {
      const mockSession = {
        tenantId: TENANT_A,
        phoneNumber: "+919999000001",
      }

      const inboundMsg = {
        key: {
          remoteJid: "919876543210@s.whatsapp.net",
          fromMe: false,
          id: "WA_TEST_MSG_INBOUND_001",
        },
        message: {
          conversation: "Hi, I am interested in your pricing plan.",
        },
        pushName: "Rohan Sharma",
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [inboundMsg], mockSession)

      // 1. Verify Lead was created in Tenant A
      const lead = await Lead.findOne({
        tenantId: TENANT_A,
        phoneNormalized: "+919876543210",
      }).setOptions({ skipTenantFilter: true })

      assert(lead, "Lead must be created for inbound WhatsApp customer")
      assert.strictEqual(lead.source, "WhatsApp")
      assert.strictEqual(lead.name, "Rohan Sharma")

      // 2. Verify WhatsAppMessage was created with normalizedPhone
      const waMsg = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "WA_TEST_MSG_INBOUND_001",
      }).setOptions({ skipTenantFilter: true })

      assert(waMsg, "WhatsAppMessage must be mirrored in DB")
      assert.strictEqual(waMsg.direction, "inbound")
      assert.strictEqual(waMsg.status, "received")
      assert.strictEqual(waMsg.body, "Hi, I am interested in your pricing plan.")
      assert.strictEqual(waMsg.normalizedPhone, "+919876543210")
      assert.strictEqual(waMsg.leadId.toString(), lead._id.toString())

      // 3. Outbound reply from phone
      const outboundMsg = {
        key: {
          remoteJid: "919876543210@s.whatsapp.net",
          fromMe: true,
          id: "WA_TEST_MSG_OUTBOUND_001",
        },
        message: {
          conversation: "Sure Rohan! Our pricing starts at Rs. 4,999/month.",
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [outboundMsg], mockSession)

      const waOut = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "WA_TEST_MSG_OUTBOUND_001",
      }).setOptions({ skipTenantFilter: true })

      assert(waOut, "Outbound message must be mirrored in DB")
      assert.strictEqual(waOut.direction, "outbound")
      assert.strictEqual(waOut.status, "sent")
      assert.strictEqual(waOut.normalizedPhone, "+919876543210")
      assert.strictEqual(waOut.leadId.toString(), lead._id.toString())
    })

    // -------------------------------------------------------------
    // 4. Scenario 2: Existing CRM Lead -> Keeps Syncing Even If in TenantPhoneContact
    // -------------------------------------------------------------
    await test("Scenario 2: Existing CRM Lead continues receiving messages even if number is added to TenantPhoneContact", async () => {
      const mockSession = { tenantId: TENANT_A, phoneNumber: "+919999000001" }

      // Now add Rohan to TenantPhoneContact (saved in phone address book)
      await TenantPhoneContact.create({
        tenantId: TENANT_A,
        name: "Rohan Sharma Friend",
        phone: "+919876543210",
        normalizedPhone: "+919876543210",
      })

      const followUpMsg = {
        key: {
          remoteJid: "919876543210@s.whatsapp.net",
          fromMe: false,
          id: "WA_TEST_MSG_INBOUND_002",
        },
        message: { conversation: "Can you send a demo link?" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [followUpMsg], mockSession)

      const waMsg = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "WA_TEST_MSG_INBOUND_002",
      }).setOptions({ skipTenantFilter: true })

      assert(waMsg, "Message for existing lead must be captured even if in contacts")
      assert.strictEqual(waMsg.body, "Can you send a demo link?")
      assert(waMsg.leadId, "Must remain linked to existing CRM Lead")
    })

    // -------------------------------------------------------------
    // 5. Scenario 3: Saved Phone Contact (No CRM Lead) -> Ignored, No Lead Created
    // -------------------------------------------------------------
    await test("Scenario 3: Saved phone contact (TenantPhoneContact, no CRM Lead) -> ignored, no Lead created", async () => {
      const mockSession = { tenantId: TENANT_A, phoneNumber: "+919999000001" }

      // Personal friend or family saved in phone
      await TenantPhoneContact.create({
        tenantId: TENANT_A,
        name: "Mom / Personal Contact",
        phone: "+919888877777",
        normalizedPhone: "+919888877777",
      })

      const personalMsg = {
        key: {
          remoteJid: "919888877777@s.whatsapp.net",
          fromMe: false,
          id: "WA_PERSONAL_MSG_001",
        },
        message: { conversation: "Hey, are you coming home for dinner?" },
        pushName: "Mom",
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [personalMsg], mockSession)

      // Verify NO Lead was created
      const momLead = await Lead.findOne({
        tenantId: TENANT_A,
        phoneNormalized: "+919888877777",
      }).setOptions({ skipTenantFilter: true })

      assert.strictEqual(momLead, null, "Must NOT create Lead for saved phone contact")

      // Verify message was not saved
      const momMsg = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "WA_PERSONAL_MSG_001",
      }).setOptions({ skipTenantFilter: true })

      assert.strictEqual(momMsg, null, "Must NOT save message for saved phone contact without Lead")
    })

    // -------------------------------------------------------------
    // 6. Scenario 4: Deleting Lead -> Adds to WhatsAppSuppressedNumber, Preserves Messages with leadId: null
    // -------------------------------------------------------------
    await test("Scenario 4: Deleting a Lead suppresses future auto-creation and preserves messages with leadId: null", async () => {
      // Find Rohan's lead
      const rohanLead = await Lead.findOne({
        tenantId: TENANT_A,
        phoneNormalized: "+919876543210",
      }).setOptions({ skipTenantFilter: true })
      assert(rohanLead, "Rohan lead must exist before deletion")

      const mockReq = {
        params: { id: rohanLead._id.toString() },
        user: { role: "account_admin", tenantId: TENANT_A, _id: new mongoose.Types.ObjectId() },
      }
      let resStatus = null
      let resJson = null
      const mockRes = {
        status: (code) => {
          resStatus = code
          return {
            json: (payload) => {
              resJson = payload
            },
          }
        },
      }

      // Call deleteLead controller
      await deleteLead(mockReq, mockRes)
      assert.strictEqual(resStatus, 200, "Lead deletion must return 200")
      assert.strictEqual(resJson.success, true)

      // 1. Verify number is in WhatsAppSuppressedNumber
      const suppressed = await WhatsAppSuppressedNumber.findOne({
        tenantId: TENANT_A,
        normalizedPhone: "+919876543210",
      }).setOptions({ skipTenantFilter: true })
      assert(suppressed, "Deleted phone number must be added to WhatsAppSuppressedNumber")

      // 2. Verify WhatsAppMessage records still exist but have leadId: null
      const preservedMessages = await WhatsAppMessage.find({
        tenantId: TENANT_A,
        normalizedPhone: "+919876543210",
      }).setOptions({ skipTenantFilter: true })

      assert(preservedMessages.length >= 2, "Historical WhatsApp messages must be preserved")
      for (const m of preservedMessages) {
        assert.strictEqual(m.leadId, null, "Preserved messages must have leadId unlinked to null")
      }

      // 3. Subsequent WhatsApp message from Rohan does NOT recreate the Lead
      const mockSession = { tenantId: TENANT_A, phoneNumber: "+919999000001" }
      const postDeleteMsg = {
        key: {
          remoteJid: "919876543210@s.whatsapp.net",
          fromMe: false,
          id: "WA_POST_DELETE_MSG_001",
        },
        message: { conversation: "Hello again, any update?" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [postDeleteMsg], mockSession)

      const recreatedLead = await Lead.findOne({
        tenantId: TENANT_A,
        phoneNormalized: "+919876543210",
        deletedAt: null,
      }).setOptions({ skipTenantFilter: true })

      assert.strictEqual(recreatedLead, null, "Suppressed number must NOT auto-recreate a deleted Lead")
    })

    // -------------------------------------------------------------
    // 7. Scenario 5: Manually Re-creating Lead -> Removes Suppression & Re-links Preserved Messages
    // -------------------------------------------------------------
    await test("Scenario 5: Manually re-creating Lead removes suppression and re-links preserved WhatsApp history", async () => {
      const mockReq = {
        body: {
          name: "Rohan Sharma Recreated",
          email: "rohan.recreated@example.com",
          phone: "+919876543210",
          source: "Manual Entry",
          tenantId: TENANT_A,
        },
        user: { role: "account_admin", tenantId: TENANT_A, _id: new mongoose.Types.ObjectId() },
      }
      let resStatus = null
      let resJson = null
      const mockRes = {
        status: (code) => {
          resStatus = code
          return {
            json: (payload) => {
              resJson = payload
            },
          }
        },
      }

      // Call createLead controller
      await createLead(mockReq, mockRes)
      assert.strictEqual(resStatus, 201, "Manual lead creation must return 201")
      assert.strictEqual(resJson.success, true)
      const newLead = resJson.data

      // 1. Verify suppression was removed from WhatsAppSuppressedNumber
      const suppressed = await WhatsAppSuppressedNumber.findOne({
        tenantId: TENANT_A,
        normalizedPhone: "+919876543210",
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(suppressed, null, "Suppression must be removed upon manual lead recreation")

      // 2. Verify historical WhatsApp messages were re-linked to newLead._id
      const relinkedMessages = await WhatsAppMessage.find({
        tenantId: TENANT_A,
        normalizedPhone: "+919876543210",
      }).setOptions({ skipTenantFilter: true })

      assert(relinkedMessages.length >= 2, "Messages must exist")
      for (const m of relinkedMessages) {
        assert.strictEqual(
          m.leadId?.toString(),
          newLead._id?.toString() || newLead.id?.toString(),
          "Preserved message must be re-linked to the new lead ID"
        )
      }
    })

    // -------------------------------------------------------------
    // 8. Contacts Sync API: POST /api/integrations/whatsapp-qr/sync-contacts
    // -------------------------------------------------------------
    await test("Contacts Sync API: Normalizes and batch upserts device contacts per tenant", async () => {
      const mockReq = {
        tenantId: TENANT_B,
        user: { role: "account_admin", tenantId: TENANT_B, name: "Admin B" },
        body: {
          contacts: [
            { name: "Vendor Alpha", phone: "9811122233" },
            { name: "Doctor Beta", phone: "+91 98222 33344" },
            { name: "Supplier Gamma", phone: "09833344455" },
          ],
        },
      }
      let resStatus = null
      let resJson = null
      const mockRes = {
        status: (code) => {
          resStatus = code
          return {
            json: (payload) => {
              resJson = payload
            },
          }
        },
      }

      await syncContacts(mockReq, mockRes)
      assert.strictEqual(resStatus, 200)
      assert.strictEqual(resJson.success, true)
      assert.strictEqual(resJson.data.syncedCount, 3)

      const contactsB = await TenantPhoneContact.find({ tenantId: TENANT_B })
        .setOptions({ skipTenantFilter: true })
      assert.strictEqual(contactsB.length, 3)
      assert(contactsB.some((c) => c.normalizedPhone === "+919811122233"))
      assert(contactsB.some((c) => c.normalizedPhone === "+919822233344"))
      assert(contactsB.some((c) => c.normalizedPhone === "+919833344455"))
    })

    // -------------------------------------------------------------
    // 9. Deduplication Idempotency Test
    // -------------------------------------------------------------
    await test("Idempotency: Reprocessing identical waMessageId does NOT create duplicate records", async () => {
      const mockSession = { tenantId: TENANT_A, phoneNumber: "+919999000001" }
      const duplicateMsg = {
        key: {
          remoteJid: "919876543210@s.whatsapp.net",
          fromMe: false,
          id: "WA_TEST_MSG_INBOUND_001",
        },
        message: { conversation: "Hi, I am interested in your pricing plan." },
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_A, [duplicateMsg], mockSession)

      const count = await WhatsAppMessage.countDocuments({
        tenantId: TENANT_A,
        externalMessageId: "WA_TEST_MSG_INBOUND_001",
      }).setOptions({ skipTenantFilter: true })

      assert.strictEqual(count, 1, "Must not create duplicate message record for same externalMessageId")
    })

    // -------------------------------------------------------------
    // 10. Group and Newsletter Filtering
    // -------------------------------------------------------------
    await test("Filters: Ignores groups, broadcast, newsletters, and protocol messages", async () => {
      const mockSession = { tenantId: TENANT_A, phoneNumber: "+919999000001" }
      const ignoredMessages = [
        {
          key: { remoteJid: "123456789-987654@g.us", fromMe: false, id: "GROUP_MSG_001" },
          message: { conversation: "Group chatter" },
        },
        {
          key: { remoteJid: "status@broadcast", fromMe: false, id: "STATUS_MSG_001" },
          message: { conversation: "Status update" },
        },
        {
          key: { remoteJid: "123456@newsletter", fromMe: false, id: "NEWS_MSG_001" },
          message: { conversation: "Newsletter headline" },
        },
        {
          key: { remoteJid: "919876543210@s.whatsapp.net", fromMe: false, id: "PROTO_MSG_001" },
          message: { protocolMessage: { type: 0 } },
        },
      ]

      await handleMessagesUpsert(TENANT_A, ignoredMessages, mockSession)

      const groupMsg = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "GROUP_MSG_001",
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(groupMsg, null, "Group message must be ignored")

      const statusMsg = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "STATUS_MSG_001",
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(statusMsg, null, "Status message must be ignored")
    })

    // -------------------------------------------------------------
    // 11. Multi-Tenant Strict Isolation
    // -------------------------------------------------------------
    await test("Multi-Tenant Isolation: Tenant A and Tenant B data are strictly isolated", async () => {
      const mockSessionB = { tenantId: TENANT_B, phoneNumber: "+919999000002" }
      const msgB = {
        key: {
          remoteJid: "919111222333@s.whatsapp.net",
          fromMe: false,
          id: "WA_TENANT_B_MSG_001",
        },
        message: { conversation: "Tenant B private message" },
        pushName: "Customer B",
        messageTimestamp: Math.floor(Date.now() / 1000),
      }

      await handleMessagesUpsert(TENANT_B, [msgB], mockSessionB)

      // Tenant A cannot query Tenant B's message
      const msgInA = await WhatsAppMessage.findOne({
        tenantId: TENANT_A,
        externalMessageId: "WA_TENANT_B_MSG_001",
      }).setOptions({ skipTenantFilter: true })
      assert.strictEqual(msgInA, null, "Tenant A must NOT have access to Tenant B's message")

      // Tenant B can find its own message
      const msgInB = await WhatsAppMessage.findOne({
        tenantId: TENANT_B,
        externalMessageId: "WA_TENANT_B_MSG_001",
      }).setOptions({ skipTenantFilter: true })
      assert(msgInB, "Tenant B must find its own message")
      assert.strictEqual(msgInB.body, "Tenant B private message")
    })

    // -------------------------------------------------------------
    // 12. Session Disconnect and Auth Cleanup
    // -------------------------------------------------------------
    await test("disconnectSession: Cleanly deletes auth keys and sets status to disconnected", async () => {
      // Create session in connected state
      await WhatsAppQrSession.findOneAndUpdate(
        { tenantId: TENANT_A },
        {
          tenantId: TENANT_A,
          status: "connected",
          phoneNumber: "+919999000001",
          pushName: "Test Merchant",
          connectedAt: new Date(),
        },
        { upsert: true, new: true }
      ).setOptions({ skipTenantFilter: true })

      const res = await disconnectSession(TENANT_A)
      assert.strictEqual(res.success, true)

      const status = await getSessionStatus(TENANT_A)
      assert.strictEqual(status.status, "disconnected")
      assert.strictEqual(status.phoneNumber, "")
      assert.strictEqual(status.pushName, "")

      // Verify all auth docs deleted for Tenant A
      const remainingAuthCount = await WhatsAppQrAuth.countDocuments({ tenantId: TENANT_A })
        .setOptions({ skipTenantFilter: true })
      assert.strictEqual(remainingAuthCount, 0, "All WhatsAppQrAuth docs must be removed on disconnect")
    })

  } finally {
    // Cleanup test fixtures
    console.log("\n🧹 Cleaning up test fixtures...")
    await Promise.all([
      WhatsAppQrAuth.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
      WhatsAppQrSession.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
      WhatsAppMessage.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
      TenantPhoneContact.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
      WhatsAppSuppressedNumber.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
      Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true }),
    ])
    await mongoose.disconnect()
    console.log("✅ MongoDB disconnected")
  }

  console.log("\n==================================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("==================================================================")

  if (failed > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runTestSuite().catch((err) => {
  console.error("Test suite runner crashed:", err)
  process.exit(1)
})
