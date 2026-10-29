"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Shield,
  Check,
  CheckSquare,
  Square,
  Save,
  RefreshCw,
  AlertCircle,
  Lock,
  Layers,
  ArrowLeft,
  Info,
} from "lucide-react"

export default function RolesPermissionsPage() {
  const [modules, setModules] = useState([])
  const [allowedPermissions, setAllowedPermissions] = useState([])
  const [selectedPermissions, setSelectedPermissions] = useState(new Set())
  const [initialPermissions, setInitialPermissions] = useState(new Set())
  const [updatedAt, setUpdatedAt] = useState(null)
  const [updatedBy, setUpdatedBy] = useState(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // Fetch live permissions configuration
  const loadPermissions = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const res = await apiClient.getPermissions()

      if (res.success && res.data) {
        setModules(res.data.modules || [])
        setAllowedPermissions(res.data.allowedPermissions || [])
        const active = new Set(res.data.activePermissions || [])
        setSelectedPermissions(active)
        setInitialPermissions(new Set(active))
        setUpdatedAt(res.data.updatedAt)
        setUpdatedBy(res.data.updatedBy)
      } else {
        throw new Error(res.error || "Failed to load permissions configuration")
      }
    } catch (err) {
      console.error("Error loading permissions:", err)
      setLoadError(err.message || "Failed to load roles and permissions configuration")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  // Toggle an individual permission key
  const togglePermission = useCallback((key) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  // Toggle all permissions within a specific module
  const toggleModulePermissions = useCallback((modulePermissions) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev)
      const allActive = modulePermissions.every((p) => next.has(p.key))
      if (allActive) {
        modulePermissions.forEach((p) => next.delete(p.key))
      } else {
        modulePermissions.forEach((p) => next.add(p.key))
      }
      return next
    })
  }, [])

  // Bulk actions: Select All or Deselect All
  const selectAll = useCallback(() => {
    setSelectedPermissions(new Set(allowedPermissions))
  }, [allowedPermissions])

  const deselectAll = useCallback(() => {
    setSelectedPermissions(new Set())
  }, [])

  // Reset to the last saved state from database
  const resetToSaved = useCallback(() => {
    setSelectedPermissions(new Set(initialPermissions))
    toast("Reset changes to last saved state", { icon: "↩️" })
  }, [initialPermissions])

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    if (selectedPermissions.size !== initialPermissions.size) return true
    for (const key of selectedPermissions) {
      if (!initialPermissions.has(key)) return true
    }
    return false
  }, [selectedPermissions, initialPermissions])

  // Save updated permissions
  const handleSave = async () => {
    try {
      setSaving(true)
      const permArray = Array.from(selectedPermissions)
      const res = await apiClient.updatePermissions(permArray)

      if (res.success && res.data) {
        const active = new Set(res.data.activePermissions || permArray)
        setSelectedPermissions(active)
        setInitialPermissions(new Set(active))
        setUpdatedAt(res.data.updatedAt || new Date().toISOString())
        setUpdatedBy(res.data.updatedBy || "super_admin")
        toast.success("Roles & Permissions configuration saved successfully!")
      } else {
        throw new Error(res.error || "Failed to save permissions")
      }
    } catch (err) {
      console.error("Save error:", err)
      toast.error(err.message || "Failed to save permissions")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 bg-slate-50 min-h-screen pb-16">
      {/* Top Banner / Breadcrumb */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs font-semibold text-slate-500 mb-1">
                <Link
                  href="/super-admin"
                  className="hover:text-indigo-600 transition-colors flex items-center space-x-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Super Admin Console</span>
                </Link>
                <span>/</span>
                <span className="text-slate-800">Roles & Permissions</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center space-x-2.5">
                <Shield className="w-6 h-6 text-indigo-600" />
                <span>Account Admin Default Permissions</span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
                Define the baseline permission policy granted to Leads Account Admins across tenant accounts. Changes take effect on next token renewal or session refresh.
              </p>
            </div>

            <div className="flex items-center space-x-2.5 shrink-0">
              <button
                type="button"
                onClick={loadPermissions}
                disabled={loading || saving}
                className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer disabled:opacity-50"
                title="Reload from database"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>

              {hasChanges && (
                <button
                  type="button"
                  onClick={resetToSaved}
                  disabled={loading || saving}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Discard Changes
                </button>
              )}

              <button
                type="button"
                onClick={handleSave}
                disabled={loading || saving || !hasChanges}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Saving..." : "Save Configuration"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* Loading Spinner */}
        {loading && (
          <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-3 bg-white rounded-xl border border-slate-200 p-12">
            <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Loading permission modules...
            </p>
          </div>
        )}

        {/* Error State with Retry Button */}
        {!loading && loadError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center">
            <div className="flex flex-col items-center space-y-3">
              <AlertCircle className="w-10 h-10 text-rose-500" />
              <h3 className="font-bold text-slate-900 text-base">Failed to Load Permissions</h3>
              <p className="text-xs text-rose-700 max-w-md">{loadError}</p>
              <button
                type="button"
                onClick={loadPermissions}
                className="mt-2 inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Loading</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Permissions Content */}
        {!loading && !loadError && (
          <div className="space-y-6">
            {/* Summary Metrics & Quick Actions */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="border-r border-slate-100 pr-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Target Role
                    </p>
                    <p className="text-base font-bold text-slate-900 mt-0.5 flex items-center space-x-1.5">
                      <span>Account Admin</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-50 text-indigo-700 rounded font-semibold">
                        account_admin
                      </span>
                    </p>
                  </div>

                  <div className="border-r border-slate-100 pr-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Active Permissions
                    </p>
                    <p className="text-base font-bold text-indigo-600 mt-0.5">
                      {selectedPermissions.size}
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        / {allowedPermissions.length} total
                      </span>
                    </p>
                  </div>

                  <div className="border-r border-slate-100 pr-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Total Modules
                    </p>
                    <p className="text-base font-bold text-slate-800 mt-0.5">
                      {modules.length} Modules
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Last Updated
                    </p>
                    <p className="text-xs font-medium text-slate-600 mt-1">
                      {updatedAt ? new Date(updatedAt).toLocaleDateString() : "Default"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Select All</span>
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                    <span>Deselect All</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Empty State if No Modules */}
            {modules.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <Layers className="w-10 h-10 text-slate-300 mx-auto" />
                <h3 className="font-bold text-slate-800 text-sm mt-3">No Permission Modules Found</h3>
                <p className="text-xs text-slate-500 mt-1">
                  The system does not currently have registered permission modules.
                </p>
              </div>
            ) : (
              /* Module Cards Grid */
              <div className="space-y-4">
                {modules.map((mod) => {
                  const modPermissions = mod.permissions || []
                  const activeCount = modPermissions.filter((p) =>
                    selectedPermissions.has(p.key)
                  ).length
                  const allActive =
                    modPermissions.length > 0 && activeCount === modPermissions.length
                  const someActive = activeCount > 0 && !allActive

                  return (
                    <div
                      key={mod.module}
                      className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden transition-shadow hover:shadow-sm"
                    >
                      {/* Module Header Bar */}
                      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/70 border-b border-slate-200">
                        <div className="flex items-center space-x-3">
                          <button
                            type="button"
                            onClick={() => toggleModulePermissions(modPermissions)}
                            className="p-1 text-slate-500 hover:text-indigo-600 cursor-pointer transition-colors"
                            title={allActive ? "Deselect all module permissions" : "Select all module permissions"}
                          >
                            {allActive ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : someActive ? (
                              <div className="w-4 h-4 border-2 border-indigo-600 bg-indigo-100 rounded flex items-center justify-center">
                                <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                              </div>
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          <div>
                            <h2 className="text-sm font-bold text-slate-900">{mod.label || mod.module}</h2>
                            <p className="text-[11px] text-slate-500">
                              Module identifier: <span className="font-mono text-slate-600">{mod.module}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                              allActive
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : someActive
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {activeCount} / {modPermissions.length} Active
                          </span>
                        </div>
                      </div>

                      {/* Permissions List */}
                      <div className="divide-y divide-slate-100 p-2 sm:p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
                          {modPermissions.map((perm) => {
                            const isEnabled = selectedPermissions.has(perm.key)

                            return (
                              <div
                                key={perm.key}
                                onClick={() => togglePermission(perm.key)}
                                className={`flex items-start space-x-3 p-3 rounded-lg border transition-all cursor-pointer select-none ${
                                  isEnabled
                                    ? "bg-indigo-50/40 border-indigo-200 shadow-2xs"
                                    : "bg-white border-slate-150 hover:bg-slate-50"
                                }`}
                              >
                                <div className="pt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() => {}} // Controlled by outer div onClick
                                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-1.5">
                                    <span className="text-xs font-bold text-slate-900 truncate">
                                      {perm.label || perm.key}
                                    </span>
                                    {perm.scope && (
                                      <span className="px-1.5 py-0.2 text-[10px] font-mono bg-slate-100 text-slate-600 rounded">
                                        scope: {perm.scope}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                                    {perm.description || "Grant capability to perform operations on this resource."}
                                  </p>
                                  <p className="text-[10px] font-mono text-slate-400 mt-1">
                                    {perm.key}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
