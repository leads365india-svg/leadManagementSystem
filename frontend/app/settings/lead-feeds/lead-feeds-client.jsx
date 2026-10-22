"use client"

import React, { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import {
  Globe,
  Key,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  FileText,
  Mail,
  Phone,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Send,
  Code2,
  Lock,
  Eye,
  EyeOff,
  Sliders,
  Database,
  ArrowRight,
  Info,
  X,
} from "lucide-react"

const DEFAULT_BLOCKED_DOMAINS = [
  "mailinator.com",
  "tempmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "throwawaymail.com",
  "yopmail.com",
]

export default function LeadFeedsClient() {
  // Loading & state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rotating, setRotating] = useState(false)

  // Configuration state
  const [enabled, setEnabled] = useState(true)
  const [apiKeyMasked, setApiKeyMasked] = useState("")
  const [apiKeyLastRotatedAt, setApiKeyLastRotatedAt] = useState(null)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [staffList, setStaffList] = useState([])
  const [assignedStaffId, setAssignedStaffId] = useState("unassigned")
  const [assignedStaffName, setAssignedStaffName] = useState("Unassigned")
  const [acceptedFormsText, setAcceptedFormsText] = useState("")
  const [blockedDomainsText, setBlockedDomainsText] = useState("")
  const [duplicateHandling, setDuplicateHandling] = useState("reject")
  const [stats, setStats] = useState({
    totalReceived: 0,
    totalSuccess: 0,
    totalErrors: 0,
    lastReceivedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: "",
  })

  // Email verification settings
  const [requireVerifiedEmail, setRequireVerifiedEmail] = useState(false)
  const [holdUntilConfirmed, setHoldUntilConfirmed] = useState(false)
  const [strictVerification, setStrictVerification] = useState(false)
  const [allowPhoneOnly, setAllowPhoneOnly] = useState(true)

  // UI accordion & modals state
  const [websiteCardOpen, setWebsiteCardOpen] = useState(true)
  const [codeSampleOpen, setCodeSampleOpen] = useState(false)
  const [showRotateModal, setShowRotateModal] = useState(false)
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState(null)
  const [showTestResultModal, setShowTestResultModal] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [activeDocTab, setActiveDocTab] = useState("wordpress")

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getLeadFeedSettings()
      if (res.success && res.data) {
        const { config, staff, webhookUrl: url, rawApiKey } = res.data
        const ws = config.websiteSource || {}

        setEnabled(Boolean(ws.enabled))
        setApiKeyMasked(ws.apiKeyMasked || "")
        setApiKeyLastRotatedAt(ws.apiKeyLastRotatedAt)
        setWebhookUrl(url || "")
        setStaffList(staff || [])
        setAssignedStaffId(ws.assignedStaffId || "unassigned")
        setAssignedStaffName(ws.assignedStaffName || "Unassigned")
        setAcceptedFormsText((ws.acceptedForms || []).join("\n"))
        setBlockedDomainsText((ws.blockedDomains || []).join("\n"))
        setDuplicateHandling(ws.duplicateHandling || "reject")
        setStats(ws.stats || {})

        const ev = ws.emailVerification || {}
        setRequireVerifiedEmail(Boolean(ev.requireVerifiedEmail))
        setHoldUntilConfirmed(Boolean(ev.holdUntilConfirmed))
        setStrictVerification(Boolean(ev.strictVerification))
        setAllowPhoneOnly(ev.allowPhoneOnly !== undefined ? Boolean(ev.allowPhoneOnly) : true)

        if (rawApiKey) {
          setNewlyGeneratedKey(rawApiKey)
        }
      }
    } catch (err) {
      console.error("Failed to load Lead Feeds config:", err)
      toast.error(err.message || "Failed to load lead feed configuration")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Save changes
  const handleSave = async () => {
    try {
      setSaving(true)

      const acceptedForms = acceptedFormsText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)

      const blockedDomains = blockedDomainsText
        .split("\n")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)

      const payload = {
        enabled,
        assignedStaffId,
        acceptedForms,
        blockedDomains,
        duplicateHandling,
        emailVerification: {
          requireVerifiedEmail,
          holdUntilConfirmed,
          strictVerification,
          allowPhoneOnly,
        },
      }

      const res = await apiClient.updateLeadFeedSettings(payload)
      if (res.success) {
        toast.success("Lead Feed configuration saved successfully!")
        if (res.data?.websiteSource) {
          setAssignedStaffName(res.data.websiteSource.assignedStaffName)
        }
      } else {
        toast.error(res.error || "Failed to save configuration")
      }
    } catch (err) {
      toast.error(err.message || "An error occurred while saving")
    } finally {
      setSaving(false)
    }
  }

  // Rotate Key
  const handleRotateKey = async () => {
    try {
      setRotating(true)
      const res = await apiClient.rotateLeadFeedApiKey()
      if (res.success && res.data) {
        setNewlyGeneratedKey(res.data.rawApiKey)
        setApiKeyMasked(res.data.apiKeyMasked)
        setApiKeyLastRotatedAt(res.data.apiKeyLastRotatedAt)
        toast.success("API key successfully rotated! Previous key invalidated.")
      } else {
        toast.error(res.error || "Failed to rotate API key")
      }
    } catch (err) {
      toast.error(err.message || "Key rotation failed")
    } finally {
      setRotating(false)
    }
  }

  // Send diagnostic test lead
  const handleSendTestLead = async () => {
    try {
      setTesting(true)
      const res = await apiClient.sendLeadFeedTest()
      if (res.success) {
        setTestResult(res.data)
        setShowTestResultModal(true)
        toast.success("Test lead processed! Integration pipeline is healthy.")
        // Refresh metrics
        loadSettings()
      } else {
        toast.error(res.error || "Test submission failed")
      }
    } catch (err) {
      toast.error(err.message || "Failed to execute test submission")
    } finally {
      setTesting(false)
    }
  }

  const copyToClipboard = (text, type) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    if (type === "url") {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2500)
      toast.success("Webhook URL copied to clipboard")
    } else {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2500)
      toast.success("API Key copied to clipboard")
    }
  }

  const handleResetBlockedDomains = () => {
    setBlockedDomainsText(DEFAULT_BLOCKED_DOMAINS.join("\n"))
    toast.success("Reset to standard disposable domains")
  }

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
        <p className="text-sm font-medium">Loading Lead Feeds configuration...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Breadcrumb & Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <nav className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
            <Link href="/leads" className="hover:text-slate-800 transition-colors">
              CRM
            </Link>
            <span>/</span>
            <span className="text-slate-400">Settings</span>
            <span>/</span>
            <span className="text-indigo-600 font-semibold">Lead Feeds</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lead Feeds & Website Integration</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Manage inbound webhooks, website forms, automated assignment, and verification gates.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleSendTestLead}
            disabled={testing || !enabled}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
            ) : (
              <Send className="w-4 h-4 text-slate-600" />
            )}
            Send Test Lead
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-medium shadow-sm shadow-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Check className="w-4 h-4 text-white" />
            )}
            Save Changes
          </button>
        </div>
      </div>

      {/* Main Grid: Settings & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: Main Website Feed Settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section A: Website Lead Source Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
            {/* Card Header with Toggle & Collapse */}
            <div className="p-6 bg-slate-50/50 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                    enabled
                      ? "bg-emerald-50 border border-emerald-200/80 text-emerald-600"
                      : "bg-slate-100 border border-slate-200 text-slate-400"
                  }`}
                >
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-semibold text-slate-900">Website & Webhook Feed</h2>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        enabled
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`}
                      />
                      {enabled ? "Active & Receiving" : "Integration Disabled"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Accept leads directly from HTML forms, WordPress, Webflow, or custom backends via REST Webhook.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 self-end sm:self-center">
                {/* Enable/Disable Toggle */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>

                {/* Expand / Collapse Button */}
                <button
                  type="button"
                  onClick={() => setWebsiteCardOpen(!websiteCardOpen)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  title={websiteCardOpen ? "Collapse Section" : "Expand Section"}
                >
                  {websiteCardOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Collapsible Content */}
            {websiteCardOpen && (
              <div className="p-6 space-y-6">
                {/* 1. Webhook URL */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Webhook Endpoint URL
                    </label>
                    <span className="text-xs text-slate-500">Method: HTTP POST</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        readOnly
                        value={webhookUrl}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 text-xs font-mono text-slate-700 select-all focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(webhookUrl, "url")}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all active:scale-95"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedUrl ? "Copied" : "Copy URL"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Send a JSON payload with headers: <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded">Content-Type: application/json</code> and <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded">x-api-key: [Your API Key]</code>.
                  </p>
                </div>

                {/* 2. Integration API Key */}
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Integration API Secret Key
                    </label>
                    {apiKeyLastRotatedAt && (
                      <span className="text-xs text-slate-400">
                        Last rotated: {new Date(apiKeyLastRotatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        readOnly
                        value={newlyGeneratedKey || apiKeyMasked || "lf_live_••••••••••••••••••••"}
                        className={`w-full border rounded-lg py-2.5 px-3.5 text-xs font-mono select-all focus:outline-none ${
                          newlyGeneratedKey
                            ? "bg-amber-50 border-amber-300 text-amber-900 font-semibold"
                            : "bg-slate-50 border-slate-200 text-slate-700"
                        }`}
                      />
                      {newlyGeneratedKey && (
                        <span className="absolute right-3 top-2.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-200 text-amber-800 rounded">
                          Unmasked (Copy Now)
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => copyToClipboard(newlyGeneratedKey || apiKeyMasked, "key")}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all active:scale-95"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedKey ? "Copied" : "Copy Key"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowRotateModal(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-medium shadow-sm transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rotate Key
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Keep this key strictly confidential. Rotating your key will immediately invalidate the existing key.
                  </p>

                  {newlyGeneratedKey && (
                    <div className="mt-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start justify-between gap-3 text-xs text-amber-900 animate-in fade-in">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Important:</span> This unmasked key is revealed only once. Please copy and store it securely in your server environment variables now. For security reasons, it cannot be recovered after refreshing this page.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(newlyGeneratedKey, "key")}
                        className="shrink-0 px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 font-semibold rounded text-[11px] transition-colors"
                      >
                        {copiedKey ? "Copied" : "Copy Secret"}
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. Lead Assignment Dropdown */}
                <div className="pt-4 border-t border-slate-100">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Default Lead Assignee
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <select
                      value={assignedStaffId}
                      onChange={(e) => setAssignedStaffId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="unassigned">Unassigned (Leave in General Queue)</option>
                      {staffList.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name} ({staff.email})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      Eligible staff from your account. If the selected staff member becomes inactive or is removed, assignments will safely fall back to Unassigned.
                    </p>
                  </div>
                </div>

                {/* Developer Documentation Collapsible */}
                <div className="pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setCodeSampleOpen(!codeSampleOpen)}
                    className="flex items-center justify-between w-full py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    <span className="flex items-center gap-1.5">
                      <Code2 className="w-4 h-4" />
                      View Website Form Integration Code & Example Payload
                    </span>
                    {codeSampleOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {codeSampleOpen && (
                    <div className="mt-3 bg-slate-900 rounded-xl p-5 text-slate-200 text-xs font-mono space-y-4 shadow-lg border border-slate-800">
                      {/* Security Warning */}
                      <div className="bg-amber-950/70 border border-amber-800/80 rounded-lg p-3 text-amber-200 text-xs font-sans flex items-start gap-2.5">
                        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-amber-300">Security Rule:</strong> Always keep your integration secret on your server backend or environment variables. Never expose private API keys in public client-side browser JavaScript or unauthenticated frontend repos.
                        </div>
                      </div>

                      {/* Framework Tabs */}
                      <div className="flex items-center gap-1 border-b border-slate-800 pb-2 overflow-x-auto font-sans text-xs">
                        <button
                          type="button"
                          onClick={() => setActiveDocTab("wordpress")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            activeDocTab === "wordpress"
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          WordPress / PHP
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveDocTab("nextjs")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            activeDocTab === "nextjs"
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          Next.js / React
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveDocTab("laravel")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            activeDocTab === "laravel"
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          Laravel
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveDocTab("curl")}
                          className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                            activeDocTab === "curl"
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          }`}
                        >
                          cURL / REST
                        </button>
                      </div>

                      {/* Tab 1: WordPress */}
                      {activeDocTab === "wordpress" && (
                        <div className="space-y-2">
                          <div className="text-slate-400 font-sans text-[11px]">
                            Add to your child theme's <code className="text-amber-300">functions.php</code> or custom plugin (works with Contact Form 7, Elementor Pro, or Gravity Forms):
                          </div>
                          <pre className="text-emerald-400 bg-slate-950 p-3.5 rounded-lg overflow-x-auto leading-relaxed">{`// Hook into Contact Form 7 submission
add_action('wpcf7_mail_sent', function($contact_form) {
    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;
    $data = $submission->get_posted_data();

    $leadflow_url = '${webhookUrl || "http://localhost:5000/api/integrations/leads/website"}';
    $leadflow_key = '${newlyGeneratedKey || "lf_live_your_api_key_here"}'; // Store securely in wp-config.php
    $email = sanitize_email($data['your-email'] ?? '');

    // Optional HMAC verification token (if strict email verification is enabled)
    $timestamp = time() * 1000;
    $hmac = hash_hmac('sha256', "{$email}:{$timestamp}", $leadflow_key);

    wp_remote_post($leadflow_url, [
        'headers' => [
            'Content-Type' => 'application/json',
            'x-api-key'    => $leadflow_key,
        ],
        'body'    => wp_json_encode([
            'name'              => sanitize_text_field($data['your-name'] ?? ''),
            'email'             => $email,
            'phone'             => sanitize_text_field($data['your-phone'] ?? ''),
            'message'           => sanitize_textarea_field($data['your-message'] ?? ''),
            'formId'            => 'cf7_contact_form',
            'landingPage'       => esc_url($_SERVER['HTTP_REFERER'] ?? home_url()),
            'verificationToken' => "{$timestamp}:{$hmac}",
        ]),
        'timeout' => 10,
    ]);
});`}</pre>
                        </div>
                      )}

                      {/* Tab 2: Next.js / React */}
                      {activeDocTab === "nextjs" && (
                        <div className="space-y-2">
                          <div className="text-slate-400 font-sans text-[11px]">
                            Server-side API Route in <code className="text-amber-300">app/api/contact/route.js</code> (reads secret from private <code className="text-amber-300">.env</code>):
                          </div>
                          <pre className="text-sky-300 bg-slate-950 p-3.5 rounded-lg overflow-x-auto leading-relaxed">{`// app/api/contact/route.js (Server-side handler)
import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(request) {
  const body = await request.json();
  const apiKey = process.env.LEADFLOW_INTEGRATION_KEY; // Kept secure on server

  // Optional HMAC verification token (if strict email verification is enabled)
  const timestamp = Date.now();
  const signature = crypto.createHmac("sha256", apiKey)
    .update(\`\${body.email}:\${timestamp}\`)
    .digest("hex");

  const response = await fetch("${webhookUrl || "http://localhost:5000/api/integrations/leads/website"}", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      name: body.name,
      email: body.email,
      phone: body.phone,
      message: body.message,
      formId: "react_quote_form",
      landingPage: request.headers.get("referer") || "",
      verificationToken: \`\${timestamp}:\${signature}\`,
    }),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}`}</pre>
                        </div>
                      )}

                      {/* Tab 3: Laravel */}
                      {activeDocTab === "laravel" && (
                        <div className="space-y-2">
                          <div className="text-slate-400 font-sans text-[11px]">
                            Controller method in <code className="text-amber-300">app/Http/Controllers/ContactController.php</code>:
                          </div>
                          <pre className="text-purple-300 bg-slate-950 p-3.5 rounded-lg overflow-x-auto leading-relaxed">{`namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Http;

class ContactController extends Controller {
    public function submit(Request $request) {
        $validated = $request->validate([
            'name'  => 'required|string|max:100',
            'email' => 'required|email',
            'phone' => 'nullable|string',
            'notes' => 'nullable|string',
        ]);

        $apiKey = config('services.leadflow.api_key');
        $timestamp = (int)(microtime(true) * 1000);
        $hmac = hash_hmac('sha256', "{$validated['email']}:{$timestamp}", $apiKey);

        $response = Http::withHeaders([
            'x-api-key' => $apiKey,
        ])->post('${webhookUrl || "http://localhost:5000/api/integrations/leads/website"}', [
            'name'              => $validated['name'],
            'email'             => $validated['email'],
            'phone'             => $validated['phone'] ?? '',
            'message'           => $validated['notes'] ?? '',
            'formId'            => 'laravel_contact_form',
            'landingPage'       => $request->header('referer'),
            'verificationToken' => "{$timestamp}:{$hmac}",
        ]);

        return response()->json($response->json(), $response->status());
    }
}`}</pre>
                        </div>
                      )}

                      {/* Tab 4: cURL / Raw */}
                      {activeDocTab === "curl" && (
                        <div className="space-y-2">
                          <div className="text-slate-400 font-sans text-[11px]">Direct JSON Webhook Request:</div>
                          <pre className="text-emerald-400 bg-slate-950 p-3.5 rounded-lg overflow-x-auto leading-relaxed">{`curl -X POST ${webhookUrl || "http://localhost:5000/api/integrations/leads/website"} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${newlyGeneratedKey || "lf_live_your_api_key_here"}" \\
  -d '{
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": "+1 (555) 234-5678",
    "message": "Interested in enterprise CRM plan.",
    "formId": "contact_us_form",
    "landingPage": "https://yoursite.com/pricing"
  }'`}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section B: Accepted Forms */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-slate-900">Accepted Forms Restriction</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Specify which form IDs or form names are permitted to push leads. Enter one form identifier per line.
                </p>
              </div>
            </div>

            <div>
              <textarea
                rows={3}
                value={acceptedFormsText}
                onChange={(e) => setAcceptedFormsText(e.target.value)}
                placeholder="contact_us_form&#10;header_quote_form&#10;demo_request"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  <strong>Note:</strong> Leaving this box empty means <strong>ALL forms are accepted</strong>. If populated, submissions with unlisted form IDs will be rejected.
                </span>
              </div>
            </div>
          </div>

          {/* Section C: Email Verification Settings */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Email Verification & Inbound Gates</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure validation gates to ensure incoming leads contain authentic, deliverable contact information.
                </p>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              {/* Option 1: Only accept leads with verified email */}
              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={requireVerifiedEmail}
                  onChange={(e) => setRequireVerifiedEmail(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">Only accept leads with a verified email</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Submissions must include verified status or token. Unverified emails will be rejected by backend validation.
                  </div>
                </div>
              </label>

              {/* Option 2: Hold leads until confirmed */}
              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={holdUntilConfirmed}
                  onChange={(e) => setHoldUntilConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">Hold leads until the person confirms their email address</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Mark incoming leads as 'Pending Verification' (Engaged) until an email confirmation callback is completed.
                  </div>
                </div>
              </label>

              {/* Option 3: Strict verification */}
              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={strictVerification}
                  onChange={(e) => {
                    setStrictVerification(e.target.checked)
                    if (e.target.checked) setRequireVerifiedEmail(true)
                  }}
                  className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Strict verification: require trusted backend verification token / OTP
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Enforces cryptographic verification tokens or OTP confirmation. Rejects forged or unverified payloads.
                  </div>
                </div>
              </label>

              {/* Option 4: Allow leads with phone number but no email */}
              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={allowPhoneOnly}
                  onChange={(e) => setAllowPhoneOnly(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">Allow leads with a phone number but no email</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Permits click-to-call, SMS inquiry forms, and mobile leads without demanding an email address.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Section D: Blocked Email Domains */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Blocked Email Domains (Spam Gate)</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Automatically reject submissions originating from disposable, fake, or competitor email domains.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetBlockedDomains}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
              >
                Reset Defaults
              </button>
            </div>

            <div>
              <textarea
                rows={4}
                value={blockedDomainsText}
                onChange={(e) => setBlockedDomainsText(e.target.value)}
                placeholder="mailinator.com&#10;tempmail.com&#10;guerrillamail.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-2">
                One domain per line without '@' or 'http'. Exact domains and their subdomains will be blocked safely.
              </p>
            </div>
          </div>

          {/* Section E: Duplicate Handling Policy */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Duplicate Lead Handling</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  How should the CRM handle an incoming lead whose phone or email matches an existing lead in your account?
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {/* Option 1: Reject duplicates */}
              <label
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  duplicateHandling === "reject"
                    ? "border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600/20"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Recommended</span>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="reject"
                    checked={duplicateHandling === "reject"}
                    onChange={(e) => setDuplicateHandling(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <div className="text-sm font-semibold text-slate-900">Reject Duplicates</div>
                <div className="text-xs text-slate-500 mt-1">
                  Returns HTTP 409 Conflict. Prevents duplicate submissions from cluttering your CRM.
                </div>
              </label>

              {/* Option 2: Update existing */}
              <label
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  duplicateHandling === "update"
                    ? "border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600/20"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Merge Activity</span>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="update"
                    checked={duplicateHandling === "update"}
                    onChange={(e) => setDuplicateHandling(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <div className="text-sm font-semibold text-slate-900">Update Existing Lead</div>
                <div className="text-xs text-slate-500 mt-1">
                  Appends new inquiry notes and updates timestamp without overwriting existing staff assignments.
                </div>
              </label>

              {/* Option 3: Allow duplicates */}
              <label
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  duplicateHandling === "allow"
                    ? "border-indigo-600 bg-indigo-50/30 ring-1 ring-indigo-600/20"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Always Create</span>
                  <input
                    type="radio"
                    name="duplicatePolicy"
                    value="allow"
                    checked={duplicateHandling === "allow"}
                    onChange={(e) => setDuplicateHandling(e.target.value)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <div className="text-sm font-semibold text-slate-900">Allow All Duplicates</div>
                <div className="text-xs text-slate-500 mt-1">
                  Creates a new lead entry every time, even if the email or phone number matches an existing lead.
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Right 1 Column: Stats, Health, and Additional Sources */}
        <div className="space-y-6">
          {/* Feed Health & Activity Metrics */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Feed Health & Activity</h3>
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  enabled ? "bg-emerald-500 animate-ping" : "bg-slate-400"
                }`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 font-medium">Total Ingested</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{stats.totalReceived || 0}</div>
              </div>
              <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                <div className="text-xs text-emerald-700 font-medium">Successful</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">{stats.totalSuccess || 0}</div>
              </div>
              <div className="p-3 bg-rose-50/50 rounded-lg border border-rose-100">
                <div className="text-xs text-rose-700 font-medium">Errors / Blocked</div>
                <div className="text-xl font-bold text-rose-700 mt-1">{stats.totalErrors || 0}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 font-medium">Success Rate</div>
                <div className="text-xl font-bold text-slate-900 mt-1">
                  {stats.totalReceived > 0
                    ? `${Math.round((stats.totalSuccess / stats.totalReceived) * 100)}%`
                    : "100%"}
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-500 space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span>Last Lead Received:</span>
                <span className="font-medium text-slate-700">
                  {stats.lastReceivedAt ? new Date(stats.lastReceivedAt).toLocaleString() : "No leads yet"}
                </span>
              </div>
              {stats.lastErrorMessage && (
                <div className="p-2.5 bg-rose-50 rounded-lg border border-rose-100 text-rose-700">
                  <span className="font-semibold">Recent Event:</span> {stats.lastErrorMessage}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSendTestLead}
              disabled={testing || !enabled}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-100"
            >
              <Send className="w-3.5 h-3.5" />
              {testing ? "Running Test..." : "Send Test Submission"}
            </button>
          </div>

          {/* Section G: Additional Lead Sources (Coming Soon) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Additional Channels</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Integrate external ad networks and CMS platforms directly into your pipeline.
              </p>
            </div>

            <div className="space-y-3">
              {/* WordPress */}
              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100/70 text-blue-700 flex items-center justify-center text-xs font-bold">
                    WP
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">WordPress / Elementor</div>
                    <div className="text-[11px] text-slate-400">Direct plugin sync</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                  Coming Soon
                </span>
              </div>

              {/* Meta Lead Ads */}
              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100/70 text-indigo-700 flex items-center justify-center text-xs font-bold">
                    f
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Meta Lead Ads</div>
                    <div className="text-[11px] text-slate-400">Facebook & Instagram</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                  Coming Soon
                </span>
              </div>

              {/* Google Lead Forms */}
              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-100/70 text-amber-700 flex items-center justify-center text-xs font-bold">
                    G
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Google Lead Forms</div>
                    <div className="text-[11px] text-slate-400">Search & YouTube Ads</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                  Coming Soon
                </span>
              </div>

              {/* Zapier / Make */}
              <div className="p-3.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-orange-100/70 text-orange-700 flex items-center justify-center text-xs font-bold">
                    Z
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Zapier / Make Stream</div>
                    <div className="text-[11px] text-slate-400">5,000+ app connectors</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-600 rounded">
                  Coming Soon
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rotate Key Confirmation Modal */}
      {showRotateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">Rotate Integration API Key?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Rotating this API key will <strong>immediately revoke and invalidate the previous key</strong>. Any external website forms or webhooks using the old key will stop receiving leads until updated.
              </p>
            </div>

            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
              This action is atomic and irreversible. Make sure you are prepared to update your website configuration with the new key.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRotateModal(false)}
                disabled={rotating}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async () => {
                  await handleRotateKey()
                  setShowRotateModal(false)
                }}
                disabled={rotating}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {rotating ? <RefreshCw className="w-4 h-4 animate-spin text-white" /> : null}
                Yes, Rotate Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Lead Results Modal */}
      {showTestResultModal && testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Diagnostic Test Result</h3>
                  <p className="text-xs text-slate-500">Pipeline verification passed</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTestResultModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Integration Status:</span>
                <span className="font-semibold text-emerald-700">Online & Enabled</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Assigned Staff Target:</span>
                <span className="font-semibold text-slate-800">{testResult.validationResults?.assignedStaff}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Form Rule Check:</span>
                <span className="font-semibold text-emerald-700">Accepted</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Domain Spam Filter:</span>
                <span className="font-semibold text-emerald-700">Passed</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Duplicate Handling Rule:</span>
                <span className="font-semibold text-slate-800 capitalize">
                  {testResult.validationResults?.duplicateHandling}
                </span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-800">
              <strong>Notice:</strong> This diagnostic test validated your webhook settings without polluting your production CRM database with fake test leads.
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowTestResultModal(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
