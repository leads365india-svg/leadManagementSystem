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
  Share2,
  Briefcase,
  Play,
  RotateCw,
  Activity,
  LayoutGrid,
  ArrowUpRight,
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
  // Active Integration Navigation Tab (Phase 26: Integration Studio Overview is default)
  const [activeTab, setActiveTab] = useState("overview") // "overview" | "website" | "indiamart" | "meta" | "google" | "generic" | "events"

  // Loading & Action states for Website
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rotating, setRotating] = useState(false)

  // Configuration state for Website
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

  // Email verification settings for Website
  const [requireVerifiedEmail, setRequireVerifiedEmail] = useState(false)
  const [holdUntilConfirmed, setHoldUntilConfirmed] = useState(false)
  const [strictVerification, setStrictVerification] = useState(false)
  const [allowPhoneOnly, setAllowPhoneOnly] = useState(true)

  // Website UI modals & accordion state
  const [websiteCardOpen, setWebsiteCardOpen] = useState(true)
  const [codeSampleOpen, setCodeSampleOpen] = useState(false)
  const [showRotateModal, setShowRotateModal] = useState(false)
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState(null)
  const [showTestResultModal, setShowTestResultModal] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [activeDocTab, setActiveDocTab] = useState("wordpress")

  // Phase 22: Website Snippet, Allowed Origins & Attribution State
  const [siteKey, setSiteKey] = useState("")
  const [snippetUrl, setSnippetUrl] = useState("")
  const [allowedOrigins, setAllowedOrigins] = useState([])
  const [newOrigin, setNewOrigin] = useState("")
  const [originError, setOriginError] = useState("")
  const [copiedSiteKey, setCopiedSiteKey] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const [rotatingSiteKey, setRotatingSiteKey] = useState(false)
  const [showRotateSiteKeyModal, setShowRotateSiteKeyModal] = useState(false)

  // ==========================================
  // IndiaMART Integration State (Phase 13)
  // ==========================================
  const [indiamartData, setIndiamartData] = useState({
    configured: false,
    status: "disconnected",
    reconnectNeeded: false,
    integration: null,
  })
  const [loadingIndiaMart, setLoadingIndiaMart] = useState(false)
  const [syncingIndiaMart, setSyncingIndiaMart] = useState(false)
  const [showIndiaMartModal, setShowIndiaMartModal] = useState(false)
  const [connectingIndiaMart, setConnectingIndiaMart] = useState(false)
  const [indiaMartForm, setIndiaMartForm] = useState({
    crmKey: "",
    mobileNumber: "",
    name: "IndiaMART Lead Manager",
    assignedStaffId: "unassigned",
  })

  // ==========================================
  // Meta Lead Ads Integration State (Phase 12)
  // ==========================================
  const [metaData, setMetaData] = useState({
    configured: false,
    integration: null,
  })
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [reconcilingMeta, setReconcilingMeta] = useState(false)
  const [showMetaModal, setShowMetaModal] = useState(false)
  const [connectingMeta, setConnectingMeta] = useState(false)
  const [metaForm, setMetaForm] = useState({
    pageId: "",
    pageName: "",
    pageAccessToken: "",
    appSecret: "",
    duplicateHandling: "update",
    assignedStaffId: "unassigned",
  })
  const [backfillDays, setBackfillDays] = useState(7)

  // ==========================================
  // Google Lead Forms Integration State (Phase 23)
  // ==========================================
  const [googleData, setGoogleData] = useState({
    configured: false,
    status: "disconnected",
    integration: null,
    googleSource: {},
    webhookUrl: "",
    googleKeyMasked: "",
    googleKeyLastRotatedAt: null,
    stats: {},
  })
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [savingGoogle, setSavingGoogle] = useState(false)
  const [testingGoogle, setTestingGoogle] = useState(false)
  const [rotatingGoogleKey, setRotatingGoogleKey] = useState(false)
  const [showGoogleModal, setShowGoogleModal] = useState(false)
  const [showRotateGoogleModal, setShowRotateGoogleModal] = useState(false)
  const [newlyGeneratedGoogleKey, setNewlyGeneratedGoogleKey] = useState(null)
  const [copiedGoogleKey, setCopiedGoogleKey] = useState(false)
  const [copiedGoogleUrl, setCopiedGoogleUrl] = useState(false)
  const [googleForm, setGoogleForm] = useState({
    name: "Google Ads Lead Form",
    assignedStaffId: "unassigned",
    duplicateHandling: "update",
  })

  // ==========================================
  // Generic Connector State (Phase 24: Zapier, Make, n8n)
  // ==========================================
  const [genericData, setGenericData] = useState({
    configured: false,
    status: "active",
    integration: null,
    webhookUrl: "",
    apiKeyMasked: "",
    apiKeyLastRotatedAt: null,
    duplicateHandling: "update",
    assignedStaffId: "unassigned",
    assignedStaffName: "Unassigned",
    stats: {},
  })
  const [loadingGeneric, setLoadingGeneric] = useState(false)
  const [savingGeneric, setSavingGeneric] = useState(false)
  const [testingGeneric, setTestingGeneric] = useState(false)
  const [rotatingGenericKey, setRotatingGenericKey] = useState(false)
  const [showGenericModal, setShowGenericModal] = useState(false)
  const [showRotateGenericModal, setShowRotateGenericModal] = useState(false)
  const [newlyGeneratedGenericKey, setNewlyGeneratedGenericKey] = useState(null)
  const [copiedGenericKey, setCopiedGenericKey] = useState(false)
  const [copiedGenericUrl, setCopiedGenericUrl] = useState(false)
  const [activeGenericRecipeTab, setActiveGenericRecipeTab] = useState("zapier")
  const [genericForm, setGenericForm] = useState({
    assignedStaffId: "unassigned",
    duplicateHandling: "update",
    status: "active",
  })

  // ==========================================
  // Integration Events Ledger State (Phase 11 / Phase 26)
  // ==========================================
  const [events, setEvents] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [replayingEventId, setReplayingEventId] = useState(null)
  const [eventSourceFilter, setEventSourceFilter] = useState("all")
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [copiedEventPayload, setCopiedEventPayload] = useState(false)

  // Load Website settings on mount
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
        setSnippetUrl(res.data.snippetUrl || (url ? url.replace(/\/leads\/website$/, "/snippet.js") : ""))
        setSiteKey(ws.siteKey || "")
        setAllowedOrigins(Array.isArray(ws.allowedOrigins) ? ws.allowedOrigins : [])
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

  // Load IndiaMART Status
  const loadIndiaMartStatus = useCallback(async () => {
    try {
      setLoadingIndiaMart(true)
      const res = await apiClient.getIndiaMartStatus()
      if (res && res.success) {
        setIndiamartData({
          configured: Boolean(res.configured),
          status: res.status || (res.configured ? "active" : "disconnected"),
          reconnectNeeded: Boolean(res.reconnectNeeded),
          integration: res.integration || null,
        })
      }
    } catch (err) {
      console.error("Failed to load IndiaMART status:", err)
    } finally {
      setLoadingIndiaMart(false)
    }
  }, [])

  // Load Meta Status
  const loadMetaStatus = useCallback(async () => {
    try {
      setLoadingMeta(true)
      const res = await apiClient.getMetaStatus()
      if (res && res.success) {
        setMetaData({
          configured: Boolean(res.configured),
          integration: res.integration || null,
        })
      }
    } catch (err) {
      console.error("Failed to load Meta status:", err)
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  // Load Events Ledger
  const loadEvents = useCallback(async () => {
    try {
      setLoadingEvents(true)
      const query = { limit: 25 }
      if (eventSourceFilter !== "all") query.source = eventSourceFilter
      const res = await apiClient.getIntegrationEvents(query)
      if (res && res.success) {
        setEvents(res.data || [])
      }
    } catch (err) {
      console.error("Failed to load integration events:", err)
    } finally {
      setLoadingEvents(false)
    }
  }, [eventSourceFilter])

  // Load Google Ads Status (Phase 23)
  const loadGoogleStatus = useCallback(async () => {
    try {
      setLoadingGoogle(true)
      const res = await apiClient.getGoogleAdsStatus()
      if (res && res.success) {
        setGoogleData({
          configured: Boolean(res.configured),
          status: res.status || (res.configured ? "active" : "disconnected"),
          integration: res.integration || null,
          googleSource: res.googleSource || {},
          webhookUrl: res.webhookUrl || "",
          googleKeyMasked: res.googleKeyMasked || "",
          googleKeyLastRotatedAt: res.googleKeyLastRotatedAt || null,
          stats: res.stats || {},
        })
        if (res.staff && res.staff.length > 0 && staffList.length === 0) {
          setStaffList(res.staff)
        }
        if (res.googleSource) {
          setGoogleForm((prev) => ({
            ...prev,
            assignedStaffId: res.googleSource.assignedStaffId || "unassigned",
            duplicateHandling: res.googleSource.duplicateHandling || "update",
          }))
        }
      }
    } catch (err) {
      console.error("Failed to load Google Ads status:", err)
    } finally {
      setLoadingGoogle(false)
    }
  }, [staffList.length])

  // Load Generic Connector Status (Phase 24)
  const loadGenericStatus = useCallback(async () => {
    try {
      setLoadingGeneric(true)
      const res = await apiClient.getGenericConnectorStatus()
      if (res && res.success) {
        const intg = res.integration || {}
        setGenericData({
          configured: Boolean(res.configured),
          status: intg.status || "active",
          integration: intg,
          webhookUrl: res.webhookUrl || "",
          apiKeyMasked: intg.apiKeyMasked || "",
          apiKeyLastRotatedAt: intg.apiKeyLastRotatedAt || null,
          duplicateHandling: intg.duplicateHandling || "update",
          assignedStaffId: intg.assignedStaffId || "unassigned",
          assignedStaffName: intg.assignedStaffName || "Unassigned",
          stats: intg.stats || {},
        })
        if (res.rawKeyOnce) {
          setNewlyGeneratedGenericKey(res.rawKeyOnce)
        }
        setGenericForm({
          assignedStaffId: intg.assignedStaffId || "unassigned",
          duplicateHandling: intg.duplicateHandling || "update",
          status: intg.status || "active",
        })
      }
    } catch (err) {
      console.error("Failed to load Generic Connector status:", err)
    } finally {
      setLoadingGeneric(false)
    }
  }, [])

  // Phase 11 & Phase 26: Handle Replay Integration Event
  const handleReplayEvent = async (id) => {
    try {
      setReplayingEventId(id)
      const res = await apiClient.replayIntegrationEvent(id)
      if (res && res.success) {
        toast.success(res.message || "Event replayed successfully!")
        loadEvents()
      } else {
        toast.error(res?.error || "Failed to replay event")
      }
    } catch (err) {
      toast.error(err.message || "Failed to replay event")
    } finally {
      setReplayingEventId(null)
    }
  }

  // Phase 26/27: Load all statuses for Integration Studio Overview (optimized, no redundant requests)
  const loadAllStatuses = useCallback(async (showToast = false) => {
    try {
      setRefreshingAll(true)
      await Promise.allSettled([
        loadSettings(),
        loadIndiaMartStatus(),
        loadMetaStatus(),
        loadGoogleStatus(),
        loadGenericStatus(),
        loadEvents(),
      ])
      if (showToast) {
        toast.success("Integration feeds refreshed!")
      }
    } catch (err) {
      console.error("Failed to refresh Integration Studio:", err)
      if (showToast) {
        toast.error("Failed to refresh feeds")
      }
    } finally {
      setRefreshingAll(false)
    }
  }, [loadSettings, loadIndiaMartStatus, loadMetaStatus, loadGoogleStatus, loadGenericStatus, loadEvents])

  useEffect(() => {
    if (activeTab === "overview") {
      loadAllStatuses(false)
    } else if (activeTab === "website") {
      loadSettings()
    } else if (activeTab === "indiamart") {
      loadIndiaMartStatus()
    } else if (activeTab === "meta") {
      loadMetaStatus()
    } else if (activeTab === "google") {
      loadGoogleStatus()
    } else if (activeTab === "generic") {
      loadGenericStatus()
    } else if (activeTab === "events") {
      loadEvents()
    }
  }, [activeTab, loadAllStatuses, loadSettings, loadIndiaMartStatus, loadMetaStatus, loadGoogleStatus, loadGenericStatus, loadEvents])

  // Save Website changes
  const handleSaveWebsite = async () => {
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
        allowedOrigins,
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
        toast.success("Website Lead Feed configuration saved successfully!")
        if (res.data?.websiteSource) {
          setAssignedStaffName(res.data.websiteSource.assignedStaffName)
          if (Array.isArray(res.data.websiteSource.allowedOrigins)) {
            setAllowedOrigins(res.data.websiteSource.allowedOrigins)
          }
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

  // Add Allowed Origin (Phase 22)
  const handleAddOrigin = () => {
    if (!newOrigin) return
    const trimmed = newOrigin.trim().toLowerCase()
    if (!/^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(trimmed)) {
      setOriginError("Origin must include http:// or https:// and a valid hostname (e.g. https://example.com or https://*.example.com)")
      return
    }
    const parts = trimmed.replace(/^https?:\/\//, "").split("/")
    if (parts.length > 1 && parts[1]) {
      setOriginError("Origin must not include path, parameters or hash")
      return
    }
    if (allowedOrigins.includes(trimmed)) {
      setOriginError("This origin is already in your allowed list")
      return
    }
    setAllowedOrigins([...allowedOrigins, trimmed])
    setNewOrigin("")
    setOriginError("")
  }

  // Remove Allowed Origin (Phase 22)
  const handleRemoveOrigin = (indexToRemove) => {
    setAllowedOrigins(allowedOrigins.filter((_, idx) => idx !== indexToRemove))
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

  // Rotate Public Site Key (Phase 22)
  const handleRotateSiteKey = async () => {
    try {
      setRotatingSiteKey(true)
      const res = await apiClient.rotateLeadFeedSiteKey()
      if (res && res.success && res.data) {
        setSiteKey(res.data.siteKey)
        setShowRotateSiteKeyModal(false)
        toast.success("Website Public Site Key rotated successfully!")
      } else {
        toast.error(res?.error || "Failed to rotate site key")
      }
    } catch (err) {
      toast.error(err.message || "Failed to rotate site key")
    } finally {
      setRotatingSiteKey(false)
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

  // IndiaMART: Connect Form Submit
  const handleConnectIndiaMartSubmit = async (e) => {
    e.preventDefault()
    if (!indiaMartForm.crmKey || indiaMartForm.crmKey.trim().length < 8) {
      toast.error("Valid IndiaMART glusr_crm_key is required (min 8 characters)")
      return
    }

    try {
      setConnectingIndiaMart(true)
      const res = await apiClient.connectIndiaMartIntegration({
        crmKey: indiaMartForm.crmKey.trim(),
        mobileNumber: indiaMartForm.mobileNumber.trim(),
        name: indiaMartForm.name.trim() || "IndiaMART Lead Manager",
        assignedStaffId: indiaMartForm.assignedStaffId,
      })

      if (res && res.success) {
        toast.success("IndiaMART integration connected successfully!")
        setShowIndiaMartModal(false)
        setIndiaMartForm({ crmKey: "", mobileNumber: "", name: "IndiaMART Lead Manager", assignedStaffId: "unassigned" })
        loadIndiaMartStatus()
      } else {
        toast.error(res?.error || "Failed to connect IndiaMART")
      }
    } catch (err) {
      toast.error(err.message || "Failed to connect IndiaMART")
    } finally {
      setConnectingIndiaMart(false)
    }
  }

  // IndiaMART: Trigger On-Demand Sync
  const handleTriggerIndiaMartSync = async () => {
    if (!indiamartData.integration?._id && !indiamartData.integration?.id) {
      toast.error("IndiaMART is not configured yet. Click 'Connect IndiaMART' first.")
      return
    }
    const integrationId = indiamartData.integration._id || indiamartData.integration.id

    try {
      setSyncingIndiaMart(true)
      const res = await apiClient.triggerIndiaMartSync(integrationId, { lookbackHours: 24 })
      if (res && res.success) {
        toast.success("IndiaMART lead sync initiated! Checking new buyer inquiries...")
        setTimeout(() => {
          loadIndiaMartStatus()
        }, 3000)
      } else {
        toast.error(res?.error || "Failed to initiate IndiaMART sync")
      }
    } catch (err) {
      toast.error(err.message || "Sync request failed")
    } finally {
      setSyncingIndiaMart(false)
    }
  }

  // Meta: Connect Form Submit
  const handleConnectMetaSubmit = async (e) => {
    e.preventDefault()
    if (!metaForm.pageId.trim() || !metaForm.pageAccessToken.trim()) {
      toast.error("Page ID and Page Access Token are required to connect Meta Lead Ads")
      return
    }

    try {
      setConnectingMeta(true)
      const res = await apiClient.connectMetaIntegration({
        pageId: metaForm.pageId.trim(),
        pageName: metaForm.pageName.trim() || `Facebook Page ${metaForm.pageId}`,
        pageAccessToken: metaForm.pageAccessToken.trim(),
        appSecret: metaForm.appSecret.trim(),
        duplicateHandling: metaForm.duplicateHandling,
        assignedStaffId: metaForm.assignedStaffId,
      })

      if (res && res.success) {
        toast.success("Meta Lead Ads connected successfully!")
        setShowMetaModal(false)
        setMetaForm({
          pageId: "",
          pageName: "",
          pageAccessToken: "",
          appSecret: "",
          duplicateHandling: "update",
          assignedStaffId: "unassigned",
        })
        loadMetaStatus()
      } else {
        toast.error(res?.error || "Failed to connect Meta integration")
      }
    } catch (err) {
      toast.error(err.message || "Failed to connect Meta integration")
    } finally {
      setConnectingMeta(false)
    }
  }

  // Meta: Reconcile / Backfill Leads
  const handleReconcileMeta = async () => {
    if (!metaData.integration?._id && !metaData.integration?.id) {
      toast.error("Meta Lead Ads is not connected. Click 'Connect Facebook Page' first.")
      return
    }
    const integrationId = metaData.integration._id || metaData.integration.id

    try {
      setReconcilingMeta(true)
      const res = await apiClient.triggerMetaBackfill(integrationId, backfillDays)
      if (res && res.success) {
        toast.success(res.message || `Meta reconciliation completed for last ${backfillDays} days`)
        loadMetaStatus()
      } else {
        toast.error(res?.error || "Failed to reconcile Meta leads")
      }
    } catch (err) {
      toast.error(err.message || "Reconciliation failed")
    } finally {
      setReconcilingMeta(false)
    }
  }

  // Connect / Update Google Ads Integration
  const handleConnectGoogleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    try {
      setSavingGoogle(true)
      const res = await apiClient.connectGoogleAdsIntegration(googleForm)
      if (res && res.success) {
        toast.success(res.message || "Google Ads Lead Form integration configured successfully!")
        if (res.rawKey) {
          setNewlyGeneratedGoogleKey(res.rawKey)
        }
        setShowGoogleModal(false)
        loadGoogleStatus()
      } else {
        toast.error(res?.error || "Failed to configure Google Ads integration")
      }
    } catch (err) {
      toast.error(err.message || "Error configuring Google Ads integration")
    } finally {
      setSavingGoogle(false)
    }
  }

  // Rotate Google Ads Webhook Key
  const handleRotateGoogleKey = async () => {
    try {
      setRotatingGoogleKey(true)
      const res = await apiClient.rotateGoogleAdsKey()
      if (res && res.success) {
        toast.success("Google Ads webhook key rotated successfully!")
        if (res.rawKey) {
          setNewlyGeneratedGoogleKey(res.rawKey)
        }
        setShowRotateGoogleModal(false)
        loadGoogleStatus()
      } else {
        toast.error(res?.error || "Failed to rotate Google Ads key")
      }
    } catch (err) {
      toast.error(err.message || "Error rotating key")
    } finally {
      setRotatingGoogleKey(false)
    }
  }

  // Send Google Ads Test Lead
  const handleSendGoogleTest = async () => {
    try {
      setTestingGoogle(true)
      const res = await apiClient.sendGoogleAdsTestLead()
      if (res && res.success) {
        toast.success(res.message || "Test lead processed successfully!")
        loadGoogleStatus()
      } else {
        toast.error(res?.error || "Failed to send test lead")
      }
    } catch (err) {
      toast.error(err.message || "Test lead failed")
    } finally {
      setTestingGoogle(false)
    }
  }

  // Generic Connector Handlers (Phase 24)
  const handleConnectGenericSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    try {
      setSavingGeneric(true)
      const res = await apiClient.connectGenericConnector(genericForm)
      if (res && res.success) {
        toast.success(res.message || "Generic Connector settings updated successfully")
        setShowGenericModal(false)
        loadGenericStatus()
      } else {
        toast.error(res?.error || "Failed to update Generic Connector settings")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update settings")
    } finally {
      setSavingGeneric(false)
    }
  }

  const handleRotateGenericKey = async () => {
    try {
      setRotatingGenericKey(true)
      const res = await apiClient.rotateGenericConnectorKey()
      if (res && res.success) {
        toast.success("Generic Connector API key rotated successfully!")
        if (res.rawKey) {
          setNewlyGeneratedGenericKey(res.rawKey)
        }
        setShowRotateGenericModal(false)
        loadGenericStatus()
      } else {
        toast.error(res?.error || "Failed to rotate API key")
      }
    } catch (err) {
      toast.error(err.message || "Error rotating key")
    } finally {
      setRotatingGenericKey(false)
    }
  }

  const handleSendGenericTest = async () => {
    try {
      setTestingGeneric(true)
      const res = await apiClient.sendGenericConnectorTestLead()
      if (res && res.success) {
        toast.success(res.message || "Simulated test lead ingested successfully!")
        loadGenericStatus()
      } else {
        toast.error(res?.error || "Failed to send test lead")
      }
    } catch (err) {
      toast.error(err.message || "Test lead failed")
    } finally {
      setTestingGeneric(false)
    }
  }

  const copyToClipboard = (text, type) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    if (type === "url") {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2500)
      toast.success("Webhook URL copied to clipboard")
    } else if (type === "googleUrl") {
      setCopiedGoogleUrl(true)
      setTimeout(() => setCopiedGoogleUrl(false), 2500)
      toast.success("Google Webhook URL copied to clipboard")
    } else if (type === "googleKey") {
      setCopiedGoogleKey(true)
      setTimeout(() => setCopiedGoogleKey(false), 2500)
      toast.success("Google Webhook Key copied to clipboard")
    } else if (type === "genericUrl") {
      setCopiedGenericUrl(true)
      setTimeout(() => setCopiedGenericUrl(false), 2500)
      toast.success("Generic Webhook URL copied to clipboard")
    } else if (type === "genericKey") {
      setCopiedGenericKey(true)
      setTimeout(() => setCopiedGenericKey(false), 2500)
      toast.success("Generic Connector API Key copied to clipboard")
    } else if (type === "siteKey") {
      setCopiedSiteKey(true)
      setTimeout(() => setCopiedSiteKey(false), 2500)
      toast.success("Public Site Key copied to clipboard")
    } else if (type === "snippet") {
      setCopiedSnippet(true)
      setTimeout(() => setCopiedSnippet(false), 2500)
      toast.success("JavaScript Snippet tag copied to clipboard")
    } else {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2500)
      toast.success("API Key copied to clipboard")
    }
  }

  const handleResetBlockedDomains = () => {
    setBlockedDomainsText(DEFAULT_BLOCKED_DOMAINS.join("\n"))
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
            <span className="text-indigo-600 font-semibold">Integrations</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lead Feeds & Integration Center</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Connect and synchronize B2B lead sources, website webhooks, IndiaMART Lead Manager, and Meta Ads.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        {activeTab === "overview" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => loadAllStatuses(true)}
              disabled={refreshingAll}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${refreshingAll ? "animate-spin" : ""}`} />
              <span>Refresh Statuses</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("events")}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>View Event Ledger</span>
            </button>
          </div>
        )}

        {activeTab === "website" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSendTestLead}
              disabled={testing || !enabled}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
              onClick={handleSaveWebsite}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-medium shadow-sm shadow-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Check className="w-4 h-4 text-white" />
              )}
              Save Website Settings
            </button>
          </div>
        )}

        {activeTab === "indiamart" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleTriggerIndiaMartSync}
              disabled={syncingIndiaMart || !indiamartData.configured}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-sm font-medium shadow-sm shadow-amber-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCw className={`w-4 h-4 ${syncingIndiaMart ? "animate-spin" : ""}`} />
              {syncingIndiaMart ? "Syncing..." : "Sync IndiaMART Now"}
            </button>
            <button
              type="button"
              onClick={() => setShowIndiaMartModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <Key className="w-4 h-4 text-amber-600" />
              {indiamartData.configured ? "Reconfigure Credentials" : "Connect IndiaMART"}
            </button>
          </div>
        )}

        {activeTab === "meta" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleReconcileMeta}
              disabled={reconcilingMeta || !metaData.configured}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium shadow-sm shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <RotateCw className={`w-4 h-4 ${reconcilingMeta ? "animate-spin" : ""}`} />
              {reconcilingMeta ? "Reconciling..." : "Reconcile Leads"}
            </button>
            <button
              type="button"
              onClick={() => setShowMetaModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-blue-600" />
              {metaData.configured ? "Update Meta Page" : "Connect Facebook Page"}
            </button>
          </div>
        )}

        {activeTab === "google" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSendGoogleTest}
              disabled={testingGoogle || !googleData.configured}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {testingGoogle ? (
                <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
              ) : (
                <Send className="w-4 h-4 text-slate-600" />
              )}
              Send Google Test Lead
            </button>
            <button
              type="button"
              onClick={() => setShowGoogleModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
              {googleData.configured ? "Configure Google Settings" : "Enable Google Integration"}
            </button>
          </div>
        )}

        {activeTab === "generic" && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSendGenericTest}
              disabled={testingGeneric || genericData.status !== "active"}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {testingGeneric ? (
                <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
              ) : (
                <Send className="w-4 h-4 text-violet-600" />
              )}
              Send Test Lead
            </button>
            <button
              type="button"
              onClick={() => setShowGenericModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
              Configure Settings
            </button>
          </div>
        )}

        {activeTab === "events" && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadEvents}
              disabled={loadingEvents}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loadingEvents ? "animate-spin" : ""}`} />
              Refresh Ledger
            </button>
          </div>
        )}
      </div>

      {/* Modern Platform Tab Navigation Selector */}
      <div className="flex items-center space-x-2 border-b border-slate-200 overflow-x-auto pb-px">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "overview"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <LayoutGrid className="w-4 h-4 text-indigo-600" />
          <span>Integration Studio</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
            Overview
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("website")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "website"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Website & Webhooks</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {enabled ? "Active" : "Disabled"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("indiamart")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "indiamart"
              ? "border-amber-600 text-amber-600 bg-amber-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <Briefcase className="w-4 h-4 text-amber-600" />
          <span>IndiaMART Lead Manager</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${indiamartData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {indiamartData.configured ? "Connected" : "Disconnected"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("meta")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "meta"
              ? "border-blue-600 text-blue-600 bg-blue-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <Share2 className="w-4 h-4 text-blue-600" />
          <span>Meta Lead Ads (FB & IG)</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${metaData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {metaData.configured ? "Connected" : "Disconnected"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("google")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "google"
              ? "border-emerald-600 text-emerald-600 bg-emerald-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <Code2 className="w-4 h-4 text-emerald-600" />
          <span>Google Lead Forms (Google Ads)</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${googleData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {googleData.configured ? "Active" : "Disconnected"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("generic")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "generic"
              ? "border-violet-600 text-violet-600 bg-violet-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <Sparkles className="w-4 h-4 text-violet-600" />
          <span>Zapier, Make & n8n</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${genericData.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {genericData.status === "active" ? "Active" : "Disabled"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("events")}
          className={`flex items-center space-x-2 py-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "events"
              ? "border-purple-600 text-purple-600 bg-purple-50/40 rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
          }`}
        >
          <FileText className="w-4 h-4 text-purple-600" />
          <span>Integration Event Ledger</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            Audit
          </span>
        </button>
      </div>

      {/* ========================================================
          TAB 0: PHASE 26 INTEGRATION STUDIO OVERVIEW & MONITORING
      ======================================================== */}
      {activeTab === "overview" && (
        <div className="space-y-8 animate-in fade-in duration-150">
          {/* Health Alert Banner */}
          {indiamartData.reconnectNeeded ? (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-rose-900">IndiaMART CRM Key Expired or Revoked</h4>
                  <p className="text-xs text-rose-700 mt-0.5">
                    Background polling has been halted. Reconnect your IndiaMART glusr_crm_key to restore automated inquiry ingestion.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("indiamart")}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer whitespace-nowrap"
              >
                Reconnect IndiaMART
              </button>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-slate-50 border border-emerald-200/80 rounded-xl p-4 flex items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-emerald-950">
                    Ingestion Pipelines Operational &bull; Multi-Tenant Isolated
                  </h4>
                  <p className="text-xs text-emerald-800/90 mt-0.5">
                    All webhook endpoints, polling workers, idempotency deduplication ledgers, and secure key vaults are running normally.
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-bold border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                100% Operational
              </span>
            </div>
          )}

          {/* Global Ingestion KPI Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monitored Channels</span>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <LayoutGrid className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-900">
                  {[
                    enabled,
                    indiamartData.configured,
                    metaData.configured,
                    googleData.configured,
                    genericData.status === "active",
                  ].filter(Boolean).length}{" "}
                  / 5
                </span>
                <span className="text-xs font-medium text-emerald-600">Active</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Multi-tenant inbound channels</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Leads Ingested</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Database className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-900">
                  {(stats.totalReceived || 0) +
                    (googleData.stats?.totalReceived || 0) +
                    (genericData.stats?.totalReceived || 0) +
                    (indiamartData.integration?.stats?.totalReceived || 0)}
                </span>
                <span className="text-xs font-medium text-slate-500">Recorded</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Across all enabled feeds</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Valid Dispatched</span>
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-900">
                  {(stats.validLeads || 0) +
                    (googleData.stats?.validLeads || 0) +
                    (genericData.stats?.validLeads || 0) +
                    (indiamartData.integration?.stats?.leadsCreated || 0)}
                </span>
                <span className="text-xs font-medium text-teal-600">In CRM</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">De-duplicated & normalized</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Errors / Blocked</span>
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-slate-900">
                  {(stats.spamBlocked || 0) +
                    (stats.duplicateRejected || 0) +
                    (googleData.stats?.errors || 0) +
                    (genericData.stats?.errors || 0) +
                    (indiamartData.integration?.stats?.errors || 0)}
                </span>
                <span className="text-xs font-medium text-rose-600">Shielded</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Spam, rejected & dropped</p>
            </div>
          </div>

          {/* 5 Channel Integration Health Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Configured Integration Feeds</h3>
                <p className="text-xs text-slate-500">Live operational status, sync watermarks, and key vault health</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Channel 1: IndiaMART */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                        IM
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">IndiaMART Lead Manager</h4>
                        <span className="text-[11px] text-slate-500">B2B Marketplace Polling</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      indiamartData.configured
                        ? indiamartData.reconnectNeeded
                          ? "bg-rose-100 text-rose-800"
                          : "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {indiamartData.configured
                        ? indiamartData.reconnectNeeded
                          ? "Auth Required"
                          : "Connected"
                        : "Disconnected"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Auto-pulls direct buyer inquiries, RFQs, and requirements every 5–15 minutes via IndiaMART CRM API.
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Key Vault:</span>
                      <span className="font-mono text-slate-700">
                        {indiamartData.configured ? "••••••••••••[LOCKED]" : "Not configured"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Sync:</span>
                      <span className="text-slate-700">
                        {indiamartData.integration?.lastSyncAt
                          ? new Date(indiamartData.integration.lastSyncAt).toLocaleTimeString()
                          : "Never"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Ingested Leads:</span>
                      <span className="font-semibold text-slate-800">
                        {indiamartData.integration?.stats?.leadsCreated || 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleTriggerIndiaMartSync}
                    disabled={syncingIndiaMart || !indiamartData.configured}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingIndiaMart ? "animate-spin" : ""}`} />
                    <span>Sync Now</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("indiamart")}
                    className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Configure
                  </button>
                </div>
              </div>

              {/* Channel 2: Google Ads */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm shadow-sm">
                        <Code2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Google Ads Lead Forms</h4>
                        <span className="text-[11px] text-slate-500">HTTP Webhook Extension</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      googleData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}>
                      {googleData.configured ? "Active Webhook" : "Disconnected"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Zero-delay lead capture from Google Search, Display, YouTube, and Discovery lead form extensions.
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Webhook Key:</span>
                      <span className="font-mono text-slate-700">
                        {googleData.googleKeyMasked || "••••••••••••[VAULT]"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Received:</span>
                      <span className="text-slate-700">
                        {googleData.stats?.lastReceivedAt
                          ? new Date(googleData.stats.lastReceivedAt).toLocaleTimeString()
                          : "Awaiting leads"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Ingested Leads:</span>
                      <span className="font-semibold text-slate-800">
                        {googleData.stats?.validLeads || 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleSendGoogleTest}
                    disabled={testingGoogle}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Send className={`w-3.5 h-3.5 ${testingGoogle ? "animate-spin" : ""}`} />
                    <span>Send Test Lead</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("google")}
                    className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Configure
                  </button>
                </div>
              </div>

              {/* Channel 3: Generic Connector */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center font-bold text-sm shadow-sm">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Zapier, Make, n8n & Pabbly</h4>
                        <span className="text-[11px] text-slate-500">Universal Inbound REST</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      genericData.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}>
                      {genericData.status === "active" ? "Active Endpoint" : "Disabled"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Universal webhook ingestion for 2,000+ third-party tools, iPaaS flows, and automation recipes.
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Connector Key:</span>
                      <span className="font-mono text-slate-700">
                        {genericData.apiKeyMasked || "••••••••••••[VAULT]"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Ingested:</span>
                      <span className="text-slate-700">
                        {genericData.stats?.lastReceivedAt
                          ? new Date(genericData.stats.lastReceivedAt).toLocaleTimeString()
                          : "Awaiting leads"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Valid Leads:</span>
                      <span className="font-semibold text-slate-800">
                        {genericData.stats?.validLeads || 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleSendGenericTest}
                    disabled={testingGeneric}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Send className={`w-3.5 h-3.5 ${testingGeneric ? "animate-spin" : ""}`} />
                    <span>Send Test Lead</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("generic")}
                    className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Configure
                  </button>
                </div>
              </div>

              {/* Channel 4: Website & Webhook Feed */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm shadow-sm">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Website Forms & JS Snippet</h4>
                        <span className="text-[11px] text-slate-500">Public Forms & Webhooks</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}>
                      {enabled ? "Active" : "Disabled"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Embedded website lead capture snippet and direct JSON webhook feeds with spam protection.
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Site Key:</span>
                      <span className="font-mono text-slate-700">
                        {siteKey ? `${siteKey.slice(0, 10)}...` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Received:</span>
                      <span className="text-slate-700">
                        {stats.lastReceivedAt ? new Date(stats.lastReceivedAt).toLocaleTimeString() : "Ready"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Valid Leads:</span>
                      <span className="font-semibold text-slate-800">
                        {stats.validLeads || 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleSendTestLead}
                    disabled={testing || !enabled}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Send className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} />
                    <span>Send Test Lead</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("website")}
                    className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Configure
                  </button>
                </div>
              </div>

              {/* Channel 5: Meta Lead Ads */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shadow-sm">
                        <Share2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Meta Lead Ads</h4>
                        <span className="text-[11px] text-slate-500">Facebook & Instagram</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      metaData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}>
                      {metaData.configured ? "Connected" : "Disconnected"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Real-time Graph API webhook sync for Facebook Page instant lead forms and Instagram campaign leads.
                  </p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Page Subscriptions:</span>
                      <span className="text-slate-700 font-semibold">
                        {metaData.integration?.metaPages?.length || (metaData.configured ? 1 : 0)} Active
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Webhook Status:</span>
                      <span className="text-slate-700">
                        {metaData.configured ? "Subscribed (v21.0)" : "Not registered"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Key Vault:</span>
                      <span className="font-mono text-slate-700">
                        {metaData.configured ? "••••••••••••[VAULT]" : "None"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveTab("meta")}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-semibold transition-all cursor-pointer"
                  >
                    <span>Manage Meta Settings</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live Recent Event Activity Stream (Phase 26) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  <span>Recent Integration Event Activity</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Append-only streaming ledger of incoming webhook payloads and processing results
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("events")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
              >
                <span>View Full Ledger</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-4">Event ID</th>
                    <th className="py-2.5 px-4">Source</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Idempotency Key</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        No recent integration events recorded. Send a test lead from any feed above to trigger activity.
                      </td>
                    </tr>
                  ) : (
                    events.slice(0, 6).map((evt) => (
                      <tr key={evt._id || evt.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-700 select-all">
                          {(evt._id || evt.id)?.substring(0, 10)}...
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                            {evt.source || evt.integrationType || "Webhook"}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            evt.status === "completed" || evt.status === "processed"
                              ? "bg-emerald-100 text-emerald-800"
                              : evt.status === "failed"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-blue-100 text-blue-800"
                          }`}>
                            {evt.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">
                          {evt.createdAt ? new Date(evt.createdAt).toLocaleTimeString() : "—"}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 select-all truncate max-w-[160px]">
                          {evt.idempotencyKey || "—"}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedEvent(evt)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer mr-1.5"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Inspect</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplayEvent(evt._id || evt.id)}
                            disabled={replayingEventId === (evt._id || evt.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>Replay</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 1: WEBSITE FORMS & REST WEBHOOK
      ======================================================== */}
      {activeTab === "website" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left 2 Columns: Main Website Feed Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section A: Website Lead Source Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
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
                        <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                        {enabled ? "Active & Receiving" : "Integration Disabled"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Accept leads directly from HTML forms, WordPress, Webflow, or custom backends via REST Webhook.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>

                  <button
                    type="button"
                    onClick={() => setWebsiteCardOpen(!websiteCardOpen)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                    title={websiteCardOpen ? "Collapse Section" : "Expand Section"}
                  >
                    {websiteCardOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {websiteCardOpen && (
                <div className="p-6 space-y-6">
                  {/* Webhook URL */}
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
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all active:scale-95 cursor-pointer"
                      >
                        {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedUrl ? "Copied" : "Copy URL"}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">
                      Send JSON with header: <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded">x-api-key: [Your API Key]</code>.
                    </p>
                  </div>

                  {/* Integration API Key */}
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
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all active:scale-95 cursor-pointer"
                      >
                        {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedKey ? "Copied" : "Copy Key"}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowRotateModal(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 text-xs font-medium transition-all active:scale-95 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Rotate Key
                      </button>
                    </div>
                  </div>

                  {/* Automated Staff Assignment */}
                  <div className="pt-4 border-t border-slate-100">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Default Assigned Staff Member
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <select
                          value={assignedStaffId}
                          onChange={(e) => setAssignedStaffId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg py-2.5 px-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        >
                          <option value="unassigned">Unassigned (Round-Robin Pool)</option>
                          {staffList.map((member) => (
                            <option key={member.id || member._id} value={member.id || member._id}>
                              {member.name} ({member.role})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center text-xs text-slate-500">
                        {assignedStaffId === "unassigned" ? (
                          <span>Leads route to unassigned pool for team claim or round-robin routing.</span>
                        ) : (
                          <span>Leads will be assigned immediately to {assignedStaffName}.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Duplicate Handling */}
                  <div className="pt-4 border-t border-slate-100">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                      Duplicate Lead Handling
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className={`p-3 rounded-lg border text-xs cursor-pointer flex items-start gap-3 transition-colors ${
                        duplicateHandling === "reject" ? "bg-indigo-50/60 border-indigo-200 text-indigo-900" : "bg-white border-slate-200 text-slate-700"
                      }`}>
                        <input
                          type="radio"
                          name="duplicateHandling"
                          value="reject"
                          checked={duplicateHandling === "reject"}
                          onChange={(e) => setDuplicateHandling(e.target.value)}
                          className="mt-0.5 text-indigo-600"
                        />
                        <div>
                          <strong className="block font-semibold">Reject Duplicate (Recommended)</strong>
                          <span className="text-[11px] text-slate-500">Returns 409 Conflict if phone or email already exists.</span>
                        </div>
                      </label>
                      <label className={`p-3 rounded-lg border text-xs cursor-pointer flex items-start gap-3 transition-colors ${
                        duplicateHandling === "update" ? "bg-indigo-50/60 border-indigo-200 text-indigo-900" : "bg-white border-slate-200 text-slate-700"
                      }`}>
                        <input
                          type="radio"
                          name="duplicateHandling"
                          value="update"
                          checked={duplicateHandling === "update"}
                          onChange={(e) => setDuplicateHandling(e.target.value)}
                          className="mt-0.5 text-indigo-600"
                        />
                        <div>
                          <strong className="block font-semibold">Update Existing Lead</strong>
                          <span className="text-[11px] text-slate-500">Appends latest submission inquiry note to existing lead.</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Section B: Website Snippet, Allowed Origins & Attribution (Phase 22) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
              <div className="p-6 bg-slate-50/50 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200/80 text-indigo-600 flex items-center justify-center">
                    <Code2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-semibold text-slate-900">Website Snippet & Allowed Origins</h2>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border bg-indigo-50 text-indigo-700 border-indigo-200">
                        Phase 22
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Embed our non-blocking JavaScript snippet to automatically capture leads and UTM attribution from your approved websites.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* 1. Public Site Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Public Site Key
                    </label>
                    <span className="text-[11px] text-emerald-600 font-medium">Safe for Browser Embed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        readOnly
                        value={siteKey || "lf_site_••••••••••••••••••••"}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-3.5 text-xs font-mono text-slate-800 select-all focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(siteKey, "siteKey")}
                      disabled={!siteKey}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      {copiedSiteKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSiteKey ? "Copied" : "Copy Key"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRotateSiteKeyModal(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium transition-all active:scale-95 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rotate
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    Unlike the private API key, the public site key is designed to be public in your HTML. It only accepts submissions matching your authorized origins below.
                  </p>
                </div>

                {/* 2. Allowed Origins Manager */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Authorized Website Origins (CORS & Ingestion Guard)
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Only browser submissions originating from these domains are accepted. Wildcards supported (e.g. <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded font-mono">https://*.example.com</code>).
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${allowedOrigins.length > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {allowedOrigins.length} {allowedOrigins.length === 1 ? "Origin" : "Origins"} Configured
                    </span>
                  </div>

                  {/* Add origin input */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="https://example.com or https://*.example.com"
                        value={newOrigin}
                        onChange={(e) => {
                          setNewOrigin(e.target.value)
                          if (originError) setOriginError("")
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleAddOrigin()
                          }
                        }}
                        className="flex-1 bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddOrigin}
                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow-sm transition-all cursor-pointer"
                      >
                        Add Origin
                      </button>
                    </div>
                    {originError && (
                      <p className="text-xs text-rose-600 flex items-center gap-1 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {originError}
                      </p>
                    )}
                  </div>

                  {/* List of Origins */}
                  {allowedOrigins.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {allowedOrigins.map((orig, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-xs font-mono"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          <span>{orig}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveOrigin(idx)}
                            className="text-slate-400 hover:text-rose-600 ml-1 transition-colors cursor-pointer"
                            title="Remove origin"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>No allowed origins configured.</strong> Public browser snippet submissions will be rejected with HTTP 403 until you add your website's origin. Server-to-server submissions using your private API key are unaffected.
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Embeddable Snippet Code */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                        HTML Embed Script
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Place this snippet before the closing <code className="text-slate-700 bg-slate-100 px-1 py-0.5 rounded font-mono">&lt;/body&gt;</code> tag of your website pages.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`<script src="${snippetUrl || "/api/integrations/snippet.js"}" data-site-key="${siteKey || ""}" async defer></script>`, "snippet")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-all cursor-pointer"
                    >
                      {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedSnippet ? "Copied" : "Copy Tag"}
                    </button>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-emerald-400 overflow-x-auto select-all">
                    {`<script src="${snippetUrl || "/api/integrations/snippet.js"}" data-site-key="${siteKey || ""}" async defer></script>`}
                  </div>

                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-2 text-xs text-slate-600">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-indigo-600" />
                      Snippet Features & Attribution Capabilities:
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-slate-600">
                      <li><strong>Automatic Attribution:</strong> Automatically captures <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">utm_source</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">utm_medium</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">utm_campaign</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">gclid</code>, <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">fbclid</code>, referrer, and landing page.</li>
                      <li><strong>Multi-Touch Attribution:</strong> First-touch is preserved; last-touch is updated on repeat inquiries.</li>
                      <li><strong>Zero Dependencies:</strong> 2.5 KB lightweight script; runs non-blocking with async/defer.</li>
                      <li><strong>Form Tagging:</strong> Auto-detects forms containing contact inputs or marked with <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">&lt;form data-leads365-form&gt;</code>.</li>
                      <li><strong>Programmatic Submission:</strong> Use <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">{'window.Leads365.capture({ name, email, phone, message })'}</code> in custom SPAs / React / Vue.</li>
                      <li><strong>Anti-Spam Honeypot:</strong> Add <code className="bg-slate-200 px-1 py-0.5 rounded font-mono text-slate-800">&lt;input type="text" name="_hp_trap" style="display:none" tabIndex="-1" /&gt;</code> to silently reject bots.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Health & Pipeline Stats */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900">Website Pipeline Metrics</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Live
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-500 uppercase">Total Received</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">{stats.totalReceived || 0}</div>
                </div>
                <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  <div className="text-[11px] font-medium text-emerald-700 uppercase">Processed</div>
                  <div className="text-2xl font-bold text-emerald-700 mt-1">{stats.totalSuccess || 0}</div>
                </div>
                <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-100 col-span-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-medium text-rose-700 uppercase">Rejected / Errors</div>
                      <div className="text-xl font-bold text-rose-700 mt-0.5">{stats.totalErrors || 0}</div>
                    </div>
                    {stats.lastErrorMessage && (
                      <span className="text-[10px] text-rose-600 font-mono max-w-[150px] truncate">
                        {stats.lastErrorMessage}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-500 space-y-1.5 pt-2">
                <div className="flex justify-between">
                  <span>Last Ingested:</span>
                  <span className="font-semibold text-slate-700">
                    {stats.lastReceivedAt ? new Date(stats.lastReceivedAt).toLocaleString() : "No events yet"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last Success:</span>
                  <span className="font-semibold text-emerald-700">
                    {stats.lastSuccessAt ? new Date(stats.lastSuccessAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 2: INDIAMART LEAD MANAGER INTEGRATION (PHASE 13)
      ======================================================== */}
      {activeTab === "indiamart" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 bg-amber-50/30 border-b border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    IM
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-bold text-slate-900">IndiaMART B2B Lead Manager</h2>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        indiamartData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${indiamartData.configured ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                        {indiamartData.configured ? "Connected & Active" : "Not Configured"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Automatically capture incoming buyer inquiries, RFQs, calls, and catalog leads from IndiaMART Lead Manager API v2.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowIndiaMartModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    <Key className="w-3.5 h-3.5" />
                    {indiamartData.configured ? "Update Key" : "Connect Now"}
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Active Connection Summary */}
                {indiamartData.configured ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">GLUSR CRM Key</div>
                        <div className="text-sm font-mono font-bold text-slate-800 mt-0.5">
                          {indiamartData.integration?.crmKeyMasked || "glusr_••••••••••••••••"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Assigned Staff Target</div>
                        <div className="text-sm font-bold text-slate-800 mt-0.5">
                          {indiamartData.integration?.assignedStaffName || "Unassigned (Round-Robin)"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Last Sync Watermark</div>
                        <div className="text-xs font-mono text-slate-700 mt-0.5">
                          {indiamartData.integration?.lastSyncTime
                            ? new Date(indiamartData.integration.lastSyncTime).toLocaleString()
                            : "Awaiting initial sync"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Integration Health</div>
                        <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 mt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Connected & Polling</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-200">
                      <div>
                        <div className="text-xs font-bold text-amber-900">Push Webhook Feed (Optional Instant Push)</div>
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          IndiaMART can push real-time inquiries directly to your Leads-365 endpoint:
                        </div>
                        <code className="text-[11px] font-mono text-amber-950 bg-amber-100 px-2 py-0.5 rounded mt-1.5 inline-block select-all">
                          {typeof window !== "undefined" ? `${window.location.origin}/api/integrations/webhooks/indiamart` : "/api/integrations/webhooks/indiamart"}
                        </code>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                      <Briefcase className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Connect your IndiaMART Seller Account</h3>
                      <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                        Generate your glusr_crm_key from the IndiaMART Seller portal to pull real-time verified buyer inquiries directly into Leads-365.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowIndiaMartModal(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-200 transition-all cursor-pointer"
                    >
                      <Key className="w-4 h-4" />
                      Configure IndiaMART CRM Key
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Step-by-Step Setup Guide */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600" />
                How to Generate Your IndiaMART CRM Key
              </h3>
              <ol className="space-y-3 text-xs text-slate-600 list-decimal list-inside leading-relaxed">
                <li>Log in to your <strong>IndiaMART Seller Portal</strong> (seller.indiamart.com).</li>
                <li>Navigate to <strong>Settings</strong> &rarr; <strong>Lead Manager</strong> &rarr; <strong>CRM Integration</strong>.</li>
                <li>Click <strong>Generate CRM Key</strong> to receive your unique <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">glusr_crm_key</code>.</li>
                <li>Copy the key, return to Leads-365, and click <strong>Connect IndiaMART</strong> above.</li>
                <li>Paste the key and save. Inbound B2B buyer leads will now synchronize automatically.</li>
              </ol>
            </div>
          </div>

          {/* IndiaMART Metrics Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900">IndiaMART Ingestion Stats</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  B2B
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-500 uppercase">Buyer Leads</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    {indiamartData.integration?.stats?.totalReceived || 0}
                  </div>
                </div>
                <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  <div className="text-[11px] font-medium text-emerald-700 uppercase">Imported</div>
                  <div className="text-2xl font-bold text-emerald-700 mt-1">
                    {indiamartData.integration?.stats?.totalSuccess || 0}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Scheduled Polling:</span>
                  <span className="font-semibold text-slate-800">Every 15 minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="font-semibold text-emerald-600">
                    {indiamartData.configured ? "Active Connector" : "Not Active"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleTriggerIndiaMartSync}
                disabled={syncingIndiaMart || !indiamartData.configured}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <RotateCw className={`w-3.5 h-3.5 ${syncingIndiaMart ? "animate-spin" : ""}`} />
                {syncingIndiaMart ? "Synchronizing Leads..." : "Run Immediate Sync"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 3: META (FB & IG) LEAD ADS INTEGRATION (PHASE 12)
      ======================================================== */}
      {activeTab === "meta" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 bg-blue-50/30 border-b border-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    <Share2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-bold text-slate-900">Meta (Facebook & IG) Lead Ads</h2>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        metaData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${metaData.configured ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                        {metaData.configured ? "Connected & Active" : "Not Configured"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Stream leads in real time from Facebook & Instagram Instant Forms using Meta Webhooks and Graph API.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMetaModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    {metaData.configured ? "Update Page" : "Connect Page"}
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {metaData.configured ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Connected Page Name</div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          {metaData.integration?.settings?.pageName || metaData.integration?.name || "Meta Facebook Page"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Page ID</div>
                        <div className="text-sm font-mono text-slate-700 mt-0.5">
                          {metaData.integration?.credentials?.pageId || "Configured"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Default Assigned Staff</div>
                        <div className="text-sm font-bold text-slate-800 mt-0.5">
                          {metaData.integration?.assignedStaffName || "Unassigned (Round-Robin)"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase">Webhook Handshake</div>
                        <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 mt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Subscribed to leadgen changes</span>
                        </div>
                      </div>
                    </div>

                    {/* Backfill / Reconciliation Tool */}
                    <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-blue-900">Historical Lead Reconciliation (Backfill)</div>
                          <div className="text-[11px] text-blue-700 mt-0.5">
                            Retrieve any past leads from your Meta lead forms that were missed during server downtime.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={backfillDays}
                            onChange={(e) => setBackfillDays(Number(e.target.value))}
                            className="bg-white border border-blue-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
                          >
                            <option value={7}>Last 7 Days</option>
                            <option value={14}>Last 14 Days</option>
                            <option value={30}>Last 30 Days</option>
                          </select>
                          <button
                            type="button"
                            onClick={handleReconcileMeta}
                            disabled={reconcilingMeta}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${reconcilingMeta ? "animate-spin" : ""}`} />
                            {reconcilingMeta ? "Reconciling..." : "Run Backfill"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center mx-auto">
                      <Share2 className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Connect Facebook & Instagram Lead Ads</h3>
                      <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                        Connect your Facebook Page Access Token to stream leads from ad forms instantly into your CRM pipeline.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowMetaModal(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-200 transition-all cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                      Configure Meta Page Token
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Meta Webhook Endpoint Info */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Meta Webhooks Callback Configuration
              </h3>
              <p className="text-xs text-slate-600">
                In your Meta App Dashboard &rarr; Webhooks &rarr; Page &rarr; Edit Subscription:
              </p>
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200 font-mono text-xs">
                <div>
                  <span className="text-slate-400">Callback URL: </span>
                  <span className="font-semibold text-slate-900 select-all">
                    {typeof window !== "undefined" ? `${window.location.origin}/api/integrations/webhooks/meta` : "/api/integrations/webhooks/meta"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Verify Token: </span>
                  <span className="font-semibold text-slate-900 select-all">leads365_meta_verify_token</span>
                </div>
                <div>
                  <span className="text-slate-400">Fields to Subscribe: </span>
                  <span className="font-semibold text-indigo-700">leadgen</span>
                </div>
              </div>
            </div>
          </div>

          {/* Meta Ingestion Stats Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-bold text-slate-900">Meta Ads Metrics</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                  Ads
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-500 uppercase">Total Received</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    {metaData.integration?.stats?.totalReceived || 0}
                  </div>
                </div>
                <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  <div className="text-[11px] font-medium text-emerald-700 uppercase">Processed</div>
                  <div className="text-2xl font-bold text-emerald-700 mt-1">
                    {metaData.integration?.stats?.totalSuccess || 0}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pipeline Routing:</span>
                  <span className="font-semibold text-slate-800">Real-Time Webhook</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Duplicate Check:</span>
                  <span className="font-semibold text-slate-800">Auto-Deduplicated</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB: GOOGLE ADS LEAD FORM WEBHOOK (PHASE 23)
      ======================================================== */}
      {activeTab === "google" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Header Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 bg-emerald-50/30 border-b border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                    <Code2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-bold text-slate-900">Google Ads Lead Form Extensions</h2>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        googleData.configured ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${googleData.configured ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                        {googleData.configured ? "Connected & Active" : "Not Configured"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Direct server-to-server webhook ingestion for Google Lead Form assets with constant-time HMAC security & automated UTM attribution.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGoogleModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    {googleData.configured ? "Update Settings" : "Enable Ingestion"}
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* One-Time Generated Key Banner if just generated */}
                {newlyGeneratedGoogleKey && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                        <Key className="w-4 h-4 text-amber-600" />
                        <span>New Google Webhook Key Generated — Copy Now</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900">
                        Shown Once
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">
                      This key will not be displayed in full again. Paste it immediately into your Google Ads Lead Form webhook delivery key field.
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        readOnly
                        value={newlyGeneratedGoogleKey}
                        className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-800 select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(newlyGeneratedGoogleKey, "googleKey")}
                        className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedGoogleKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedGoogleKey ? "Copied" : "Copy Key"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Webhook Delivery URL */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-emerald-600" />
                      Google Webhook Delivery URL
                    </label>
                    <span className="text-[11px] text-slate-400">Post directly from Google Ads</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={googleData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/webhooks/google`}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-mono text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(googleData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/webhooks/google`, "googleUrl")}
                      className="px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      {copiedGoogleUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedGoogleUrl ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* Webhook Secret Key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-emerald-600" />
                      Webhook Key (Shared Secret)
                    </label>
                    {googleData.googleKeyLastRotatedAt && (
                      <span className="text-[11px] text-slate-400">
                        Rotated: {new Date(googleData.googleKeyLastRotatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-mono text-slate-600 flex items-center justify-between">
                      <span>{googleData.googleKeyMasked || "No key generated yet"}</span>
                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded">
                        AES-256 Vault
                      </span>
                    </div>
                    {googleData.configured && (
                      <button
                        type="button"
                        onClick={() => setShowRotateGoogleModal(true)}
                        className="px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                        Rotate Key
                      </button>
                    )}
                  </div>
                </div>

                {/* Configuration Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase">Assigned Staff</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5">
                      {googleData.googleSource?.assignedStaffName || "Unassigned (Round-Robin Pool)"}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Incoming Google leads automatically assigned</p>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-500 uppercase">Duplicate Handling</div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5 capitalize">
                      {googleData.googleSource?.duplicateHandling || "update"}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {googleData.googleSource?.duplicateHandling === "reject"
                        ? "Reject repeat submissions"
                        : "Merge & update existing lead activity"}
                    </p>
                  </div>
                </div>

                {/* Setup Guide */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2 font-bold text-xs text-slate-800">
                    <Info className="w-4 h-4 text-emerald-600" />
                    <span>How to configure Webhook Delivery in Google Ads:</span>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600 leading-relaxed">
                    <p>1. Sign in to your <strong>Google Ads account</strong>.</p>
                    <p>2. In the left navigation menu, click <strong>Ads & assets</strong> &gt; <strong>Assets</strong> &gt; <strong>Lead form</strong>.</p>
                    <p>3. Create a new lead form asset or edit an existing one.</p>
                    <p>4. Expand the <strong>Lead delivery option</strong> section and choose <strong>Manage leads with a webhook</strong>.</p>
                    <p>5. Copy and paste the <strong>Google Webhook Delivery URL</strong> and your <strong>Webhook Key</strong> from above.</p>
                    <p>6. Click <strong>Send test data</strong> in Google Ads to verify the connection. Our endpoint will respond with HTTP 200 without creating junk CRM leads.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">Google Ingestion Stats</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Real-time
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-500 uppercase">Total Received</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    {googleData.stats?.totalReceived || 0}
                  </div>
                </div>
                <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  <div className="text-[11px] font-medium text-emerald-700 uppercase">Processed</div>
                  <div className="text-2xl font-bold text-emerald-700 mt-1">
                    {googleData.stats?.totalSuccess || 0}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Security Mode:</span>
                  <span className="font-semibold text-emerald-700">HMAC Timing-Safe</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UTM Attribution:</span>
                  <span className="font-semibold text-slate-800">google / cpc</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Delivery:</span>
                  <span className="font-semibold text-slate-700">
                    {googleData.stats?.lastReceivedAt
                      ? new Date(googleData.stats.lastReceivedAt).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendGoogleTest}
                disabled={testingGoogle || !googleData.configured}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Send className={`w-3.5 h-3.5 ${testingGoogle ? "animate-spin" : ""}`} />
                {testingGoogle ? "Dispatching Test..." : "Send Test Google Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 4: GENERIC CONNECTOR (ZAPIER, MAKE, N8N, PABBLY) (PHASE 24)
      ======================================================== */}
      {activeTab === "generic" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left 2 Columns: Connector Configuration & Recipes */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section A: Inbound Feed Endpoint & Security */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 bg-slate-50/50 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-600 animate-pulse" />
                    <h2 className="text-base font-bold text-slate-900">
                      Generic Automation Connector (Zapier, Make, n8n, Pabbly)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Ingest leads from any automation platform, form builder, or webhook forwarder with unified deduplication, assignment, and attribution.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      genericData.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {genericData.status === "active" ? "Connector Active" : "Connector Disabled"}
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* One-Time Rotated Key Banner */}
                {newlyGeneratedGenericKey && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>New Connector API Key Generated — Copy Now</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewlyGeneratedGenericKey(null)}
                        className="text-amber-500 hover:text-amber-700 text-xs font-medium cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="text-xs text-amber-700">
                      This raw API key is displayed <strong>only once</strong> for security. Update your Zapier, Make, or n8n workflow headers immediately.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={newlyGeneratedGenericKey}
                        className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-800 select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(newlyGeneratedGenericKey, "genericKey")}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                      >
                        {copiedGenericKey ? "Copied!" : "Copy Key"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Webhook Intake URL */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-violet-600" />
                      Inbound Webhook Intake URL
                    </label>
                    <span className="text-[11px] text-slate-400">Target for POST requests</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={genericData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/webhooks/generic`}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-mono text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(genericData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/webhooks/generic`, "genericUrl")}
                      className="px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      {copiedGenericUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedGenericUrl ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-violet-600" />
                      Connector API Key (Secret)
                    </label>
                    <span className="text-[11px] text-slate-400">Pass in &apos;x-api-key&apos; header</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={genericData.apiKeyMasked || "gen_live_••••••••••••••••••••••••"}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-mono text-slate-600 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRotateGenericModal(true)}
                      className="px-3 py-2.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rotate Key
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Authenticates webhook delivery securely.</span>
                    <span>
                      Last rotated:{" "}
                      {genericData.apiKeyLastRotatedAt
                        ? new Date(genericData.apiKeyLastRotatedAt).toLocaleDateString()
                        : "Initial Setup"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section B: Integration Recipes (Zapier, Make, n8n, Pabbly, cURL) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-violet-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Integration Setup Guides & Recipes
                  </h3>
                </div>

                {/* Platform Selector Buttons */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                  {["zapier", "make", "n8n", "pabbly", "curl"].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveGenericRecipeTab(tab)}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer capitalize ${
                        activeGenericRecipeTab === tab
                          ? "bg-violet-600 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {tab === "curl" ? "cURL" : tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-6">
                {activeGenericRecipeTab === "zapier" && (
                  <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
                    <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      Zapier Setup (Webhooks by Zapier)
                    </div>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Create a new Zap with any trigger (e.g., <strong>Facebook Lead Ads</strong>, <strong>Typeform</strong>, or <strong>Google Forms</strong>).</li>
                      <li>Add an Action: choose <strong>Webhooks by Zapier</strong> &rarr; event: <strong>POST</strong>.</li>
                      <li>Set <strong>URL</strong> to your Inbound Intake URL above.</li>
                      <li>Set <strong>Payload Type</strong> to <code>json</code>.</li>
                      <li>Map your lead fields in the <strong>Data</strong> section: <code>name</code>, <code>email</code>, <code>phone</code>, <code>company</code>, <code>message</code>.</li>
                      <li>In <strong>Headers</strong>, add: <code>x-api-key</code> with your secret API key.</li>
                    </ol>
                  </div>
                )}

                {activeGenericRecipeTab === "make" && (
                  <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
                    <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-500" />
                      Make.com (Integromat) Setup
                    </div>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Add an <strong>HTTP</strong> module to your scenario &rarr; select <strong>Make a request</strong>.</li>
                      <li>Set <strong>URL</strong> to your Intake URL.</li>
                      <li>Set <strong>Method</strong> to <code>POST</code>.</li>
                      <li>In <strong>Headers</strong>, add <code>x-api-key: [Your API Key]</code> and <code>Content-Type: application/json</code>.</li>
                      <li>Set <strong>Body type</strong> to <code>Raw</code> &rarr; <strong>Content type</strong> to <code>JSON (application/json)</code>.</li>
                      <li>Provide JSON with <code>name</code>, <code>email</code>, <code>phone</code>, <code>company</code>, and <code>source: &quot;Make.com&quot;</code>.</li>
                    </ol>
                  </div>
                )}

                {activeGenericRecipeTab === "n8n" && (
                  <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
                    <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-rose-500" />
                      n8n (Self-Hosted / Cloud) Setup
                    </div>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Add an <strong>HTTP Request</strong> node to your workflow.</li>
                      <li>Set <strong>Method</strong> to <code>POST</code>.</li>
                      <li>Set <strong>URL</strong> to your Intake URL.</li>
                      <li>Under <strong>Authentication</strong>, choose <strong>Generic Credential Type</strong> &rarr; <strong>Header Auth</strong> (Name: <code>x-api-key</code>).</li>
                      <li>Set <strong>Send Body</strong> to <code>true</code> &rarr; <strong>Specify Body</strong> as <code>JSON</code>.</li>
                      <li>Pass mapped node parameters into the JSON body.</li>
                    </ol>
                  </div>
                )}

                {activeGenericRecipeTab === "pabbly" && (
                  <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
                    <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-500" />
                      Pabbly Connect Setup
                    </div>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>Choose action step <strong>API by Pabbly</strong> &rarr; action event <strong>Execute API Request</strong>.</li>
                      <li>Action Type: <strong>POST</strong>.</li>
                      <li>API Endpoint URL: Your Inbound Intake URL.</li>
                      <li>Headers: key <code>x-api-key</code> with your API key.</li>
                      <li>Payload Type: <code>JSON</code>. Set Request Data with your lead attributes.</li>
                    </ol>
                  </div>
                )}

                {activeGenericRecipeTab === "curl" && (
                  <div className="space-y-3">
                    <div className="font-semibold text-slate-900 text-xs">Test Terminal Command:</div>
                    <pre className="p-3 bg-slate-900 text-emerald-400 rounded-lg text-[11px] font-mono overflow-x-auto select-all">
{`curl -X POST "${genericData.webhookUrl || "http://localhost:5000/api/integrations/webhooks/generic"}" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${newlyGeneratedGenericKey || genericData.apiKeyMasked || "YOUR_API_KEY"}" \\
  -d '{
    "name": "Rohit Verma",
    "email": "rohit@example.in",
    "phone": "+91 98765 43210",
    "company": "Apex Diagnostics",
    "source": "Zapier",
    "message": "Interested in diagnostic equipment demo."
  }'`}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* Section C: Field Mapping Reference */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Supported Inbound Field Names</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Our intelligent normalizer automatically recognizes any of these standard naming conventions:
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">CRM Field</th>
                      <th className="py-2.5 px-3">Accepted Inbound Keys</th>
                      <th className="py-2.5 px-3">Requirement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Name</td>
                      <td className="py-2 px-3 font-mono text-[11px]">name, full_name, fullName, or first_name + last_name</td>
                      <td className="py-2 px-3 text-emerald-600 font-medium">Auto-fallback</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Email</td>
                      <td className="py-2 px-3 font-mono text-[11px]">email, email_address, emailAddress, work_email</td>
                      <td className="py-2 px-3 text-slate-600">Email or Phone required</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Phone</td>
                      <td className="py-2 px-3 font-mono text-[11px]">phone, phone_number, mobile, mobile_number, tel</td>
                      <td className="py-2 px-3 text-slate-600">Normalized to E.164</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Company</td>
                      <td className="py-2 px-3 font-mono text-[11px]">company, company_name, organization, org</td>
                      <td className="py-2 px-3 text-slate-400">Optional</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">City / Location</td>
                      <td className="py-2 px-3 font-mono text-[11px]">city, location, town</td>
                      <td className="py-2 px-3 text-slate-400">Optional</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Attribution</td>
                      <td className="py-2 px-3 font-mono text-[11px]">utm_source, utm_medium, utm_campaign, gclid, fbclid</td>
                      <td className="py-2 px-3 text-slate-400">Preserved in Multi-Touch</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-semibold text-slate-900">Custom Fields</td>
                      <td className="py-2 px-3 font-mono text-[11px]">Any other parameters (e.g. budget, requirement)</td>
                      <td className="py-2 px-3 text-slate-600">Saved in metadata & notes</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Status & Operational Controls */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-violet-600" />
                Connector Configuration
              </h3>

              <div className="space-y-4 text-xs">
                <div>
                  <div className="text-slate-500 font-medium mb-1">Assigned Agent</div>
                  <div className="font-semibold text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex items-center justify-between">
                    <span>{genericData.assignedStaffName || "Unassigned"}</span>
                    <button
                      type="button"
                      onClick={() => setShowGenericModal(true)}
                      className="text-violet-600 hover:text-violet-800 font-bold text-[11px] cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-500 font-medium mb-1">Duplicate Lead Policy</div>
                  <div className="font-semibold text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-100 flex items-center justify-between">
                    <span className="capitalize">{genericData.duplicateHandling || "update"}</span>
                    <button
                      type="button"
                      onClick={() => setShowGenericModal(true)}
                      className="text-violet-600 hover:text-violet-800 font-bold text-[11px] cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {genericData.duplicateHandling === "update"
                      ? "Appends new inquiries to the existing lead timeline."
                      : "Rejects repeat submissions to avoid duplicates."}
                  </p>
                </div>
              </div>

              {/* Statistics */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[11px] font-medium text-slate-500 uppercase">Received</div>
                  <div className="text-2xl font-bold text-slate-900 mt-1">
                    {genericData.stats?.totalReceived || 0}
                  </div>
                </div>
                <div className="p-3.5 bg-violet-50/50 rounded-xl border border-violet-100">
                  <div className="text-[11px] font-medium text-violet-700 uppercase">Processed</div>
                  <div className="text-2xl font-bold text-violet-700 mt-1">
                    {genericData.stats?.totalSuccess || 0}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Security Mode:</span>
                  <span className="font-semibold text-violet-700">SHA-256 Constant-Time</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tenant Isolation:</span>
                  <span className="font-semibold text-emerald-700">Strict Ambient Context</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Delivery:</span>
                  <span className="font-semibold text-slate-700">
                    {genericData.stats?.lastReceivedAt
                      ? new Date(genericData.stats.lastReceivedAt).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendGenericTest}
                disabled={testingGeneric || genericData.status !== "active"}
                className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Send className={`w-3.5 h-3.5 ${testingGeneric ? "animate-spin" : ""}`} />
                {testingGeneric ? "Dispatching Test Lead..." : "Send Test Inbound Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 5: INTEGRATION EVENT LEDGER & AUDIT (PHASE 11)
      ======================================================== */}
      {activeTab === "events" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/60">
            <div>
              <h2 className="text-base font-bold text-slate-900">Append-Only Integration Event Ledger</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Immutable audit trail of all webhook intakes, signatures, idempotency deduplication and replay states.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={eventSourceFilter}
                onChange={(e) => setEventSourceFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none"
              >
                <option value="all">All Sources</option>
                <option value="Website">Website Form</option>
                <option value="IndiaMART">IndiaMART</option>
                <option value="Facebook">Meta / Facebook</option>
                <option value="Google Ads">Google Ads</option>
                <option value="Generic">Zapier / Make / Generic</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Idempotency Key</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingEvents ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-600 mb-2" />
                      Loading event ledger...
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No integration events recorded yet. Submit a test lead or configure a webhook.
                    </td>
                  </tr>
                ) : (
                  events.map((evt) => (
                    <tr key={evt._id || evt.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-700 select-all">
                        {(evt._id || evt.id)?.substring(0, 10)}...
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                          {evt.source || evt.integrationType || "Webhook"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          evt.status === "completed" || evt.status === "processed"
                            ? "bg-emerald-100 text-emerald-800"
                            : evt.status === "failed"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-blue-100 text-blue-800"
                        }`}>
                          {evt.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 select-all truncate max-w-[180px]">
                        {evt.idempotencyKey || "—"}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedEvent(evt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer mr-1.5"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Inspect</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReplayEvent(evt._id || evt.id)}
                          disabled={replayingEventId === (evt._id || evt.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          <span>Replay</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: CONNECT INDIAMART (PHASE 13)
      ======================================================== */}
      {showIndiaMartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-sm">
                  IM
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Connect IndiaMART CRM Key</h3>
                  <p className="text-xs text-slate-500">Encrypted with AES-256-GCM in backend vault</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIndiaMartModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConnectIndiaMartSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  IndiaMART glusr_crm_key <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={indiaMartForm.crmKey}
                  onChange={(e) => setIndiaMartForm({ ...indiaMartForm, crmKey: e.target.value })}
                  placeholder="Paste your GLUSR CRM Key here"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Registered Mobile Number (Optional)
                </label>
                <input
                  type="text"
                  value={indiaMartForm.mobileNumber}
                  onChange={(e) => setIndiaMartForm({ ...indiaMartForm, mobileNumber: e.target.value })}
                  placeholder="e.g. 9876543210"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Default Assigned Staff Member
                </label>
                <select
                  value={indiaMartForm.assignedStaffId}
                  onChange={(e) => setIndiaMartForm({ ...indiaMartForm, assignedStaffId: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                >
                  <option value="unassigned">Unassigned (Round-Robin Pool)</option>
                  {staffList.map((m) => (
                    <option key={m.id || m._id} value={m.id || m._id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIndiaMartModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connectingIndiaMart}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {connectingIndiaMart ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" /> : <Check className="w-3.5 h-3.5 text-white" />}
                  Connect & Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: CONNECT META LEAD ADS (PHASE 12)
      ======================================================== */}
      {showMetaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Connect Meta Facebook Page</h3>
                  <p className="text-xs text-slate-500">Subscribe Page to leadgen webhook updates</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMetaModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConnectMetaSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Facebook Page ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={metaForm.pageId}
                  onChange={(e) => setMetaForm({ ...metaForm, pageId: e.target.value })}
                  placeholder="e.g. 104829104819028"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Page Name (Optional)
                </label>
                <input
                  type="text"
                  value={metaForm.pageName}
                  onChange={(e) => setMetaForm({ ...metaForm, pageName: e.target.value })}
                  placeholder="e.g. Medical 365 Official"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Page Access Token <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={metaForm.pageAccessToken}
                  onChange={(e) => setMetaForm({ ...metaForm, pageAccessToken: e.target.value })}
                  placeholder="EAABw..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Never-expiring Page Access Token from Graph API Explorer or Meta Business Suite.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Default Assigned Staff Member
                </label>
                <select
                  value={metaForm.assignedStaffId}
                  onChange={(e) => setMetaForm({ ...metaForm, assignedStaffId: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="unassigned">Unassigned (Round-Robin Pool)</option>
                  {staffList.map((m) => (
                    <option key={m.id || m._id} value={m.id || m._id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowMetaModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connectingMeta}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {connectingMeta ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" /> : <Check className="w-3.5 h-3.5 text-white" />}
                  Connect Page
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ROTATE WEBSITE API KEY
      ======================================================== */}
      {showRotateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900">Rotate Integration API Key?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Rotating this API key will <strong>immediately revoke the previous key</strong>. Any external forms or webhooks using the old key will stop receiving leads until updated.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRotateModal(false)}
                disabled={rotating}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {rotating ? <RefreshCw className="w-4 h-4 animate-spin text-white" /> : null}
                Yes, Rotate Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ROTATE PUBLIC SITE KEY (PHASE 22)
      ======================================================== */}
      {showRotateSiteKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <RefreshCw className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900">Rotate Public Site Key?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Rotating this site key will immediately revoke the old site key. You will need to update the <code className="text-slate-800 bg-slate-100 px-1 py-0.5 rounded font-mono">data-site-key</code> attribute on your website pages.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRotateSiteKeyModal(false)}
                disabled={rotatingSiteKey}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleRotateSiteKey}
                disabled={rotatingSiteKey}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {rotatingSiteKey ? <RefreshCw className="w-4 h-4 animate-spin text-white" /> : null}
                Yes, Rotate Site Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: CONFIGURE GOOGLE ADS SETTINGS (PHASE 23)
      ======================================================== */}
      {showGoogleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Google Ads Integration Settings</h3>
                  <p className="text-xs text-slate-500">Configure assignment & duplicate handling</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConnectGoogleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Default Assigned Staff Member
                </label>
                <select
                  value={googleForm.assignedStaffId}
                  onChange={(e) => setGoogleForm({ ...googleForm, assignedStaffId: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="unassigned">Unassigned (Round-Robin Pool)</option>
                  {staffList.map((m) => (
                    <option key={m.id || m._id} value={m.id || m._id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Duplicate Submission Handling
                </label>
                <div className="space-y-2 pt-1">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="googleDuplicate"
                      value="update"
                      checked={googleForm.duplicateHandling === "update"}
                      onChange={() => setGoogleForm({ ...googleForm, duplicateHandling: "update" })}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-800">Update Existing Lead (Recommended)</span>
                      <p className="text-[11px] text-slate-500">
                        Append new inquiry details to timeline and update last contact timestamp.
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="googleDuplicate"
                      value="reject"
                      checked={googleForm.duplicateHandling === "reject"}
                      onChange={() => setGoogleForm({ ...googleForm, duplicateHandling: "reject" })}
                      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-800">Reject Duplicate</span>
                      <p className="text-[11px] text-slate-500">
                        Do not create new lead or modify existing record if contact details already exist.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowGoogleModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingGoogle}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingGoogle ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" /> : <Check className="w-3.5 h-3.5 text-white" />}
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ROTATE GOOGLE WEBHOOK KEY (PHASE 23)
      ======================================================== */}
      {showRotateGoogleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Rotate Google Webhook Key?</h3>
                <p className="text-xs text-slate-500">Immediate key revocation</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Rotating your Google Webhook Key will <strong>immediately invalidate</strong> the current key. Any webhook deliveries from Google Ads using the old key will fail with HTTP 401 until you paste the new key into Google Ads.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRotateGoogleModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRotateGoogleKey}
                disabled={rotatingGoogleKey}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {rotatingGoogleKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" /> : null}
                Yes, Rotate Key Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: TEST LEAD RESULTS
      ======================================================== */}
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
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
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
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: CONFIGURE GENERIC CONNECTOR (PHASE 24)
      ======================================================== */}
      {showGenericModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Configure Generic Connector</h3>
                  <p className="text-xs text-slate-500">Automation ingestion preferences</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGenericModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConnectGenericSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Assigned Staff Member
                </label>
                <select
                  value={genericForm.assignedStaffId}
                  onChange={(e) => setGenericForm({ ...genericForm, assignedStaffId: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-600"
                >
                  <option value="unassigned">Unassigned (Pool)</option>
                  {staffList.map((s) => (
                    <option key={s._id || s.id} value={s._id || s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  All inbound automation leads without explicit assignee will be assigned to this user.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Duplicate Lead Policy
                </label>
                <select
                  value={genericForm.duplicateHandling}
                  onChange={(e) => setGenericForm({ ...genericForm, duplicateHandling: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-600"
                >
                  <option value="update">Update Existing Lead (Append Inquiry to Timeline Note)</option>
                  <option value="reject">Reject Duplicate (Return HTTP 409 Conflict)</option>
                  <option value="allow">Allow Duplicate (Create Separate Record)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Connector Status
                </label>
                <select
                  value={genericForm.status}
                  onChange={(e) => setGenericForm({ ...genericForm, status: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-600"
                >
                  <option value="active">Active (Accepting Inbound Leads)</option>
                  <option value="inactive">Inactive (Reject With HTTP 403 Forbidden)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowGenericModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingGeneric}
                  className="px-5 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {savingGeneric && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ROTATE GENERIC CONNECTOR KEY (PHASE 24)
      ======================================================== */}
      {showRotateGenericModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Rotate Generic Connector Key?</h3>
                <p className="text-xs text-slate-500">Security credential regeneration</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Rotating your connector key will <strong>immediately invalidate</strong> the previous key. Any Zapier, Make, or n8n workflow currently dispatching leads with the old key will fail authentication until updated with the new key.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRotateGenericModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRotateGenericKey}
                disabled={rotatingGenericKey}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                {rotatingGenericKey && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Yes, Rotate Key Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: INSPECT INTEGRATION EVENT (PHASE 26)
      ======================================================== */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Integration Event Inspector</h3>
                  <p className="text-xs text-slate-500 font-mono">
                    ID: {selectedEvent._id || selectedEvent.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Event Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex-shrink-0">
              <div>
                <span className="text-slate-500 block">Source</span>
                <span className="font-semibold text-slate-800">{selectedEvent.source || selectedEvent.integrationType || "Webhook"}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Status</span>
                <span className={`font-bold uppercase tracking-wider text-[11px] ${
                  selectedEvent.status === "processed" || selectedEvent.status === "completed"
                    ? "text-emerald-700"
                    : selectedEvent.status === "failed"
                    ? "text-rose-700"
                    : "text-blue-700"
                }`}>
                  {selectedEvent.status}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">HTTP Code</span>
                <span className="font-mono font-semibold text-slate-800">{selectedEvent.httpStatus || 200}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Created At</span>
                <span className="text-slate-700">
                  {selectedEvent.createdAt ? new Date(selectedEvent.createdAt).toLocaleTimeString() : "—"}
                </span>
              </div>
            </div>

            {/* Idempotency Key */}
            <div className="flex-shrink-0">
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Idempotency Key</label>
              <div className="font-mono text-xs bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 select-all truncate">
                {selectedEvent.idempotencyKey || "None (non-deduplicated)"}
              </div>
            </div>

            {/* Scrubbed Payload Viewer */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-600">
                  Scrubbed Payload (Vault Redacted)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const json = JSON.stringify(selectedEvent.rawPayload || selectedEvent.normalizedPayload || {}, null, 2)
                    navigator.clipboard.writeText(json)
                    setCopiedEventPayload(true)
                    setTimeout(() => setCopiedEventPayload(false), 2000)
                    toast.success("Payload copied to clipboard")
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                >
                  {copiedEventPayload ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEventPayload ? "Copied!" : "Copy JSON"}</span>
                </button>
              </div>
              <pre className="flex-1 bg-slate-900 text-slate-100 p-3.5 rounded-xl text-xs font-mono overflow-auto max-h-60 border border-slate-800 selection:bg-indigo-500 selection:text-white">
                {JSON.stringify(selectedEvent.rawPayload || selectedEvent.normalizedPayload || {}, null, 2)}
              </pre>
            </div>

            {/* Result / Error Details */}
            {selectedEvent.errorMessage && (
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs text-rose-700 flex-shrink-0">
                <strong>Error details:</strong> {selectedEvent.errorMessage}
              </div>
            )}

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 flex-shrink-0">
              <span className="text-[11px] text-slate-400">
                Tenant isolation enforced &bull; Append-only audit
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await handleReplayEvent(selectedEvent._id || selectedEvent.id)
                    setSelectedEvent(null)
                  }}
                  disabled={replayingEventId === (selectedEvent._id || selectedEvent.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {replayingEventId === (selectedEvent._id || selectedEvent.id) ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Replay Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
