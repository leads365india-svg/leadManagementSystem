const Account = require("../models/Account")
const Workspace = require("../models/Workspace")
const WorkspaceMembership = require("../models/WorkspaceMembership")
const { CustomField } = require("../models/CustomField")
const {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  SUPPORTED_LEAD_FIELDS,
  parseLeadImportFile,
  suggestColumnMapping,
  detectNestedFieldConflicts,
  previewImportLeads,
  executeImportLeads,
  resolveImportScope,
} = require("../services/leadImportService")

/**
 * GET /api/leads/import/config
 * Returns supported Lead schema fields, active tenant custom fields, and current import scope.
 */
const getImportConfig = async (req, res) => {
  try {
    const scope = await resolveImportScope(req)
    const [account, customFields] = await Promise.all([
      Account.findOne({ accountId: scope.tenantId }).select("workspaceModeEnabled companyName displayName").lean(),
      CustomField.find({ tenantId: scope.tenantId, status: "active" })
        .setOptions({ skipTenantFilter: true })
        .sort({ order: 1, createdAt: 1 })
        .select("name label type options required order")
        .lean(),
    ])

    let availableWorkspaces = []
    if (account?.workspaceModeEnabled) {
      if (req.user.role === "account_admin") {
        availableWorkspaces = await Workspace.find({
          tenantId: scope.tenantId,
          status: "active",
          isSystemManaged: { $ne: true },
        })
          .setOptions({ skipTenantFilter: true })
          .select("_id name slug isDefault")
          .sort({ isDefault: -1, createdAt: 1 })
          .lean()
      } else {
        const memberships = await WorkspaceMembership.find({
          tenantId: scope.tenantId,
          userId: req.user.id || req.user._id,
          status: "active",
        })
          .setOptions({ skipTenantFilter: true })
          .lean()
        const allowedIds = memberships
          .filter((m) => m.role !== "viewer")
          .map((m) => m.workspaceId)
        if (allowedIds.length > 0) {
          availableWorkspaces = await Workspace.find({
            _id: { $in: allowedIds },
            tenantId: scope.tenantId,
            status: "active",
            isSystemManaged: { $ne: true },
          })
            .setOptions({ skipTenantFilter: true })
            .select("_id name slug isDefault")
            .lean()
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        supportedFields: SUPPORTED_LEAD_FIELDS,
        customFields: customFields.map((cf) => ({
          key: `customField:${cf.name}`,
          name: cf.name,
          label: cf.label,
          type: cf.type,
          options: cf.options || [],
          required: Boolean(cf.required),
        })),
        limits: {
          maxFileBytes: MAX_IMPORT_FILE_BYTES,
          maxRows: MAX_IMPORT_ROWS,
          supportedExtensions: [".csv", ".xlsx", ".xls", ".json"],
        },
        scope: {
          mode: scope.mode,
          workspaceId: scope.workspaceId ? scope.workspaceId.toString() : null,
          workspaceName: scope.workspaceName || null,
          workspaceModeEnabled: Boolean(account?.workspaceModeEnabled),
          canChooseWorkspace: scope.mode === "authorized_all_workspaces" && req.user.role === "account_admin",
          availableWorkspaces: availableWorkspaces.map((w) => ({
            id: w._id.toString(),
            name: w.name,
            slug: w.slug,
          })),
        },
      },
    })
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Failed to load import configuration",
      ...(error.code ? { code: error.code } : {}),
    })
  }
}

/**
 * POST /api/leads/import/parse
 * Parses uploaded CSV, Excel (.xlsx/.xls), or JSON file and returns auto-suggested column mapping.
 */
const parseImportFileHandler = async (req, res) => {
  try {
    const scope = await resolveImportScope(req, req.body?.targetWorkspaceId || null)

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Please attach a CSV, Excel (.xlsx/.xls), or JSON file.",
        code: "NO_FILE_UPLOADED",
      })
    }

    const parsed = parseLeadImportFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
    })

    const customFields = await CustomField.find({ tenantId: scope.tenantId, status: "active" })
      .setOptions({ skipTenantFilter: true })
      .sort({ order: 1, createdAt: 1 })
      .lean()

    const autoMapping = suggestColumnMapping(parsed.headers, customFields, {
      nestedColumnMeta: parsed.nestedColumnMeta,
    })
    const conflicts = detectNestedFieldConflicts({
      headers: parsed.headers,
      rows: parsed.rows,
      mapping: autoMapping,
      customFields,
      nestedColumnMeta: parsed.nestedColumnMeta,
    })

    return res.status(200).json({
      success: true,
      data: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: parsed.fileType,
        sheetName: parsed.sheetName,
        headers: parsed.headers,
        totalRows: parsed.totalRows,
        autoMapping,
        sampleRows: parsed.sampleRows,
        rows: parsed.rows,
        nestedColumnMeta: parsed.nestedColumnMeta || {},
        nestedJson: {
          ...(parsed.nestedJson || { hasNestedJson: false, containers: [], extractedHeaders: [] }),
          conflicts,
        },
      },
    })
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      error: error.message || "Failed to parse uploaded file",
      ...(error.code ? { code: error.code } : {}),
    })
  }
}

/**
 * POST /api/leads/import/preview
 * Validates mapped rows and detects tenant-scoped duplicates BEFORE saving any lead.
 */
const previewImportHandler = async (req, res) => {
  try {
    const {
      rows,
      mapping,
      defaultSource = "Bulk Import",
      targetWorkspaceId = null,
      priorEmails = [],
      priorPhones = [],
    } = req.body || {}

    const scope = await resolveImportScope(req, targetWorkspaceId)

    const preview = await previewImportLeads({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      mode: scope.mode,
      rows,
      mapping,
      defaultSource,
      priorEmails,
      priorPhones,
    })

    return res.status(200).json({
      success: true,
      data: {
        ...preview,
        scope: {
          mode: scope.mode,
          workspaceId: scope.workspaceId ? scope.workspaceId.toString() : null,
          workspaceName: scope.workspaceName || null,
        },
      },
    })
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      error: error.message || "Failed to validate import preview",
      ...(error.code ? { code: error.code } : {}),
    })
  }
}

/**
 * POST /api/leads/import/execute
 * Executes confirmed bulk import batch using shared LeadService with strict tenant & workspace isolation.
 */
const executeImportHandler = async (req, res) => {
  try {
    const {
      rows,
      mapping,
      defaultSource = "Bulk Import",
      targetWorkspaceId = null,
      importBatchId = "",
      fileName = "",
    } = req.body || {}

    const scope = await resolveImportScope(req, targetWorkspaceId)

    const result = await executeImportLeads({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      mode: scope.mode,
      rows,
      mapping,
      defaultSource,
      importBatchId,
      fileName,
      actor: req.user,
      req,
    })

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        scope: {
          mode: scope.mode,
          workspaceId: scope.workspaceId ? scope.workspaceId.toString() : null,
          workspaceName: scope.workspaceName || null,
        },
      },
    })
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      error: error.message || "Failed to execute lead import",
      ...(error.code ? { code: error.code } : {}),
    })
  }
}

module.exports = {
  getImportConfig,
  parseImportFileHandler,
  previewImportHandler,
  executeImportHandler,
}
