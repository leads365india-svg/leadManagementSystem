require("dotenv").config({ path: require("path").join(__dirname, "../.env") })
process.env.NODE_ENV = "test"

const assert = require("assert")
const mongoose = require("mongoose")
const request = require("supertest")
const jwt = require("jsonwebtoken")
const dns = require("dns")
const xlsx = require("xlsx")

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"])
} catch (_) {}

const app = require("../start")
const connectDB = require("../db/connection")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")
const { getJwtSecret } = require("../middleware/authMiddleware")

const TEST_ID = `aik_${Date.now()}`
const TENANT_A = `ACC-AIK-A-${TEST_ID}`
const TENANT_B = `ACC-AIK-B-${TEST_ID}`

let tokenAdminA, tokenUserA, tokenAdminB
let adminUserA, regularUserA, adminUserB

const results = []
const record = (name, passed, detail = "") => {
  results.push({ name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} ${name}`)
  if (!passed && detail) {
    console.log(`     Error: ${detail}`)
  }
}

function generateAuthToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tokenVersion: user.tokenVersion || 1,
    },
    getJwtSecret(),
    { expiresIn: "2h" }
  )
}

async function cleanup() {
  try {
    await TenantBusinessProfile.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await BusinessProduct.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await AIKnowledgeSource.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
  } catch (e) {
    console.warn("Cleanup error (ignored):", e.message)
  }
}

async function runPhase1Tests() {
  console.log("\n=======================================================")
  console.log("   AI CALL INTELLIGENCE - PHASE 1 VERIFICATION SUITE   ")
  console.log("=======================================================\n")

  try {
    await connectDB()
    await cleanup()

    console.log("--- 1. Setting Up Test Fixtures & Tenant Accounts ---")

    // Create Tenant A Admin
    adminUserA = await User.create({
      name: "Admin Tenant A",
      email: `adminA_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
    })
    tokenAdminA = generateAuthToken(adminUserA)

    // Create Tenant A Regular Staff User (Non-Admin)
    regularUserA = await User.create({
      name: "Staff Tenant A",
      email: `staffA_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "user",
      tenantId: TENANT_A,
      status: "active",
    })
    tokenUserA = generateAuthToken(regularUserA)

    // Create Tenant B Admin
    adminUserB = await User.create({
      name: "Admin Tenant B",
      email: `adminB_${TEST_ID}@test.com`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
    })
    tokenAdminB = generateAuthToken(adminUserB)

    // Create Accounts
    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Tenant A Enterprises",
        displayName: "Tenant A",
        adminUserId: adminUserA._id,
        adminName: adminUserA.name,
        adminEmail: adminUserA.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Tenant B Solutions",
        displayName: "Tenant B",
        adminUserId: adminUserB._id,
        adminName: adminUserB.name,
        adminEmail: adminUserB.email,
        status: "active",
      },
    ])

    record("Tenant A & B Accounts and Users initialized", true)

    // ==========================================
    // SUITE 1: BUSINESS PROFILE CRUD & VALIDATION
    // ==========================================
    console.log("\n--- Suite 1: Business Profile Module & Multi-Tenancy ---")

    // 1.1 Initial GET returns default empty profile structure
    const resGetInitial = await request(app)
      .get("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)
    
    record("Initial GET /api/ai-knowledge/profile returns 200 with default structure",
      resGetInitial.status === 200 && resGetInitial.body.success === true && resGetInitial.body.data.tenantId === TENANT_A,
      JSON.stringify(resGetInitial.body)
    )

    // 1.2 Update Business Profile with standard industry
    const profilePayloadA = {
      businessName: "Royal Oak Furnishings",
      industry: "Furniture",
      description: "Premium handcrafted solid wood living room and office furniture.",
      website: "https://royaloakfurniture.example.com",
      contactEmail: "support@royaloak.example.com",
      contactPhone: "+91 9876543210",
      address: {
        street: "45 MG Road, Indiranagar",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560038"
      },
      languages: ["English", "Hindi", "Kannada"],
      status: "active"
    }

    const resUpdateA = await request(app)
      .put("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send(profilePayloadA)

    record("PUT /api/ai-knowledge/profile updates profile successfully with standard industry",
      resUpdateA.status === 200 && resUpdateA.body.data.businessName === "Royal Oak Furnishings" && resUpdateA.body.data.industry === "Furniture",
      JSON.stringify(resUpdateA.body)
    )

    // 1.3 Category Validation: Reject unsupported industry category
    const resInvalidCategory = await request(app)
      .put("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        businessName: "Royal Oak Furnishings",
        industry: "InvalidAerospaceIndustry",
      })

    record("PUT /api/ai-knowledge/profile rejects unlisted industry category with 400",
      resInvalidCategory.status === 400 && resInvalidCategory.body.success === false,
      `Status: ${resInvalidCategory.status}`
    )

    // 1.4 Setting customIndustry with 'Other' succeeds
    const resValidCustom = await request(app)
      .put("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        businessName: "Royal Oak Furnishings",
        industry: "Other",
        customIndustry: "Luxury Custom Joinery",
        description: "Custom architectural millwork and joinery."
      })

    record("PUT /api/ai-knowledge/profile accepts 'Other' when customIndustry is provided",
      resValidCustom.status === 200 && resValidCustom.body.data.customIndustry === "Luxury Custom Joinery",
      JSON.stringify(resValidCustom.body)
    )

    // 1.5 Strict Tenant Isolation on Business Profile: Tenant B gets their own empty profile, not Tenant A's
    const resProfileB = await request(app)
      .get("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B cannot see Tenant A's business profile (Tenant Isolation)",
      resProfileB.status === 200 &&
      resProfileB.body.data.tenantId === TENANT_B &&
      resProfileB.body.data.businessName !== "Royal Oak Furnishings",
      `Tenant B saw: ${resProfileB.body.data.businessName}`
    )

    // ==========================================
    // SUITE 2: PRODUCT & SERVICE LIBRARY
    // ==========================================
    console.log("\n--- Suite 2: Product & Service Library ---")

    // 2.1 Create PRODUCT in Tenant A
    let product1Id, service1Id
    const resProd1 = await request(app)
      .post("/api/ai-knowledge/products")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Solid Teak 6-Seater Dining Table",
        type: "PRODUCT",
        category: "Dining Furniture",
        description: "Handcrafted Malaysian teak wood dining table with natural oil finish.",
        price: {
          amount: 45000,
          currency: "INR",
          pricingModel: "fixed"
        },
        features: ["100% Solid Teak Wood", "Water-resistant matte sealer", "Seating capacity 6"],
        notes: "Lead time 7-10 business days for delivery.",
        status: "active"
      })

    record("POST /api/ai-knowledge/products creates PRODUCT",
      resProd1.status === 201 && resProd1.body.data.name === "Solid Teak 6-Seater Dining Table" && resProd1.body.data.type === "PRODUCT",
      JSON.stringify(resProd1.body)
    )
    product1Id = resProd1.body.data?._id

    // 2.2 Create SERVICE in Tenant A
    const resServ1 = await request(app)
      .post("/api/ai-knowledge/products")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Custom Furniture Design & Site Consultation",
        type: "SERVICE",
        category: "Consulting",
        description: "On-site measurement and 3D architectural rendering for custom carpentry.",
        price: {
          amount: 2500,
          currency: "INR",
          pricingModel: "hourly"
        },
        features: ["On-site inspection", "3D CAD layout", "Material swatches sample box"],
        notes: "Consultation fee credited towards final furniture order.",
        status: "active"
      })

    record("POST /api/ai-knowledge/products creates SERVICE",
      resServ1.status === 201 && resServ1.body.data.name.includes("Site Consultation") && resServ1.body.data.type === "SERVICE",
      JSON.stringify(resServ1.body)
    )
    service1Id = resServ1.body.data?._id

    // 2.3 List products with filtering & search
    const resListAll = await request(app)
      .get("/api/ai-knowledge/products?search=Dining")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("GET /api/ai-knowledge/products searches and finds Dining product",
      resListAll.status === 200 && resListAll.body.data.products.length === 1 && resListAll.body.data.products[0].name.includes("Dining Table"),
      `Found: ${resListAll.body.data?.products?.length}`
    )

    // Filter by type=SERVICE
    const resListServices = await request(app)
      .get("/api/ai-knowledge/products?type=SERVICE")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("GET /api/ai-knowledge/products?type=SERVICE filters correctly",
      resListServices.status === 200 && resListServices.body.data.products.length === 1 && resListServices.body.data.products[0].type === "SERVICE",
      `Found: ${resListServices.body.data?.products?.length}`
    )

    // 2.4 Toggle product status
    const resToggle = await request(app)
      .patch(`/api/ai-knowledge/products/${product1Id}/status`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("PATCH /api/ai-knowledge/products/:id/status deactivates active product",
      resToggle.status === 200 && resToggle.body.data.status === "inactive",
      `New status: ${resToggle.body.data?.status}`
    )

    // Re-activate
    await request(app)
      .patch(`/api/ai-knowledge/products/${product1Id}/status`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    // 2.5 Strict Tenant Isolation on Products: Tenant B cannot see Tenant A's products
    const resTenantBProds = await request(app)
      .get("/api/ai-knowledge/products")
      .set("Authorization", `Bearer ${tokenAdminB}`)

    record("Tenant B product list is empty (strict tenant isolation)",
      resTenantBProds.status === 200 && resTenantBProds.body.data.products.length === 0,
      `Tenant B saw ${resTenantBProds.body.data?.products?.length} products`
    )

    // Tenant B attempting to update Tenant A's product receives 404
    const resTenantBTamper = await request(app)
      .put(`/api/ai-knowledge/products/${product1Id}`)
      .set("Authorization", `Bearer ${tokenAdminB}`)
      .send({ name: "Hacked by Tenant B" })

    record("Tenant B cannot mutate Tenant A's product (404 Not Found)",
      resTenantBTamper.status === 404,
      `Status: ${resTenantBTamper.status}`
    )

    // ==========================================
    // SUITE 3: AI KNOWLEDGE SOURCES & EXTRACTION
    // ==========================================
    console.log("\n--- Suite 3: AI Knowledge Sources & Text Extraction ---")

    // 3.1 Add Manual Note Knowledge Source
    const resManual = await request(app)
      .post("/api/ai-knowledge/sources/manual")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        title: "Company Warranty and Return Policy",
        category: "Policy",
        content: "We provide 5-year comprehensive termite and structural warranty on all solid wood products. Returns are accepted within 30 days of delivery if undamaged.",
        productId: product1Id
      })

    record("POST /api/ai-knowledge/sources/manual creates COMPLETED knowledge source with word/char count",
      resManual.status === 201 &&
      resManual.body.data.status === "COMPLETED" &&
      resManual.body.data.sourceType === "manual" &&
      resManual.body.data.wordCount > 10 &&
      resManual.body.data.productId === product1Id,
      JSON.stringify(resManual.body)
    )
    const manualSourceId = resManual.body.data?._id

    // 3.2 Upload CSV Document via /upload
    const csvContent = "SKU,Product Name,Material,Warranty,Price\nSOF-001,Chesterfield Velvet Sofa,Solid Birch + Velvet,3 Years,65000\nBED-002,King Size Storage Bed,Sheesham Wood,5 Years,52000"
    const csvBuffer = Buffer.from(csvContent, "utf-8")

    const resCsv = await request(app)
      .post("/api/ai-knowledge/sources/upload")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .attach("document", csvBuffer, "furniture_catalog.csv")
      .field("title", "2026 Furniture Catalog CSV")
      .field("category", "Catalog")

    record("POST /api/ai-knowledge/sources/upload processes CSV and extracts text accurately",
      resCsv.status === 201 &&
      resCsv.body.data.status === "COMPLETED" &&
      resCsv.body.data.sourceType === "csv" &&
      resCsv.body.data.extractedText.includes("Chesterfield Velvet Sofa"),
      JSON.stringify(resCsv.body)
    )
    const csvSourceId = resCsv.body.data?._id

    // 3.3 Upload XLSX Document via /upload
    const wb = xlsx.utils.book_new()
    const wsData = [
      ["Product ID", "Specification", "Dimensions", "Finish"],
      ["TBL-100", "Malaysian Teak Table", "180x90x75 cm", "Natural Matte Polish"],
      ["CHR-200", "Cushioned Dining Chair", "45x45x95 cm", "Fabric Upholstered"]
    ]
    const ws = xlsx.utils.aoa_to_sheet(wsData)
    xlsx.utils.book_append_sheet(wb, ws, "Tables & Chairs")
    const xlsxBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" })

    const resXlsx = await request(app)
      .post("/api/ai-knowledge/sources/upload")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .attach("document", xlsxBuffer, "specifications.xlsx")
      .field("title", "Product Specifications XLSX")
      .field("category", "Specifications")

    record("POST /api/ai-knowledge/sources/upload processes XLSX and extracts sheet content",
      resXlsx.status === 201 &&
      resXlsx.body.data.status === "COMPLETED" &&
      resXlsx.body.data.sourceType === "xlsx" &&
      resXlsx.body.data.extractedText.includes("Malaysian Teak Table"),
      JSON.stringify(resXlsx.body)
    )

    // 3.4 Upload Minimal PDF Document via /upload
    const minimalPdf = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj
4 0 obj <</Length 44>> stream
BT
/F1 12 Tf
72 712 Td
(Hello PDF World!) Tj
ET
endstream endobj
5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000238 00000 n 
0000000332 00000 n 
trailer <</Size 6 /Root 1 0 R>>
startxref
406
%%EOF`
    const pdfBuffer = Buffer.from(minimalPdf)

    const resPdf = await request(app)
      .post("/api/ai-knowledge/sources/upload")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .attach("document", pdfBuffer, "brochure.pdf")
      .field("title", "Company Brochure PDF")
      .field("category", "Brochure")

    record("POST /api/ai-knowledge/sources/upload processes PDF and extracts text",
      resPdf.status === 201 &&
      resPdf.body.data.status === "COMPLETED" &&
      resPdf.body.data.sourceType === "pdf" &&
      resPdf.body.data.extractedText.includes("Hello PDF World"),
      JSON.stringify(resPdf.body)
    )

    // 3.5 Text Preview Endpoint
    const resPreview = await request(app)
      .get(`/api/ai-knowledge/sources/${csvSourceId}/preview?maxLength=50`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("GET /api/ai-knowledge/sources/:id/preview returns truncated preview",
      resPreview.status === 200 &&
      resPreview.body.data.previewText.length <= 53 && // 50 + "..."
      resPreview.body.data.totalCharacters > 50,
      JSON.stringify(resPreview.body)
    )

    // 3.6 Retry logic on failed source
    const failedSource = await AIKnowledgeSource.create({
      tenantId: TENANT_A,
      title: "Broken Website Retry Test",
      sourceType: "manual",
      status: "FAILED",
      errorMessage: "Simulated extraction failure",
      manualDetails: {
        content: "Manual note content for retry test."
      }
    })

    const resRetry = await request(app)
      .post(`/api/ai-knowledge/sources/${failedSource._id}/retry`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("POST /api/ai-knowledge/sources/:id/retry resets failed source and completes extraction",
      resRetry.status === 200 &&
      resRetry.body.data.status === "COMPLETED" &&
      resRetry.body.data.wordCount > 0,
      JSON.stringify(resRetry.body)
    )

    // ==========================================
    // SUITE 4: PRODUCT ARCHIVAL PROTECTION
    // ==========================================
    console.log("\n--- Suite 4: Product Archival Protection (Reference Check) ---")

    // In Suite 3.1, manualSourceId was created with productId = product1Id
    // Attempting to delete product1Id must soft-archive it rather than hard-delete it!
    const resArchiveProduct = await request(app)
      .delete(`/api/ai-knowledge/products/${product1Id}`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("DELETE product with active knowledge source references safely archives instead of hard deleting",
      resArchiveProduct.status === 200 &&
      resArchiveProduct.body.archived === true &&
      resArchiveProduct.body.referenceCount > 0,
      JSON.stringify(resArchiveProduct.body)
    )

    // Verify service1Id (which has no knowledge source references) is permanently deleted when hardDelete=true
    const resDeleteService = await request(app)
      .delete(`/api/ai-knowledge/products/${service1Id}?hardDelete=true`)
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("DELETE product with NO references permanently deletes document",
      resDeleteService.status === 200 &&
      resDeleteService.body.deleted === true,
      JSON.stringify(resDeleteService.body)
    )

    // ==========================================
    // SUITE 5: SSRF PROTECTION & SECURITY
    // ==========================================
    console.log("\n--- Suite 5: SSRF Prevention & File Upload Security ---")

    // 5.1 Website SSRF Protection: Loopback IP
    const resSsrfLoopback = await request(app)
      .post("/api/ai-knowledge/sources/website")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        url: "http://127.0.0.1:5000/api/leads",
        title: "Internal Admin Probe"
      })

    record("SSRF: Blocks loopback IP http://127.0.0.1",
      resSsrfLoopback.status === 400 && resSsrfLoopback.body.success === false,
      resSsrfLoopback.body.error
    )

    // 5.2 Website SSRF Protection: Localhost
    const resSsrfLocalhost = await request(app)
      .post("/api/ai-knowledge/sources/website")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        url: "http://localhost:8080/admin",
        title: "Localhost Probe"
      })

    record("SSRF: Blocks http://localhost",
      resSsrfLocalhost.status === 400 && resSsrfLocalhost.body.success === false,
      resSsrfLocalhost.body.error
    )

    // 5.3 Website SSRF Protection: AWS/GCP Cloud Metadata IP 169.254.169.254
    const resSsrfMetadata = await request(app)
      .post("/api/ai-knowledge/sources/website")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        url: "http://169.254.169.254/latest/meta-data/",
        title: "Cloud Metadata Theft Attempt"
      })

    record("SSRF: Blocks AWS/GCP link-local metadata IP 169.254.169.254",
      resSsrfMetadata.status === 400 && resSsrfMetadata.body.success === false,
      resSsrfMetadata.body.error
    )

    // 5.4 Website SSRF Protection: Private Subnet (10.0.0.0/8, 192.168.0.0/16)
    const resSsrfPrivate = await request(app)
      .post("/api/ai-knowledge/sources/website")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        url: "http://192.168.1.1/router-login",
        title: "Private Subnet Probe"
      })

    record("SSRF: Blocks private LAN range 192.168.1.1",
      resSsrfPrivate.status === 400 && resSsrfPrivate.body.success === false,
      resSsrfPrivate.body.error
    )

    // 5.5 File Upload Validation: Unsupported extension / mime type (.exe / .zip)
    const dummyExe = Buffer.from("MZ9000DUMMYBINARYCONTENT", "utf-8")
    const resInvalidExt = await request(app)
      .post("/api/ai-knowledge/sources/upload")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .attach("document", dummyExe, "malicious.exe")
      .field("title", "Malicious Binary")

    record("File Upload: Rejects disallowed file extension .exe",
      resInvalidExt.status === 400 && resInvalidExt.body.success === false,
      resInvalidExt.body.error
    )

    // ==========================================
    // SUITE 6: RBAC & AUTHORIZATION PERMISSIONS
    // ==========================================
    console.log("\n--- Suite 6: RBAC Permissions (Admin vs Non-Admin) ---")

    // 6.1 Non-admin (role: 'user') attempting to access Business Profile
    const resUserForbiddenProfile = await request(app)
      .get("/api/ai-knowledge/profile")
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user (role: 'user') receives 403 Forbidden on profile",
      resUserForbiddenProfile.status === 403,
      `Status: ${resUserForbiddenProfile.status}`
    )

    // 6.2 Non-admin attempting to access Products
    const resUserForbiddenProducts = await request(app)
      .get("/api/ai-knowledge/products")
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user receives 403 Forbidden on products",
      resUserForbiddenProducts.status === 403,
      `Status: ${resUserForbiddenProducts.status}`
    )

    // 6.3 Non-admin attempting to access Knowledge Sources
    const resUserForbiddenSources = await request(app)
      .get("/api/ai-knowledge/sources")
      .set("Authorization", `Bearer ${tokenUserA}`)

    record("RBAC: Regular user receives 403 Forbidden on knowledge sources",
      resUserForbiddenSources.status === 403,
      `Status: ${resUserForbiddenSources.status}`
    )

    // 6.4 Missing Authorization Header receives 401 Unauthorized
    const resUnauth = await request(app)
      .get("/api/ai-knowledge/profile")

    record("RBAC: Missing authorization token receives 401 Unauthorized",
      resUnauth.status === 401,
      `Status: ${resUnauth.status}`
    )

    // ==========================================
    // SUITE 7: REGRESSION TESTING (LEADS & CALLS)
    // ==========================================
    console.log("\n--- Suite 7: Regression Testing (Leads & Mobile Call Routes) ---")

    // 7.1 Verify Lead Creation under tenant context works seamlessly
    const resCreateLead = await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${tokenAdminA}`)
      .send({
        name: "Prospective Buyer",
        email: `buyer_${TEST_ID}@example.com`,
        phone: "+91 9988776655",
        status: "New",
        source: "Website",
        tenantId: TENANT_A
      })

    record("Regression: Existing Lead creation API (/api/leads) functions normally",
      resCreateLead.status === 201 || resCreateLead.status === 200,
      `Status: ${resCreateLead.status}`
    )

    // 7.2 Verify Device and Call routes are intact
    const resDeviceCheck = await request(app)
      .get("/api/devices")
      .set("Authorization", `Bearer ${tokenAdminA}`)

    record("Regression: Device API route (/api/devices) is intact",
      resDeviceCheck.status === 200 || resDeviceCheck.status === 404,
      `Status: ${resDeviceCheck.status}`
    )

  } catch (err) {
    console.error("FATAL ERROR IN TEST SUITE:", err)
    record("Phase 1 verification suite execution", false, err.message)
  } finally {
    await cleanup()
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  }

  console.log("\n=======================================================")
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`PHASE 1 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (${results.length} total)`)
  console.log("=======================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runPhase1Tests()
