"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  PhoneCall,
  Bot,
  Shield,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Save,
  Lock,
  Key,
  Globe,
  Sliders,
  PhoneForwarded,
  Mic,
  Clock,
  Sparkles,
  Server,
  UserCheck,
  Eye,
  EyeOff,
  Trash2,
  Info,
  HelpCircle,
} from "lucide-react"

const PROVIDER_OPTIONS = [
  {
    id: "mock",
    name: "Mock Telephony (Free Local Testing)",
    badge: "Free / Local",
    desc: "Deterministic synthetic audio testing harness. No third-party accounts, numbers, or credit card required.",
  },
  {
    id: "twilio",
    name: "Twilio (Programmable Voice)",
    badge: "Cloud Carrier",
    desc: "Global bidirectional media streaming, virtual numbers, and dual-track cloud recording via Twilio Voice.",
  },
  {
    id: "exotel",
    name: "Exotel (India Cloud Telephony)",
    badge: "India Carrier",
    desc: "Direct Indian virtual numbers, Applets, and enterprise SIP trunks compliant with DoT guidelines.",
  },
  {
    id: "airtel_iq",
    name: "Airtel IQ (Enterprise Voice)",
    badge: "Telco Direct",
    desc: "Direct telco-grade carrier SIP trunking and cloud voice routing for Indian enterprises.",
  },
  {
    id: "sip",
    name: "SIP PBX / Private IP-Trunk",
    badge: "Private PBX",
    desc: "Connect to Asterisk, FreePBX, Cisco, or any on-premise IP-PBX via SIP URI.",
  },
]

const CONNECTION_MODES = [
  {
    id: "sim_forwarding",
    label: "Existing Business SIM (Conditional Call Forwarding)",
    desc: "Customers keep calling your existing business number. When unanswered by staff, carrier forwards call to AI receptionist.",
  },
  {
    id: "cloud_number",
    label: "Dedicated Cloud Virtual Number",
    desc: "Customers dial a carrier-assigned virtual number directly; AI receptionist answers immediately or routes to staff.",
  },
  {
    id: "sip_pbx",
    label: "SIP PBX Trunk / Auto-Attendant",
    desc: "Integrated with your office PBX ring-group or IVR queue via SIP endpoint.",
  },
]

const LANGUAGE_OPTIONS = [
  { id: "hinglish", label: "Hinglish (Hindi + English Natural Mix — Recommended for India)" },
  { id: "hindi", label: "Hindi (हिंदी)" },
  { id: "english", label: "English" },
  { id: "both", label: "Bilingual (Auto-detect Hindi / English)" },
]

export default function AIReceptionistClient() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Core Configuration State
  const [config, setConfig] = useState({
    provider: "mock",
    connectionMode: "sim_forwarding",
    businessPhoneNumber: "",
    virtualNumber: "",
    answerMode: "unanswered_only",
    noAnswerTimeoutSeconds: 20,
    aiEnabled: false,
    aiLanguage: "hinglish",
    aiGreeting: "Namaste, thank you for calling. How can I help you today?",
    humanHandoverNumber: "",
    recordingEnabled: true,
    status: "unconfigured",
    credentialsConfigured: false,
    credentialsLastUpdated: null,
    credentialsMasked: {},
  })

  // Credential Input State (for entering / rotating secrets)
  const [showCredentialInputs, setShowCredentialInputs] = useState(false)
  const [showSecrets, setShowSecrets] = useState(false)
  const [credentialInputs, setCredentialInputs] = useState({
    // Twilio
    accountSid: "",
    authToken: "",
    apiKey: "",
    apiSecret: "",
    twilioAppSid: "",
    // Exotel
    apiToken: "",
    subAccount: "",
    // Airtel IQ
    customerId: "",
    // SIP
    sipServer: "",
    port: "5060",
    username: "",
    password: "",
    // Mock
    mockApiKey: "",
  })

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiClient.getTelephonyConfig()
      if (res && res.success && res.data) {
        setConfig((prev) => ({
          ...prev,
          ...res.data,
        }))
      }
    } catch (err) {
      toast.error(err.message || "Failed to load telephony configuration")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async (e) => {
    e.preventDefault()

    if (config.noAnswerTimeoutSeconds < 10 || config.noAnswerTimeoutSeconds > 60) {
      toast.error("No-answer timeout must be between 10 and 60 seconds")
      return
    }

    try {
      setSaving(true)

      const payload = {
        provider: config.provider,
        connectionMode: config.connectionMode,
        businessPhoneNumber: config.businessPhoneNumber.trim(),
        virtualNumber: config.virtualNumber.trim(),
        answerMode: config.answerMode,
        noAnswerTimeoutSeconds: Number(config.noAnswerTimeoutSeconds),
        aiEnabled: config.aiEnabled,
        aiLanguage: config.aiLanguage,
        aiGreeting: config.aiGreeting.trim(),
        humanHandoverNumber: config.humanHandoverNumber.trim(),
        recordingEnabled: config.recordingEnabled,
        status: config.status === "unconfigured" && config.businessPhoneNumber ? "active" : config.status,
      }

      // Check if user is rotating/setting credentials
      if (showCredentialInputs) {
        const credsToSubmit = {}
        if (config.provider === "twilio") {
          if (credentialInputs.accountSid) credsToSubmit.accountSid = credentialInputs.accountSid.trim()
          if (credentialInputs.authToken) credsToSubmit.authToken = credentialInputs.authToken.trim()
          if (credentialInputs.apiKey) credsToSubmit.apiKey = credentialInputs.apiKey.trim()
          if (credentialInputs.apiSecret) credsToSubmit.apiSecret = credentialInputs.apiSecret.trim()
          if (credentialInputs.twilioAppSid) credsToSubmit.twilioAppSid = credentialInputs.twilioAppSid.trim()
        } else if (config.provider === "exotel") {
          if (credentialInputs.apiKey) credsToSubmit.apiKey = credentialInputs.apiKey.trim()
          if (credentialInputs.apiToken) credsToSubmit.apiToken = credentialInputs.apiToken.trim()
          if (credentialInputs.accountSid) credsToSubmit.accountSid = credentialInputs.accountSid.trim()
          if (credentialInputs.subAccount) credsToSubmit.subAccount = credentialInputs.subAccount.trim()
        } else if (config.provider === "airtel_iq") {
          if (credentialInputs.customerId) credsToSubmit.customerId = credentialInputs.customerId.trim()
          if (credentialInputs.apiKey) credsToSubmit.apiKey = credentialInputs.apiKey.trim()
          if (credentialInputs.apiSecret) credsToSubmit.apiSecret = credentialInputs.apiSecret.trim()
        } else if (config.provider === "sip") {
          if (credentialInputs.sipServer) credsToSubmit.sipServer = credentialInputs.sipServer.trim()
          if (credentialInputs.port) credsToSubmit.port = Number(credentialInputs.port)
          if (credentialInputs.username) credsToSubmit.username = credentialInputs.username.trim()
          if (credentialInputs.password) credsToSubmit.password = credentialInputs.password.trim()
        } else if (config.provider === "mock") {
          if (credentialInputs.mockApiKey) credsToSubmit.mockApiKey = credentialInputs.mockApiKey.trim()
        }

        if (Object.keys(credsToSubmit).length > 0) {
          payload.credentials = credsToSubmit
        }
      }

      const res = await apiClient.updateTelephonyConfig(payload)

      if (res && res.success && res.data) {
        toast.success(res.message || "Telephony settings saved successfully")
        setConfig(res.data)
        setShowCredentialInputs(false)
        setCredentialInputs({
          accountSid: "",
          authToken: "",
          apiKey: "",
          apiSecret: "",
          twilioAppSid: "",
          apiToken: "",
          subAccount: "",
          customerId: "",
          sipServer: "",
          port: "5060",
          username: "",
          password: "",
          mockApiKey: "",
        })
      } else {
        toast.error(res?.error || "Failed to save settings")
      }
    } catch (err) {
      toast.error(err.message || "Failed to save telephony configuration")
    } finally {
      setSaving(false)
    }
  }

  const handleClearCredentials = async () => {
    if (!confirm("Are you sure you want to clear stored provider credentials? Inbound calls will not route until reconfigured.")) {
      return
    }

    try {
      setSaving(true)
      const res = await apiClient.updateTelephonyConfig({ clearCredentials: true })
      if (res && res.success && res.data) {
        toast.success("Credentials cleared successfully")
        setConfig(res.data)
        setShowCredentialInputs(false)
      }
    } catch (err) {
      toast.error(err.message || "Failed to clear credentials")
    } finally {
      setSaving(false)
    }
  }

  // Derive Truthful State Badges
  const isUnconfigured = config.status === "unconfigured" || !config.businessPhoneNumber
  const isMock = config.provider === "mock"
  const needsCredentials = !isMock && !config.credentialsConfigured
  const isAiDisabled = !config.aiEnabled
  const isConfiguredAndActive = !needsCredentials && config.aiEnabled && config.status === "active"

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                AI Incoming Call Receptionist & Telephony
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Multi-tenant cloud telephony routing, call forwarding, encrypted credentials, and bilingual AI answering
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchConfig}
            disabled={loading}
            className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            title="Refresh configuration"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>

      {/* Truthful Status Banner */}
      <div className="space-y-3">
        {isUnconfigured && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3.5 text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <span className="font-semibold">Status: Not Configured. </span>
              Enter your business phone number and select a telephony provider below to begin.
            </div>
          </div>
        )}

        {needsCredentials && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-3.5 text-rose-900 dark:text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <span className="font-semibold">Status: Provider Credentials Required. </span>
              You have selected <strong>{config.provider.toUpperCase()}</strong>, but credentials are not yet configured.
              Click <strong>&quot;Configure / Rotate Credentials&quot;</strong> below to enter your API credentials.
            </div>
          </div>
        )}

        {isAiDisabled && (
          <div className="p-4 bg-slate-500/10 border border-slate-500/20 rounded-2xl flex items-start gap-3.5 text-slate-800 dark:text-slate-300">
            <Info className="w-5 h-5 text-slate-600 dark:text-slate-400 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <span className="font-semibold">Status: AI Receptionist Disabled. </span>
              All incoming calls will ring human agents only. Enable AI Receptionist below when you are ready to allow the AI to answer unanswered calls.
            </div>
          </div>
        )}

        {isConfiguredAndActive && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3.5 text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <span className="font-semibold">Status: Configuration Active &amp; Saved. </span>
              Telephony settings are configured with AES-256-GCM encryption. Unanswered calls after {config.noAnswerTimeoutSeconds}s will be answered by AI in {config.aiLanguage.toUpperCase()}.
            </div>
          </div>
        )}
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: AI Answering & Routing Activation */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  1. AI Answering &amp; Call Routing
                </h2>
                <p className="text-xs text-slate-500">
                  Control how and when the AI Receptionist intercepts incoming business calls
                </p>
              </div>
            </div>

            {/* AI Toggle Switch */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {config.aiEnabled ? "AI Active" : "AI Inactive"}
              </span>
              <button
                type="button"
                onClick={() => setConfig({ ...config, aiEnabled: !config.aiEnabled })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  config.aiEnabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    config.aiEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Answer Mode */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Answer Mode
              </label>
              <select
                value={config.answerMode}
                disabled
                className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 text-sm cursor-not-allowed"
              >
                <option value="unanswered_only">Unanswered Only (Rings Staff First, AI Answers if Missed)</option>
              </select>
              <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                Staff always receives normal incoming call first. Normal calling flow is never bypassed.
              </p>
            </div>

            {/* No Answer Timeout */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                No-Answer Timeout ({config.noAnswerTimeoutSeconds} seconds)
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="5"
                  value={config.noAnswerTimeoutSeconds}
                  onChange={(e) => setConfig({ ...config, noAnswerTimeoutSeconds: Number(e.target.value) })}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="w-12 text-center text-sm font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                  {config.noAnswerTimeoutSeconds}s
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Ringing duration before call is forwarded to AI Receptionist (Recommended: 20-25s).
              </p>
            </div>

            {/* Human Handover Number */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Human Handover / Escalation Number
              </label>
              <input
                type="text"
                value={config.humanHandoverNumber}
                onChange={(e) => setConfig({ ...config, humanHandoverNumber: e.target.value })}
                placeholder="e.g. +919876543210"
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                If the customer insists on speaking to a human, AI transfers the live call to this number.
              </p>
            </div>

            {/* Recording Enabled Switch */}
            <div className="flex flex-col justify-center">
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Mic className="w-4 h-4 text-indigo-500" />
                    Cloud Recording
                  </div>
                  <div className="text-xs text-slate-500">Record caller + AI receptionist audio to CRM</div>
                </div>
                <input
                  type="checkbox"
                  checked={config.recordingEnabled}
                  onChange={(e) => setConfig({ ...config, recordingEnabled: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Telephony Provider & Numbers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="p-2 bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 rounded-lg">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                2. Telephony Provider &amp; Connection Setup
              </h2>
              <p className="text-xs text-slate-500">
                Multi-tenant telephony carrier abstraction and phone number routing
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Provider Grid */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Telephony Provider Selection
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {PROVIDER_OPTIONS.map((p) => {
                  const isSelected = config.provider === p.id
                  return (
                    <div
                      key={p.id}
                      onClick={() => setConfig({ ...config, provider: p.id })}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">{p.name}</span>
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              p.id === "mock"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {p.badge}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">{p.desc}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Connection Mode */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Connection Mode
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {CONNECTION_MODES.map((mode) => {
                  const isSelected = config.connectionMode === mode.id
                  return (
                    <div
                      key={mode.id}
                      onClick={() => setConfig({ ...config, connectionMode: mode.id })}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition ${
                        isSelected
                          ? "border-sky-600 bg-sky-50/50 dark:bg-sky-950/20"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950"
                      }`}
                    >
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{mode.label}</div>
                      <p className="text-xs text-slate-500 mt-1 leading-normal">{mode.desc}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Phone Numbers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Existing Business Phone Number (Customer Facing)
                </label>
                <input
                  type="text"
                  value={config.businessPhoneNumber}
                  onChange={(e) => setConfig({ ...config, businessPhoneNumber: e.target.value })}
                  placeholder="e.g. +919876543210"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  The primary phone number published in marketing campaigns or Google Business profile.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Provider Virtual / Cloud Number (Forwarding Destination)
                </label>
                <input
                  type="text"
                  value={config.virtualNumber}
                  onChange={(e) => setConfig({ ...config, virtualNumber: e.target.value })}
                  placeholder="e.g. +15551234567 or 08045678901"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  Target number assigned by your telephony provider where calls forward when unanswered.
                </p>
              </div>
            </div>

            {/* Carrier Dialing Helper */}
            {config.connectionMode === "sim_forwarding" && config.virtualNumber && (
              <div className="p-3.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl flex items-center justify-between text-xs text-indigo-900 dark:text-indigo-200">
                <div className="flex items-center gap-2">
                  <PhoneForwarded className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>
                    To activate on your physical SIM, dial from your phone:{" "}
                    <code className="font-mono font-bold bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-indigo-300 dark:border-indigo-700">
                      *61*{config.virtualNumber}*{config.noAnswerTimeoutSeconds}#
                    </code>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: AI Language & Greeting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                3. AI Language &amp; Initial Greeting
              </h2>
              <p className="text-xs text-slate-500">
                Configure voice personality, spoken language, and initial greeting for callers
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                AI Conversation Language
              </label>
              <select
                value={config.aiLanguage}
                onChange={(e) => setConfig({ ...config, aiLanguage: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1.5">
                Indian businesses usually perform best with Hinglish, allowing smooth bilingual code-switching.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                AI Initial Greeting Script
              </label>
              <textarea
                rows={3}
                value={config.aiGreeting}
                onChange={(e) => setConfig({ ...config, aiGreeting: e.target.value })}
                placeholder="Namaste, thank you for calling. How can I help you today?"
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Spoken aloud immediately when AI answers the call. Keep concise and professional.
              </p>
            </div>
          </div>
        </div>

        {/* Section 4: Secure Provider Credentials (AES-256-GCM) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-lg">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  4. Telephony Provider Credentials (AES-256-GCM Encrypted)
                </h2>
                <p className="text-xs text-slate-500">
                  Carrier auth tokens and API secrets are encrypted at rest; never exposed in plain text
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {config.credentialsConfigured && (
                <button
                  type="button"
                  onClick={handleClearCredentials}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Credentials
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCredentialInputs(!showCredentialInputs)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg transition"
              >
                <Key className="w-3.5 h-3.5" />
                {showCredentialInputs ? "Hide Inputs" : "Configure / Rotate Credentials"}
              </button>
            </div>
          </div>

          {/* Current Credential Status */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className={`w-5 h-5 ${
                    config.credentialsConfigured ? "text-emerald-500" : "text-slate-400"
                  }`}
                />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  {config.credentialsConfigured
                    ? "Credentials Configured & Stored Securely"
                    : "No Provider Credentials Configured"}
                </span>
              </div>
              {config.credentialsLastUpdated && (
                <span className="text-xs text-slate-500">
                  Last updated: {new Date(config.credentialsLastUpdated).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Display Masked Fields */}
            {config.credentialsConfigured && config.credentialsMasked && Object.keys(config.credentialsMasked).length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                {Object.entries(config.credentialsMasked).map(([key, val]) => (
                  <div key={key} className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                      {key}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Credential Inputs Panel */}
          {showCredentialInputs && (
            <div className="p-5 border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/20 dark:bg-indigo-950/10 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                  Update {config.provider.toUpperCase()} Credentials
                </span>
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showSecrets ? "Mask Secrets" : "Reveal Plaintext"}
                </button>
              </div>

              {/* Twilio Inputs */}
              {config.provider === "twilio" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Twilio Account SID (e.g. AC...)
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.accountSid}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, accountSid: e.target.value })}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Twilio Auth Token
                    </label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={credentialInputs.authToken}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, authToken: e.target.value })}
                      placeholder="Enter Auth Token"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      API Key SID (Optional)
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.apiKey}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiKey: e.target.value })}
                      placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      API Key Secret (Optional)
                    </label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={credentialInputs.apiSecret}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiSecret: e.target.value })}
                      placeholder="Enter API Secret"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Exotel Inputs */}
              {config.provider === "exotel" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Exotel API Key
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.apiKey}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiKey: e.target.value })}
                      placeholder="Enter Exotel API Key"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Exotel API Token
                    </label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={credentialInputs.apiToken}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiToken: e.target.value })}
                      placeholder="Enter Exotel API Token"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Exotel Account SID
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.accountSid}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, accountSid: e.target.value })}
                      placeholder="e.g. leads365"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Airtel IQ Inputs */}
              {config.provider === "airtel_iq" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Customer ID / Account ID
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.customerId}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, customerId: e.target.value })}
                      placeholder="Enter Airtel Customer ID"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Airtel API Key
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.apiKey}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiKey: e.target.value })}
                      placeholder="Enter Airtel API Key"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Airtel API Secret
                    </label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={credentialInputs.apiSecret}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, apiSecret: e.target.value })}
                      placeholder="Enter Airtel API Secret"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* SIP PBX Inputs */}
              {config.provider === "sip" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SIP Server / Domain
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.sipServer}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, sipServer: e.target.value })}
                      placeholder="sip.mycompany.com"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SIP Port
                    </label>
                    <input
                      type="number"
                      value={credentialInputs.port}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, port: e.target.value })}
                      placeholder="5060"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SIP Username / Extension
                    </label>
                    <input
                      type="text"
                      value={credentialInputs.username}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, username: e.target.value })}
                      placeholder="1001"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SIP Secret / Password
                    </label>
                    <input
                      type={showSecrets ? "text" : "password"}
                      value={credentialInputs.password}
                      onChange={(e) => setCredentialInputs({ ...credentialInputs, password: e.target.value })}
                      placeholder="Enter SIP Password"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Mock Telephony Inputs */}
              {config.provider === "mock" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Mock Test Key (Optional)
                  </label>
                  <input
                    type="text"
                    value={credentialInputs.mockApiKey}
                    onChange={(e) => setCredentialInputs({ ...credentialInputs, mockApiKey: e.target.value })}
                    placeholder="mock_free_test_key"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Mock telephony requires no live account. You can leave this blank or input a local test key.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={fetchConfig}
            disabled={loading}
            className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-sm rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Reset Changes
          </button>
          <button
            type="submit"
            disabled={saving || loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-sm transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving Settings..." : "Save Telephony Configuration"}
          </button>
        </div>
      </form>
    </div>
  )
}

