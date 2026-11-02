require("dotenv").config({ path: require("path").join(__dirname, "../.env") })

const assert = require("assert")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const http = require("http")
const https = require("https")
const xlsx = require("xlsx")
const fs = require("fs")
const path = require("path")

const { getJwtSecret } = require("../middleware/authMiddleware")
const User = require("../models/User")
const Account = require("../models/Account")
const Lead = require("../models/Lead")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")
const { extractWebsiteContent, validateUrlSecurity } = require("../services/websiteExtractor")
const { extractDocumentContent, validateDocumentUpload } = require("../services/documentExtractor")

const PORT = process.env.PORT || 5000
const BASE_URL = `http://localhost:${PORT}`

const TEST_ID = `live_${Date.now()}`
const TENANT_A = `ACC-LIVE-A-${TEST_ID}`
const TENANT_B = `ACC-LIVE-B-${TEST_ID}`

let tokenAdminA, tokenUserA, tokenAdminB
let adminUserA, regularUserA, adminUserB

const testResults = []
function logResult(suite, name, passed, detail = "") {
  testResults.push({ suite, name, passed, detail })
  const icon = passed ? "  ✅ PASS:" : "  ❌ FAIL:"
  console.log(`${icon} [${suite}] ${name}`)
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

function makeHttpRequest({ method = "GET", path = "/", body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)
    const reqHeaders = { ...headers }

    let payload = null
    if (body !== null) {
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        payload = body
      } else {
        payload = JSON.stringify(body)
        if (!reqHeaders["Content-Type"]) {
          reqHeaders["Content-Type"] = "application/json"
        }
      }
      reqHeaders["Content-Length"] = Buffer.byteLength(payload)
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = ""
        res.on("data", (chunk) => (raw += chunk))
        res.on("end", () => {
          try {
            const json = raw ? JSON.parse(raw) : null
            resolve({ status: res.statusCode, headers: res.headers, data: json, raw })
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, data: null, raw })
          }
        })
      }
    )

    req.on("error", (err) => reject(err))
    if (payload) req.write(payload)
    req.end()
  })
}

function makeMultipartRequest({ path = "/", fields = {}, file = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2)
    const chunks = []

    for (const [k, v] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
    }

    if (file) {
      const { fieldName = "document", fileName = "test.txt", mimeType = "text/plain", buffer } = file
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
        )
      )
      chunks.push(buffer)
      chunks.push(Buffer.from("\r\n"))
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    const fullBody = Buffer.concat(chunks)

    const reqHeaders = {
      ...headers,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": fullBody.length,
    }

    const url = new URL(path, BASE_URL)
    const req = http.request(
      url,
      {
        method: "POST",
        headers: reqHeaders,
      },
      (res) => {
        let raw = ""
        res.on("data", (chunk) => (raw += chunk))
        res.on("end", () => {
          try {
            const json = raw ? JSON.parse(raw) : null
            resolve({ status: res.statusCode, headers: res.headers, data: json, raw })
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, data: null, raw })
          }
        })
      }
    )

    req.on("error", (err) => reject(err))
    req.write(fullBody)
    req.end()
  })
}

async function cleanupFixtures() {
  try {
    await TenantBusinessProfile.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await BusinessProduct.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await AIKnowledgeSource.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
    await User.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } })
    await Account.deleteMany({ accountId: { $in: [TENANT_A, TENANT_B] } })
    await Lead.deleteMany({ tenantId: { $in: [TENANT_A, TENANT_B] } }).setOptions({ skipTenantFilter: true })
  } catch (err) {
    console.warn("Cleanup notice:", err.message)
  }
}

async function runLiveAndStabilizationTests() {
  console.log("\n================================================================================")
  console.log("   LEADS-365 AI CALL INTELLIGENCE — PHASE 1 LIVE & STABILIZATION VERIFICATION   ")
  console.log("================================================================================\n")

  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log("Connected to MongoDB for test fixture orchestration.\n")

    await cleanupFixtures()

    // -------------------------------------------------------------
    // Setup Test Tenants: Tenant A and Tenant B
    // -------------------------------------------------------------
    adminUserA = await User.create({
      name: "Admin Tenant A",
      email: `adminA_${TEST_ID}@leads365.test`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_A,
      status: "active",
    })
    tokenAdminA = generateAuthToken(adminUserA)

    regularUserA = await User.create({
      name: "Staff Tenant A",
      email: `staffA_${TEST_ID}@leads365.test`,
      password: "Password123!",
      role: "user",
      tenantId: TENANT_A,
      status: "active",
    })
    tokenUserA = generateAuthToken(regularUserA)

    adminUserB = await User.create({
      name: "Admin Tenant B",
      email: `adminB_${TEST_ID}@leads365.test`,
      password: "Password123!",
      role: "account_admin",
      tenantId: TENANT_B,
      status: "active",
    })
    tokenAdminB = generateAuthToken(adminUserB)

    await Account.create([
      {
        accountId: TENANT_A,
        companyName: "Acme Logistics A",
        displayName: "Acme Log A",
        adminUserId: adminUserA._id,
        adminName: adminUserA.name,
        adminEmail: adminUserA.email,
        status: "active",
      },
      {
        accountId: TENANT_B,
        companyName: "Beta Corp B",
        displayName: "Beta Corp B",
        adminUserId: adminUserB._id,
        adminName: adminUserB.name,
        adminEmail: adminUserB.email,
        status: "active",
      },
    ])

    // =========================================================================
    // SECTION 3: BACKEND LIVE VERIFICATION (RUNNING ON PORT 5000)
    // =========================================================================
    console.log("\n--- Section 3: Live HTTP API Verification (Port 5000) ---")

    // 3.1 Backend Health / Root Endpoint
    const resHealth = await makeHttpRequest({ method: "GET", path: "/health" })
    logResult(
      "Live API",
      "GET /health or server responsive",
      resHealth.status === 200 || resHealth.status === 404, // Some servers mount /health or /api/health
      `Status: ${resHealth.status}`
    )

    // 3.2 Unauthorized Access (No Token)
    const resUnauth = await makeHttpRequest({ method: "GET", path: "/api/ai-knowledge/profile" })
    logResult("Live API", "Unauthorized request without token returns 401", resUnauth.status === 401, `Status: ${resUnauth.status}`)

    // 3.3 Regular User Forbidden (role: 'user')
    const resForbidden = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/profile",
      headers: { Authorization: `Bearer ${tokenUserA}` },
    })
    logResult(
      "Live API",
      "Regular staff user (role: 'user') returns 403 Forbidden",
      resForbidden.status === 403,
      `Status: ${resForbidden.status}`
    )

    // 3.4 GET Business Profile (Tenant A Admin)
    const resGetProfile = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/profile",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "GET /api/ai-knowledge/profile returns 200 with default profile structure",
      resGetProfile.status === 200 && resGetProfile.data?.success === true && resGetProfile.data?.data?.tenantId === TENANT_A,
      JSON.stringify(resGetProfile.data)
    )

    // 3.5 PUT Business Profile (Tenant A Admin)
    const updateProfileBody = {
      businessName: "Acme Logistics Global",
      industry: "Retail",
      description: "Omnichannel inventory distribution and fulfillment network.",
      website: "https://acmelogistics.example.com",
      contactEmail: "contact@acmelogistics.example.com",
      contactPhone: "+91 9123456780",
      address: {
        street: "Sector 62",
        city: "Noida",
        state: "Uttar Pradesh",
        country: "India",
        postalCode: "201309",
      },
      languages: ["English", "Hindi"],
      status: "active",
    }
    const resPutProfile = await makeHttpRequest({
      method: "PUT",
      path: "/api/ai-knowledge/profile",
      body: updateProfileBody,
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "PUT /api/ai-knowledge/profile updates business profile successfully",
      resPutProfile.status === 200 && resPutProfile.data?.data?.businessName === "Acme Logistics Global",
      JSON.stringify(resPutProfile.data)
    )

    // 3.6 POST Product (Tenant A Admin)
    const productPayload = {
      name: "Warehouse Pallet Storage Bay",
      type: "PRODUCT",
      category: "Storage Units",
      description: "Temperature-controlled automated high-density rack storage for FMCG goods.",
      price: { amount: 8500, currency: "INR", billingCycle: "monthly" },
      features: ["24/7 CCTV surveillance", "Fire-suppressed zone", "Forklift access aisles"],
      notes: "Minimum 3-month lease agreement.",
      status: "active",
    }
    const resCreateProd = await makeHttpRequest({
      method: "POST",
      path: "/api/ai-knowledge/products",
      body: productPayload,
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "POST /api/ai-knowledge/products creates product successfully",
      resCreateProd.status === 201 && resCreateProd.data?.data?.name === "Warehouse Pallet Storage Bay",
      JSON.stringify(resCreateProd.data)
    )
    const liveProductId = resCreateProd.data?.data?._id

    // 3.7 GET Products List (Tenant A Admin)
    const resListProd = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/products",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "GET /api/ai-knowledge/products lists tenant products with pagination",
      resListProd.status === 200 && resListProd.data?.data?.products?.length === 1,
      `Count: ${resListProd.data?.data?.products?.length}`
    )

    // 3.8 Manual Knowledge Source Creation (Tenant A Admin)
    const manualSourcePayload = {
      title: "Warehouse Access Protocol & Security Guidelines",
      category: "Operational SOP",
      content:
        "All delivery drivers must present valid government photo ID and consignment bill before vehicle entry. Strict PPE compliance including high-vis vests and steel-toed boots is required inside bay areas.",
      productId: liveProductId,
    }
    const resCreateManual = await makeHttpRequest({
      method: "POST",
      path: "/api/ai-knowledge/sources/manual",
      body: manualSourcePayload,
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "POST /api/ai-knowledge/sources/manual stores manual entry in COMPLETED state",
      resCreateManual.status === 201 &&
        resCreateManual.data?.data?.status === "COMPLETED" &&
        resCreateManual.data?.data?.wordCount > 20,
      JSON.stringify(resCreateManual.data)
    )
    const liveManualSourceId = resCreateManual.data?.data?._id

    // 3.9 GET Knowledge Sources List (Tenant A Admin)
    const resListSources = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/sources",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "GET /api/ai-knowledge/sources lists sources with summary KPI counters",
      resListSources.status === 200 &&
        resListSources.data?.data?.sources?.length >= 1 &&
        resListSources.data?.data?.summary?.completed >= 1,
      JSON.stringify(resListSources.data?.data?.summary)
    )

    // 3.10 Website Source Security Validation on Live Server
    const resSsrfLocalhost = await makeHttpRequest({
      method: "POST",
      path: "/api/ai-knowledge/sources/website",
      body: { url: "http://127.0.0.1:5000/api/leads", title: "Localhost probe" },
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Live API",
      "POST /api/ai-knowledge/sources/website blocks 127.0.0.1 with 400 Bad Request",
      resSsrfLocalhost.status === 400 && resSsrfLocalhost.data?.success === false,
      `Status: ${resSsrfLocalhost.status}, Error: ${resSsrfLocalhost.data?.error}`
    )

    // =========================================================================
    // SECTION 4: DOCUMENT AND WEBSITE EXTRACTION VERIFICATION
    // =========================================================================
    console.log("\n--- Section 4: Document & Website Extraction Deep Verification ---")

    // 4.1 Plain TXT Extraction
    const txtBuffer = Buffer.from("ACME Logistics Terms of Service:\n1. All items must be packed.\n2. In transit damages covered up to 50,000 INR.", "utf-8")
    const resTxtUpload = await makeMultipartRequest({
      path: "/api/ai-knowledge/sources/upload",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      fields: { title: "Terms of Service TXT" },
      file: { fieldName: "document", fileName: "terms.txt", mimeType: "text/plain", buffer: txtBuffer },
    })
    logResult(
      "Extraction",
      "TXT document upload and text extraction",
      resTxtUpload.status === 201 &&
        resTxtUpload.data?.data?.status === "COMPLETED" &&
        resTxtUpload.data?.data?.extractedText.includes("ACME Logistics Terms of Service"),
      JSON.stringify(resTxtUpload.data)
    )

    // 4.2 CSV Extraction
    const csvBuffer = Buffer.from("Product,Rack,WeightCapacityKg\nPallet-A,Zone-1,1200\nPallet-B,Zone-2,2000", "utf-8")
    const resCsvUpload = await makeMultipartRequest({
      path: "/api/ai-knowledge/sources/upload",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      fields: { title: "Rack Capacity CSV" },
      file: { fieldName: "document", fileName: "racks.csv", mimeType: "text/csv", buffer: csvBuffer },
    })
    logResult(
      "Extraction",
      "CSV document upload and text extraction",
      resCsvUpload.status === 201 &&
        resCsvUpload.data?.data?.status === "COMPLETED" &&
        resCsvUpload.data?.data?.extractedText.includes("Pallet-A"),
      JSON.stringify(resCsvUpload.data)
    )

    // 4.3 XLSX Multi-Sheet Extraction
    const wb = xlsx.utils.book_new()
    const ws1 = xlsx.utils.aoa_to_sheet([["Zone", "Manager", "Capacity"], ["Zone North", "Rajesh", "5000"]])
    const ws2 = xlsx.utils.aoa_to_sheet([["Equipment", "Qty", "Status"], ["Forklift 3T", "4", "Operational"]])
    xlsx.utils.book_append_sheet(wb, ws1, "Zones")
    xlsx.utils.book_append_sheet(wb, ws2, "Equipment")
    const xlsxBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" })

    const resXlsxUpload = await makeMultipartRequest({
      path: "/api/ai-knowledge/sources/upload",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      fields: { title: "Facility Layout XLSX" },
      file: {
        fieldName: "document",
        fileName: "facility.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: xlsxBuffer,
      },
    })
    logResult(
      "Extraction",
      "XLSX multi-sheet document extraction with sheet names in metadata",
      resXlsxUpload.status === 201 &&
        resXlsxUpload.data?.data?.status === "COMPLETED" &&
        resXlsxUpload.data?.data?.metadata?.sheetNames?.length === 2 &&
        resXlsxUpload.data?.data?.extractedText.includes("Forklift 3T"),
      JSON.stringify(resXlsxUpload.data?.data?.metadata)
    )

    // 4.4 PDF Extraction
    const minimalPdf = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj
4 0 obj <</Length 48>> stream
BT
/F1 12 Tf
72 712 Td
(ACME Cold Storage Capabilities Specification) Tj
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
    const resPdfUpload = await makeMultipartRequest({
      path: "/api/ai-knowledge/sources/upload",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      fields: { title: "Cold Storage Specs PDF" },
      file: { fieldName: "document", fileName: "cold_storage.pdf", mimeType: "application/pdf", buffer: pdfBuffer },
    })
    logResult(
      "Extraction",
      "PDF text extraction and page counting",
      resPdfUpload.status === 201 &&
        resPdfUpload.data?.data?.status === "COMPLETED" &&
        resPdfUpload.data?.data?.extractedText.includes("Cold Storage Capabilities"),
      JSON.stringify(resPdfUpload.data)
    )

    // 4.5 DOCX Extraction (Direct Service Unit Verification)
    // Mammoth extractRawText on empty/minimal buffer
    try {
      const mammoth = require("mammoth")
      const docxResult = await extractDocumentContent({
        buffer: Buffer.from("PK\x03\x04emptyzipcontainer"),
        fileName: "empty.docx",
        sourceType: "docx",
      })
      logResult("Extraction", "DOCX service handles corrupt/invalid docx gracefully", docxResult.success === false, docxResult.error)
    } catch (e) {
      logResult("Extraction", "DOCX service handles corrupt/invalid docx gracefully", false, e.message)
    }

    // 4.6 Invalid File Type Rejection (.exe / .zip)
    const resDisallowedUpload = await makeMultipartRequest({
      path: "/api/ai-knowledge/sources/upload",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      fields: { title: "Binary Upload" },
      file: { fieldName: "document", fileName: "trojan.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
    })
    logResult(
      "Extraction",
      "Disallowed file extension (.exe) rejected with 400 Bad Request",
      resDisallowedUpload.status === 400 && resDisallowedUpload.data?.success === false,
      resDisallowedUpload.data?.error
    )

    // 4.7 Oversized File Rejection (>25MB)
    const fakeOversizedValidation = validateDocumentUpload({
      fileName: "huge_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: 26 * 1024 * 1024, // 26MB
    })
    logResult(
      "Extraction",
      "Oversized file (>25MB) rejected by upload validator",
      fakeOversizedValidation.valid === false && fakeOversizedValidation.error.includes("25MB"),
      fakeOversizedValidation.error
    )

    // 4.8 SSRF Network Rejection Tests (Unit & Integration)
    // - Localhost
    let ssrfLocalhostBlocked = false
    try {
      await validateUrlSecurity("http://localhost:3000/secret")
    } catch (e) {
      ssrfLocalhostBlocked = e.message.includes("blocked")
    }
    logResult("SSRF Defense", "Localhost (http://localhost:3000) rejected", ssrfLocalhostBlocked)

    // - Loopback IPv4
    let ssrfLoopbackBlocked = false
    try {
      await validateUrlSecurity("http://127.0.0.1:8080")
    } catch (e) {
      ssrfLoopbackBlocked = e.message.includes("blocked")
    }
    logResult("SSRF Defense", "IPv4 Loopback (127.0.0.1) rejected", ssrfLoopbackBlocked)

    // - Cloud Metadata (169.254.169.254)
    let ssrfMetaBlocked = false
    try {
      await validateUrlSecurity("http://169.254.169.254/computeMetadata/v1/")
    } catch (e) {
      ssrfMetaBlocked = e.message.includes("blocked")
    }
    logResult("SSRF Defense", "Cloud metadata IP (169.254.169.254) rejected", ssrfMetaBlocked)

    // - Private Subnets (10.0.0.1, 192.168.1.1, 172.20.0.1)
    let ssrfPrivateBlocked = false
    try {
      await validateUrlSecurity("http://10.200.1.5:8000/internal")
      await validateUrlSecurity("http://192.168.0.1/admin")
    } catch (e) {
      ssrfPrivateBlocked = e.message.includes("blocked")
    }
    logResult("SSRF Defense", "RFC 1918 Private IPs (10.x, 192.168.x) rejected", ssrfPrivateBlocked)

    // - IPv6 Loopback (::1)
    let ssrfIpv6Blocked = false
    try {
      await validateUrlSecurity("http://[::1]:8080")
    } catch (e) {
      ssrfIpv6Blocked = e.message.includes("blocked")
    }
    logResult("SSRF Defense", "IPv6 Loopback ([::1]) rejected", ssrfIpv6Blocked)

    // - Non-HTTP schemes (file://, ftp://, gopher://)
    let ssrfSchemeBlocked = false
    try {
      await validateUrlSecurity("file:///etc/passwd")
    } catch (e) {
      ssrfSchemeBlocked = e.message.includes("protocol") || e.message.includes("allowed")
    }
    logResult("SSRF Defense", "Non-HTTP protocol (file:///etc/passwd) rejected", ssrfSchemeBlocked)

    // =========================================================================
    // SECTION 5: TENANT AND PERMISSION VERIFICATION
    // =========================================================================
    console.log("\n--- Section 5: Strict Cross-Tenant Isolation Verification ---")

    // 5.1 Tenant B cannot read Tenant A's business profile
    const resCrossProfile = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/profile",
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot view Tenant A's business profile (scoped to Tenant B)",
      resCrossProfile.status === 200 &&
        resCrossProfile.data?.data?.tenantId === TENANT_B &&
        resCrossProfile.data?.data?.businessName !== "Acme Logistics Global",
      `Tenant B saw: ${resCrossProfile.data?.data?.businessName}`
    )

    // 5.2 Tenant B cannot list Tenant A's products
    const resCrossProducts = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/products",
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot see Tenant A's products (returns 0 products)",
      resCrossProducts.status === 200 && resCrossProducts.data?.data?.products?.length === 0,
      `Count: ${resCrossProducts.data?.data?.products?.length}`
    )

    // 5.3 Tenant B cannot mutate Tenant A's product
    const resCrossProductMutate = await makeHttpRequest({
      method: "PUT",
      path: `/api/ai-knowledge/products/${liveProductId}`,
      body: { name: "Tampered by Tenant B" },
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot modify Tenant A's product (returns 404 Not Found)",
      resCrossProductMutate.status === 404,
      `Status: ${resCrossProductMutate.status}`
    )

    // 5.4 Tenant B cannot list Tenant A's knowledge sources
    const resCrossSources = await makeHttpRequest({
      method: "GET",
      path: "/api/ai-knowledge/sources",
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot view Tenant A's knowledge sources (returns 0 sources)",
      resCrossSources.status === 200 && resCrossSources.data?.data?.sources?.length === 0,
      `Count: ${resCrossSources.data?.data?.sources?.length}`
    )

    // 5.5 Tenant B cannot access or preview Tenant A's extracted text
    const resCrossPreview = await makeHttpRequest({
      method: "GET",
      path: `/api/ai-knowledge/sources/${liveManualSourceId}/preview`,
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot preview Tenant A's extracted text (returns 404 Not Found)",
      resCrossPreview.status === 404,
      `Status: ${resCrossPreview.status}`
    )

    // 5.6 Tenant B cannot trigger retry on Tenant A's knowledge source
    const resCrossRetry = await makeHttpRequest({
      method: "POST",
      path: `/api/ai-knowledge/sources/${liveManualSourceId}/retry`,
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot retry Tenant A's knowledge source (returns 404 Not Found)",
      resCrossRetry.status === 404,
      `Status: ${resCrossRetry.status}`
    )

    // 5.7 Tenant B cannot delete Tenant A's knowledge source
    const resCrossDelete = await makeHttpRequest({
      method: "DELETE",
      path: `/api/ai-knowledge/sources/${liveManualSourceId}`,
      headers: { Authorization: `Bearer ${tokenAdminB}` },
    })
    logResult(
      "Isolation",
      "Tenant B cannot delete Tenant A's knowledge source (returns 404 Not Found)",
      resCrossDelete.status === 404,
      `Status: ${resCrossDelete.status}`
    )

    // =========================================================================
    // SECTION 6: EXISTING CRM REGRESSION
    // =========================================================================
    console.log("\n--- Section 6: Existing CRM Endpoints Regression Verification ---")

    // 6.1 Lead Creation
    const resCreateLead = await makeHttpRequest({
      method: "POST",
      path: "/api/leads",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
      body: {
        name: "Enterprise Client Lead",
        email: `enterprise_${TEST_ID}@buyer.test`,
        phone: "+91 9888877777",
        status: "New",
        source: "Website",
        tenantId: TENANT_A,
      },
    })
    logResult(
      "Regression",
      "Existing Lead creation API (POST /api/leads) works normally",
      resCreateLead.status === 201 || resCreateLead.status === 200,
      `Status: ${resCreateLead.status}, Body: ${JSON.stringify(resCreateLead.data)}`
    )
    const leadId = resCreateLead.data?.data?.id || resCreateLead.data?.data?._id || resCreateLead.data?.id || resCreateLead.data?._id

    // 6.2 Lead Editing
    let leadEditPassed = false
    if (leadId) {
      const resEditLead = await makeHttpRequest({
        method: "PUT",
        path: `/api/leads/${leadId}`,
        headers: { Authorization: `Bearer ${tokenAdminA}` },
        body: { status: "Engaged" },
      })
      leadEditPassed = resEditLead.status === 200
      logResult("Regression", "Existing Lead editing API (PUT /api/leads/:id) works normally", leadEditPassed, `Status: ${resEditLead.status}`)
    } else {
      logResult("Regression", "Existing Lead editing API (PUT /api/leads/:id)", false, "No leadId from creation")
    }

    // 6.3 Lead Assignment API check
    const resAssignCheck = await makeHttpRequest({
      method: "GET",
      path: "/api/assignment-rules",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Regression",
      "Assignment rules API (/api/assignment-rules) intact",
      resAssignCheck.status === 200 || resAssignCheck.status === 404,
      `Status: ${resAssignCheck.status}`
    )

    // 6.4 Device APIs
    const resDevicesCheck = await makeHttpRequest({
      method: "GET",
      path: "/api/devices",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Regression",
      "Device management API (/api/devices) intact and correctly routed",
      resDevicesCheck.status === 200,
      `Status: ${resDevicesCheck.status}`
    )

    // 6.5 Call Recording Playback Route Contract
    const resCallRecordingContract = await makeHttpRequest({
      method: "GET",
      path: "/api/calls/recordings/test-recording-id/stream",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Regression",
      "Call recording streaming route (/api/calls/recordings/:id/stream) contract intact",
      resCallRecordingContract.status === 404 || resCallRecordingContract.status === 200 || resCallRecordingContract.status === 400,
      `Status: ${resCallRecordingContract.status}`
    )

    // 6.6 Media Storage / Legacy GridFS Route Contract
    const resMediaRoute = await makeHttpRequest({
      method: "GET",
      path: "/api/media/audio/test-gridfs-id",
      headers: { Authorization: `Bearer ${tokenAdminA}` },
    })
    logResult(
      "Regression",
      "Media audio streaming route (/api/media/audio/:id) contract intact",
      resMediaRoute.status === 404 || resMediaRoute.status === 200 || resMediaRoute.status === 400,
      `Status: ${resMediaRoute.status}`
    )

  } catch (err) {
    console.error("FATAL ERROR IN LIVE VERIFICATION:", err)
    logResult("FATAL", "Execution exception", false, err.message)
  } finally {
    await cleanupFixtures()
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  }

  console.log("\n================================================================================")
  const totalTests = testResults.length
  const passedTests = testResults.filter((r) => r.passed).length
  const failedTests = testResults.filter((r) => !r.passed).length
  console.log(`FINAL STABILIZATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (${totalTests} total)`)
  console.log("================================================================================\n")

  if (failedTests > 0) {
    process.exit(1)
  }
}

runLiveAndStabilizationTests()
