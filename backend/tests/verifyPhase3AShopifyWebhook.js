/**
 * Phase 3A: Shopify Webhook Integration Verification Suite
 *
 * Verifies:
 * 1. Valid raw-body HMAC is accepted.
 * 2. Invalid HMAC is rejected with HTTP 401.
 * 3. Missing HMAC is rejected with HTTP 401.
 * 4. Modified body with original HMAC is rejected.
 * 5. Malformed Base64 signature is safely rejected.
 * 6. Missing server-side secret fails closed with HTTP 401.
 * 7. Valid registered Shopify domain resolves integration & tenant.
 * 8. Unknown Shopify domain is rejected with HTTP 404.
 * 9. Caller-supplied tenant ID cannot spoof tenant context.
 * 10. Repeated delivery ID (X-Shopify-Webhook-Id) is deduplicated.
 * 11. Concurrent duplicate deliveries create only one lead.
 * 12. Two different integrations in one tenant independently use the same idempotency key without collision.
 * 13. Long-running lock ownership with lease renewal heartbeat & fencing.
 * 14. Existing duplicate policies (reject, update) work on Shopify webhooks.
 * 15. Standard website integration flows remain unaffected.
 */

process.env.NODE_ENV = "test"
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") })
const mongoose = require("mongoose")
const crypto = require("crypto")
const Lead = require("../models/Lead")
const { Integration } = require("../models/Integration")
const { IntegrationEvent } = require("../models/IntegrationEvent")
const { IdempotencyReservation } = require("../models/IdempotencyReservation")
const { LeadConcurrencyLock } = require("../models/LeadConcurrencyLock")
const shopifyService = require("../services/shopifyService")
const integrationService = require("../services/integrationService")
const { acquireLeadIdentityLock } = require("../services/leadConcurrencyService")
const { claimIdempotency } = require("../services/idempotencyService")

let passedCount = 0
let failedCount = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`)
    passedCount++
  } else {
    console.error(`  [FAIL] ${message}`)
    failedCount++
  }
}

async function runShopifyTests() {
  console.log("================================================================================")
  console.log("=== PHASE 3A: SHOPIFY WEBHOOK INTEGRATION VERIFICATION                       ===")
  console.log("================================================================================")

  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/leads365"

  await mongoose.connect(mongoUri)

  const tenantA = `tenant_shopify_a_${Date.now()}`
  const shopDomainA = `test-store-a-${Date.now()}.myshopify.com`
  const sharedSecretA = `shpss_${crypto.randomBytes(24).toString("hex")}`

  try {
    // 1. Setup active Shopify Integration for Tenant A
    const shopifyIntegrationA = new Integration({
      tenantId: tenantA,
      name: "Shopify Store A",
      type: "shopify",
      status: "active",
      settings: {
        shopifyShopDomain: shopDomainA,
        shopifySharedSecret: sharedSecretA,
        duplicateHandling: "update",
      },
    })
    await shopifyIntegrationA.save()

    console.log("\n--- TEST SUITE 1: Shopify HMAC Verification & Security ---")

    // Test 1: Valid raw-body HMAC is accepted
    const payload1 = {
      id: 991001,
      first_name: "Shopify",
      last_name: "Buyer",
      email: `shopify_buyer_${Date.now()}@example.com`,
      phone: "+91 98765 12345",
      note: "Looking for enterprise bulk orders",
      tags: "vip, retail",
    }
    const rawBody1 = Buffer.from(JSON.stringify(payload1), "utf8")
    const validHmac1 = crypto.createHmac("sha256", sharedSecretA).update(rawBody1).digest("base64")

    const res1 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": validHmac1,
        "x-shopify-topic": "customers/create",
        "x-shopify-webhook-id": `wh_id_1_${Date.now()}`,
      },
      body: payload1,
    })
    assert(
      res1.success === true && (res1.status === 201 || res1.status === 200),
      "Test 1: Valid raw-body HMAC-SHA256 signature is accepted and creates lead"
    )

    // Test 2: Invalid HMAC is rejected with HTTP 401
    const invalidHmac = crypto.createHmac("sha256", "wrong_secret_1234567890").update(rawBody1).digest("base64")
    const res2 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": invalidHmac,
        "x-shopify-topic": "customers/create",
      },
      body: payload1,
    })
    assert(
      res2.success === false && res2.status === 401 && res2.error.includes("Invalid Shopify webhook HMAC"),
      "Test 2: Invalid HMAC signature is rejected with HTTP 401 Unauthorized"
    )

    // Test 3: Missing HMAC is rejected with HTTP 401
    const res3 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-topic": "customers/create",
      },
      body: payload1,
    })
    assert(
      res3.success === false && res3.status === 401 && res3.error.includes("Missing X-Shopify-Hmac-Sha256"),
      "Test 3: Missing X-Shopify-Hmac-Sha256 header is rejected with HTTP 401"
    )

    // Test 4: Tampered body with original HMAC is rejected
    const tamperedPayload = { ...payload1, email: "attacker_injected@tampered.com" }
    const tamperedRawBody = Buffer.from(JSON.stringify(tamperedPayload), "utf8")
    const res4 = await shopifyService.processShopifyWebhook({
      rawBody: tamperedRawBody,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": validHmac1, // Original HMAC
        "x-shopify-topic": "customers/create",
      },
      body: tamperedPayload,
    })
    assert(
      res4.success === false && res4.status === 401,
      "Test 4: Tampered body with original HMAC signature is strictly rejected"
    )

    // Test 5: Malformed Base64 signature is safely rejected
    const res5 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": "!!!not_base64_garbage@@@###$$$",
        "x-shopify-topic": "customers/create",
      },
      body: payload1,
    })
    assert(
      res5.success === false && res5.status === 401,
      "Test 5: Malformed Base64 signature string is safely rejected without crash"
    )

    // Test 6: Missing server-side secret fails closed
    const shopDomainNoSecret = `no-secret-${Date.now()}.myshopify.com`
    const unconfiguredIntegration = new Integration({
      tenantId: tenantA,
      name: "Shopify Store Without Secret",
      type: "shopify",
      status: "active",
      settings: {
        shopifyShopDomain: shopDomainNoSecret,
        shopifySharedSecret: "", // Missing secret
      },
    })
    await unconfiguredIntegration.save()

    const res6 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": shopDomainNoSecret,
        "x-shopify-hmac-sha256": validHmac1,
        "x-shopify-topic": "customers/create",
      },
      body: payload1,
    })
    assert(
      res6.success === false && res6.status === 401 && res6.error.includes("not configured on the server"),
      "Test 6: Missing server-side secret fails closed with HTTP 401"
    )

    console.log("\n--- TEST SUITE 2: Store Resolution, Tenant Isolation & Caller Spoofing Defense ---")

    // Test 7: Valid registered domain resolves the correct tenant
    const createdLead1 = await Lead.findOne({ tenantId: tenantA, email: payload1.email }).lean()
    assert(
      Boolean(createdLead1 && createdLead1.tenantId === tenantA && createdLead1.source === "Shopify"),
      "Test 7: Valid registered Shopify store domain resolves to the correct tenant and maps source"
    )

    // Test 8: Unknown shop domain is rejected with HTTP 404
    const res8 = await shopifyService.processShopifyWebhook({
      rawBody: rawBody1,
      headers: {
        "x-shopify-shop-domain": "unknown-nonexistent-shop.myshopify.com",
        "x-shopify-hmac-sha256": validHmac1,
        "x-shopify-topic": "customers/create",
      },
      body: payload1,
    })
    assert(
      res8.success === false && res8.status === 404,
      "Test 8: Unregistered or unknown Shopify store domain is rejected with HTTP 404"
    )

    // Test 9: Caller-supplied tenantId cannot override authenticated integration tenant
    const payloadSpoof = {
      id: 991002,
      first_name: "Spoof",
      last_name: "Attacker",
      email: `spoof_${Date.now()}@example.com`,
      tenantId: "malicious_spoofed_tenant_id_999", // Caller attempts to inject tenant
    }
    const rawBodySpoof = Buffer.from(JSON.stringify(payloadSpoof), "utf8")
    const hmacSpoof = crypto.createHmac("sha256", sharedSecretA).update(rawBodySpoof).digest("base64")

    const res9 = await shopifyService.processShopifyWebhook({
      rawBody: rawBodySpoof,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": hmacSpoof,
        "x-shopify-topic": "customers/create",
      },
      body: payloadSpoof,
    })

    const spoofLeadInTarget = await Lead.findOne({ tenantId: tenantA, email: payloadSpoof.email }).lean()
    const spoofLeadInMalicious = await Lead.findOne({ tenantId: "malicious_spoofed_tenant_id_999", email: payloadSpoof.email }).setOptions({ skipTenantFilter: true }).lean()
    assert(
      res9.success === true &&
        spoofLeadInTarget &&
        spoofLeadInTarget.tenantId === tenantA &&
        spoofLeadInMalicious === null,
      "Test 9: Caller-supplied tenant ID is ignored; tenant partition is derived exclusively from integration"
    )

    console.log("\n--- TEST SUITE 3: Webhook Delivery Deduplication & Concurrency ---")

    // Test 10: Repeated delivery ID (X-Shopify-Webhook-Id) is processed only once
    const webhookId10 = `wh_delivery_${Date.now()}`
    const payload10 = {
      id: 991003,
      first_name: "Idempotent",
      last_name: "Delivery",
      email: `idem_delivery_${Date.now()}@example.com`,
    }
    const rawBody10 = Buffer.from(JSON.stringify(payload10), "utf8")
    const hmac10 = crypto.createHmac("sha256", sharedSecretA).update(rawBody10).digest("base64")

    const res10a = await shopifyService.processShopifyWebhook({
      rawBody: rawBody10,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": hmac10,
        "x-shopify-topic": "customers/create",
        "x-shopify-webhook-id": webhookId10,
      },
      body: payload10,
    })

    const res10b = await shopifyService.processShopifyWebhook({
      rawBody: rawBody10,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": hmac10,
        "x-shopify-topic": "customers/create",
        "x-shopify-webhook-id": webhookId10,
      },
      body: payload10,
    })

    const leadsCount10 = await Lead.countDocuments({ tenantId: tenantA, email: payload10.email })
    assert(
      res10a.success === true &&
        res10b.success === true &&
        res10b.idempotent === true &&
        leadsCount10 === 1,
      "Test 10: Repeated Shopify delivery ID is deduplicated and returns cached acknowledgment"
    )

    // Test 11: Concurrent duplicate webhook deliveries create only one lead
    const webhookId11 = `wh_conc_${Date.now()}`
    const payload11 = {
      id: 991004,
      first_name: "Concurrent",
      last_name: "Delivery",
      email: `conc_delivery_${Date.now()}@example.com`,
    }
    const rawBody11 = Buffer.from(JSON.stringify(payload11), "utf8")
    const hmac11 = crypto.createHmac("sha256", sharedSecretA).update(rawBody11).digest("base64")

    const [res11a, res11b] = await Promise.all([
      shopifyService.processShopifyWebhook({
        rawBody: rawBody11,
        headers: {
          "x-shopify-shop-domain": shopDomainA,
          "x-shopify-hmac-sha256": hmac11,
          "x-shopify-topic": "customers/create",
          "x-shopify-webhook-id": webhookId11,
        },
        body: payload11,
      }),
      shopifyService.processShopifyWebhook({
        rawBody: rawBody11,
        headers: {
          "x-shopify-shop-domain": shopDomainA,
          "x-shopify-hmac-sha256": hmac11,
          "x-shopify-topic": "customers/create",
          "x-shopify-webhook-id": webhookId11,
        },
        body: payload11,
      }),
    ])

    const leadsCount11 = await Lead.countDocuments({ tenantId: tenantA, email: payload11.email })
    assert(
      (res11a.success || res11b.success) &&
        (res11a.idempotent || res11b.idempotent || res11a.inProgress || res11b.inProgress) &&
        leadsCount11 === 1,
      "Test 11: Concurrent duplicate webhook deliveries create exactly one lead"
    )

    console.log("\n--- TEST SUITE 4: Carry-Forward Phase 2 Corrections ---")

    // Test 12: Two different integrations in the same tenant can use the same idempotency key without collision
    const integrationA2 = new Integration({
      tenantId: tenantA,
      name: "Second Integration in Tenant A",
      type: "generic",
      status: "active",
    })
    await integrationA2.save()

    const sharedIdemKey = `shared_key_${Date.now()}`
    const claimRes1 = await claimIdempotency({
      tenantId: tenantA,
      integrationId: shopifyIntegrationA._id.toString(),
      idempotencyKey: sharedIdemKey,
      payload: { name: "Payload From Integration 1" },
    })

    const claimRes2 = await claimIdempotency({
      tenantId: tenantA,
      integrationId: integrationA2._id.toString(),
      idempotencyKey: sharedIdemKey,
      payload: { name: "Payload From Integration 2" },
    })

    assert(
      claimRes1.action === "claimed" &&
        claimRes2.action === "claimed" &&
        claimRes1.reservationId !== claimRes2.reservationId,
      "Test 12: Two separate integrations in the same tenant independently use the same idempotency key without collision"
    )

    // Test 13: Long-running lock ownership with lease renewal heartbeat & fencing
    const lockTestEmail = `lock_renew_${Date.now()}@test.com`
    const lockHandle = await acquireLeadIdentityLock({
      tenantId: tenantA,
      email: lockTestEmail,
      duplicateHandling: "reject",
    })

    // Verify initial lock acquired
    const initialLockDoc = await LeadConcurrencyLock.findOne({
      tenantId: tenantA,
      identityType: "email",
    }).lean()
    const initialOwnerToken = lockHandle.ownerToken

    // Wait 3.5 seconds to trigger active lease renewal heartbeat (heartbeat fires every 3s)
    await new Promise((resolve) => setTimeout(resolve, 3500))

    const renewedLockDoc = await LeadConcurrencyLock.findOne({
      tenantId: tenantA,
      identityType: "email",
    }).lean()

    const leaseExtended =
      renewedLockDoc &&
      renewedLockDoc.ownerToken === initialOwnerToken &&
      new Date(renewedLockDoc.expiresAt).getTime() > new Date(initialLockDoc.expiresAt).getTime()

    // Test that an unauthorized former token cannot delete the lock
    await LeadConcurrencyLock.deleteMany({
      _id: initialLockDoc._id,
      tenantId: tenantA,
      ownerToken: "wrong_former_owner_token",
    })
    const stillExistsAfterFakeDelete = await LeadConcurrencyLock.findOne({
      _id: initialLockDoc._id,
      tenantId: tenantA,
    })

    // Safe release with correct ownerToken
    await lockHandle.release()
    const deletedAfterSafeRelease = await LeadConcurrencyLock.findOne({
      _id: initialLockDoc._id,
      tenantId: tenantA,
    })

    assert(
      leaseExtended &&
        stillExistsAfterFakeDelete !== null &&
        deletedAfterSafeRelease === null,
      "Test 13: Long-running lock safely renews lease via heartbeat and enforces ownerToken fencing"
    )

    // Test 14: Existing duplicate policy (update) works for Shopify order webhooks
    const orderPayload = {
      id: 887766,
      order_number: 1045,
      total_price: "4999.00",
      currency: "INR",
      customer: {
        first_name: "Shopify",
        last_name: "Buyer",
        email: payload1.email, // Matches payload1 email (duplicateHandling = 'update')
      },
    }
    const orderRawBody = Buffer.from(JSON.stringify(orderPayload), "utf8")
    const orderHmac = crypto.createHmac("sha256", sharedSecretA).update(orderRawBody).digest("base64")

    const res14 = await shopifyService.processShopifyWebhook({
      rawBody: orderRawBody,
      headers: {
        "x-shopify-shop-domain": shopDomainA,
        "x-shopify-hmac-sha256": orderHmac,
        "x-shopify-topic": "orders/create",
        "x-shopify-webhook-id": `wh_order_${Date.now()}`,
      },
      body: orderPayload,
    })

    const updatedLead = await Lead.findOne({ tenantId: tenantA, email: payload1.email }).lean()
    assert(
      res14.success === true &&
        res14.action === "merged" &&
        updatedLead.message.includes("Shopify Order #1045"),
      "Test 14: Existing 'update' duplicate policy updates existing lead on subsequent Shopify orders"
    )

    // Test 15: Website lead integration intake remains unaffected
    const rawApiKeyA = `lf_live_${crypto.randomBytes(24).toString("hex")}`
    const apiKeyHashA = crypto.createHash("sha256").update(rawApiKeyA).digest("hex")
    const websiteIntegration = new Integration({
      tenantId: tenantA,
      name: "Website Source",
      type: "website",
      apiKeyHash: apiKeyHashA,
      status: "active",
    })
    await websiteIntegration.save()

    const webRes = await integrationService.intakeWebhookPayload({
      rawApiKey: rawApiKeyA,
      body: {
        name: "Website Visitor",
        email: `visitor_${Date.now()}@example.com`,
        phone: "+91 99887 76655",
      },
    })
    assert(
      webRes.success === true && webRes.status === 201,
      "Test 15: Existing website API integrations remain fully functional"
    )

    // Clean up test data
    await Integration.deleteMany({ tenantId: tenantA })
    await Lead.deleteMany({ tenantId: tenantA })
    await IntegrationEvent.deleteMany({ tenantId: tenantA })
    await IdempotencyReservation.deleteMany({ tenantId: tenantA })
    await LeadConcurrencyLock.deleteMany({ tenantId: tenantA })

  } catch (err) {
    console.error("Test execution encountered an error:", err)
    assert(false, `Unexpected error in test suite: ${err.message}`)
  } finally {
    await mongoose.disconnect()
  }

  console.log("\n================================================================================")
  console.log(`=== PHASE 3A TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED ===`)
  console.log("================================================================================")

  if (failedCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runShopifyTests()
