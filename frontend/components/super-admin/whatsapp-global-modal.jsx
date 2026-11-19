"use client"

import React, { useState, useEffect } from "react"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  X,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  Info,
  CheckCircle2,
} from "lucide-react"

export default function WhatsAppGlobalModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null)
  const [showSecret, setShowSecret] = useState(false)

  const [formData, setFormData] = useState({
    webhookUrl: "",
    verifyToken: "",
    appSecret: "",
    graphApiVersion: "v21.0",
    hasAppSecret: false,
    appSecretMasked: "",
  })

  useEffect(() => {
    if (!isOpen) return

    const fetchConfig = async () => {
      try {
        setLoading(true)
        const res = await apiClient.getSuperAdminWhatsAppConfig()
        if (res && res.success && res.data) {
          setFormData({
            webhookUrl:
              res.data.webhookUrl ||
              `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/webhooks/whatsapp`,
            verifyToken: res.data.verifyToken || "leadflow_whatsapp_verify_token_2026",
            appSecret: "",
            graphApiVersion: res.data.graphApiVersion || "v21.0",
            hasAppSecret: Boolean(res.data.hasAppSecret),
            appSecretMasked: res.data.appSecretMasked || "",
          })
        }
      } catch (err) {
        console.error("Failed to load global WhatsApp config:", err)
        toast.error("Failed to load global WhatsApp configuration")
      } finally {
        setLoading(false)
      }
    }

    fetchConfig()
  }, [isOpen])

  const handleCopy = (text, key) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success("Copied to clipboard!")
    setTimeout(() => {
      setCopiedKey(null)
    }, 2000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      setSaving(true)
      const payload = {
        verifyToken: formData.verifyToken,
        graphApiVersion: formData.graphApiVersion,
      }
      if (formData.appSecret && formData.appSecret.trim()) {
        payload.appSecret = formData.appSecret.trim()
      }

      const res = await apiClient.updateSuperAdminWhatsAppConfig(payload)
      if (res && res.success) {
        toast.success("Global WhatsApp configuration updated successfully")
        if (res.data) {
          setFormData((prev) => ({
            ...prev,
            hasAppSecret: Boolean(res.data.hasAppSecret),
            appSecretMasked: res.data.appSecretMasked || "",
            appSecret: "",
          }))
        }
        onClose()
      } else {
        toast.error(res?.error || "Failed to save configuration")
      }
    } catch (err) {
      console.error("Error saving WhatsApp config:", err)
      toast.error(err.message || "Failed to update configuration")
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 via-teal-50 to-white">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Central Meta WhatsApp Cloud API Setup
              </h2>
              <p className="text-xs text-slate-500">
                Single central developer app & webhook serving all multi-tenant CRM accounts
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
        <div className="p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <p className="text-xs font-medium">Loading Meta Cloud API configuration...</p>
            </div>
          ) : (
            <form id="whatsapp-global-form" onSubmit={handleSubmit} className="space-y-5">
              {/* Central Webhook Card */}
              <div className="p-4 bg-emerald-50/60 border border-emerald-200/80 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Central Webhook URL (Paste into Meta App Dashboard)
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-200 text-emerald-800">
                    Shared Webhook
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={formData.webhookUrl}
                    className="flex-1 bg-white border border-emerald-300 rounded-md px-3 py-2 text-xs font-mono text-slate-800 select-all focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(formData.webhookUrl, "webhook-url")}
                    className="inline-flex items-center space-x-1 px-3 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-sm transition-colors cursor-pointer"
                  >
                    {copiedKey === "webhook-url" ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Meta routes all messages and status updates for every tenant to this single endpoint.
                  The backend automatically partitions each event by Phone Number ID with zero data leakage.
                </p>
              </div>

              {/* Verify Token Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Webhook Verify Token (hub.verify_token)</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    Must match the token entered in Meta Developer Portal
                  </span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    required
                    value={formData.verifyToken}
                    onChange={(e) =>
                      setFormData({ ...formData, verifyToken: e.target.value })
                    }
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="Enter verify token..."
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(formData.verifyToken, "verify-token")}
                    className="inline-flex items-center space-x-1 px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-200 transition-colors cursor-pointer"
                  >
                    {copiedKey === "verify-token" ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              {/* Meta App Secret */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Meta App Secret (HMAC X-Hub-Signature-256 Verification)</span>
                  {formData.hasAppSecret && (
                    <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Active & Encrypted (AES-256-GCM)
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={formData.appSecret}
                    onChange={(e) =>
                      setFormData({ ...formData, appSecret: e.target.value })
                    }
                    placeholder={
                      formData.hasAppSecret
                        ? `Configured (${formData.appSecretMasked}) - leave blank to keep unchanged`
                        : "Paste Meta App Secret from App Dashboard > Basic Settings"
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-md pl-3 pr-10 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Used by the central webhook to cryptographically verify that all incoming HTTP requests originate from Meta.
                </p>
              </div>

              {/* Graph API Version */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Meta Graph API Version
                </label>
                <input
                  type="text"
                  required
                  value={formData.graphApiVersion}
                  onChange={(e) =>
                    setFormData({ ...formData, graphApiVersion: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="v21.0"
                />
              </div>

              {/* Instructions Box */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-indigo-600" />
                  Meta Developer App Configuration Checklist:
                </h4>
                <ol className="text-[11px] text-slate-600 list-decimal list-inside space-y-1 pl-1">
                  <li>In Meta Developers Portal, open your Meta App &rarr; WhatsApp &rarr; Configuration.</li>
                  <li>Click <strong>Edit Webhook</strong>, paste the <strong>Central Webhook URL</strong> above, and enter the <strong>Verify Token</strong>.</li>
                  <li>Under <strong>Webhook fields</strong>, click <strong>Manage</strong> and subscribe to <code>messages</code>.</li>
                  <li>Once verified, click the <strong>WhatsApp API</strong> button on any tenant account row below to register that tenant&apos;s Phone Number ID!</li>
                </ol>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
          <button
            type="submit"
            form="whatsapp-global-form"
            disabled={saving || loading}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition-colors flex items-center space-x-1.5 disabled:opacity-50"
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>Save Global Configuration</span>
          </button>
        </div>
      </div>
    </div>
  )
}
