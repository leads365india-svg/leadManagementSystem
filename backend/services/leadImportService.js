const mongoose = require("mongoose")
const xlsx = require("xlsx")
const Lead = require("../models/Lead")
const Workspace = require("../models/Workspace")
const { CustomField } = require("../models/CustomField")
const leadService = require("./leadService")
const audit = require("./auditService")
const { normalizePhoneE164, isValidE164 } = require("../utils/phoneNormalizer")
const { getEffectiveTenant, runWithTenantContext } = require("../middleware/tenantContext")

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_IMPORT_ROWS = 5000
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
const PHONE_SYNTAX_REGEX = /^[+\d\s().-]{5,30}$/

const STATUS_ALIASES = {
  new: "New",
  "new lead": "New",
  "new leads": "New",
  "new-leads": "New",
  engaged: "Engaged",
  active: "Engaged",
  "active lead": "Engaged",
  "active leads": "Engaged",
  "active-leads": "Engaged",
  contacted: "Engaged",
  "proposal sent": "Proposal Sent",
  "proposal-sent": "Proposal Sent",
  proposal: "Proposal Sent",
  "closed-won": "Closed-Won",
  "closed won": "Closed-Won",
  won: "Closed-Won",
  "order placed": "Closed-Won",
  "order-placed": "Closed-Won",
  "closed-lost": "Closed-Lost",
  "closed lost": "Closed-Lost",
  lost: "Closed-Lost",
  "lost lead": "Closed-Lost",
  "lost leads": "Closed-Lost",
  "lost-leads": "Closed-Lost",
}

const SUPPORTED_LEAD_FIELDS = [
  {
    key: "name",
    label: "Lead Name",
    required: true,
    description: "Full name of prospect (2-100 characters)",
  },
  {
    key: "email",
    label: "Email",
    required: false,
    contactIdentity: true,
    description: "Prospect email address (Email or Phone required)",
  },
  {
    key: "phone",
    label: "Phone",
    required: false,
    contactIdentity: true,
    description: "Mobile or landline phone number (Email or Phone required)",
  },
  {
    key: "company",
    label: "Company Name",
    required: false,
    description: "Organization or business name",
  },
  {
    key: "source",
    label: "Lead Source",
    required: false,
    description: "Acquisition channel (defaults to Bulk Import)",
  },
  {
    key: "status",
    label: "Pipeline Status",
    required: false,
    description: "New, Engaged, Proposal Sent, Closed-Won, or Closed-Lost",
  },
  {
    key: "city",
    label: "City",
    required: false,
    description: "City or location",
  },
  {
    key: "alternatePhone",
    label: "Alternate Phone",
    required: false,
    description: "Secondary contact phone number",
  },
  {
    key: "expectedDealAmount",
    label: "Expected Deal Amount",
    required: false,
    description: "Estimated pipeline value (non-negative number)",
  },
  {
    key: "closedWonAmount",
    label: "Closed Won Amount",
    required: false,
    description: "Required when status is Closed-Won",
  },
  {
    key: "tags",
    label: "Tags",
    required: false,
    description: "Comma-separated tags",
  },
  {
    key: "message",
    label: "Notes / Inquiry",
    required: false,
    description: "Prospect requirements or notes (up to 2000 characters)",
  },
]

const HEADER_ALIAS_MAP = {
  name: [
    "name",
    "full name",
    "fullname",
    "lead name",
    "contact name",
    "customer name",
    "client name",
    "prospect",
    "prospect name",
    "first and last name",
  ],
  email: [
    "email",
    "email address",
    "e-mail",
    "e mail",
    "mail",
    "work email",
    "contact email",
    "primary email",
  ],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "mobile number",
    "contact",
    "contact number",
    "cell",
    "telephone",
    "tel",
    "whatsapp",
    "whatsapp number",
    "ph",
    "ph no",
  ],
  company: [
    "company",
    "company name",
    "organization",
    "organisation",
    "org",
    "business",
    "business name",
    "firm",
    "hospital",
    "clinic",
    "account name",
  ],
  source: [
    "source",
    "lead source",
    "channel",
    "origin",
    "campaign source",
    "acquisition channel",
  ],
  status: [
    "status",
    "lead status",
    "stage",
    "pipeline status",
    "pipeline stage",
  ],
  city: [
    "city",
    "location",
    "town",
  ],
  alternatePhone: [
    "alternate phone",
    "alt phone",
    "secondary phone",
    "phone 2",
    "mobile 2",
    "alternate mobile",
  ],
  expectedDealAmount: [
    "expected deal amount",
    "deal amount",
    "deal value",
    "expected amount",
    "estimated value",
    "amount",
  ],
  closedWonAmount: [
    "closed won amount",
    "closed amount",
    "won amount",
    "closing amount",
  ],
  tags: [
    "tags",
    "tag",
    "labels",
  ],
  message: [
    "message",
    "notes",
    "note",
    "comment",
    "comments",
    "description",
    "requirements",
    "requirement",
    "inquiry",
    "enquiry",
    "remarks",
  ],
}

function stripBom(str) {
  if (typeof str !== "string") return ""
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str
}

function normalizeHeaderToken(header) {
  return String(header || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function createImportError(message, status = 400, code = "IMPORT_VALIDATION_ERROR") {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function formatCellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ""
  if (cell.t === "s" || cell.t === "str") {
    return String(cell.v).trim()
  }
  if (cell.t === "b") {
    return cell.v ? "true" : "false"
  }
  if (cell.t === "n") {
    // Preserve integer phone / ID numbers verbatim without scientific notation
    if (Number.isFinite(cell.v) && Number.isInteger(cell.v)) {
      return cell.v.toFixed(0)
    }
    return cell.w ? String(cell.w).trim() : String(cell.v).trim()
  }
  if (cell.v instanceof Date && !isNaN(cell.v.getTime())) {
    return cell.v.toISOString().split("T")[0]
  }
  return cell.w !== undefined && cell.w !== null
    ? String(cell.w).trim()
    : String(cell.v).trim()
}

function buildUniqueHeaders(rawHeaders = []) {
  const seen = new Map()
  const headers = []
  let hasRealHeader = false

  for (let i = 0; i < rawHeaders.length; i++) {
    const raw = rawHeaders[i] !== undefined && rawHeaders[i] !== null ? String(rawHeaders[i]).trim() : ""
    const isAutoEmpty = !raw || /^__EMPTY/i.test(raw)
    if (!isAutoEmpty) {
      hasRealHeader = true
    }
    const base = isAutoEmpty ? `Column_${i + 1}` : raw
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    headers.push(count === 1 ? base : `${base} (${count})`)
  }

  return { headers, hasRealHeader }
}

/**
 * Parses an uploaded CSV, Excel (.xlsx/.xls), or JSON file buffer into normalized headers + rows.
 */
function parseLeadImportFile({ buffer, originalName = "", mimetype = "" }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createImportError("Uploaded file is empty. Please choose a valid CSV, Excel, or JSON file.", 400, "EMPTY_FILE")
  }

  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw createImportError("File size exceeds the 10 MB limit. Split the file or upload fewer rows.", 400, "FILE_TOO_LARGE")
  }

  const ext = (originalName.match(/\.[^.]+$/)?.[0] || "").toLowerCase()
  const allowedExts = new Set([".csv", ".xlsx", ".xls", ".json"])
  const mimeLower = String(mimetype || "").toLowerCase()

  let fileType = ""
  if (ext === ".json" || mimeLower === "application/json" || mimeLower === "text/json") {
    fileType = "json"
  } else if (ext === ".csv" || mimeLower === "text/csv" || mimeLower === "application/csv") {
    fileType = "csv"
  } else if (
    ext === ".xlsx" ||
    ext === ".xls" ||
    mimeLower.includes("spreadsheetml") ||
    mimeLower.includes("ms-excel")
  ) {
    fileType = "excel"
  }

  if (!fileType || (ext && !allowedExts.has(ext))) {
    throw createImportError(
      `Unsupported file format${ext ? ` '${ext}'` : ""}. Please upload a .csv, .xlsx, .xls, or .json file.`,
      400,
      "UNSUPPORTED_FORMAT",
    )
  }

  let headers = []
  let rows = []
  let sheetName = null

  if (fileType === "json") {
    const rawText = stripBom(buffer.toString("utf8")).trim()
    if (!rawText) {
      throw createImportError("Uploaded JSON file is empty.", 400, "EMPTY_FILE")
    }

    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch (jsonErr) {
      throw createImportError(`Malformed JSON file: ${jsonErr.message}`, 400, "MALFORMED_JSON")
    }

    let items = null
    if (Array.isArray(parsed)) {
      items = parsed
    } else if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.leads)) items = parsed.leads
      else if (Array.isArray(parsed.data)) items = parsed.data
      else if (Array.isArray(parsed.rows)) items = parsed.rows
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw createImportError(
        "JSON file must contain a non-empty array of lead objects (or an object with a 'leads' array).",
        400,
        "EMPTY_OR_INVALID_JSON",
      )
    }

    if (items.length > MAX_IMPORT_ROWS) {
      throw createImportError(
        `File contains ${items.length} records, exceeding the maximum ${MAX_IMPORT_ROWS} rows per import.`,
        400,
        "ROW_LIMIT_EXCEEDED",
      )
    }

    const headerSet = new Set()
    const validObjects = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw createImportError(`JSON entry at index ${i} must be an object of lead fields.`, 400, "INVALID_JSON_ITEM")
      }
      const keys = Object.keys(item)
      keys.forEach((k) => {
        if (String(k).trim()) headerSet.add(String(k).trim())
      })
      validObjects.push(item)
    }

    headers = Array.from(headerSet)
    if (headers.length === 0) {
      throw createImportError("JSON objects do not contain any readable column headers.", 400, "INVALID_HEADERS")
    }

    rows = validObjects.map((item, idx) => {
      const normalized = { __rowNumber: idx + 1 }
      for (const h of headers) {
        const val = item[h]
        if (val === undefined || val === null) {
          normalized[h] = ""
        } else if (Array.isArray(val)) {
          normalized[h] = val.map((v) => String(v ?? "").trim()).filter(Boolean).join(", ")
        } else if (typeof val === "object") {
          normalized[h] = JSON.stringify(val)
        } else {
          normalized[h] = String(val).trim()
        }
      }
      return normalized
    })
  } else {
    // Reject obvious binary PDF/ZIP/PNG masquerading as CSV, or corrupt buffers for Excel
    if (fileType === "csv") {
      const sampleText = stripBom(buffer.toString("utf8"))
      if (!sampleText.trim()) {
        throw createImportError("Uploaded CSV file is empty.", 400, "EMPTY_FILE")
      }
      if (buffer.includes(0x00)) {
        throw createImportError("CSV file contains invalid binary null bytes.", 400, "MALFORMED_CSV")
      }
    }

    let workbook
    try {
      workbook =
        fileType === "csv"
          ? xlsx.read(stripBom(buffer.toString("utf8")), { type: "string", raw: true })
          : xlsx.read(buffer, { type: "buffer", cellDates: false })
    } catch (parseErr) {
      throw createImportError(
        `Could not parse ${fileType === "csv" ? "CSV" : "Excel"} file: ${parseErr.message}`,
        400,
        "MALFORMED_SPREADSHEET",
      )
    }

    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw createImportError("Spreadsheet contains no worksheets.", 400, "EMPTY_WORKBOOK")
    }

    // Select first non-empty worksheet
    let selectedSheet = null
    for (const sName of workbook.SheetNames) {
      const candidate = workbook.Sheets[sName]
      if (candidate && candidate["!ref"]) {
        selectedSheet = candidate
        sheetName = sName
        break
      }
    }

    if (!selectedSheet) {
      throw createImportError("Uploaded spreadsheet is empty.", 400, "EMPTY_SHEET")
    }

    const range = xlsx.utils.decode_range(selectedSheet["!ref"])
    const colCount = range.e.c - range.s.c + 1
    const rowCount = range.e.r - range.s.r + 1

    if (colCount <= 0 || rowCount <= 1) {
      throw createImportError(
        "File must contain a header row and at least one lead data row.",
        400,
        "NO_DATA_ROWS",
      )
    }

    if (rowCount - 1 > MAX_IMPORT_ROWS) {
      throw createImportError(
        `File contains ${rowCount - 1} rows, exceeding the maximum ${MAX_IMPORT_ROWS} rows per import.`,
        400,
        "ROW_LIMIT_EXCEEDED",
      )
    }

    const rawHeaderCells = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r: range.s.r, c })
      rawHeaderCells.push(formatCellValue(selectedSheet[addr]))
    }

    const headerResult = buildUniqueHeaders(rawHeaderCells)
    if (!headerResult.hasRealHeader) {
      throw createImportError("First row does not contain valid column headers.", 400, "INVALID_HEADERS")
    }
    headers = headerResult.headers

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const rowObj = { __rowNumber: r - range.s.r }
      let hasAnyValue = false
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r, c })
        const val = formatCellValue(selectedSheet[addr])
        const colName = headers[c - range.s.c]
        rowObj[colName] = val
        if (val !== "") {
          hasAnyValue = true
        }
      }
      if (hasAnyValue) {
        rows.push(rowObj)
      }
    }

    if (rows.length === 0) {
      throw createImportError("No non-empty lead data rows found below the header row.", 400, "NO_DATA_ROWS")
    }
  }

  return {
    fileType,
    sheetName,
    headers,
    totalRows: rows.length,
    rows,
    sampleRows: rows.slice(0, 5),
  }
}

/**
 * Generates deterministic 1-to-1 column auto-mapping suggestions from uploaded headers.
 */
function suggestColumnMapping(headers = [], customFields = []) {
  const mapping = {}
  const usedTargets = new Set()

  // Pass 1: exact alias match against standard Lead fields (prioritize exact token matches first)
  for (const header of headers) {
    const token = normalizeHeaderToken(header)
    if (!token) continue

    let matchedField = null
    for (const [fieldKey, aliases] of Object.entries(HEADER_ALIAS_MAP)) {
      if (usedTargets.has(fieldKey)) continue
      if (aliases.includes(token)) {
        matchedField = fieldKey
        break
      }
    }

    // Match tenant active custom fields by key or label
    if (!matchedField && Array.isArray(customFields) && customFields.length > 0) {
      for (const cf of customFields) {
        const target = `customField:${cf.name}`
        if (usedTargets.has(target)) continue
        const cfNameTok = normalizeHeaderToken(cf.name)
        const cfLabelTok = normalizeHeaderToken(cf.label)
        if (token === cfNameTok || token === cfLabelTok) {
          matchedField = target
          break
        }
      }
    }

    if (matchedField) {
      mapping[header] = matchedField
      usedTargets.add(matchedField)
    }
  }

  // Pass 2: fuzzy substring fallback for remaining unmapped headers
  for (const header of headers) {
    if (mapping[header]) continue
    const token = normalizeHeaderToken(header)
    if (!token) {
      mapping[header] = ""
      continue
    }

    let matchedField = ""
    for (const [fieldKey, aliases] of Object.entries(HEADER_ALIAS_MAP)) {
      if (usedTargets.has(fieldKey)) continue
      if (aliases.some((alias) => alias.length >= 4 && token.includes(alias))) {
        matchedField = fieldKey
        break
      }
    }

    mapping[header] = matchedField
    if (matchedField) {
      usedTargets.add(matchedField)
    }
  }

  return mapping
}

/**
 * Normalizes and validates status string using existing CRM canonical statuses and aliases.
 */
function normalizeLeadStatus(rawStatus) {
  if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === "") {
    return { valid: true, value: "New" }
  }
  const clean = String(rawStatus).trim()
  const mapped = STATUS_ALIASES[clean.toLowerCase()]
  if (mapped) {
    return { valid: true, value: mapped }
  }
  const allowed = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]
  if (allowed.includes(clean)) {
    return { valid: true, value: clean }
  }
  return {
    valid: false,
    error: `Invalid status '${clean}'. Allowed: ${allowed.join(", ")}`,
  }
}

function sanitizeCustomFieldKeySet(customFields = []) {
  const map = new Map()
  for (const cf of customFields || []) {
    if (cf && cf.name) {
      map.set(`customField:${cf.name}`, cf)
    }
  }
  return map
}

function validateAndSanitizeMapping(mapping = {}, customFields = []) {
  const allowedTargets = new Set(SUPPORTED_LEAD_FIELDS.map((f) => f.key))
  const cfMap = sanitizeCustomFieldKeySet(customFields)
  const cleanMapping = {}
  const usedTargets = new Set()

  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw createImportError("Column mapping must be a valid object.", 400, "INVALID_MAPPING")
  }

  for (const [columnName, targetField] of Object.entries(mapping)) {
    const cleanTarget = typeof targetField === "string" ? targetField.trim() : ""
    if (!cleanTarget) continue

    if (!allowedTargets.has(cleanTarget) && !cfMap.has(cleanTarget)) {
      throw createImportError(`Unsupported target field '${cleanTarget}' in mapping.`, 400, "UNSUPPORTED_FIELD")
    }
    if (usedTargets.has(cleanTarget)) {
      throw createImportError(`Multiple columns cannot map to the same field '${cleanTarget}'.`, 400, "DUPLICATE_MAPPING")
    }
    cleanMapping[columnName] = cleanTarget
    usedTargets.add(cleanTarget)
  }

  return {
    cleanMapping,
    mappedFields: Array.from(usedTargets),
  }
}

/**
 * Validates and transforms a single uploaded row according to Lead model & CRM rules.
 */
function validateAndNormalizeImportRow(rawRow = {}, cleanMapping = {}, options = {}) {
  const rowNumber = Number(rawRow.__rowNumber) || options.fallbackRowNumber || 1
  const defaultSource =
    typeof options.defaultSource === "string" && options.defaultSource.trim()
      ? options.defaultSource.trim()
      : "Bulk Import"
  const cfMap = sanitizeCustomFieldKeySet(options.customFields || [])

  const extracted = {}
  const customFieldValues = []

  for (const [col, target] of Object.entries(cleanMapping)) {
    const rawVal = rawRow[col]
    const strVal = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : ""

    if (target.startsWith("customField:")) {
      const cfDef = cfMap.get(target)
      if (cfDef) {
        customFieldValues.push({ def: cfDef, value: strVal })
      }
    } else if (strVal !== "" || extracted[target] === undefined) {
      extracted[target] = strVal
    }
  }

  const errors = []

  // 1. Name (Required, 2-100 chars matching Lead.js)
  const name = (extracted.name || "").trim()
  if (!name) {
    errors.push("Lead Name is required")
  } else if (name.length < 2) {
    errors.push("Lead Name must be at least 2 characters long")
  } else if (name.length > 100) {
    errors.push("Lead Name cannot exceed 100 characters")
  }

  // 2. Email validation (if provided)
  const email = (extracted.email || "").toLowerCase().trim()
  if (email && !EMAIL_REGEX.test(email)) {
    errors.push(`Invalid email format '${extracted.email}'`)
  }

  // 3. Phone validation & normalization (using existing phoneNormalizer.js)
  const phone = (extracted.phone || "").trim()
  let phoneNormalized = ""
  if (phone) {
    const hasInvalidAlpha = /[a-zA-Z]/.test(phone) || !PHONE_SYNTAX_REGEX.test(phone)
    phoneNormalized = hasInvalidAlpha ? "" : normalizePhoneE164(phone, options.defaultCountry || "+91")
    if (hasInvalidAlpha || !phoneNormalized || !isValidE164(phoneNormalized)) {
      errors.push(`Invalid phone format '${phone}'`)
    }
  }

  // Require at least one valid contact identity (email or phone)
  if (!email && !phone) {
    errors.push("Either Email or Phone number is required")
  }

  // 4. Alternate phone validation if provided
  const alternatePhone = (extracted.alternatePhone || "").trim()
  if (alternatePhone) {
    const altHasAlpha = /[a-zA-Z]/.test(alternatePhone) || !PHONE_SYNTAX_REGEX.test(alternatePhone)
    const altNorm = altHasAlpha ? "" : normalizePhoneE164(alternatePhone, options.defaultCountry || "+91")
    if (altHasAlpha || !altNorm || !isValidE164(altNorm)) {
      errors.push(`Invalid alternate phone format '${alternatePhone}'`)
    }
  }

  // 5. Status validation & alias mapping
  const statusCheck = normalizeLeadStatus(extracted.status)
  if (!statusCheck.valid) {
    errors.push(statusCheck.error)
  }
  const status = statusCheck.valid ? statusCheck.value : "New"

  // 6. Deal amount validation
  let expectedDealAmount = 0
  if (extracted.expectedDealAmount !== undefined && extracted.expectedDealAmount !== "") {
    const numStr = extracted.expectedDealAmount.replace(/[,$\s₹]/g, "")
    const parsedAmt = Number(numStr)
    if (!numStr || !Number.isFinite(parsedAmt) || parsedAmt < 0) {
      errors.push(`Expected deal amount must be a non-negative number ('${extracted.expectedDealAmount}')`)
    } else {
      expectedDealAmount = parsedAmt
    }
  }

  let closedWonAmount = null
  if (extracted.closedWonAmount !== undefined && extracted.closedWonAmount !== "") {
    const numStr = extracted.closedWonAmount.replace(/[,$\s₹]/g, "")
    const parsedWon = Number(numStr)
    if (!numStr || !Number.isFinite(parsedWon) || parsedWon < 0) {
      errors.push(`Closed won amount must be a valid non-negative number ('${extracted.closedWonAmount}')`)
    } else {
      closedWonAmount = parsedWon
    }
  }
  if (status === "Closed-Won" && !(closedWonAmount > 0)) {
    errors.push("Closed-Won leads require a positive Closed Won Amount")
  }

  // 7. Message length (matching Lead.js 2000 max)
  const message = (extracted.message || "").trim()
  if (message.length > 2000) {
    errors.push("Notes/Message cannot exceed 2000 characters")
  }

  // 8. Tags normalization
  const tags = extracted.tags
    ? extracted.tags
        .split(/[,;|]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : []

  // 9. Active Custom Fields validation
  const customFields = []
  for (const item of customFieldValues) {
    const { def, value } = item
    if (def.required && !value) {
      errors.push(`Required custom field '${def.label}' is missing`)
      continue
    }
    if (!value) continue

    let coerced = value
    if (def.type === "number") {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        errors.push(`Custom field '${def.label}' must be a number ('${value}')`)
        continue
      }
      coerced = n
    } else if (def.type === "email" && !EMAIL_REGEX.test(value)) {
      errors.push(`Custom field '${def.label}' must be a valid email ('${value}')`)
      continue
    } else if (def.type === "checkbox") {
      const lower = value.toLowerCase()
      coerced = lower === "true" || lower === "yes" || lower === "1"
    } else if (def.type === "dropdown" && Array.isArray(def.options) && def.options.length > 0) {
      const match = def.options.find((opt) => opt.toLowerCase() === value.toLowerCase())
      if (!match) {
        errors.push(`Custom field '${def.label}' must be one of: ${def.options.join(", ")}`)
        continue
      }
      coerced = match
    }

    customFields.push({
      key: def.name,
      label: def.label,
      value: coerced,
      type: def.type || "text",
      order: def.order || 0,
    })
  }

  const normalizedPayload = {
    name,
    email,
    phone,
    phoneNormalized,
    alternatePhone,
    company: (extracted.company || "").trim(),
    city: (extracted.city || "").trim(),
    status,
    source: (extracted.source || "").trim() || defaultSource,
    expectedDealAmount,
    ...(closedWonAmount !== null ? { closedWonAmount } : {}),
    tags,
    message,
    ...(customFields.length > 0 ? { customFields } : {}),
  }

  return {
    rowNumber,
    valid: errors.length === 0,
    errors,
    payload: normalizedPayload,
  }
}

/**
 * Strictly resolves tenantId, workspaceId, and mode from server-side authenticated session & tenantContext.
 * Never trusts client-supplied tenantId overrides or unauthorized workspaceIds.
 */
async function resolveImportScope(req, requestedWorkspaceId = null) {
  const { tenantId: effectiveTenantId, isSuperAdmin } = getEffectiveTenant(req)

  if (!req.user || (!effectiveTenantId && !isSuperAdmin)) {
    throw createImportError("Authentication required to import CRM leads.", 401, "AUTH_REQUIRED")
  }

  if (isSuperAdmin) {
    throw createImportError(
      "Access denied: Platform Super Admin is in audited read-only support mode and cannot import leads into tenant accounts.",
      403,
      "SUPERADMIN_READONLY_SUPPORT_MODE",
    )
  }

  // Never trust uploaded/body/header tenantId that disagrees with authenticated user.tenantId
  const userTenantId = req.user.tenantId ? String(req.user.tenantId).trim() : null
  if (!userTenantId) {
    throw createImportError("Authenticated user has no associated tenant account.", 403, "NO_TENANT_CONTEXT")
  }

  const claimedTenant =
    (typeof req.body?.tenantId === "string" && req.body.tenantId.trim()) ||
    (typeof req.query?.tenantId === "string" && req.query.tenantId.trim()) ||
    (typeof req.headers?.["x-tenant-id"] === "string" && req.headers["x-tenant-id"].trim()) ||
    null

  if (claimedTenant && claimedTenant !== userTenantId) {
    throw createImportError("Access denied: Cross-tenant lead import is prohibited.", 403, "CROSS_TENANT_FORBIDDEN")
  }

  const ctx = req.tenantContext || {
    tenantId: userTenantId,
    workspaceId: null,
    mode: "standalone",
    isOrgAdmin: req.user.role === "account_admin",
  }

  if (ctx.mode === "anonymous" || ctx.mode === "unassigned_review") {
    throw createImportError("Invalid tenant/workspace execution context for lead import.", 403, "INVALID_CONTEXT")
  }

  const cleanRequestedWs =
    typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim() && requestedWorkspaceId.trim() !== "all"
      ? requestedWorkspaceId.trim()
      : null

  // Mode A: Standalone Account — never auto-create or accept foreign workspaces
  if (ctx.mode === "standalone") {
    if (cleanRequestedWs) {
      throw createImportError(
        "Workspace assignment is unavailable in standalone account mode.",
        400,
        "STANDALONE_WORKSPACE_FORBIDDEN",
      )
    }
    return {
      tenantId: userTenantId,
      workspaceId: null,
      workspaceName: null,
      mode: "standalone",
    }
  }

  // Mode B: Single Workspace Context
  if (ctx.mode === "single_workspace") {
    if (ctx.workspaceRole === "viewer") {
      throw createImportError(
        "Access denied: Read-only workspace viewers cannot import leads.",
        403,
        "WORKSPACE_VIEWER_FORBIDDEN",
      )
    }

    const boundWsId = ctx.workspaceId ? ctx.workspaceId.toString() : null
    if (!boundWsId) {
      throw createImportError("Active workspace context is missing.", 403, "WORKSPACE_REQUIRED")
    }

    if (cleanRequestedWs && cleanRequestedWs !== boundWsId) {
      throw createImportError(
        "Cross-workspace import denied: Selected target workspace does not match your active workspace.",
        403,
        "CROSS_WORKSPACE_FORBIDDEN",
      )
    }

    return {
      tenantId: userTenantId,
      workspaceId: ctx.workspaceId,
      workspaceName: ctx.workspaceName || null,
      mode: "single_workspace",
    }
  }

  // Mode B: Organization Admin in "All Projects"
  if (ctx.mode === "authorized_all_workspaces") {
    if (req.user.role !== "account_admin") {
      throw createImportError(
        "Cross-workspace access requires Organization Administrator privileges.",
        403,
        "CROSS_WORKSPACE_DENIED",
      )
    }

    if (cleanRequestedWs) {
      if (!mongoose.Types.ObjectId.isValid(cleanRequestedWs)) {
        throw createImportError("Invalid target workspace identifier.", 400, "INVALID_WORKSPACE_ID")
      }

      const targetWs = await Workspace.findOne({
        _id: cleanRequestedWs,
        tenantId: userTenantId,
        status: "active",
      })
        .setOptions({ skipTenantFilter: true })
        .lean()

      if (!targetWs) {
        throw createImportError(
          "Target workspace not found, archived, or does not belong to your organization.",
          404,
          "WORKSPACE_NOT_FOUND",
        )
      }

      return {
        tenantId: userTenantId,
        workspaceId: targetWs._id,
        workspaceName: targetWs.name,
        mode: "single_workspace",
      }
    }

    // All Projects without specific workspace keeps workspaceId: null (unassigned review pool per existing All Projects rules)
    return {
      tenantId: userTenantId,
      workspaceId: null,
      workspaceName: null,
      mode: "authorized_all_workspaces",
    }
  }

  throw createImportError("Unsupported workspace mode for lead import.", 403, "INVALID_WORKSPACE_MODE")
}

async function fetchExistingDuplicateMaps({ tenantId, workspaceId, mode, emails = [], phones = [] }) {
  const cleanEmails = Array.from(new Set(emails.filter(Boolean)))
  const cleanPhones = Array.from(new Set(phones.filter(Boolean)))

  const existingEmailSet = new Set()
  const existingPhoneSet = new Set()

  if (cleanEmails.length === 0 && cleanPhones.length === 0) {
    return { existingEmailSet, existingPhoneSet }
  }

  const identityOr = []
  if (cleanEmails.length > 0) identityOr.push({ email: { $in: cleanEmails } })
  if (cleanPhones.length > 0) {
    identityOr.push({ phoneNormalized: { $in: cleanPhones } })
    identityOr.push({ phone: { $in: cleanPhones } })
  }

  const query = {
    tenantId,
    deletedAt: null,
    $or: identityOr,
  }

  if (mode === "single_workspace" && workspaceId) {
    query.workspaceId = workspaceId
  } else if (mode === "standalone") {
    query.$and = [{ $or: [{ workspaceId: null }, { workspaceId: { $exists: false } }] }]
  }
  // In authorized_all_workspaces with workspaceId: null, check across all tenant leads to prevent org duplicates

  const matches = await Lead.find(query)
    .setOptions({ skipTenantFilter: true })
    .select("email phone phoneNormalized")
    .lean()

  for (const doc of matches) {
    if (doc.email) existingEmailSet.add(String(doc.email).toLowerCase().trim())
    if (doc.phoneNormalized) existingPhoneSet.add(String(doc.phoneNormalized).trim())
    else if (doc.phone) {
      const norm = normalizePhoneE164(doc.phone)
      if (norm) existingPhoneSet.add(norm)
    }
  }

  return { existingEmailSet, existingPhoneSet }
}

/**
 * Validates rows and detects duplicates WITHOUT persisting anything to MongoDB.
 */
async function previewImportLeads({
  tenantId,
  workspaceId = null,
  mode = "standalone",
  rows = [],
  mapping = {},
  defaultSource = "Bulk Import",
  priorEmails = [],
  priorPhones = [],
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createImportError("No rows supplied for preview.", 400, "NO_ROWS")
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw createImportError(`Maximum ${MAX_IMPORT_ROWS} rows supported per preview request.`, 400, "ROW_LIMIT_EXCEEDED")
  }

  const customFields = await CustomField.find({ tenantId, status: "active" })
    .setOptions({ skipTenantFilter: true })
    .sort({ order: 1, createdAt: 1 })
    .lean()

  const { cleanMapping, mappedFields } = validateAndSanitizeMapping(mapping, customFields)

  if (!mappedFields.includes("name")) {
    throw createImportError("Lead Name column mapping is required before previewing.", 400, "MISSING_NAME_MAPPING")
  }
  if (!mappedFields.includes("email") && !mappedFields.includes("phone")) {
    throw createImportError("Map at least Email or Phone column before previewing.", 400, "MISSING_CONTACT_MAPPING")
  }

  const validatedRows = rows.map((row, idx) =>
    validateAndNormalizeImportRow(row, cleanMapping, {
      defaultSource,
      customFields,
      fallbackRowNumber: idx + 1,
    }),
  )

  const emailsToLookup = validatedRows.filter((r) => r.valid && r.payload.email).map((r) => r.payload.email)
  const phonesToLookup = validatedRows
    .filter((r) => r.valid && r.payload.phoneNormalized)
    .map((r) => r.payload.phoneNormalized)

  const { existingEmailSet, existingPhoneSet } = await fetchExistingDuplicateMaps({
    tenantId,
    workspaceId,
    mode,
    emails: emailsToLookup,
    phones: phonesToLookup,
  })

  const seenEmailsInFile = new Map((priorEmails || []).map((e) => [String(e).toLowerCase().trim(), "earlier batch"]))
  const seenPhonesInFile = new Map((priorPhones || []).map((p) => [String(p).trim(), "earlier batch"]))

  let validCount = 0
  let invalidCount = 0
  let duplicateCount = 0
  const previewRows = []
  const sampleValidLeads = []

  for (const vr of validatedRows) {
    if (!vr.valid) {
      invalidCount++
      previewRows.push({
        rowNumber: vr.rowNumber,
        status: "invalid",
        reasons: vr.errors,
        reason: vr.errors.join("; "),
        data: vr.payload,
      })
      continue
    }

    const { email, phoneNormalized } = vr.payload
    const dupReasons = []

    if (email && existingEmailSet.has(email)) {
      dupReasons.push(`Email '${email}' already exists in CRM`)
    } else if (email && seenEmailsInFile.has(email)) {
      dupReasons.push(`Duplicate email '${email}' within uploaded file (row ${seenEmailsInFile.get(email)})`)
    }

    if (phoneNormalized && existingPhoneSet.has(phoneNormalized)) {
      dupReasons.push(`Phone '${phoneNormalized}' already exists in CRM`)
    } else if (phoneNormalized && seenPhonesInFile.has(phoneNormalized)) {
      dupReasons.push(`Duplicate phone '${phoneNormalized}' within uploaded file (row ${seenPhonesInFile.get(phoneNormalized)})`)
    }

    if (dupReasons.length > 0) {
      duplicateCount++
      previewRows.push({
        rowNumber: vr.rowNumber,
        status: "duplicate",
        reasons: dupReasons,
        reason: dupReasons.join("; "),
        data: vr.payload,
      })
      continue
    }

    if (email) seenEmailsInFile.set(email, vr.rowNumber)
    if (phoneNormalized) seenPhonesInFile.set(phoneNormalized, vr.rowNumber)

    validCount++
    if (sampleValidLeads.length < 10) {
      sampleValidLeads.push({
        rowNumber: vr.rowNumber,
        ...vr.payload,
      })
    }
    previewRows.push({
      rowNumber: vr.rowNumber,
      status: "valid",
      reasons: [],
      reason: "",
      data: vr.payload,
    })
  }

  return {
    summary: {
      total: validatedRows.length,
      valid: validCount,
      invalid: invalidCount,
      duplicate: duplicateCount,
      skipped: duplicateCount,
    },
    mappedFields,
    rows: previewRows,
    sampleValidLeads,
  }
}

/**
 * Executes confirmed lead import safely through leadService.createOrMergeLead.
 * Re-validates on server, enforces tenant/workspace isolation, prevents duplicate overwrites,
 * supports retry idempotency via importBatchId, and isolates partial row failures.
 */
async function executeImportLeads({
  tenantId,
  workspaceId = null,
  mode = "standalone",
  rows = [],
  mapping = {},
  defaultSource = "Bulk Import",
  importBatchId = "",
  actor = null,
  fileName = "",
  req = null,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createImportError("No rows provided to import.", 400, "NO_ROWS")
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw createImportError(`Maximum ${MAX_IMPORT_ROWS} rows allowed per import batch.`, 400, "ROW_LIMIT_EXCEEDED")
  }

  const cleanBatchId =
    typeof importBatchId === "string" && importBatchId.trim()
      ? importBatchId.trim().slice(0, 64)
      : `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const customFields = await CustomField.find({ tenantId, status: "active" })
    .setOptions({ skipTenantFilter: true })
    .sort({ order: 1, createdAt: 1 })
    .lean()

  const { cleanMapping, mappedFields } = validateAndSanitizeMapping(mapping, customFields)
  if (!mappedFields.includes("name")) {
    throw createImportError("Lead Name column mapping is required.", 400, "MISSING_NAME_MAPPING")
  }
  if (!mappedFields.includes("email") && !mappedFields.includes("phone")) {
    throw createImportError("Map at least Email or Phone column.", 400, "MISSING_CONTACT_MAPPING")
  }

  const WRITE_CONCURRENCY = 10

  // 1. Validate all rows synchronously & assign deterministic slots
  const validatedEntries = rows.map((rawRow, idx) => {
    const validation = validateAndNormalizeImportRow(rawRow, cleanMapping, {
      defaultSource,
      customFields,
      fallbackRowNumber: idx + 1,
    })
    return {
      idx,
      rowNum: validation.rowNumber,
      idempotencyKey: `import:${cleanBatchId}:row:${validation.rowNumber}`,
      validation,
    }
  })

  // 2. Single batch query for retry idempotency keys & existing tenant duplicates
  const validEntries = validatedEntries.filter((e) => e.validation.valid)
  const validIdempKeys = validEntries.map((e) => e.idempotencyKey)
  const validEmails = validEntries.map((e) => e.validation.payload.email).filter(Boolean)
  const validPhones = validEntries.map((e) => e.validation.payload.phoneNormalized).filter(Boolean)

  const [existingRetryDocs, dupMaps] = await Promise.all([
    validIdempKeys.length > 0
      ? Lead.find({ tenantId, "metadata.idempotencyKey": { $in: validIdempKeys } })
          .setOptions({ skipTenantFilter: true })
          .select("_id metadata.idempotencyKey")
          .lean()
      : [],
    fetchExistingDuplicateMaps({
      tenantId,
      workspaceId,
      mode: mode === "authorized_all_workspaces" && !workspaceId ? "authorized_all_workspaces" : mode,
      emails: validEmails,
      phones: validPhones,
    }),
  ])

  const retryByKey = new Map()
  for (const doc of existingRetryDocs) {
    const k = doc?.metadata?.idempotencyKey
    if (k) retryByKey.set(k, doc._id.toString())
  }
  const { existingEmailSet, existingPhoneSet } = dupMaps

  const results = new Array(rows.length)
  const errors = []
  let importedCount = 0
  let duplicateCount = 0
  let skippedCount = 0
  let failedCount = 0

  // 3. Synchronously resolve invalid, retry-skipped, existing-duplicate, and in-batch duplicate rows
  const seenEmailsInBatch = new Set()
  const seenPhonesInBatch = new Set()
  const readyToInsert = []

  for (const entry of validatedEntries) {
    const { idx, rowNum, idempotencyKey, validation } = entry

    if (!validation.valid) {
      failedCount++
      const reason = validation.errors.join("; ")
      const errItem = {
        rowNumber: rowNum,
        outcome: "failed",
        name: validation.payload.name || "",
        email: validation.payload.email || "",
        phone: validation.payload.phone || "",
        reason,
      }
      errors.push(errItem)
      results[idx] = errItem
      continue
    }

    const existingRetryLeadId = retryByKey.get(idempotencyKey)
    if (existingRetryLeadId) {
      skippedCount++
      results[idx] = {
        rowNumber: rowNum,
        outcome: "skipped",
        name: validation.payload.name,
        email: validation.payload.email,
        phone: validation.payload.phone,
        leadId: existingRetryLeadId,
        reason: "Already imported in previous attempt (retry prevented duplicate)",
      }
      continue
    }

    const { email, phoneNormalized } = validation.payload
    const isDbDup =
      (email && existingEmailSet.has(email)) || (phoneNormalized && existingPhoneSet.has(phoneNormalized))
    const isFileDup =
      (email && seenEmailsInBatch.has(email)) || (phoneNormalized && seenPhonesInBatch.has(phoneNormalized))

    if (isDbDup || isFileDup) {
      duplicateCount++
      skippedCount++
      const dupItem = {
        rowNumber: rowNum,
        outcome: "duplicate",
        name: validation.payload.name,
        email: validation.payload.email,
        phone: validation.payload.phone,
        reason: isDbDup
          ? "A lead with this email or phone number already exists"
          : "Duplicate email or phone within uploaded batch",
      }
      errors.push(dupItem)
      results[idx] = dupItem
      continue
    }

    if (email) seenEmailsInBatch.add(email)
    if (phoneNormalized) seenPhonesInBatch.add(phoneNormalized)
    readyToInsert.push(entry)
  }

  const runContext = {
    tenantId,
    workspaceId: workspaceId || null,
    mode,
    isSuperAdmin: false,
    userId: actor?._id || actor?.id || null,
    userRole: actor?.role || null,
    userEmail: actor?.email || null,
  }

  // 4. Insert distinct valid leads via shared LeadService in bounded concurrent slices
  await runWithTenantContext(runContext, async () => {
    for (let i = 0; i < readyToInsert.length; i += WRITE_CONCURRENCY) {
      const slice = readyToInsert.slice(i, i + WRITE_CONCURRENCY)
      await Promise.all(
        slice.map(async ({ idx, rowNum, idempotencyKey, validation }) => {
          try {
            const createRes = await leadService.createOrMergeLead({
              tenantId,
              source: validation.payload.source,
              payload: {
                ...validation.payload,
                workspaceId: workspaceId || null,
                metadata: {
                  importBatchId: cleanBatchId,
                  importFileName: fileName ? String(fileName).slice(0, 120) : "",
                  idempotencyKey,
                  importedBy: actor?.id || actor?._id?.toString() || null,
                  importedAt: new Date().toISOString(),
                },
              },
              options: {
                duplicateHandling: "reject",
              },
              actor,
            })

            if (createRes.action === "duplicate_rejected") {
              duplicateCount++
              skippedCount++
              const dupItem = {
                rowNumber: rowNum,
                outcome: "duplicate",
                name: validation.payload.name,
                email: validation.payload.email,
                phone: validation.payload.phone,
                leadId: createRes.lead?._id ? createRes.lead._id.toString() : null,
                reason: createRes.reason || "Lead with this email or phone already exists",
              }
              errors.push(dupItem)
              results[idx] = dupItem
              return
            }

            const savedLead = createRes.lead
            if (
              savedLead &&
              (validation.payload.expectedDealAmount > 0 ||
                (validation.payload.status === "Closed-Won" && validation.payload.closedWonAmount > 0))
            ) {
              const updateFields = {}
              if (validation.payload.expectedDealAmount > 0) {
                updateFields.expectedDealAmount = validation.payload.expectedDealAmount
              }
              if (validation.payload.status === "Closed-Won" && validation.payload.closedWonAmount > 0) {
                updateFields.closedWonAmount = validation.payload.closedWonAmount
                updateFields.dealStatus = "Won"
                updateFields.closedBy = actor?._id || actor?.id || null
                updateFields.closedByName = actor?.name || actor?.email || "Bulk Import"
                updateFields.closedAt = new Date()
              }
              await Lead.updateOne({ _id: savedLead._id, tenantId }, { $set: updateFields }).setOptions({
                skipTenantFilter: true,
              })
            }

            importedCount++
            results[idx] = {
              rowNumber: rowNum,
              outcome: "imported",
              name: validation.payload.name,
              email: validation.payload.email,
              phone: validation.payload.phone,
              leadId: savedLead?._id ? savedLead._id.toString() : null,
            }
          } catch (rowErr) {
            if (rowErr?.code === 11000 && rowErr?.message?.includes("idempotencyKey")) {
              skippedCount++
              results[idx] = {
                rowNumber: rowNum,
                outcome: "skipped",
                name: validation.payload.name,
                email: validation.payload.email,
                phone: validation.payload.phone,
                reason: "Already imported in previous attempt (retry prevented duplicate)",
              }
              return
            }

            failedCount++
            const errItem = {
              rowNumber: rowNum,
              outcome: "failed",
              name: validation.payload.name,
              email: validation.payload.email,
              phone: validation.payload.phone,
              reason: rowErr?.message || "Unexpected error saving lead record",
            }
            errors.push(errItem)
            results[idx] = errItem
          }
        }),
      )
    }
  })

  try {
    await audit.log({
      tenantId,
      actor,
      action: "lead.import",
      entity: "lead",
      summary: `Bulk imported ${importedCount} lead(s) (${duplicateCount} duplicate, ${failedCount} failed, ${skippedCount} skipped)`,
      details: {
        importBatchId: cleanBatchId,
        fileName: fileName ? String(fileName).slice(0, 120) : "",
        workspaceId: workspaceId ? workspaceId.toString() : null,
        mode,
        totalRows: rows.length,
        importedCount,
        duplicateCount,
        skippedCount,
        failedCount,
      },
      req,
    })
  } catch (auditErr) {
    console.warn("[LeadImportService] Audit log error:", auditErr.message)
  }

  return {
    importBatchId: cleanBatchId,
    summary: {
      total: rows.length,
      imported: importedCount,
      skipped: skippedCount,
      duplicate: duplicateCount,
      failed: failedCount,
    },
    results,
    errors,
  }
}

module.exports = {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  SUPPORTED_LEAD_FIELDS,
  parseLeadImportFile,
  suggestColumnMapping,
  validateAndSanitizeMapping,
  validateAndNormalizeImportRow,
  normalizeLeadStatus,
  resolveImportScope,
  previewImportLeads,
  executeImportLeads,
}
