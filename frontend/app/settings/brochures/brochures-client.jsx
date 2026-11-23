"use client"

import React, { useState, useEffect, useCallback } from "react"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  FileText,
  UploadCloud,
  Download,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Send,
  Layers,
  Sparkles,
  ShieldCheck,
  Package,
} from "lucide-react"

export default function BrochuresClient() {
  const [brochures, setBrochures] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [togglingId, setTogglingId] = useState(null)

  // Form State
  const [file, setFile] = useState(null)
  const [productName, setProductName] = useState("")
  const [isDefault, setIsDefault] = useState(false)

  const fetchBrochures = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getBrochures()
      if (res && res.success && Array.isArray(res.data)) {
        setBrochures(res.data)
      } else {
        setBrochures([])
      }
    } catch (err) {
      console.error("Failed to load brochures:", err)
      toast.error(err.message || "Failed to load product brochures")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBrochures()
  }, [fetchBrochures])

  const handleUploadSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      toast.error("Please select a PDF brochure file")
      return
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported")
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Brochure file exceeds 25MB limit")
      return
    }

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append("file", file)
      if (productName.trim()) {
        formData.append("productName", productName.trim())
      }
      formData.append("isDefault", isDefault ? "true" : "false")

      const res = await apiClient.uploadBrochure(formData)
      if (res && res.success) {
        toast.success("Product brochure uploaded successfully")
        setFile(null)
        setProductName("")
        setIsDefault(false)
        fetchBrochures()
      } else {
        toast.error(res?.error || "Failed to upload brochure")
      }
    } catch (err) {
      toast.error(err.message || "Failed to upload brochure")
    } finally {
      setUploading(false)
    }
  }

  const handleToggleStatus = async (brochure) => {
    if (!brochure || togglingId) return
    try {
      setTogglingId(brochure._id)
      const newStatus = !brochure.isActive
      const res = await apiClient.toggleBrochureStatus(brochure._id, { isActive: newStatus })
      if (res && res.success) {
        toast.success(`Brochure marked as ${newStatus ? "Active" : "Inactive"}`)
        setBrochures((prev) =>
          prev.map((b) => (b._id === brochure._id ? { ...b, isActive: newStatus } : b))
        )
      } else {
        toast.error(res?.error || "Failed to update brochure status")
      }
    } catch (err) {
      toast.error(err.message || "Failed to toggle status")
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600" />
            <span>Product Brochures</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Upload tenant product brochures (PDF). AI Call Intelligence will automatically dispatch matching brochures when customers request them during verified qualified calls.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchBrochures}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition self-start cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Grid: Upload form + Brochures list */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Upload Form */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-4">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <UploadCloud className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Upload New Brochure</h2>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Brochure PDF Document <span className="text-rose-500">*</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border border-slate-200 rounded-lg p-2 bg-white"
                />
                <span className="text-[10px] text-slate-400 block">Max 25MB • Strict PDF verification</span>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Product / Service Name
                </label>
                <div className="relative">
                  <Package className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Hospital Management System"
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
                <span className="text-[10px] text-slate-400 block">
                  Matches customer inquiries for this specific product
                </span>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="default-brochure-check"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="default-brochure-check" className="text-xs text-slate-700 cursor-pointer select-none">
                  Set as <strong>Default Tenant Brochure</strong>
                </label>
              </div>

              <button
                type="submit"
                disabled={!file || uploading}
                className="w-full inline-flex items-center justify-center space-x-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Uploading Brochure...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    <span>Upload Brochure</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* AI Autonomous Dispatch Note */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl space-y-2 text-xs">
            <div className="flex items-center space-x-1.5 text-indigo-900 font-bold">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Autonomous AI Dispatch Rules</span>
            </div>
            <ul className="space-y-1.5 text-indigo-800 text-[11px] list-disc pl-4 leading-relaxed">
              <li>Customer must explicitly request a brochure or catalog.</li>
              <li>Requested product must match tenant&apos;s active product catalogue.</li>
              <li>Customer must have a valid email address on file.</li>
              <li>Requested channel must not be WhatsApp or phone-only.</li>
              <li>Tenant SMTP email integration must be configured and active.</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Brochures List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              Configured Brochures ({brochures.length})
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">
              Tenant Isolated Storage
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading tenant brochures...
            </div>
          ) : brochures.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-1" />
              <h3 className="text-sm font-bold text-slate-700">No Product Brochures Configured</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Upload your product brochure PDF on the left. The AI Call Intelligence system will autonomously dispatch it to interested leads.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {brochures.map((b) => (
                <div
                  key={b._id}
                  className={`p-5 bg-white border rounded-2xl shadow-2xs space-y-3 transition ${
                    b.isActive ? "border-slate-200" : "border-slate-200/60 opacity-60 bg-slate-50/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span className="font-bold text-slate-900 truncate text-sm">
                          {b.productName || b.originalName}
                        </span>
                        {b.isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                            Default Brochure
                          </span>
                        )}
                        <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                          v{b.version || 1}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                        <span className="truncate max-w-[200px]" title={b.originalName}>
                          {b.originalName}
                        </span>
                        <span>•</span>
                        <span>{b.fileSize ? `${Math.round(b.fileSize / 1024)} KB` : "PDF"}</span>
                        <span>•</span>
                        <span>Uploaded {new Date(b.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 shrink-0">
                      <a
                        href={apiClient.getBrochureDownloadUrl(b._id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => handleToggleStatus(b)}
                        disabled={togglingId === b._id}
                        className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                          b.isActive
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
                        }`}
                      >
                        {b.isActive ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Active</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                            <span>Inactive</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Sent stats */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 font-mono">
                    <div className="flex items-center space-x-1">
                      <Send className="w-3 h-3 text-slate-400" />
                      <span>Autonomous dispatches: <strong className="text-slate-800">{b.sentCount || 0}</strong></span>
                    </div>
                    {b.lastSentAt && (
                      <span>Last dispatched: {new Date(b.lastSentAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
