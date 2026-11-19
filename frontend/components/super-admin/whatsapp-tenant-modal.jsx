"use client"

import React, { useState, useEffect } from "react"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  X,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
  Save,
  Activity,
  Phone,
  Layers,
  Info,
} from "lucide-react"

export default function WhatsAppTenantModal({ isOpen, onClose, account, onUpdated }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const [formData, setFormData] = useState({
    phoneNumberId: "",
    wabaId: "",
    displayPhoneNumber: "",
    accessToken: "",
    status: "active",
    hasAccessToken: false,
    accessTokenMasked: "",
    stats: {
      totalReceived: 0,
      totalSuccess: 0,
      lastReceivedAt: null,
      lastSuccessAt: null,
    },
    configured: false,
  })

  useEffect(() => {
    if (!isOpen || !account?.accountId) return

    const loadTenantWhatsApp = async () => {
      try {
        setLoading(true)
        const res = await apiClient.getSuperAdminTenantWhatsAppConfig(account.accountId)
        if (res && res.success && res.data) {
          const d = res.data
          setFormData({
            phoneNumberId: d.phoneNumberId || "",
            wabaId: d.wabaId || "",
            displayPhoneNumber: d.displayPhoneNumber || "",
            accessToken: "",
            status: d.status || "active",
            hasAccessToken: Boolean(d.hasAccessToken),
            accessTokenMasked: d.accessTokenMasked || "",
            stats: d.stats || {
              totalReceived: 0,
              totalSuccess: 0,
              lastReceivedAt: null,
              lastSuccessAt: null,
            },
            configured: Boolean(d.configured),
          })
        }
      } catch (err) {
        console.error("Failed to fetch tenant WhatsApp config:", err)
        toast.error("Failed to load tenant WhatsApp configuration")
      } finally {
        setLoading(false)
      }
    }

    loadTenantWhatsApp()
  }, [isOpen, account?.accountId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.phoneNumberId || !formData.phoneNumberId.trim()) {
      toast.error("Phone Number ID is required.")
      return
    }

    try {
      setSaving(true)
      const payload = {
        phoneNumberId: formData.phoneNumberId.trim(),
        wabaId: formData.wabaId.trim(),
        displayPhoneNumber: formData.displayPhoneNumber.trim(),
        status: formData.status,
      }
      if (formData.accessToken && formData.accessToken.trim()) {
        payload.accessToken = formData.accessToken.trim()
      }

      const res = await apiClient.saveSuperAdminTenantWhatsAppConfig(
        account.accountId,
        payload
      )

      if (res && res.success) {
        toast.success(`WhatsApp API configuration updated for ${account.companyName}`)
        if (typeof onUpdated === "function") onUpdated()
        onClose()
      } else {
        toast.error(res?.error || "Failed to save configuration")
      }
    } catch (err) {
      console.error("Failed to save tenant WhatsApp config:", err)
      toast.error(err.message || "Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  const handleUnlink = async () => {
    if (
      !confirm(
        `Are you sure you want to unlink WhatsApp Cloud API for tenant '${account.companyName}' (${account.accountId})? Incoming messages to this number will no longer be routed to this CRM.`
      )
    ) {
      return
    }

    try {
      setUnlinking(true)
      const res = await apiClient.deleteSuperAdminTenantWhatsAppConfig(account.accountId)
      if (res && res.success) {
        toast.success("WhatsApp configuration unlinked successfully")
        if (typeof onUpdated === "function") onUpdated()
        onClose()
      } else {
        toast.error(res?.error || "Failed to unlink configuration")
      }
    } catch (err) {
      console.error("Failed to unlink tenant WhatsApp:", err)
      toast.error(err.message || "Failed to unlink WhatsApp API")
    } finally {
      setUnlinking(false)
    }
  }

  if (!isOpen || !account) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 via-teal-50 to-white">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-800">
                  {account.companyName}
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600 font-bold">
                  {account.accountId}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                WhatsApp Cloud API Credentials & Webhook Routing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <p className="text-xs font-medium">Loading tenant WhatsApp credentials...</p>
            </div>
          ) : (
            <form id="tenant-whatsapp-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Connection Status Banner */}
              <div
                className={`p-3 rounded-lg border flex items-center justify-between text-xs ${
                  formData.configured && formData.status === "active"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : formData.configured && formData.status === "inactive"
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-slate-50 border-slate-200 text-slate-600"
                }`}
              >
                <div className="flex items-center space-x-2">
                  {formData.configured && formData.status === "active" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}
                  <span className="font-semibold">
                    {formData.configured && formData.status === "active"
                      ? "Active & Connected to Central Webhook"
                      : formData.configured && formData.status === "inactive"
                      ? "Configuration Inactive (Routing Paused)"
                      : "Not Configured"}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-[11px] font-medium text-slate-600 cursor-pointer">
                    Status:
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="text-xs bg-white border border-slate-300 rounded px-2 py-1 font-semibold focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {/* Phone Number ID Field */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Phone Number ID <span className="text-red-500">*</span></span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    Meta Graph API ID
                  </span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.phoneNumberId}
                  onChange={(e) => setFormData({ ...formData, phoneNumberId: e.target.value })}
                  placeholder="e.g. 100609346426745"
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400">
                  Unique Meta Phone Number ID. The Central Webhook uses this exact ID to isolate incoming messages into this tenant.
                </p>
              </div>

              {/* Display Phone Number */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Display Phone Number</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    Customer-facing number
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.displayPhoneNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, displayPhoneNumber: e.target.value })
                  }
                  placeholder="e.g. +91 98765 43210 or +1 555-0199"
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* WABA ID */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  WhatsApp Business Account (WABA) ID
                </label>
                <input
                  type="text"
                  value={formData.wabaId}
                  onChange={(e) => setFormData({ ...formData, wabaId: e.target.value })}
                  placeholder="e.g. 104593847291039"
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* System User Access Token */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Permanent Access Token (System User)</span>
                  {formData.hasAccessToken && (
                    <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Encrypted (AES-256-GCM)
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={formData.accessToken}
                    onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
                    placeholder={
                      formData.hasAccessToken
                        ? `Token configured (${formData.accessTokenMasked}) - leave blank to keep unchanged`
                        : "Paste Meta Permanent System User Access Token (whatsapp_business_messaging)"
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-md pl-3 pr-10 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  Required for CRM users to send outbound text replies directly from the Lead Detail Drawer.
                </p>
              </div>

              {/* Ingestion & Activity Statistics */}
              {formData.configured && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-indigo-600" />
                      Tenant Message Traffic & Health
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-white rounded border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium">Inbound Received</div>
                      <div className="text-base font-bold text-slate-800">
                        {formData.stats?.totalReceived || 0}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {formData.stats?.lastReceivedAt
                          ? `Last: ${new Date(formData.stats.lastReceivedAt).toLocaleDateString()}`
                          : "None yet"}
                      </div>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium">Outbound Sent</div>
                      <div className="text-base font-bold text-emerald-600">
                        {formData.stats?.totalSuccess || 0}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {formData.stats?.lastSuccessAt
                          ? `Last: ${new Date(formData.stats.lastSuccessAt).toLocaleDateString()}`
                          : "None yet"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div>
            {formData.configured && (
              <button
                type="button"
                disabled={unlinking || saving}
                onClick={handleUnlink}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md border border-red-200 transition-colors inline-flex items-center space-x-1 disabled:opacity-50 cursor-pointer"
              >
                {unlinking ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                <span>Unlink WhatsApp</span>
              </button>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="tenant-whatsapp-form"
              disabled={saving || loading || unlinking}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition-colors flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save Credentials</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
