const path = require("path")
const { PDFParse } = require("pdf-parse")
const mammoth = require("mammoth")
const xlsx = require("xlsx")

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25MB
const MAX_TEXT_LENGTH_CHARS = 500000 // 500,000 characters (~100,000 words)

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
])

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/octet-stream", // Frequently sent by browsers for binary files
])

/**
 * Sanitizes a filename to prevent directory traversal and remove dangerous characters.
 * @param {string} originalName
 * @returns {string}
 */
function sanitizeFileName(originalName) {
  if (!originalName || typeof originalName !== "string") {
    return `document_${Date.now()}`
  }
  const base = path.basename(originalName)
  const ext = path.extname(base).toLowerCase()
  const nameWithoutExt = path.basename(base, ext)
  const cleanName = nameWithoutExt
    .replace(/[^a-zA-Z0-9_\-\s.]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)

  return `${cleanName || "document"}${ext}`
}

/**
 * Validates document upload constraints (MIME type, extension, size).
 * @param {Object} options
 * @param {string} options.fileName
 * @param {string} options.mimeType
 * @param {number} options.sizeBytes
 * @returns {{ valid: boolean, error?: string, normalizedType?: string }}
 */
function validateDocumentUpload({ fileName, mimeType, sizeBytes }) {
  if (!fileName || typeof fileName !== "string") {
    return { valid: false, error: "A valid file name is required." }
  }

  const ext = path.extname(fileName).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Unsupported file extension '${ext}'. Supported extensions: .pdf, .docx, .doc, .xlsx, .xls, .csv, .txt`,
    }
  }

  if (sizeBytes !== null && sizeBytes !== undefined) {
    if (sizeBytes <= 0) {
      return { valid: false, error: "The uploaded file is empty (0 bytes)." }
    }
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File size exceeds the maximum limit of 25MB (${Math.round(sizeBytes / (1024 * 1024))}MB uploaded).`,
      }
    }
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase().trim())) {
    return {
      valid: false,
      error: `Unsupported MIME type '${mimeType}'. Permitted types: PDF, Word (DOCX/DOC), Excel (XLSX/XLS), CSV, TXT.`,
    }
  }

  // Derive normalized source type
  let normalizedType = "pdf"
  if (ext === ".docx" || ext === ".doc") normalizedType = ext === ".docx" ? "docx" : "doc"
  else if (ext === ".xlsx" || ext === ".xls") normalizedType = ext === ".xlsx" ? "xlsx" : "xls"
  else if (ext === ".csv") normalizedType = "csv"
  else if (ext === ".txt") normalizedType = "manual"

  return { valid: true, normalizedType }
}

/**
 * Extracts plain text and metadata from a document buffer.
 * 
 * @param {Object} params
 * @param {Buffer} params.buffer - Document file buffer
 * @param {string} params.fileName - Name of the file
 * @param {string} params.sourceType - 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'csv' | 'txt'
 * @returns {Promise<{ success: boolean, text: string, textLength: number, wordCount: number, metadata: Object, error?: string }>}
 */
async function extractDocumentContent({ buffer, fileName, sourceType }) {
  const startTime = Date.now()
  const metadata = {
    pageCount: null,
    sheetNames: [],
    rowCount: null,
    warnings: [],
    extractionDurationMs: 0,
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      success: false,
      text: "",
      textLength: 0,
      wordCount: 0,
      metadata,
      error: "Corrupt or empty file buffer received.",
    }
  }

  const ext = path.extname(fileName || "").toLowerCase()
  let rawText = ""

  try {
    if (sourceType === "pdf" || ext === ".pdf") {
      let parser = null
      try {
        parser = new PDFParse({ data: buffer })
        const result = await parser.getText()
        rawText = result.text || ""
        metadata.pageCount = result.total || (result.pages ? result.pages.length : null)
      } finally {
        if (parser && typeof parser.destroy === "function") {
          try {
            await parser.destroy()
          } catch (_) {
            // Ignore destroy cleanup errors
          }
        }
      }
    } else if (sourceType === "docx" || ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer })
      rawText = result.value || ""
      if (Array.isArray(result.messages) && result.messages.length > 0) {
        metadata.warnings = result.messages.map((m) => m.message)
      }
    } else if (sourceType === "doc" || ext === ".doc") {
      // Legacy Word format (.doc)
      try {
        const result = await mammoth.extractRawText({ buffer })
        rawText = result.value || ""
      } catch (docErr) {
        // Fallback: search for printable text sequences in legacy OLE binary
        const printableMatches = buffer.toString("binary").match(/[\x20-\x7E\r\n\t]{4,}/g)
        if (printableMatches && printableMatches.length > 0) {
          rawText = printableMatches.join(" ")
          metadata.warnings.push(
            "Legacy DOC binary detected: Text extracted via heuristic stream. For best results, please convert to DOCX or PDF."
          )
        } else {
          throw new Error("Unable to parse legacy binary DOC format. Please convert to modern DOCX or PDF.")
        }
      }
    } else if (sourceType === "xlsx" || sourceType === "xls" || ext === ".xlsx" || ext === ".xls") {
      const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true })
      metadata.sheetNames = workbook.SheetNames || []

      const sheetsText = []
      let totalRows = 0

      for (const sheetName of metadata.sheetNames) {
        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) continue

        const csvContent = xlsx.utils.sheet_to_csv(worksheet, { blankrows: false }).trim()
        if (csvContent) {
          const rowCount = csvContent.split("\n").length
          totalRows += rowCount
          sheetsText.push(`--- Sheet: ${sheetName} (${rowCount} rows) ---\n${csvContent}`)
        }
      }

      metadata.rowCount = totalRows
      rawText = sheetsText.join("\n\n")
    } else if (sourceType === "csv" || ext === ".csv") {
      const textContent = buffer.toString("utf-8")
      const lines = textContent.split(/\r?\n/).filter((l) => l.trim().length > 0)
      metadata.rowCount = lines.length
      rawText = textContent
    } else {
      // Plain text fallback
      rawText = buffer.toString("utf-8")
    }
  } catch (extractError) {
    console.error(`[DocumentExtractor] Failed extracting from ${fileName}:`, extractError.message)
    metadata.extractionDurationMs = Date.now() - startTime
    return {
      success: false,
      text: "",
      textLength: 0,
      wordCount: 0,
      metadata,
      error: `Extraction failed: ${extractError.message || "Unrecognized or corrupted document format."}`,
    }
  }

  // Clean extracted text (normalize excessive whitespaces, newlines)
  let cleanText = rawText
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()

  // Enforce text length ceiling
  if (cleanText.length > MAX_TEXT_LENGTH_CHARS) {
    cleanText = cleanText.slice(0, MAX_TEXT_LENGTH_CHARS)
    metadata.warnings.push(
      `Extracted content was truncated to ${MAX_TEXT_LENGTH_CHARS.toLocaleString()} characters to maintain optimal processing speed.`
    )
  }

  const wordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0
  metadata.extractionDurationMs = Date.now() - startTime

  if (!cleanText) {
    return {
      success: false,
      text: "",
      textLength: 0,
      wordCount: 0,
      metadata,
      error: "No readable text content could be extracted from this document. It may contain only images, scanned pages, or empty sheets.",
    }
  }

  return {
    success: true,
    text: cleanText,
    textLength: cleanText.length,
    wordCount,
    metadata,
  }
}

module.exports = {
  sanitizeFileName,
  validateDocumentUpload,
  extractDocumentContent,
  MAX_FILE_SIZE_BYTES,
  MAX_TEXT_LENGTH_CHARS,
  SUPPORTED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
}

