"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import {
  UploadCloud,
  FileSpreadsheet,
  FileJson,
  FileText,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  ChevronRight,
  LayoutDashboard,
  Users,
  Download,
  RefreshCw,
  Building2,
  ShieldAlert,
  Check,
  Sparkles,
  Trash2,
  Layers,
} from "lucide-react"

const WORKFLOW_STEPS = [
  { id: 1, title: "Upload File", subtitle: "CSV, Excel, or JSON" },
  { id: 2, title: "Map Columns", subtitle: "Match Lead schema" },
  { id: 3, title: "Preview & Validate", subtitle: "Check errors & duplicates" },
  { id: 4, title: "Confirm Import", subtitle: "Review scope & rules" },
  { id: 5, title: "Import Results", subtitle: "Progress & summary" },
]

const EXECUTE_BATCH_SIZE = 50
const PREVIEW_CHUNK_SIZE = 1000

function escapeCsvCell(val) {
  const str = String(val ?? "")
  const safe = /^[=+\-@\t\r]/.test(str) && !/^\+\d[\d\s().-]+$/.test(str) ? `'${str}` : str
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

function downloadCsvFile(filename, headers, rows) {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((r) => r.map(escapeCsvCell).join(",")),
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadSampleTemplate(format = "csv") {
  if (format === "json") {
    const sample = [
      {
        "Full Name": "Aarav Sharma",
        "Email Address": "aarav.sharma@example.com",
        Phone: "+91 98765 43210",
        Company: "Apex Clinics Pvt Ltd",
        City: "Mumbai",
        Source: "Trade Show",
        Status: "New",
        Notes: "Requested product demo for 3 clinics",
      },
      {
        "Full Name": "Priya Nair",
        "Email Address": "priya.nair@example.com",
        Phone: "9811122233",
        Company: "Horizon Logistics",
        City: "Bengaluru",
        Source: "Referral",
        Status: "Engaged",
        Notes: "Interested in annual plan",
      },
    ]
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "leads-import-template.json"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    return
  }

  downloadCsvFile(
    "leads-import-template.csv",
    ["Full Name", "Email Address", "Phone", "Company", "City", "Source", "Status", "Notes"],
    [
      ["Aarav Sharma", "aarav.sharma@example.com", "+91 98765 43210", "Apex Clinics Pvt Ltd", "Mumbai", "Trade Show", "New", "Requested product demo"],
      ["Priya Nair", "priya.nair@example.com", "9811122233", "Horizon Logistics", "Bengaluru", "Referral", "Engaged", "Interested in annual plan"],
    ],
  )
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 KB"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function ImportLeadsClient() {
  const { user, activeWorkspace, hasPermission } = useAuth()

  const canImportLeads =
    typeof hasPermission === "function"
      ? hasPermission("leads.create") || hasPermission("leads.import")
      : true

  const fileInputRef = useRef(null)

  const [step, setStep] = useState(1)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState(null)
  const [importConfig, setImportConfig] = useState({
    supportedFields: [],
    customFields: [],
    limits: { maxFileBytes: 10 * 1024 * 1024, maxRows: 5000, supportedExtensions: [".csv", ".xlsx", ".xls", ".json"] },
    scope: { mode: "standalone", workspaceId: null, workspaceName: null, workspaceModeEnabled: false, canChooseWorkspace: false, availableWorkspaces: [] },
  })

  // Step 1: Upload state
  const [isDragging, setIsDragging] = useState(false)
  const [parsingFile, setParsingFile] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [uploadedFileMeta, setUploadedFileMeta] = useState(null)
  const [parsedHeaders, setParsedHeaders] = useState([])
  const [parsedRows, setParsedRows] = useState([])
  const [sampleRows, setSampleRows] = useState([])

  // Step 2: Mapping & options
  const [columnMapping, setColumnMapping] = useState({})
  const [defaultSource, setDefaultSource] = useState("Bulk Import")
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("")

  // Step 3: Preview & Validation
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [previewData, setPreviewData] = useState(null)
  const [previewFilter, setPreviewFilter] = useState("all") // all | valid | duplicate | invalid

  // Step 5: Execute & Results
  const [importBatchId, setImportBatchId] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0, batchIndex: 0, totalBatches: 0 })
  const [importResult, setImportResult] = useState(null)
  const [failedChunkRows, setFailedChunkRows] = useState([])
  const [executeError, setExecuteError] = useState(null)
  const [resultsFilter, setResultsFilter] = useState("all") // all | imported | duplicate | skipped | failed

  const loadConfig = useCallback(async () => {
    try {
      setConfigLoading(true)
      setConfigError(null)
      const res = await apiClient.request("/leads/import/config")
      if (res?.success && res.data) {
        setImportConfig(res.data)
        setTargetWorkspaceId(res.data?.scope?.workspaceId || "")
        // Clear any stale preview validated under a prior workspace scope
        setPreviewData(null)
        setStep((prev) => (prev === 3 || prev === 4 ? 2 : prev))
      } else {
        setConfigError(res?.error || "Failed to load import settings")
      }
    } catch (err) {
      setConfigError(err.message || "Unable to load import settings")
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user && canImportLeads) {
      loadConfig()
    } else {
      setConfigLoading(false)
    }
  }, [user, canImportLeads, activeWorkspace, loadConfig])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleWorkspaceChanged = () => {
      if (user && canImportLeads) {
        loadConfig()
      }
    }
    window.addEventListener("leadflow_workspace_changed", handleWorkspaceChanged)
    return () => window.removeEventListener("leadflow_workspace_changed", handleWorkspaceChanged)
  }, [user, canImportLeads, loadConfig])

  const allTargetFields = useMemo(() => {
    const std = (importConfig.supportedFields || []).map((f) => ({
      ...f,
      group: f.required || f.contactIdentity ? "Required / Contact" : "Optional Lead Fields",
    }))
    const cfs = (importConfig.customFields || []).map((cf) => ({
      key: cf.key,
      label: `${cf.label} (Custom)`,
      required: Boolean(cf.required),
      description: `Custom ${cf.type} field`,
      group: "Custom Fields",
    }))
    return [...std, ...cfs]
  }, [importConfig])

  const mappingStatus = useMemo(() => {
    const mappedTargets = new Set(Object.values(columnMapping).filter(Boolean))
    const hasName = mappedTargets.has("name")
    const hasEmailOrPhone = mappedTargets.has("email") || mappedTargets.has("phone")
    const unmappedHeaders = parsedHeaders.filter((h) => !columnMapping[h])
    const mappedHeaders = parsedHeaders.filter((h) => Boolean(columnMapping[h]))

    const missingRequired = []
    if (!hasName) missingRequired.push("Lead Name")
    if (!hasEmailOrPhone) missingRequired.push("Email or Phone")

    return {
      mappedTargets,
      hasName,
      hasEmailOrPhone,
      unmappedHeaders,
      mappedHeaders,
      missingRequired,
      isReady: missingRequired.length === 0,
    }
  }, [columnMapping, parsedHeaders])

  const resetAllState = () => {
    setStep(1)
    setParseError(null)
    setPreviewError(null)
    setExecuteError(null)
    setUploadedFileMeta(null)
    setParsedHeaders([])
    setParsedRows([])
    setSampleRows([])
    setColumnMapping({})
    setPreviewData(null)
    setImportResult(null)
    setFailedChunkRows([])
    setImportBatchId("")
    setImportProgress({ processed: 0, total: 0, batchIndex: 0, totalBatches: 0 })
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleFileSelected = async (file) => {
    if (!file) return
    setParseError(null)
    setPreviewData(null)
    setImportResult(null)
    setFailedChunkRows([])

    const ext = file.name?.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ""
    const allowed = new Set([".csv", ".xlsx", ".xls", ".json"])
    if (!allowed.has(ext)) {
      const msg = `Unsupported file '${file.name}'. Please upload a .csv, .xlsx, .xls, or .json file.`
      setParseError(msg)
      toast.error(msg)
      return
    }

    if (file.size === 0) {
      const msg = "Selected file is empty (0 bytes)."
      setParseError(msg)
      toast.error(msg)
      return
    }

    const maxBytes = importConfig?.limits?.maxFileBytes || 10 * 1024 * 1024
    if (file.size > maxBytes) {
      const msg = `File size (${formatBytes(file.size)}) exceeds maximum allowed 10 MB limit.`
      setParseError(msg)
      toast.error(msg)
      return
    }

    try {
      setParsingFile(true)
      const formData = new FormData()
      formData.append("file", file)
      if (importConfig?.scope?.canChooseWorkspace && targetWorkspaceId) {
        formData.append("targetWorkspaceId", targetWorkspaceId)
      }

      const res = await apiClient.request("/leads/import/parse", {
        method: "POST",
        body: formData,
      })

      if (!res?.success || !res.data) {
        const errMsg = res?.error || "Failed to read uploaded file"
        setParseError(errMsg)
        toast.error(errMsg)
        return
      }

      setUploadedFileMeta({
        fileName: res.data.fileName,
        fileSize: res.data.fileSize,
        fileType: res.data.fileType,
        sheetName: res.data.sheetName,
        totalRows: res.data.totalRows,
      })
      setParsedHeaders(res.data.headers || [])
      setParsedRows(res.data.rows || [])
      setSampleRows(res.data.sampleRows || [])
      setColumnMapping(res.data.autoMapping || {})
      setStep(2)
      toast.success(`Parsed ${res.data.totalRows} row(s) from ${res.data.fileName}`)
    } catch (err) {
      const errMsg = err.message || "Failed to parse file"
      setParseError(errMsg)
      toast.error(errMsg)
    } finally {
      setParsingFile(false)
    }
  }

  const handleMappingChange = (header, newTarget) => {
    setColumnMapping((prev) => {
      const next = { ...prev }
      if (newTarget) {
        for (const [col, assigned] of Object.entries(next)) {
          if (col !== header && assigned === newTarget) {
            next[col] = ""
          }
        }
      }
      next[header] = newTarget
      return next
    })
  }

  const projectMappedRows = useCallback(
    (rowsList) => {
      const mappedCols = Object.entries(columnMapping)
        .filter(([, target]) => Boolean(target))
        .map(([col]) => col)

      return rowsList.map((row) => {
        const projected = { __rowNumber: row.__rowNumber }
        for (const col of mappedCols) {
          projected[col] = row[col] ?? ""
        }
        return projected
      })
    },
    [columnMapping],
  )

  const handleRunPreview = async () => {
    if (!mappingStatus.isReady) {
      toast.error(`Please map required fields: ${mappingStatus.missingRequired.join(", ")}`)
      return
    }

    setPreviewError(null)
    setPreviewLoading(true)
    setPreviewFilter("all")

    try {
      const projectedRows = projectMappedRows(parsedRows)
      const serializedApproxBytes = JSON.stringify(projectedRows).length

      let combinedSummary = { total: 0, valid: 0, invalid: 0, duplicate: 0, skipped: 0 }
      let combinedRows = []
      let combinedSampleValid = []
      let mappedFields = []

      if (serializedApproxBytes < 1200000 && projectedRows.length <= PREVIEW_CHUNK_SIZE) {
        const res = await apiClient.request("/leads/import/preview", {
          method: "POST",
          body: JSON.stringify({
            rows: projectedRows,
            mapping: columnMapping,
            defaultSource,
            targetWorkspaceId: importConfig?.scope?.canChooseWorkspace ? targetWorkspaceId || null : null,
          }),
        })

        if (!res?.success || !res.data) {
          throw new Error(res?.error || "Preview validation failed")
        }

        combinedSummary = res.data.summary
        combinedRows = res.data.rows || []
        combinedSampleValid = res.data.sampleValidLeads || []
        mappedFields = res.data.mappedFields || []
      } else {
        const seenEmails = new Set()
        const seenPhones = new Set()

        for (let i = 0; i < projectedRows.length; i += PREVIEW_CHUNK_SIZE) {
          const chunk = projectedRows.slice(i, i + PREVIEW_CHUNK_SIZE)
          const res = await apiClient.request("/leads/import/preview", {
            method: "POST",
            body: JSON.stringify({
              rows: chunk,
              mapping: columnMapping,
              defaultSource,
              targetWorkspaceId: importConfig?.scope?.canChooseWorkspace ? targetWorkspaceId || null : null,
              priorEmails: Array.from(seenEmails),
              priorPhones: Array.from(seenPhones),
            }),
          })

          if (!res?.success || !res.data) {
            throw new Error(res?.error || `Preview failed on rows ${i + 1}-${i + chunk.length}`)
          }

          const s = res.data.summary || {}
          combinedSummary.total += s.total || 0
          combinedSummary.valid += s.valid || 0
          combinedSummary.invalid += s.invalid || 0
          combinedSummary.duplicate += s.duplicate || 0
          combinedSummary.skipped += s.skipped || 0
          mappedFields = res.data.mappedFields || mappedFields

          const chunkRows = res.data.rows || []
          for (const pr of chunkRows) {
            combinedRows.push(pr)
            if (pr.status === "valid") {
              if (pr.data?.email) seenEmails.add(pr.data.email)
              if (pr.data?.phoneNormalized) seenPhones.add(pr.data.phoneNormalized)
              if (combinedSampleValid.length < 10) {
                combinedSampleValid.push({ rowNumber: pr.rowNumber, ...pr.data })
              }
            }
          }
        }
      }

      setPreviewData({
        summary: combinedSummary,
        rows: combinedRows,
        sampleValidLeads: combinedSampleValid,
        mappedFields,
      })
      setStep(3)
    } catch (err) {
      const errMsg = err.message || "Failed to validate import rows"
      setPreviewError(errMsg)
      toast.error(errMsg)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDownloadPreviewReport = () => {
    if (!previewData?.rows) return
    const issueRows = previewData.rows.filter((r) => r.status === "invalid" || r.status === "duplicate")
    if (issueRows.length === 0) {
      toast("No validation errors or duplicates to download.")
      return
    }
    downloadCsvFile(
      `lead-import-validation-report-${Date.now()}.csv`,
      ["Row Number", "Validation Status", "Lead Name", "Email", "Phone", "Company", "Reason"],
      issueRows.map((r) => [
        r.rowNumber,
        r.status === "duplicate" ? "Duplicate (Skipped)" : "Invalid",
        r.data?.name || "",
        r.data?.email || "",
        r.data?.phone || "",
        r.data?.company || "",
        r.reason || "",
      ]),
    )
    toast.success("Downloaded validation report CSV")
  }

  const runBatchedExecution = async ({ rowsToProcess, batchId, resetExisting = true }) => {
    setIsImporting(true)
    setExecuteError(null)
    setFailedChunkRows([])

    const totalBatches = Math.ceil(rowsToProcess.length / EXECUTE_BATCH_SIZE)
    const accumulated = resetExisting
      ? {
          importBatchId: batchId,
          summary: { total: 0, imported: 0, skipped: 0, duplicate: 0, failed: 0 },
          results: [],
          errors: [],
        }
      : {
          importBatchId: batchId,
          summary: { ...(importResult?.summary || { total: 0, imported: 0, skipped: 0, duplicate: 0, failed: 0 }) },
          results: [...(importResult?.results || [])],
          errors: [...(importResult?.errors || [])],
        }

    const remainingFailed = []

    setImportProgress({ processed: 0, total: rowsToProcess.length, batchIndex: 0, totalBatches })

    for (let b = 0; b < totalBatches; b++) {
      const start = b * EXECUTE_BATCH_SIZE
      const chunk = rowsToProcess.slice(start, start + EXECUTE_BATCH_SIZE)

      try {
        const res = await apiClient.request("/leads/import/execute", {
          method: "POST",
          body: JSON.stringify({
            rows: chunk,
            mapping: columnMapping,
            defaultSource,
            targetWorkspaceId: importConfig?.scope?.canChooseWorkspace ? targetWorkspaceId || null : null,
            importBatchId: batchId,
            fileName: uploadedFileMeta?.fileName || "",
          }),
        })

        if (!res?.success || !res.data) {
          throw new Error(res?.error || `Batch ${b + 1} failed`)
        }

        const s = res.data.summary || {}
        accumulated.summary.total += s.total || 0
        accumulated.summary.imported += s.imported || 0
        accumulated.summary.skipped += s.skipped || 0
        accumulated.summary.duplicate += s.duplicate || 0
        accumulated.summary.failed += s.failed || 0
        if (Array.isArray(res.data.results)) accumulated.results.push(...res.data.results)
        if (Array.isArray(res.data.errors)) accumulated.errors.push(...res.data.errors)
      } catch (batchErr) {
        remainingFailed.push(...chunk)
        setExecuteError(
          `Batch ${b + 1} encountered an error (${batchErr.message}). Any already imported batches were saved safely.`,
        )
      }

      setImportProgress({
        processed: Math.min(start + chunk.length, rowsToProcess.length),
        total: rowsToProcess.length,
        batchIndex: b + 1,
        totalBatches,
      })
      setImportResult({
        ...accumulated,
        summary: { ...accumulated.summary },
        results: [...accumulated.results],
        errors: [...accumulated.errors],
      })
    }

    setFailedChunkRows(remainingFailed)
    setIsImporting(false)

    if (remainingFailed.length === 0) {
      toast.success(
        `Import finished: ${accumulated.summary.imported} imported, ${accumulated.summary.skipped} skipped`,
      )
    } else {
      toast.error(`${remainingFailed.length} row(s) in failed network batches can be safely retried.`)
    }
  }

  const handleConfirmImport = async () => {
    if (!previewData) return
    const batchId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setImportBatchId(batchId)
    setStep(5)
    setResultsFilter("all")
    const projectedRows = projectMappedRows(parsedRows)
    await runBatchedExecution({ rowsToProcess: projectedRows, batchId, resetExisting: true })
  }

  const handleRetryFailedBatches = async () => {
    if (!failedChunkRows.length || !importBatchId) return
    await runBatchedExecution({
      rowsToProcess: failedChunkRows,
      batchId: importBatchId,
      resetExisting: false,
    })
  }

  const handleDownloadResultReport = () => {
    if (!importResult?.results) return
    const reportRows = importResult.results.filter((r) => r.outcome !== "imported")
    if (reportRows.length === 0) {
      toast("All rows imported cleanly with zero skipped or failed entries.")
      return
    }
    downloadCsvFile(
      `lead-import-results-${Date.now()}.csv`,
      ["Row Number", "Outcome", "Lead Name", "Email", "Phone", "Details"],
      reportRows.map((r) => [
        r.rowNumber,
        r.outcome,
        r.name || "",
        r.email || "",
        r.phone || "",
        r.reason || "",
      ]),
    )
    toast.success("Downloaded import result report CSV")
  }

  const filteredPreviewRows = useMemo(() => {
    if (!previewData?.rows) return []
    if (previewFilter === "all") return previewData.rows
    return previewData.rows.filter((r) => r.status === previewFilter)
  }, [previewData, previewFilter])

  const filteredResultRows = useMemo(() => {
    if (!importResult?.results) return []
    if (resultsFilter === "all") return importResult.results
    return importResult.results.filter((r) => r.outcome === resultsFilter)
  }, [importResult, resultsFilter])

  const activeScopeLabel = useMemo(() => {
    const scope = importConfig?.scope
    if (!scope || !scope.workspaceModeEnabled || scope.mode === "standalone") {
      return "Standard Organization Account (Standalone)"
    }
    if (scope.canChooseWorkspace) {
      if (targetWorkspaceId) {
        const ws = (scope.availableWorkspaces || []).find((w) => w.id === targetWorkspaceId)
        return ws ? `Target Workspace: ${ws.name}` : "Selected Workspace"
      }
      return "All Projects (Unassigned Attribution Pool)"
    }
    return scope.workspaceName ? `Active Workspace: ${scope.workspaceName}` : "Active Workspace"
  }, [importConfig, targetWorkspaceId])

  if (configLoading) {
    return (
      <div className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center bg-slate-50 space-y-3">
        <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-slate-500">Preparing Lead Import workspace...</p>
      </div>
    )
  }

  if (!canImportLeads) {
    return (
      <div className="min-h-[calc(100vh-120px)] bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Import Access Restricted</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your assigned role does not include permission to create or import leads (`leads.create`). Contact your Organization Administrator to request access.
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link
              href="/leads"
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              View Leads
            </Link>
            <Link
              href="/portal"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              CRM Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-100px)] bg-gradient-to-b from-slate-50 via-slate-50 to-indigo-50/20 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-xs text-slate-500">
          <Link href="/portal" className="hover:text-indigo-600 transition-colors flex items-center space-x-1">
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <span className="text-slate-600 font-medium">Tools</span>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <span className="text-indigo-600 font-semibold">Import Leads</span>
        </nav>

        {/* Page Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Tools
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  <Building2 className="w-3 h-3 text-indigo-600" />
                  <span>{activeScopeLabel}</span>
                </span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Import Leads</h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-2xl">
                Bulk upload leads from CSV, Excel (.xlsx/.xls), or JSON files with automatic column mapping,
                validation, and tenant-scoped deduplication.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <Link
                href="/leads"
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <Users className="w-4 h-4" />
                <span>View Leads</span>
              </Link>
              <Link
                href="/portal"
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>CRM Dashboard</span>
              </Link>
            </div>
          </div>

          {/* 5-Step Progress Indicator */}
          <ol className="pt-5 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {WORKFLOW_STEPS.map((s) => {
              const isCompleted = step > s.id
              const isCurrent = step === s.id
              return (
                <li
                  key={s.id}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-colors ${
                    isCurrent
                      ? "bg-indigo-50/90 border-indigo-300 text-indigo-900"
                      : isCompleted
                      ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                      : "bg-slate-50/70 border-slate-200/80 text-slate-500"
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                      isCompleted
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : s.id}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{s.title}</p>
                    <p className="text-[10px] opacity-75 truncate">{s.subtitle}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>

        {configError && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-xs text-rose-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{configError}</span>
            </div>
            <button
              type="button"
              onClick={loadConfig}
              className="px-3 py-1 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* =====================================================================
            STEP 1: UPLOAD FILE
        ===================================================================== */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 space-y-6">
            {/* Workspace / Target Options when Org Admin is in All Projects */}
            {importConfig?.scope?.canChooseWorkspace && importConfig.scope.availableWorkspaces?.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <label htmlFor="targetWorkspaceSelect" className="text-xs font-bold text-slate-800 block">
                    Destination Project / Workspace (All Projects Mode)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Choose a specific workspace or leave in the Organization Unassigned Pool.
                  </p>
                </div>
                <select
                  id="targetWorkspaceSelect"
                  value={targetWorkspaceId}
                  onChange={(e) => setTargetWorkspaceId(e.target.value)}
                  className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-64"
                >
                  <option value="">All Projects (Unassigned Pool)</option>
                  {importConfig.scope.availableWorkspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Drag and Drop Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setIsDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const droppedFile = e.dataTransfer?.files?.[0]
                if (droppedFile) handleFileSelected(droppedFile)
              }}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-colors ${
                isDragging
                  ? "border-indigo-500 bg-indigo-50/70"
                  : "border-slate-300 hover:border-indigo-400 bg-slate-50/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.json"
                onChange={(e) => {
                  const chosen = e.target.files?.[0]
                  if (chosen) handleFileSelected(chosen)
                }}
                className="hidden"
                id="lead-import-file-input"
              />

              <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto mb-4">
                {parsingFile ? (
                  <RefreshCw className="w-7 h-7 animate-spin" />
                ) : (
                  <UploadCloud className="w-7 h-7" />
                )}
              </div>

              <h2 className="text-base font-bold text-slate-900">
                {parsingFile ? "Parsing uploaded file..." : "Drag and drop your lead file here"}
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Supports CSV (`.csv`), Excel (`.xlsx`, `.xls`), and JSON (`.json`) up to 10 MB / 5,000 rows per import.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={parsingFile}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{parsingFile ? "Reading File..." : "Browse File"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadSampleTemplate("csv")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sample CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadSampleTemplate("json")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Sample JSON</span>
                </button>
              </div>
            </div>

            {parseError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Could not parse file</p>
                  <p className="mt-0.5">{parseError}</p>
                </div>
              </div>
            )}

            {/* Format Guidelines */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>CSV Files (.csv)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  UTF-8 comma-separated file with column headers in the first row.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Excel Workbooks (.xlsx, .xls)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  First non-empty worksheet is read automatically with phone digits preserved.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <FileJson className="w-4 h-4 text-purple-600" />
                  <span>JSON Arrays (.json)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Array of lead objects or <code className="bg-slate-200/60 px-1 rounded">{"{ \"leads\": [...] }"}</code>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 2: MAP COLUMNS
        ===================================================================== */}
        {step === 2 && uploadedFileMeta && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Map Uploaded Columns to CRM Fields</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  File: <strong>{uploadedFileMeta.fileName}</strong> ({uploadedFileMeta.totalRows} rows,{" "}
                  {formatBytes(uploadedFileMeta.fileSize)})
                  {uploadedFileMeta.sheetName ? ` • Sheet: ${uploadedFileMeta.sheetName}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={resetAllState}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer self-start"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Choose Different File</span>
              </button>
            </div>

            {/* Required & Optional Field Checklist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Field Requirements</p>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      mappingStatus.hasName
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-rose-50 text-rose-700 border-rose-200"
                    }`}
                  >
                    {mappingStatus.hasName ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    <span>Lead Name (Required)</span>
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      mappingStatus.hasEmailOrPhone
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-rose-50 text-rose-700 border-rose-200"
                    }`}
                  >
                    {mappingStatus.hasEmailOrPhone ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    <span>Email or Phone (At least one required)</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {mappingStatus.mappedHeaders.length} mapped column(s) • {mappingStatus.unmappedHeaders.length} unmapped column(s)
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <label htmlFor="defaultLeadSource" className="text-xs font-bold text-slate-800 block">
                  Default Lead Source (for rows without a Source column)
                </label>
                <select
                  id="defaultLeadSource"
                  value={defaultSource}
                  onChange={(e) => setDefaultSource(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Bulk Import">Bulk Import</option>
                  <option value="Manual Entry">Manual Entry</option>
                  <option value="Website">Website</option>
                  <option value="Referral">Referral</option>
                  <option value="Cold Outreach">Cold Outreach</option>
                  <option value="Google Ads">Google Ads</option>
                  <option value="Meta Ads">Meta Ads</option>
                </select>
              </div>
            </div>

            {previewError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {/* Column Mapping Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Uploaded Column</th>
                    <th className="py-3 px-4">Sample Value(s)</th>
                    <th className="py-3 px-4">CRM Lead Field</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedHeaders.map((header) => {
                    const selectedTarget = columnMapping[header] || ""
                    const sampleValues = sampleRows
                      .map((r) => r[header])
                      .filter((v) => String(v || "").trim() !== "")
                      .slice(0, 2)
                      .join(" | ")

                    return (
                      <tr key={header} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-semibold text-slate-900">{header}</td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px] max-w-xs truncate">
                          {sampleValues || <span className="italic text-slate-400">Empty</span>}
                        </td>
                        <td className="py-3 px-4">
                          <select
                            aria-label={`Map column ${header}`}
                            value={selectedTarget}
                            onChange={(e) => handleMappingChange(header, e.target.value)}
                            className="w-full sm:w-64 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">-- Do not import (Unmapped) --</option>
                            {["Required / Contact", "Optional Lead Fields", "Custom Fields"].map((groupName) => {
                              const items = allTargetFields.filter((f) => f.group === groupName)
                              if (items.length === 0) return null
                              return (
                                <optgroup key={groupName} label={groupName}>
                                  {items.map((f) => {
                                    const takenByOther =
                                      mappingStatus.mappedTargets.has(f.key) && selectedTarget !== f.key
                                    return (
                                      <option key={f.key} value={f.key}>
                                        {f.label}
                                        {f.required ? " *" : ""}
                                        {takenByOther ? " (Already mapped — reassign)" : ""}
                                      </option>
                                    )
                                  })}
                                </optgroup>
                              )
                            })}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          {selectedTarget ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Check className="w-3 h-3" />
                              Mapped
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                              Unmapped (Skipped)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {mappingStatus.unmappedHeaders.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Unmapped columns ignored: </span>
                  <span>{mappingStatus.unmappedHeaders.join(", ")}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                disabled={!mappingStatus.isReady || previewLoading}
                onClick={handleRunPreview}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-xs cursor-pointer"
              >
                {previewLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Validating Rows...</span>
                  </>
                ) : (
                  <>
                    <span>Preview & Validate</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 3: PREVIEW & VALIDATE
        ===================================================================== */}
        {step === 3 && previewData && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">Preview & Validation Report</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  No leads have been saved yet. Review validation checks and duplicate matches before confirming.
                </p>
              </div>
              {(previewData.summary.invalid > 0 || previewData.summary.duplicate > 0) && (
                <button
                  type="button"
                  onClick={handleDownloadPreviewReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs cursor-pointer self-start"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Download Error Report (CSV)</span>
                </button>
              )}
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Rows</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{previewData.summary.total}</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Valid Records</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{previewData.summary.valid}</p>
              </div>
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  Duplicate (Skipped)
                </p>
                <p className="text-2xl font-bold text-amber-700 mt-1">{previewData.summary.duplicate}</p>
              </div>
              <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Invalid Records</p>
                <p className="text-2xl font-bold text-rose-700 mt-1">{previewData.summary.invalid}</p>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: "all", label: `All (${previewData.summary.total})` },
                { key: "valid", label: `Valid (${previewData.summary.valid})` },
                { key: "duplicate", label: `Duplicates (${previewData.summary.duplicate})` },
                { key: "invalid", label: `Invalid (${previewData.summary.invalid})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPreviewFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    previewFilter === tab.key
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Validation Rows Table (paginated cap 200 displayed in DOM cleanly) */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[420px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Row</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">Company</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Validation / Duplicate Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPreviewRows.slice(0, 200).map((row) => (
                    <tr key={`${row.rowNumber}-${row.status}`} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                      <td className="py-2.5 px-3">
                        {row.status === "valid" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Valid
                          </span>
                        ) : row.status === "duplicate" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3 h-3" /> Duplicate
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            <XCircle className="w-3 h-3" /> Invalid
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.data?.name || "—"}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{row.data?.email || "—"}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                        {row.data?.phoneNormalized || row.data?.phone || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{row.data?.company || "—"}</td>
                      <td className="py-2.5 px-3 text-slate-600">{row.data?.source || defaultSource}</td>
                      <td className="py-2.5 px-3 text-[11px]">
                        {row.reason ? (
                          <span className={row.status === "duplicate" ? "text-amber-700" : "text-rose-700 font-medium"}>
                            {row.reason}
                          </span>
                        ) : (
                          <span className="text-slate-400">Ready to import</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredPreviewRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No rows match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredPreviewRows.length > 200 && (
              <p className="text-[11px] text-slate-500">
                Showing first 200 of {filteredPreviewRows.length} rows in preview table. Download the CSV report to inspect all issues.
              </p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Mapping</span>
              </button>

              <button
                type="button"
                disabled={previewData.summary.valid === 0}
                onClick={() => setStep(4)}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-xs cursor-pointer"
              >
                <span>Continue to Confirmation</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 4: CONFIRM IMPORT
        ===================================================================== */}
        {step === 4 && previewData && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 space-y-6">
            <div className="flex items-start gap-3 pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Confirm Lead Import</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review your final import summary before committing records to the CRM database.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <p className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Import Target & Rules</p>
                <div className="space-y-1.5 text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-800">File:</span> {uploadedFileMeta?.fileName}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Scope:</span> {activeScopeLabel}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Duplicate Policy:</span> Skip existing leads (never overwrite)
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Default Source:</span> {defaultSource}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <p className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">Records Summary</p>
                <div className="space-y-1.5 text-slate-600">
                  <p>
                    <span className="font-semibold text-emerald-700">New leads to import:</span>{" "}
                    <strong className="text-emerald-700">{previewData.summary.valid}</strong>
                  </p>
                  <p>
                    <span className="font-semibold text-amber-700">Duplicates to skip:</span>{" "}
                    <strong className="text-amber-700">{previewData.summary.duplicate}</strong>
                  </p>
                  <p>
                    <span className="font-semibold text-rose-700">Invalid rows skipped/rejected:</span>{" "}
                    <strong className="text-rose-700">{previewData.summary.invalid}</strong>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Batching:</span> Safe chunks of{" "}
                    {EXECUTE_BATCH_SIZE} rows per request
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Preview</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmImport}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Confirm & Start Import</span>
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            STEP 5: IMPORT PROGRESS & RESULTS
        ===================================================================== */}
        {step === 5 && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isImporting ? "Importing Leads..." : "Import Complete"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Batch {importProgress.batchIndex} of {Math.max(1, importProgress.totalBatches)} •{" "}
                  {importProgress.processed} / {importProgress.total} rows processed
                </p>
              </div>
              {!isImporting && importResult?.results?.some((r) => r.outcome !== "imported") && (
                <button
                  type="button"
                  onClick={handleDownloadResultReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs cursor-pointer self-start"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Download Results Report</span>
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    isImporting ? "bg-indigo-600" : executeError ? "bg-amber-500" : "bg-emerald-600"
                  }`}
                  style={{
                    width: `${
                      importProgress.total > 0
                        ? Math.round((importProgress.processed / importProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {executeError && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{executeError}</span>
                </div>
                {failedChunkRows.length > 0 && !isImporting && (
                  <button
                    type="button"
                    onClick={handleRetryFailedBatches}
                    className="px-3.5 py-1.5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 cursor-pointer shrink-0"
                  >
                    Retry Failed Batch
                  </button>
                )}
              </div>
            )}

            {/* Final Breakdown Summary */}
            {importResult && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Processed</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{importResult.summary.total}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Imported</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">{importResult.summary.imported}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Skipped</p>
                    <p className="text-2xl font-bold text-blue-700 mt-1">{importResult.summary.skipped}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Duplicates</p>
                    <p className="text-2xl font-bold text-amber-700 mt-1">{importResult.summary.duplicate}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Failed</p>
                    <p className="text-2xl font-bold text-rose-700 mt-1">{importResult.summary.failed}</p>
                  </div>
                </div>

                {/* Result Outcome Filter */}
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { key: "all", label: `All (${importResult.summary.total})` },
                    { key: "imported", label: `Imported (${importResult.summary.imported})` },
                    { key: "duplicate", label: `Duplicates (${importResult.summary.duplicate})` },
                    { key: "skipped", label: `Skipped (${importResult.summary.skipped})` },
                    { key: "failed", label: `Failed (${importResult.summary.failed})` },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setResultsFilter(tab.key)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        resultsFilter === tab.key
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-[380px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3">Outcome</th>
                        <th className="py-2.5 px-3">Lead Name</th>
                        <th className="py-2.5 px-3">Email</th>
                        <th className="py-2.5 px-3">Phone</th>
                        <th className="py-2.5 px-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredResultRows.slice(0, 200).map((row, idx) => (
                        <tr key={`${row.rowNumber}-${row.outcome}-${idx}`} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                          <td className="py-2.5 px-3">
                            {row.outcome === "imported" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" /> Imported
                              </span>
                            ) : row.outcome === "duplicate" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-3 h-3" /> Duplicate
                              </span>
                            ) : row.outcome === "skipped" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                Skipped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                <XCircle className="w-3 h-3" /> Failed
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{row.name || "—"}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{row.email || "—"}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">{row.phone || "—"}</td>
                          <td className="py-2.5 px-3 text-[11px] text-slate-600">
                            {row.reason || (row.outcome === "imported" ? "Created in CRM" : "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!isImporting && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={resetAllState}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Import Another File</span>
                </button>

                <div className="flex items-center gap-2.5">
                  <Link
                    href="/leads"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>View Imported Leads</span>
                  </Link>
                  <Link
                    href="/portal"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    <span>CRM Dashboard</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
