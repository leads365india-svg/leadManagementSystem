"use client"

import React, { useEffect, useState, useCallback } from "react"
import { apiClient } from "@/lib/api"
import {
  Save,
  CheckSquare,
  Square,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  Layers,
} from "lucide-react"

export default function RolesPermissionsPage() {
  const [modules, setModules] = useState([])
  const [allowedPermissions, setAllowedPermissions] = useState([])
  const [selectedPermissions, setSelectedPermissions] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [lastSaved, setLastSaved] = useState(null)

  // Load Permissions configuration from backend
  const loadPermissions = useCallback(async () => {
    try {
      setLoading(true)
      setFeedback(null)
      const response = await apiClient.getPermissions()

      if (response.success && response.data) {
        setModules(response.data.modules)
        setAllowedPermissions(response.data.allowedPermissions)
        setSelectedPermissions(new Set(response.data.activePermissions))
        if (response.data.updatedAt) {
          setLastSaved(new Date(response.data.updatedAt).toLocaleTimeString())
        }
      } else {
        setFeedback({
          type: "error",
          message: response.error || "Failed to load permissions configuration",
        })
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err.message || "Failed to load permissions configuration",
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  // Toggle single permission
  const handleToggle = (key) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Select All permissions
  const handleSelectAll = () => {
    setSelectedPermissions(new Set(allowedPermissions))
  }

  // Clear All permissions
  const handleClearAll = () => {
    setSelectedPermissions(new Set())
  }

  // Save changes to backend
  const handleSave = async () => {
    try {
      setSaving(true)
      setFeedback(null)
      const permissionsArray = Array.from(selectedPermissions)

      const response = await apiClient.updatePermissions(permissionsArray)
      if (response.success && response.data) {
        setSelectedPermissions(new Set(response.data.activePermissions))
        setLastSaved(new Date().toLocaleTimeString())
        setFeedback({
          type: "success",
          message: "Roles & Permissions saved and propagated to all Leads Account Admins!",
        })
        setTimeout(() => setFeedback(null), 4000)
      } else {
        setFeedback({
          type: "error",
          message: response.error || "Failed to save permissions",
        })
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err.message || "Failed to save permissions",
      })
    } finally {
      setSaving(false)
    }
  }

  const isAllSelected =
    allowedPermissions.length > 0 && selectedPermissions.size === allowedPermissions.length

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Roles & Permissions Configuration
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Account Admin Scope
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Configure the baseline permissions granted to Leads Account Admins across system modules.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleSelectAll}
            disabled={loading || isAllSelected}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs disabled:opacity-40 transition-colors cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
            <span>Select All</span>
          </button>

          <button
            onClick={handleClearAll}
            disabled={loading || selectedPermissions.size === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 text-slate-400" />
            <span>Clear All</span>
          </button>

          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="inline-flex items-center space-x-2 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{saving ? "Saving..." : "Save Changes"}</span>
          </button>
        </div>
      </div>

      {/* Status Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <div className="flex items-center space-x-2 font-medium">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600" />
            )}
            <span>{feedback.message}</span>
          </div>
          {lastSaved && feedback.type === "success" && (
            <span className="text-[11px] text-emerald-600">Saved at {lastSaved}</span>
          )}
        </div>
      )}

      {/* Summary Box */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-800">
              Active Permissions: {selectedPermissions.size} of {allowedPermissions.length} granted
            </span>
            <p className="text-[11px] text-slate-500">
              Changes take effect immediately across all API middleware validation checks.
            </p>
          </div>
        </div>

        {lastSaved && (
          <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
            Last updated: {lastSaved}
          </span>
        )}
      </div>

      {/* Module Grouped Permissions List */}
      {loading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Loading permissions configuration...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {modules.map((group) => {
            const allInGroupSelected = group.permissions.every((p) =>
              selectedPermissions.has(p.key),
            )

            const handleToggleGroup = () => {
              setSelectedPermissions((prev) => {
                const next = new Set(prev)
                if (allInGroupSelected) {
                  group.permissions.forEach((p) => next.delete(p.key))
                } else {
                  group.permissions.forEach((p) => next.add(p.key))
                }
                return next
              })
            }

            return (
              <div
                key={group.module}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden"
              >
                {/* Module Group Header */}
                <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-semibold text-xs text-slate-800 tracking-wide uppercase">
                      {group.label}
                    </h3>
                    <span className="text-[10px] font-medium text-slate-400">
                      ({group.permissions.filter((p) => selectedPermissions.has(p.key)).length}/
                      {group.permissions.length} enabled)
                    </span>
                  </div>

                  <button
                    onClick={handleToggleGroup}
                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                  >
                    {allInGroupSelected ? "Deselect Module" : "Select Module"}
                  </button>
                </div>

                {/* Permissions Grid */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {group.permissions.map((perm) => {
                    const isChecked = selectedPermissions.has(perm.key)

                    return (
                      <div
                        key={perm.key}
                        onClick={() => handleToggle(perm.key)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start space-x-3 select-none ${
                          isChecked
                            ? "bg-indigo-50/40 border-indigo-200/80 shadow-2xs"
                            : "bg-white border-slate-200/80 hover:bg-slate-50/80"
                        }`}
                      >
                        {/* Toggle Checkbox / Switch */}
                        <div className="pt-0.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}} // Handled by container onClick
                            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                          />
                        </div>

                        {/* Label & Description */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-slate-900 truncate">
                              {perm.label}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded ml-2 shrink-0">
                              {perm.key}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                            {perm.description}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Save Floating Bar on Bottom */}
      <div className="sticky bottom-4 bg-white/95 backdrop-blur-xs p-4 rounded-2xl border border-slate-200/90 shadow-lg flex items-center justify-between">
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{selectedPermissions.size}</span>{" "}
          permissions currently selected
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadPermissions}
            disabled={loading || saving}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            Reset
          </button>

          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shadow-indigo-100 disabled:opacity-50 transition-colors cursor-pointer flex items-center space-x-2"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{saving ? "Saving Changes..." : "Save Changes"}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
