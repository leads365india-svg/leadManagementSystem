"use client"

import React, { useState, useEffect, useCallback } from "react"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  Mail,
  Shield,
  Key,
  Server,
  Send,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Lock,
  Globe,
  FileCheck,
} from "lucide-react"

export default function EmailIntegrationClient() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState("")
  const [testResult, setTestResult] = useState(null)

  // Form Fields
  const [formData, setFormData] = useState({
    provider: "smtp",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPassword: "",
    senderName: "",
    senderEmail: "",
    replyToEmail: "",
    isActive: true,
  })

  const fetchEmailConfig = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getEmailConfig()
      if (res && res.success && res.data) {
        setConfig(res.data)
        setFormData({
          provider: res.data.provider || "smtp",
          smtpHost: res.data.smtpHost || "",
          smtpPort: res.data.smtpPort || 587,
          smtpSecure: !!res.data.smtpSecure,
          smtpUser: res.data.smtpUser || "",
          smtpPassword: "", // Do not populate encrypted password
          senderName: res.data.senderName || "",
          senderEmail: res.data.senderEmail || "",
          replyToEmail: res.data.replyToEmail || "",
          isActive: res.data.isActive !== undefined ? !!res.data.isActive : true,
        })
      }
    } catch (err) {
      console.error("Failed to load email config:", err)
      toast.error(err.message || "Failed to load email integration settings")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEmailConfig()
  }, [fetchEmailConfig])

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    if (!formData.senderEmail.trim()) {
      toast.error("Sender email is required")
      return
    }

    try {
      setSaving(true)
      const payload = {
        ...formData,
        smtpPort: Number(formData.smtpPort) || 587,
      }
      // If password was left blank, don't overwrite existing
      if (!payload.smtpPassword) {
        delete payload.smtpPassword
      }

      const res = await apiClient.updateEmailConfig(payload)
      if (res && res.success) {
        toast.success("Email configuration saved securely (AES-256-GCM encrypted)")
        setConfig(res.data)
        setFormData((prev) => ({ ...prev, smtpPassword: "" }))
      } else {
        toast.error(res?.error || "Failed to save email settings")
      }
    } catch (err) {
      toast.error(err.message || "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async (e) => {
    e.preventDefault()
    if (!testEmail.trim()) {
      toast.error("Please enter a test recipient email address")
      return
    }

    try {
      setTesting(true)
      setTestResult(null)
      const res = await apiClient.testEmailConnection({
        recipientEmail: testEmail.trim(),
        smtpHost: formData.smtpHost || undefined,
        smtpPort: Number(formData.smtpPort) || undefined,
        smtpSecure: formData.smtpSecure,
        smtpUser: formData.smtpUser || undefined,
        smtpPassword: formData.smtpPassword || undefined,
        senderName: formData.senderName || undefined,
        senderEmail: formData.senderEmail || undefined,
      })

      if (res && res.success) {
        toast.success("Test email dispatched successfully!")
        setTestResult({
          success: true,
          message: res.message || "Test email sent successfully",
          messageId: res.data?.messageId,
          simulated: res.data?.simulated,
        })
      } else {
        toast.error(res?.error || "Email delivery failed")
        setTestResult({
          success: false,
          error: res?.error || "Failed to send test email",
        })
      }
    } catch (err) {
      toast.error(err.message || "Test failed")
      setTestResult({
        success: false,
        error: err.message || "Network error",
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-indigo-600" />
            <span>Email & SMTP Integration</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure tenant-isolated outgoing SMTP credentials. Used for sending manual lead quotations and autonomous product brochure dispatches.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchEmailConfig}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition self-start cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Form: SMTP Configuration */}
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleSaveConfig} className="p-6 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-5 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900">SMTP Server Configuration</h2>
              </div>
              <span className="inline-flex items-center space-x-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <Shield className="w-3 h-3 text-emerald-600" />
                <span>AES-256-GCM Encrypted</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-slate-700 block">SMTP Host</label>
                <input
                  type="text"
                  value={formData.smtpHost}
                  onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                  placeholder="e.g. smtp.gmail.com or smtp.sendgrid.net"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">Port</label>
                <input
                  type="number"
                  value={formData.smtpPort}
                  onChange={(e) => setFormData({ ...formData, smtpPort: e.target.value })}
                  placeholder="587"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="smtp-secure-toggle"
                checked={formData.smtpSecure}
                onChange={(e) => setFormData({ ...formData, smtpSecure: e.target.checked })}
                className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <label htmlFor="smtp-secure-toggle" className="text-xs text-slate-700 cursor-pointer select-none">
                Use SSL / TLS (recommended for port 465; leave unchecked for STARTTLS port 587)
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">SMTP Username</label>
                <input
                  type="text"
                  value={formData.smtpUser}
                  onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                  placeholder="e.g. apikey or user@domain.com"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  SMTP Password / API Key
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                  <input
                    type="password"
                    value={formData.smtpPassword}
                    onChange={(e) => setFormData({ ...formData, smtpPassword: e.target.value })}
                    placeholder={config?.hasPassword ? "•••••••• (Password stored securely)" : "Enter SMTP password or API token"}
                    className="w-full pl-8 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                  />
                </div>
                {config?.hasPassword && (
                  <span className="text-[10px] text-slate-400 block">
                    Password already configured. Leave empty to keep existing password.
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-4">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-600" />
                <span>Sender Identity</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Sender Display Name
                  </label>
                  <input
                    type="text"
                    value={formData.senderName}
                    onChange={(e) => setFormData({ ...formData, senderName: e.target.value })}
                    placeholder="e.g. Leads365 Sales Team"
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 block">
                    Sender Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.senderEmail}
                    onChange={(e) => setFormData({ ...formData, senderEmail: e.target.value })}
                    placeholder="e.g. sales@mycompany.com"
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  Reply-To Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={formData.replyToEmail}
                  onChange={(e) => setFormData({ ...formData, replyToEmail: e.target.value })}
                  placeholder="e.g. support@mycompany.com"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="email-integration-active"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="email-integration-active" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                  Enable Outgoing Email Dispatches
                </label>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center space-x-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving Settings...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Save Configuration</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Connection Test & Security */}
        <div className="space-y-4">
          {/* Test Email Card */}
          <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-4 text-xs">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Send className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Test SMTP Connection</h2>
            </div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Dispatch a test email to verify that your SMTP credentials, host, and port connect properly.
            </p>

            <form onSubmit={handleTestConnection} className="space-y-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">Recipient Email</label>
                <input
                  type="email"
                  required
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={testing || !testEmail.trim()}
                className="w-full inline-flex items-center justify-center space-x-2 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {testing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Connecting & Dispatching...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Test Email</span>
                  </>
                )}
              </button>
            </form>

            {testResult && (
              <div className={`p-3.5 rounded-xl border space-y-1.5 ${
                testResult.success
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-rose-50 border-rose-200 text-rose-900"
              }`}>
                <div className="flex items-center space-x-1.5 font-bold">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{testResult.success ? "Connection Verified!" : "Connection Failed"}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {testResult.message || testResult.error}
                </p>
                {testResult.messageId && (
                  <span className="text-[10px] font-mono block opacity-80">
                    Message ID: {testResult.messageId}
                  </span>
                )}
                {testResult.simulated && (
                  <span className="text-[10px] font-mono block opacity-80 text-amber-700">
                    [Simulated development fallback mode]
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Security & Multi-Tenant Isolation Info */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 text-xs text-slate-600">
            <div className="flex items-center space-x-1.5 text-slate-900 font-bold">
              <Shield className="w-4 h-4 text-indigo-600" />
              <span>Multi-Tenant Security Guarantee</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Each tenant&apos;s SMTP credentials and outgoing emails are strictly isolated in the database. SMTP passwords are encrypted using AES-256-GCM authenticated cipher before persistence. No tenant can ever view or use another tenant&apos;s email configuration.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
