const { CustomField, ALLOWED_FIELD_TYPES } = require("../models/CustomField")
const audit = require("../services/auditService")

// Helper: Normalize name/key to snake_case
const normalizeKey = (keyOrLabel) => {
  if (!keyOrLabel || typeof keyOrLabel !== "string") return ""
  return keyOrLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * GET /api/custom-fields
 * List tenant custom fields. Defaults to active fields.
 */
const getCustomFields = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const { status = "active", type, search } = req.query

    const filter = { tenantId }
    if (status && status !== "all") {
      filter.status = status
    }
    if (type && ALLOWED_FIELD_TYPES.includes(type)) {
      filter.type = type
    }
    if (search && typeof search === "string" && search.trim()) {
      const term = search.trim()
      filter.$or = [
        { label: { $regex: term, $options: "i" } },
        { name: { $regex: term, $options: "i" } },
      ]
    }

    const fields = await CustomField.find(filter).sort({ order: 1, createdAt: 1 })

    return res.status(200).json({
      success: true,
      count: fields.length,
      data: fields,
    })
  } catch (error) {
    console.error("Error fetching custom fields:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to fetch custom fields",
    })
  }
}

/**
 * GET /api/custom-fields/:id
 * Retrieve a single custom field definition.
 */
const getCustomFieldById = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const field = await CustomField.findOne({ _id: req.params.id, tenantId })

    if (!field) {
      return res.status(404).json({
        success: false,
        error: "Custom field not found",
      })
    }

    return res.status(200).json({
      success: true,
      data: field,
    })
  } catch (error) {
    console.error("Error fetching custom field by id:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to fetch custom field details",
    })
  }
}

/**
 * POST /api/custom-fields
 * Create a new custom field definition.
 */
const createCustomField = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const {
      label,
      name,
      type = "text",
      options = [],
      required = false,
      placeholder = "",
      defaultValue = "",
      description = "",
      order = 0,
    } = req.body

    // 1. Validate label
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({
        success: false,
        error: "Field label is required",
      })
    }

    // 2. Validate & normalize field key/name
    const rawKey = name && typeof name === "string" && name.trim() ? name : label
    const cleanKey = normalizeKey(rawKey)
    if (!cleanKey || cleanKey.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Field key must contain at least 2 alphanumeric characters",
      })
    }

    // Disallow reserved lead root keys
    const RESERVED_LEAD_KEYS = [
      "_id",
      "id",
      "tenantid",
      "name",
      "email",
      "phone",
      "phonenormalized",
      "alternatephone",
      "company",
      "city",
      "status",
      "source",
      "message",
      "formid",
      "landingpage",
      "ownerid",
      "assignedto",
      "metadata",
      "attribution",
      "createdat",
      "updatedat",
    ]
    if (RESERVED_LEAD_KEYS.includes(cleanKey.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Field key '${cleanKey}' is a reserved CRM standard field. Please choose a different key.`,
      })
    }

    // 3. Validate type
    if (!ALLOWED_FIELD_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid field type '${type}'. Allowed types are: ${ALLOWED_FIELD_TYPES.join(", ")}`,
      })
    }

    // 4. Validate dropdown options
    let sanitizedOptions = []
    if (type === "dropdown") {
      if (!Array.isArray(options) || options.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Dropdown custom fields require at least one selectable option",
        })
      }
      sanitizedOptions = options
        .map((opt) => (typeof opt === "string" ? opt.trim() : String(opt).trim()))
        .filter(Boolean)
      if (sanitizedOptions.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Dropdown custom fields require at least one non-empty option",
        })
      }
    }

    // 5. Check key uniqueness for tenant
    const existing = await CustomField.findOne({ tenantId, name: cleanKey })
    if (existing) {
      if (existing.status === "archived") {
        // Reactivate previously archived field with updated settings
        existing.status = "active"
        existing.label = label.trim()
        existing.type = type
        existing.options = sanitizedOptions
        existing.required = Boolean(required)
        existing.placeholder = typeof placeholder === "string" ? placeholder.trim() : ""
        existing.defaultValue = typeof defaultValue === "string" ? defaultValue.trim() : ""
        existing.description = typeof description === "string" ? description.trim() : ""
        existing.order = Number(order) || 0
        await existing.save()

        return res.status(200).json({
          success: true,
          message: "Previously archived custom field reactivated and updated successfully",
          data: existing,
        })
      }

      return res.status(400).json({
        success: false,
        error: `A custom field with key '${cleanKey}' already exists for this tenant`,
      })
    }

    // 6. Create custom field
    const field = new CustomField({
      tenantId,
      name: cleanKey,
      label: label.trim(),
      type,
      options: sanitizedOptions,
      required: Boolean(required),
      placeholder: typeof placeholder === "string" ? placeholder.trim() : "",
      defaultValue: typeof defaultValue === "string" ? defaultValue.trim() : "",
      description: typeof description === "string" ? description.trim() : "",
      order: Number(order) || 0,
      status: "active",
    })

    await field.save()

    if (audit?.log) {
      await audit.log({
        tenantId,
        actor: req.user,
        action: "custom_field.create",
        entity: "custom_field",
        entityId: field._id,
        summary: `Created custom field '${field.label}' (${field.name})`,
        req,
      })
    }

    return res.status(201).json({
      success: true,
      message: "Custom field created successfully",
      data: field,
    })
  } catch (error) {
    console.error("Error creating custom field:", error)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "A custom field with this key already exists",
      })
    }
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to create custom field",
    })
  }
}

/**
 * PUT /api/custom-fields/:id
 * Update an existing custom field definition.
 */
const updateCustomField = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const field = await CustomField.findOne({ _id: req.params.id, tenantId })

    if (!field) {
      return res.status(404).json({
        success: false,
        error: "Custom field not found",
      })
    }

    const {
      label,
      type,
      options,
      required,
      placeholder,
      defaultValue,
      description,
      order,
      status,
    } = req.body

    if (label !== undefined) {
      if (!label || typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ success: false, error: "Field label cannot be empty" })
      }
      field.label = label.trim()
    }

    if (type !== undefined) {
      if (!ALLOWED_FIELD_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid field type '${type}'`,
        })
      }
      field.type = type
    }

    if (options !== undefined) {
      if (field.type === "dropdown" || type === "dropdown") {
        if (!Array.isArray(options) || options.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Dropdown custom fields require at least one option",
          })
        }
        field.options = options
          .map((opt) => (typeof opt === "string" ? opt.trim() : String(opt).trim()))
          .filter(Boolean)
      } else {
        field.options = []
      }
    }

    if (required !== undefined) {
      field.required = Boolean(required)
    }

    if (placeholder !== undefined) {
      field.placeholder = typeof placeholder === "string" ? placeholder.trim() : ""
    }

    if (defaultValue !== undefined) {
      field.defaultValue = typeof defaultValue === "string" ? defaultValue.trim() : ""
    }

    if (description !== undefined) {
      field.description = typeof description === "string" ? description.trim() : ""
    }

    if (order !== undefined) {
      field.order = Number(order) || 0
    }

    if (status !== undefined && ["active", "archived"].includes(status)) {
      field.status = status
    }

    await field.save()

    if (audit?.log) {
      await audit.log({
        tenantId,
        actor: req.user,
        action: "custom_field.update",
        entity: "custom_field",
        entityId: field._id,
        summary: `Updated custom field '${field.label}' (${field.name})`,
        req,
      })
    }

    return res.status(200).json({
      success: true,
      message: "Custom field updated successfully",
      data: field,
    })
  } catch (error) {
    console.error("Error updating custom field:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update custom field",
    })
  }
}

/**
 * DELETE /api/custom-fields/:id
 * Safely archive custom field to preserve historical lead values.
 */
const deleteCustomField = async (req, res) => {
  try {
    const tenantId = req.user.tenantId
    const field = await CustomField.findOne({ _id: req.params.id, tenantId })

    if (!field) {
      return res.status(404).json({
        success: false,
        error: "Custom field not found",
      })
    }

    // Safe archival strategy: preserve definition with archived status
    // Historical leads retaining field.name in lead.metadata.customFields are untouched.
    field.status = "archived"
    await field.save()

    if (audit?.log) {
      await audit.log({
        tenantId,
        actor: req.user,
        action: "custom_field.archive",
        entity: "custom_field",
        entityId: field._id,
        summary: `Archived custom field '${field.label}' (${field.name})`,
        req,
      })
    }

    return res.status(200).json({
      success: true,
      message: "Custom field archived successfully. Historical lead data has been preserved.",
      data: {
        id: field._id,
        name: field.name,
        status: field.status,
      },
    })
  } catch (error) {
    console.error("Error archiving custom field:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to archive custom field",
    })
  }
}

module.exports = {
  getCustomFields,
  getCustomFieldById,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  ALLOWED_FIELD_TYPES,
}
