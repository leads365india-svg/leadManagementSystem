"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Plus,
  Search,
  Sliders,
  Type,
  Hash,
  Mail,
  Phone,
  Calendar,
  ListFilter,
  CheckSquare,
  AlignLeft,
  Edit2,
  Trash2,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  Info,
  Archive,
  Layers,
  Sparkles,
} from "lucide-react"

const FIELD_TYPE_CONFIG = {
  text: {
    label: "Text",
    description: "Single-line plain text",
    icon: Type,
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
  },
  number: {
    label: "Number",
    description: "Numeric values, amounts or counts",
    icon: Hash,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  email: {
    label: "Email",
    description: "Email address format validation",
    icon: Mail,
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
  },
  phone: {
    label: "Phone",
    description: "Telephone and mobile numbers",
    icon: Phone,
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
  },
  date: {
    label: "Date",
    description: "Calendar date picker",
    icon: Calendar,
    badgeColor: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  dropdown: {
    label: "Dropdown",
    description: "Predefined list of selectable choices",
    icon: ListFilter,
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  checkbox: {
    label: "Checkbox",
    description: "Boolean true/false or yes/no toggle",
    icon: CheckSquare,
    badgeColor: "bg-teal-50 text-teal-700 border-teal-200",
  },
  textarea: {
    label: "Textarea",
    description: "Multi-line text or detailed notes",
    icon: AlignLeft,
    badgeColor: "bg-slate-100 text-slate-700 border-slate-200",
  },
}

export default function CustomFieldsClient() {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTypeFilter, setSelectedTypeFilter] = useState("all")
  const [showArchived, setShowArchived] = useState(false)

  // Modal states
  const [showModal, setShowModal] = useState(false)
  const [editingField, setEditingField] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")

  // Form inputs
  const [formData, setFormData] = useState({
    label: "",
    name: "",
    type: "text",
    required: false,
    placeholder: "",
    defaultValue: "",
    description: "",
    order: 0,
    options: [],
  })
  const [newOptionInput, setNewOptionInput] = useState("")

  // Delete / Archive confirmation modal
  const [fieldToArchive, setFieldToArchive] = useState(null)
  const [archiving, setArchiving] = useState(false)

  // Load custom fields
  const fetchFields = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getCustomFields({ status: showArchived ? "all" : "active" })
      if (res && res.success) {
        setFields(res.data || [])
      } else {
        toast.error(res?.error || "Failed to load custom fields")
      }
    } catch (err) {
      console.error("Error loading custom fields:", err)
      toast.error(err.message || "Failed to load custom fields")
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => {
    fetchFields()
  }, [fetchFields])

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingField(null)
    setFormData({
      label: "",
      name: "",
      type: "text",
      required: false,
      placeholder: "",
      defaultValue: "",
      description: "",
      order: fields.length,
      options: [],
    })
    setNewOptionInput("")
    setFormError("")
    setShowModal(true)
  }

  // Open Edit Modal
  const handleOpenEdit = (field) => {
    setEditingField(field)
    setFormData({
      label: field.label || "",
      name: field.name || "",
      type: field.type || "text",
      required: Boolean(field.required),
      placeholder: field.placeholder || "",
      defaultValue: field.defaultValue || "",
      description: field.description || "",
      order: field.order || 0,
      options: Array.isArray(field.options) ? [...field.options] : [],
    })
    setNewOptionInput("")
    setFormError("")
    setShowModal(true)
  }

  // Auto-slugify label to name when creating
  const handleLabelChange = (val) => {
    const updated = { ...formData, label: val }
    if (!editingField) {
      const generated = val
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
      updated.name = generated
    }
    setFormData(updated)
  }

  // Add dropdown option
  const handleAddOption = () => {
    const clean = newOptionInput.trim()
    if (!clean) return
    if (formData.options.includes(clean)) {
      setFormError(`Option '${clean}' already exists in the list`)
      return
    }
    setFormData({
      ...formData,
      options: [...formData.options, clean],
    })
    setNewOptionInput("")
    setFormError("")
  }

  // Remove dropdown option
  const handleRemoveOption = (indexToRemove) => {
    setFormData({
      ...formData,
      options: formData.options.filter((_, idx) => idx !== indexToRemove),
    })
  }

  // Save / Update Field
  const handleSaveField = async (e) => {
    e.preventDefault()
    setFormError("")

    if (!formData.label.trim()) {
      setFormError("Field label is required")
      return
    }

    if (!editingField && !formData.name.trim()) {
      setFormError("Field key is required")
      return
    }

    if (formData.type === "dropdown" && formData.options.length === 0) {
      setFormError("Dropdown custom fields require at least one option")
      return
    }

    try {
      setSaving(true)
      let res
      if (editingField) {
        res = await apiClient.updateCustomField(editingField.id || editingField._id, {
          label: formData.label.trim(),
          type: formData.type,
          required: formData.required,
          placeholder: formData.placeholder.trim(),
          defaultValue: formData.defaultValue.trim(),
          description: formData.description.trim(),
          order: Number(formData.order) || 0,
          options: formData.type === "dropdown" ? formData.options : [],
        })
      } else {
        res = await apiClient.createCustomField({
          label: formData.label.trim(),
          name: formData.name.trim(),
          type: formData.type,
          required: formData.required,
          placeholder: formData.placeholder.trim(),
          defaultValue: formData.defaultValue.trim(),
          description: formData.description.trim(),
          order: Number(formData.order) || 0,
          options: formData.type === "dropdown" ? formData.options : [],
        })
      }

      if (res && res.success) {
        toast.success(
          editingField
            ? "Custom field updated successfully"
            : "Custom field created successfully"
        )
        setShowModal(false)
        fetchFields()
      } else {
        setFormError(res?.error || "Failed to save custom field")
      }
    } catch (err) {
      console.error("Error saving custom field:", err)
      setFormError(err.message || "Failed to save custom field")
    } finally {
      setSaving(false)
    }
  }

  // Execute Safe Archive
  const handleConfirmArchive = async () => {
    if (!fieldToArchive) return
    try {
      setArchiving(true)
      const res = await apiClient.deleteCustomField(fieldToArchive.id || fieldToArchive._id)
      if (res && res.success) {
        toast.success("Custom field archived safely. Historical lead data preserved.")
        setFieldToArchive(null)
        fetchFields()
      } else {
        toast.error(res?.error || "Failed to archive custom field")
      }
    } catch (err) {
      console.error("Error archiving custom field:", err)
      toast.error(err.message || "Failed to archive custom field")
    } finally {
      setArchiving(false)
    }
  }

  // Filtered fields calculation
  const filteredFields = useMemo(() => {
    return fields.filter((f) => {
      if (selectedTypeFilter !== "all" && f.type !== selectedTypeFilter) {
        return false
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const matchLabel = (f.label || "").toLowerCase().includes(query)
        const matchName = (f.name || "").toLowerCase().includes(query)
        return matchLabel || matchName
      }
      return true
    })
  }, [fields, selectedTypeFilter, searchQuery])

  // Summary statistics
  const stats = useMemo(() => {
    const total = fields.length
    const active = fields.filter((f) => f.status === "active").length
    const required = fields.filter((f) => f.required && f.status === "active").length
    const dropdowns = fields.filter((f) => f.type === "dropdown" && f.status === "active").length
    return { total, active, required, dropdowns }
  }, [fields])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* =========================================================================
          PAGE HEADER
      ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-slate-900">Custom Fields Builder</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Phase 5 Active
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Configure tenant-specific lead properties, attribute tags, and website integration mapping targets.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={fetchFields}
            disabled={loading}
            className="p-2.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl hover:bg-slate-50 transition cursor-pointer"
            title="Refresh Fields List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Custom Field</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          STATISTICS OVERVIEW CARDS
      ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-xs font-medium text-slate-500">Active Custom Fields</span>
          <div className="text-2xl font-extrabold text-slate-900">{stats.active}</div>
          <span className="text-[11px] text-emerald-600 font-medium">Tenant partitioned</span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-xs font-medium text-slate-500">Mandatory Rules</span>
          <div className="text-2xl font-extrabold text-indigo-600">{stats.required}</div>
          <span className="text-[11px] text-slate-400">Strict form validation</span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-xs font-medium text-slate-500">Dropdown Choices</span>
          <div className="text-2xl font-extrabold text-purple-600">{stats.dropdowns}</div>
          <span className="text-[11px] text-slate-400">Configured options</span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-xs font-medium text-slate-500">Integration Readiness</span>
          <div className="text-2xl font-extrabold text-emerald-600">100%</div>
          <span className="text-[11px] text-slate-400">Mappable in Studio</span>
        </div>
      </div>

      {/* =========================================================================
          FILTER & SEARCH TOOLBAR
      ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by label or field key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 text-[11px]">Type:</span>
          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="all">All Types ({fields.length})</option>
            {Object.entries(FIELD_TYPE_CONFIG).map(([k, cfg]) => (
              <option key={k} value={k}>
                {cfg.label}
              </option>
            ))}
          </select>

          <label className="flex items-center space-x-1.5 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-[11px]">Show Archived</span>
          </label>
        </div>
      </div>

      {/* =========================================================================
          CUSTOM FIELDS LIST / TABLE
      ========================================================================= */}
      {loading && fields.length === 0 ? (
        <div className="p-16 text-center space-y-3 bg-white rounded-2xl border border-slate-200">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Loading custom fields configuration...</p>
        </div>
      ) : filteredFields.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <Sliders className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-slate-900">
              {searchQuery ? "No matching custom fields" : "No custom fields defined yet"}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {searchQuery
                ? "Try adjusting your search query or field type filters."
                : "Create custom attributes to track customer budgets, preferred products, project timelines, and custom form inputs from website leads."}
            </p>
          </div>
          {!searchQuery && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Your First Custom Field</span>
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Field Label & Description</th>
                  <th className="py-3 px-4">Field Key (API / Storage)</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Validation</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFields.map((field) => {
                  const typeConfig = FIELD_TYPE_CONFIG[field.type] || FIELD_TYPE_CONFIG.text
                  const TypeIcon = typeConfig.icon
                  const isArchived = field.status === "archived"

                  return (
                    <tr
                      key={field.id || field._id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isArchived ? "opacity-60 bg-slate-50/40" : ""
                      }`}
                    >
                      {/* Label & Description */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <span className="font-bold text-slate-900 block">{field.label}</span>
                          {field.description ? (
                            <span className="text-[11px] text-slate-500 line-clamp-1">
                              {field.description}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No description</span>
                          )}
                        </div>
                      </td>

                      {/* Monospace Key */}
                      <td className="py-3.5 px-4 font-mono">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[11px] font-semibold border border-slate-200">
                          {field.name}
                        </span>
                      </td>

                      {/* Type Badge */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${typeConfig.badgeColor}`}
                          >
                            <TypeIcon className="w-3 h-3" />
                            <span>{typeConfig.label}</span>
                          </span>

                          {field.type === "dropdown" && Array.isArray(field.options) && (
                            <span className="text-[10px] text-slate-500 block truncate max-w-xs font-mono">
                              {field.options.length} options: {field.options.slice(0, 3).join(", ")}
                              {field.options.length > 3 ? "..." : ""}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Required / Optional */}
                      <td className="py-3.5 px-4">
                        {field.required ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            Required
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Optional</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {isArchived ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            <Archive className="w-3 h-3" />
                            Archived
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(field)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                            title="Edit Custom Field"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {!isArchived && (
                            <button
                              type="button"
                              onClick={() => setFieldToArchive(field)}
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Safely Archive Field"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          CREATE / EDIT MODAL
      ========================================================================= */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingField ? `Edit '${editingField.label}'` : "New Custom Field"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Configure field properties and validation rules for CRM leads
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveField} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Label */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Field Label <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Estimated Budget, Product Choice, Project Deadline"
                  value={formData.label}
                  onChange={(e) => handleLabelChange(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
                />
              </div>

              {/* Field Key (API/Storage) */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 flex items-center justify-between">
                  <span>
                    Field Key (Metadata property) <span className="text-rose-500">*</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">lead.metadata.customFields.[key]</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. estimated_budget, product_choice"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().trim() })}
                  disabled={Boolean(editingField)}
                  required
                  className={`w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs ${
                    editingField ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "bg-white"
                  }`}
                />
                {!editingField && (
                  <p className="text-[10px] text-slate-400">
                    Alphanumeric and underscores only. Automatically derived from label.
                  </p>
                )}
              </div>

              {/* Field Type Select */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Field Type <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(FIELD_TYPE_CONFIG).map(([k, cfg]) => {
                    const Icon = cfg.icon
                    const isSelected = formData.type === k
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFormData({ ...formData, type: k })}
                        className={`flex items-start space-x-2 p-2.5 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                        <div className="min-w-0">
                          <span className={`block font-bold text-xs ${isSelected ? "text-indigo-900" : "text-slate-800"}`}>
                            {cfg.label}
                          </span>
                          <span className="block text-[10px] text-slate-400 truncate">
                            {cfg.description}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Dropdown Options Manager */}
              {formData.type === "dropdown" && (
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                  <label className="font-bold text-slate-800 block text-[11px]">
                    Configure Dropdown Options <span className="text-rose-500">*</span>
                  </label>

                  <div className="flex items-center space-x-1.5">
                    <input
                      type="text"
                      placeholder="Add choice option (e.g. Enterprise, Standard)"
                      value={newOptionInput}
                      onChange={(e) => setNewOptionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddOption()
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg bg-white text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition cursor-pointer"
                    >
                      Add
                    </button>
                  </div>

                  {formData.options.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                      {formData.options.map((opt, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white text-slate-800 border border-slate-200 shadow-2xs"
                        >
                          <span>{opt}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(idx)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-700 italic">
                      No options added yet. Please add at least one dropdown option.
                    </p>
                  )}
                </div>
              )}

              {/* Required & Placeholder */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Placeholder Text</label>
                  <input
                    type="text"
                    placeholder="e.g. Enter amount..."
                    value={formData.placeholder}
                    onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">Default Fallback Value</label>
                  <input
                    type="text"
                    placeholder="e.g. N/A or standard"
                    value={formData.defaultValue}
                    onChange={(e) => setFormData({ ...formData, defaultValue: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">Help / Description</label>
                <input
                  type="text"
                  placeholder="Optional hint displayed for sales reps or on intake forms"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-xl"
                />
              </div>

              {/* Required Checkbox */}
              <label className="flex items-center space-x-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.required}
                  onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="font-bold text-slate-800 block text-xs">Mandatory Field</span>
                  <span className="text-[10px] text-slate-400 block">
                    Website integrations and manual lead forms will require this attribute
                  </span>
                </div>
              </label>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingField ? "Update Field" : "Create Field"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          SAFE ARCHIVE CONFIRMATION MODAL
      ========================================================================= */}
      {fieldToArchive && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Archive className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900">
                Safely Archive &apos;{fieldToArchive.label}&apos;?
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Archiving this custom field will hide it from new lead entry forms and website integration mappings.
              </p>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-[11px] leading-relaxed">
                <strong>Historical Data Protection:</strong> All existing CRM leads with values stored under{" "}
                <code className="font-mono">{fieldToArchive.name}</code> will safely retain their data and remain visible in the Lead Detail Drawer.
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setFieldToArchive(null)}
                disabled={archiving}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                disabled={archiving}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl transition cursor-pointer flex items-center space-x-1.5"
              >
                {archiving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
