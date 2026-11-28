"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { apiClient, API_BASE_URL } from "@/lib/api"
import InBrowserAudioPlayer from "@/components/in-browser-audio-player"
import { toast } from "react-hot-toast"
import {
  X,
  Copy,
  Check,
  Building2,
  Phone,
  Mail,
  Calendar,
  CalendarClock,
  Clock,
  User,
  Users,
  Shield,
  Tag,
  MessageSquare,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Trash2,
  Edit2,
  PhoneCall,
  Sparkles,
  History,
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Layers,
  MapPin,
  Globe,
  Share2,
  Plus,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  Sliders,
  CheckCheck,
  MessageCircle,
  UploadCloud,
  Send,
  FileCheck,
  DollarSign,
  Receipt,
  Download,
  Archive,
  AlertTriangle,
} from "lucide-react"

// Status styling configuration
const STATUS_CONFIG = {
  New: {
    label: "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
  },
  Engaged: {
    label: "Engaged (Active)",
    dotColor: "bg-amber-500",
    badgeClasses: "bg-amber-50 text-amber-700 border-amber-200/80",
  },
  "Proposal Sent": {
    label: "Proposal Sent",
    dotColor: "bg-purple-500",
    badgeClasses: "bg-purple-50 text-purple-700 border-purple-200/80",
  },
  "Closed-Won": {
    label: "Closed-Won (Order Placed)",
    dotColor: "bg-emerald-500",
    badgeClasses: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  },
  "Closed-Lost": {
    label: "Closed-Lost (Lost)",
    dotColor: "bg-rose-500",
    badgeClasses: "bg-rose-50 text-rose-700 border-rose-200/80",
  },
}

const ALL_STATUSES = ["New", "Engaged", "Proposal Sent", "Closed-Won", "Closed-Lost"]

export default function LeadDetailDrawer({
  isOpen,
  leadId,
  initialLead,
  onClose,
  onLeadUpdated,
  onEditLead,
  onDeleteLead,
}) {
  const { user, hasPermission } = useAuth()
  const canEditLead = typeof hasPermission === "function" ? hasPermission("leads.edit*") : true
  const canDeleteLead = typeof hasPermission === "function" ? (hasPermission("leads.delete*") || hasPermission("leads.delete")) : true
  const canAssignLead = typeof hasPermission === "function" ? hasPermission("leads.assign") : true
  const canDeleteDocument = typeof hasPermission === "function"
    ? (hasPermission("leads.delete*") || hasPermission("leads.delete") || hasPermission("leads.edit*") || user?.role === "super_admin" || user?.role === "account_admin")
    : true

  const [activeTab, setActiveTab] = useState("timeline") // "timeline" | "notes" | "followups" | "calls" | "details"
  const [lead, setLead] = useState(initialLead || null)
  const [loading, setLoading] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [followUps, setFollowUps] = useState([])
  const [loadingFollowUps, setLoadingFollowUps] = useState(false)
  const [activities, setActivities] = useState([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [activitiesError, setActivitiesError] = useState(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [savingNote, setSavingNote] = useState("")
  const [timelineFilter, setTimelineFilter] = useState("all") // "all" | "status" | "assignment" | "followup" | "notes"
  const [playingCallId, setPlayingCallId] = useState(null)
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState({})
  const [loadingCustomFields, setLoadingCustomFields] = useState(false)

  // WhatsApp Message Mirror State
  const [whatsappMessages, setWhatsappMessages] = useState([])
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(false)
  const [whatsAppError, setWhatsAppError] = useState(null)
  const chatBottomRef = useRef(null)

  // Staff Assignment State
  const [staffList, setStaffList] = useState([])
  const [isAssigningStaff, setIsAssigningStaff] = useState(false)

  // Document & Quotation State (Phases 1 & 4)
  const [quotations, setQuotations] = useState([])
  const [loadingQuotations, setLoadingQuotations] = useState(false)
  const [uploadingQuotation, setUploadingQuotation] = useState(false)
  const [quotationFile, setQuotationFile] = useState(null)
  const [quotationNotes, setQuotationNotes] = useState("")

  const [sendModalQuotation, setSendModalQuotation] = useState(null)
  const [sendRecipientEmail, setSendRecipientEmail] = useState("")
  const [sendSubject, setSendSubject] = useState("")
  const [sendBody, setSendBody] = useState("")
  const [isSendingQuotation, setIsSendingQuotation] = useState(false)

  // Quotation Deletion & Void State
  const [deleteModalQuotation, setDeleteModalQuotation] = useState(null)
  const [isDeletingQuotation, setIsDeletingQuotation] = useState(false)

  const activeQuotations = useMemo(() => {
    return quotations.filter((q) => q.status !== "voided" && q.status !== "archived")
  }, [quotations])

  const voidedQuotations = useMemo(() => {
    return quotations.filter((q) => q.status === "voided" || q.status === "archived")
  }, [quotations])

  const [commHistory, setCommHistory] = useState([])
  const [loadingCommHistory, setLoadingCommHistory] = useState(false)

  // Deal Value & Closing Amount State (Phase 5)
  const [wonClosureModalOpen, setWonClosureModalOpen] = useState(false)
  const [wonAmountInput, setWonAmountInput] = useState("")
  const [wonNotesInput, setWonNotesInput] = useState("")
  const [wonAmountError, setWonAmountError] = useState(null)
  const [isSavingWon, setIsSavingWon] = useState(false)

  const [isEditingExpectedAmount, setIsEditingExpectedAmount] = useState(false)
  const [expectedAmountInput, setExpectedAmountInput] = useState("")
  const [isSavingExpectedAmount, setIsSavingExpectedAmount] = useState(false)

  // Fetch staff list for assignment
  useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    apiClient
      .getStaff({ limit: 100, status: "active" })
      .then((res) => {
        if (isMounted && res && res.success && Array.isArray(res.data?.staff)) {
          setStaffList(res.data.staff)
        }
      })
      .catch((err) => {
        console.warn("Failed to load staff list for assignment:", err)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen])

  // Assign or reassign lead to a staff member
  const handleAssignStaff = async (staffId) => {
    if (!lead || !lead._id || isAssigningStaff) return
    const targetStaff = staffList.find((s) => (s.id || s._id) === staffId)
    const targetName = targetStaff ? targetStaff.name : staffId === "unassigned" ? "Unassigned" : staffId

    try {
      setIsAssigningStaff(true)
      const res = await apiClient.assignLead(lead._id, {
        targetOwnerId: staffId === "unassigned" ? null : staffId,
        reason: "Assigned via Lead Detail Drawer",
      })

      if (res && res.success) {
        const updated = {
          ...lead,
          assignedTo: targetName,
          assignedStaffId: staffId === "unassigned" ? null : staffId,
          ownerId: targetStaff ? { _id: targetStaff.id || targetStaff._id, name: targetStaff.name } : null,
        }
        setLead(updated)
        if (onLeadUpdated) onLeadUpdated(updated)
        toast.success(`Lead assigned to ${targetName}`)
        fetchLeadActivities()
      } else {
        toast.error(res?.error || "Failed to assign lead")
      }
    } catch (err) {
      toast.error(err.message || "Failed to assign lead")
    } finally {
      setIsAssigningStaff(false)
    }
  }

  // Fetch tenant custom fields to enrich labels & formatters
  useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    setLoadingCustomFields(true)
    apiClient
      .getCustomFields({ status: "all" })
      .then((res) => {
        if (isMounted && res && res.success && Array.isArray(res.data)) {
          const map = {}
          res.data.forEach((cf) => {
            if (cf && cf.name) map[cf.name.toLowerCase()] = cf
          })
          setCustomFieldDefinitions(map)
        }
      })
      .catch((err) => {
        console.warn("Failed to load custom field definitions:", err)
      })
      .finally(() => {
        if (isMounted) setLoadingCustomFields(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen])

  // Universal Dynamic Custom Fields Extractor
  // Handles:
  // 1. Modern structured array in lead.customFields or lead.metadata.customFields
  // 2. Legacy key-value object in lead.metadata.customFields
  // 3. Omits empty/missing fields
  // 4. Preserves labels, order, and data types (arrays, booleans, dropdowns, numbers, text)
  const normalizedCustomFields = useMemo(() => {
    // 1. Check for structured array in lead.customFields or lead.metadata.customFields
    const arraySource =
      Array.isArray(lead?.customFields) && lead.customFields.length > 0
        ? lead.customFields
        : Array.isArray(lead?.metadata?.customFields) && lead.metadata.customFields.length > 0
        ? lead.metadata.customFields
        : null

    if (arraySource) {
      return arraySource
        .filter((f) => {
          if (!f || typeof f !== "object") return false
          const val = f.value
          if (val === undefined || val === null || val === "") return false
          if (Array.isArray(val) && val.length === 0) return false
          const keyLower = String(f.key || "").toLowerCase()
          if (
            keyLower.includes("password") ||
            keyLower.includes("captcha") ||
            keyLower.startsWith("_hp") ||
            keyLower.includes("token")
          ) {
            return false
          }
          return true
        })
        .map((f, idx) => {
          const key = f.key || `field_${idx}`
          const def = customFieldDefinitions[key.toLowerCase()]
          const label =
            f.label ||
            def?.label ||
            key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          let type = f.type || def?.type
          if (!type) {
            if (Array.isArray(f.value)) type = "checkbox"
            else if (typeof f.value === "boolean") type = "checkbox"
            else if (typeof f.value === "number") type = "number"
            else if (typeof f.value === "string" && f.value.includes("\n")) type = "textarea"
            else type = "text"
          }
          return {
            key,
            label,
            value: f.value,
            type,
            order:
              typeof f.order === "number"
                ? f.order
                : def?.order !== undefined
                ? def.order
                : idx + 1,
          }
        })
        .sort((a, b) => a.order - b.order)
    }

    // 2. Fallback: Legacy plain key-value object in lead.metadata.customFields
    const rawObj = lead?.metadata?.customFields
    if (rawObj && typeof rawObj === "object" && !Array.isArray(rawObj)) {
      return Object.entries(rawObj)
        .filter(([key, val]) => {
          if (val === undefined || val === null || val === "") return false
          if (Array.isArray(val) && val.length === 0) return false
          const keyLower = key.toLowerCase()
          if (
            keyLower.includes("password") ||
            keyLower.includes("captcha") ||
            keyLower.startsWith("_hp") ||
            keyLower.includes("token")
          ) {
            return false
          }
          return true
        })
        .map(([key, val], idx) => {
          const def = customFieldDefinitions[key.toLowerCase()]
          const label =
            def?.label || key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          let type = def?.type
          if (!type) {
            if (Array.isArray(val)) type = "checkbox"
            else if (typeof val === "boolean") type = "checkbox"
            else if (typeof val === "number") type = "number"
            else if (typeof val === "string" && val.includes("\n")) type = "textarea"
            else type = "text"
          }
          return {
            key,
            label,
            value: val,
            type,
            order: def?.order !== undefined ? def.order : idx + 1,
          }
        })
        .sort((a, b) => a.order - b.order)
    }

    return []
  }, [lead?.customFields, lead?.metadata?.customFields, customFieldDefinitions])

  const customFieldEntries = normalizedCustomFields

  const onLeadUpdatedRef = useRef(onLeadUpdated)
  useEffect(() => {
    onLeadUpdatedRef.current = onLeadUpdated
  })

  // Update lead when initialLead or leadId changes (keyed by ID to prevent loop)
  const initialLeadId = initialLead?._id || initialLead?.id
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLeadId])

  // Fetch full lead details on drawer open (Passive read: does NOT notify parent to avoid cascading re-renders)
  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return
    try {
      setLoading(true)
      const res = await apiClient.getLeadById(leadId)
      if (res.success && res.data) {
        setLead(res.data)
      }
    } catch (err) {
      console.error("Failed to load lead details:", err)
      // If initialLead exists, we keep it as fallback
    } finally {
      setLoading(false)
    }
  }, [leadId])

  const fetchLeadFollowUps = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingFollowUps(true)
      const res = await apiClient.getFollowUps({ leadId, limit: 50 })
      if (res.success && res.data?.followUps) {
        setFollowUps(res.data.followUps)
      } else if (Array.isArray(res.data)) {
        setFollowUps(res.data)
      }
    } catch (err) {
      console.error("Failed to fetch follow-ups for lead:", err)
    } finally {
      setLoadingFollowUps(false)
    }
  }, [leadId])

  const handleCompleteFollowUp = async (followUpId) => {
    try {
      const res = await apiClient.completeFollowUp(followUpId, { completionNotes: "Completed from Lead Drawer" })
      if (res.success) {
        toast.success("Follow-up marked completed")
        fetchLeadFollowUps()
        if (typeof onLeadUpdated === "function" && lead) onLeadUpdated(lead)
      } else {
        toast.error(res.error || "Failed to complete follow-up")
      }
    } catch (err) {
      toast.error(err.message || "Failed to complete follow-up")
    }
  }

  // Phase 10: Fetch real chronological activity timeline from API
  const fetchLeadActivities = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingActivities(true)
      setActivitiesError(null)
      const res = await apiClient.getLeadActivities(leadId, { limit: 100 })
      if (res && res.success) {
        if (Array.isArray(res.data?.activities)) {
          setActivities(res.data.activities)
        } else if (Array.isArray(res.activities)) {
          setActivities(res.activities)
        } else if (Array.isArray(res.data)) {
          setActivities(res.data)
        } else {
          setActivities([])
        }
      } else {
        setActivitiesError(res?.error || "Failed to load timeline activities")
      }
    } catch (err) {
      console.error("Failed to fetch activities for lead:", err)
      setActivitiesError(err.message || "Failed to load timeline activities")
    } finally {
      setLoadingActivities(false)
    }
  }, [leadId])

  const [calls, setCalls] = useState([])
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [showLogCallForm, setShowLogCallForm] = useState(false)
  const [callFormData, setCallFormData] = useState({
    direction: "outbound",
    duration: 60,
    status: "completed",
    disposition: "Interested",
    notes: "",
  })
  const [submittingCall, setSubmittingCall] = useState(false)

  // Fetch calls for lead (Phase 14)
  const fetchLeadCalls = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingCalls(true)
      const res = await apiClient.getCalls({ leadId, limit: 50 })
      if (res && res.success && Array.isArray(res.data?.calls)) {
        setCalls(res.data.calls)
      } else if (Array.isArray(res?.data)) {
        setCalls(res.data)
      } else {
        setCalls([])
      }
    } catch (err) {
      console.error("Failed to fetch calls for lead:", err)
      setCalls([])
    } finally {
      setLoadingCalls(false)
    }
  }, [leadId])

  // Fetch WhatsApp chat messages for lead
  const fetchWhatsAppMessages = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingWhatsApp(true)
      setWhatsAppError(null)
      const res = await apiClient.getLeadWhatsAppMessages(leadId)
      if (res && res.success && Array.isArray(res.data)) {
        setWhatsappMessages(res.data)
      } else {
        setWhatsappMessages([])
        if (res && !res.success) {
          setWhatsAppError(res.error || "Failed to load WhatsApp messages")
        }
      }
    } catch (err) {
      console.error("Failed to fetch WhatsApp messages:", err)
      setWhatsAppError(err.message || "Failed to load WhatsApp messages")
      setWhatsappMessages([])
    } finally {
      setLoadingWhatsApp(false)
    }
  }, [leadId])

  // Fetch lead quotations (Phase 1)
  const fetchLeadQuotations = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingQuotations(true)
      const res = await apiClient.getLeadQuotations(leadId)
      const list = Array.isArray(res?.data?.quotations)
        ? res.data.quotations
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.quotations)
        ? res.quotations
        : []
      setQuotations(list)
    } catch (err) {
      console.error("Failed to fetch lead quotations:", err)
      setQuotations([])
    } finally {
      setLoadingQuotations(false)
    }
  }, [leadId])

  // Fetch lead email communication history (Phase 4)
  const fetchLeadCommHistory = useCallback(async () => {
    if (!leadId) return
    try {
      setLoadingCommHistory(true)
      const res = await apiClient.getLeadCommunicationHistory(leadId)
      const list = Array.isArray(res?.data?.history)
        ? res.data.history
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.history)
        ? res.history
        : []
      setCommHistory(list)
    } catch (err) {
      console.error("Failed to fetch lead communication history:", err)
      setCommHistory([])
    } finally {
      setLoadingCommHistory(false)
    }
  }, [leadId])

  useEffect(() => {
    if (isOpen && leadId) {
      fetchWhatsAppMessages()
    }
  }, [isOpen, leadId, fetchWhatsAppMessages])

  useEffect(() => {
    if (isOpen && leadId && activeTab === "documents") {
      fetchLeadQuotations()
      fetchLeadCommHistory()
    }
  }, [isOpen, leadId, activeTab, fetchLeadQuotations, fetchLeadCommHistory])

  // Synchronize expected deal amount when lead loads
  useEffect(() => {
    if (lead) {
      setExpectedAmountInput(lead.expectedDealAmount !== undefined && lead.expectedDealAmount !== null ? String(lead.expectedDealAmount) : "")
    }
  }, [lead])

  // Scroll to bottom of chat when messages change or tab activates
  useEffect(() => {
    if (activeTab === "whatsapp" && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [activeTab, whatsappMessages])

  const handleLogCallSubmit = async (e) => {
    e.preventDefault()
    if (!lead) return
    try {
      setSubmittingCall(true)
      const payload = {
        leadId: lead._id || lead.id,
        number: lead.phoneNormalized || lead.phone || "unknown",
        direction: callFormData.direction,
        duration: Number(callFormData.duration) || 0,
        status: callFormData.status,
        disposition: callFormData.disposition,
        notes: callFormData.notes,
        startedAt: new Date(Date.now() - (Number(callFormData.duration) || 0) * 1000).toISOString(),
        endedAt: new Date().toISOString(),
      }
      const res = await apiClient.logCall(payload)
      if (res && res.success) {
        toast.success("Call logged successfully")
        setShowLogCallForm(false)
        setCallFormData({
          direction: "outbound",
          duration: 60,
          status: "completed",
          disposition: "Interested",
          notes: "",
        })
        fetchLeadCalls()
        fetchLeadActivities()
        fetchLeadDetails()
      } else {
        toast.error(res?.message || "Failed to log call")
      }
    } catch (err) {
      toast.error(err.message || "Failed to log call")
    } finally {
      setSubmittingCall(false)
    }
  }

  useEffect(() => {
    if (isOpen && leadId) {
      fetchLeadDetails()
      fetchLeadFollowUps()
      fetchLeadActivities()
      fetchLeadCalls()
      fetchLeadQuotations()
      fetchLeadCommHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leadId])

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // Quick Copy Helper
  const handleCopy = (text, fieldName) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    toast.success(`Copied to clipboard`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Open Closed-Won modal directly
  const handleOpenWonClosureModal = () => {
    setWonAmountError(null)
    setWonAmountInput(
      lead?.closedWonAmount !== undefined && lead?.closedWonAmount !== null && Number(lead.closedWonAmount) > 0
        ? String(lead.closedWonAmount)
        : ""
    )
    setWonNotesInput(lead?.closingNotes || "")
    setWonClosureModalOpen(true)
  }

  // Quick Status Change Handler with Closed-Won Interception (Phase 5)
  const handleStatusChange = async (newStatus) => {
    if (!lead || !lead._id || newStatus === lead.status || updatingStatus) return

    // Strict validation: Closed-Won requires confirmed closing deal amount
    if (newStatus === "Closed-Won") {
      handleOpenWonClosureModal()
      return
    }

    try {
      setUpdatingStatus(true)
      const res = await apiClient.updateLeadStatus(lead._id, newStatus)
      if (res.success && res.data) {
        const updated = {
          ...lead,
          status: newStatus,
          dealStatus: newStatus === "Closed-Won" ? "Won" : newStatus === "Closed-Lost" ? "Lost" : "Open",
          metadata: {
            ...lead.metadata,
            statusHistory: res.data.statusHistory || [
              ...(lead.metadata?.statusHistory || []),
              {
                status: newStatus,
                changedAt: new Date().toISOString(),
                changedBy: "Current User",
              },
            ],
          },
        }
        setLead(updated)
        if (onLeadUpdated) onLeadUpdated(updated)
        toast.success(`Pipeline status updated to ${newStatus}`)
        // Refresh activity timeline to display new status_changed event
        fetchLeadActivities()
      }
    } catch (err) {
      toast.error(err.message || "Failed to update status")
    } finally {
      setUpdatingStatus(false)
    }
  }

  // Handle Confirmed Closed-Won Submission (Phase 5)
  const handleConfirmWonClosure = async (e) => {
    if (e) e.preventDefault()
    setWonAmountError(null)
    const amountNum = Number(wonAmountInput)
    if (!wonAmountInput || isNaN(amountNum) || amountNum <= 0) {
      setWonAmountError("A valid final closed won amount (greater than 0) is required when marking a lead as Closed-Won.")
      return
    }
    try {
      setIsSavingWon(true)
      const res = await apiClient.updateLead(lead._id, {
        status: "Closed-Won",
        closedWonAmount: amountNum,
        closingNotes: wonNotesInput ? wonNotesInput.trim() : undefined,
      })
      if (res && res.success && res.data) {
        setLead(res.data)
        if (onLeadUpdated) onLeadUpdated(res.data)
        toast.success(`Deal Closed-Won for ${res.data.currency || lead?.currency || "INR"} ${amountNum.toLocaleString()}!`)
        setWonClosureModalOpen(false)
        fetchLeadActivities()
        fetchLeadDetails()
      } else {
        const errMsg = res?.error || "Failed to mark deal as Closed-Won"
        setWonAmountError(errMsg)
        toast.error(errMsg)
      }
    } catch (err) {
      const errMsg = err.message || "Failed to mark deal as Closed-Won"
      setWonAmountError(errMsg)
      toast.error(errMsg)
    } finally {
      setIsSavingWon(false)
    }
  }

  // Handle Expected Deal Amount Update (Phase 5)
  const handleSaveExpectedAmount = async () => {
    const amountNum = Number(expectedAmountInput)
    if (isNaN(amountNum) || amountNum < 0) {
      toast.error("Please enter a valid deal amount")
      return
    }
    try {
      setIsSavingExpectedAmount(true)
      const res = await apiClient.updateLead(lead._id, {
        expectedDealAmount: amountNum,
      })
      if (res.success && res.data) {
        setLead(res.data)
        if (onLeadUpdated) onLeadUpdated(res.data)
        toast.success("Expected deal amount updated")
        setIsEditingExpectedAmount(false)
        fetchLeadActivities()
      } else {
        toast.error(res?.error || "Failed to update deal amount")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update deal amount")
    } finally {
      setIsSavingExpectedAmount(false)
    }
  }

  // Handle Lead Quotation PDF Upload (Phase 1)
  const handleUploadQuotation = async (e) => {
    e.preventDefault()
    if (!quotationFile) {
      toast.error("Please select a PDF quotation file")
      return
    }
    if (quotationFile.type !== "application/pdf" && !quotationFile.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported")
      return
    }
    if (quotationFile.size > 25 * 1024 * 1024) {
      toast.error("Quotation file exceeds 25MB limit")
      return
    }
    try {
      setUploadingQuotation(true)
      const formData = new FormData()
      formData.append("file", quotationFile)
      if (quotationNotes.trim()) {
        formData.append("notes", quotationNotes.trim())
      }
      const res = await apiClient.uploadQuotation(lead._id, formData)
      if (res && res.success) {
        toast.success("Quotation PDF uploaded successfully")
        setQuotationFile(null)
        setQuotationNotes("")
        fetchLeadQuotations()
        fetchLeadActivities()
        fetchLeadDetails()
        const updatedLeadPayload = res?.data?.lead || lead
        if (typeof onLeadUpdated === "function" && updatedLeadPayload) onLeadUpdated(updatedLeadPayload)
      } else {
        toast.error(res?.error || "Failed to upload quotation")
      }
    } catch (err) {
      toast.error(err.message || "Failed to upload quotation")
    } finally {
      setUploadingQuotation(false)
    }
  }

  // Open Send Quotation Modal (Phase 1)
  const handleOpenSendModal = (q) => {
    setSendModalQuotation(q)
    setSendRecipientEmail(lead?.email || "")
    setSendSubject(`Quotation: ${lead?.company || lead?.name || "Proposal"} - Leads365`)
    setSendBody(
      `Dear ${lead?.name || "Client"},\n\nPlease find attached the quotation as requested.\n\nPlease feel free to contact us if you have any questions or require any adjustments.\n\nBest regards,\n${lead?.assignedTo || "Sales Team"}`
    )
  }

  // Submit Send Quotation Email (Phase 1 & Phase 3)
  const handleSendQuotationSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!sendRecipientEmail.trim()) {
      toast.error("Recipient email is required")
      return
    }
    if (!sendModalQuotation) return
    try {
      setIsSendingQuotation(true)
      const res = await apiClient.sendQuotation(sendModalQuotation._id, {
        leadId: lead._id || lead.id,
        recipientEmail: sendRecipientEmail.trim(),
        subject: sendSubject.trim(),
        body: sendBody.trim(),
        emailSubject: sendSubject.trim(),
        emailBody: sendBody.trim(),
      })
      if (res && res.success) {
        toast.success("Quotation sent successfully via email")
        setSendModalQuotation(null)
        fetchLeadQuotations()
        fetchLeadCommHistory()
        fetchLeadActivities()
        fetchLeadDetails()
        const updatedLeadPayload = res?.data?.lead || lead
        if (typeof onLeadUpdated === "function" && updatedLeadPayload) onLeadUpdated(updatedLeadPayload)
      } else {
        const errorMsg = res?.error || "Failed to send quotation"
        toast.error(errorMsg)
      }
    } catch (err) {
      toast.error(err.message || "Failed to send quotation")
    } finally {
      setIsSendingQuotation(false)
    }
  }

  // Handle Quotation Delete / Void
  const handleOpenDeleteModal = (q) => {
    setDeleteModalQuotation(q)
  }

  const handleConfirmDeleteQuotation = async () => {
    if (!deleteModalQuotation || isDeletingQuotation) return
    try {
      setIsDeletingQuotation(true)
      const res = await apiClient.deleteQuotation(deleteModalQuotation._id)
      if (res && res.success) {
        const isVoided = res.data?.isVoided
        toast.success(res.message || (isVoided ? "Quotation voided and archived" : "Quotation deleted successfully"))
        setDeleteModalQuotation(null)
        fetchLeadQuotations()
        fetchLeadActivities()
        fetchLeadDetails()
        if (typeof onLeadUpdated === "function" && (lead?._id || lead?.id)) {
          onLeadUpdated({
            ...lead,
            quotationStatus: res.data?.leadQuotationStatus || lead?.quotationStatus,
          })
        }
      } else {
        toast.error(res?.error || "Failed to delete quotation")
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete quotation")
    } finally {
      setIsDeletingQuotation(false)
    }
  }

  // Add Note Handler
  const handleAddNote = async (e) => {
    e.preventDefault()
    if (!newNote.trim() || !lead || !lead._id || savingNote) return
    try {
      setSavingNote(true)
      const dateStr = new Date().toLocaleString()
      const formattedNote = `[Note - ${dateStr}]: ${newNote.trim()}`
      const updatedMessage = lead.message ? `${lead.message}\n\n${formattedNote}` : formattedNote

      const res = await apiClient.updateLead(lead._id, {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        message: updatedMessage,
      })

      if (res.success && res.data) {
        const updated = { ...lead, message: updatedMessage }
        setLead(updated)
        if (onLeadUpdated) onLeadUpdated(updated)
        setNewNote("")
        toast.success("Note added successfully")
        // Refresh activity timeline to display new note_added event
        fetchLeadActivities()
      }
    } catch (err) {
      toast.error(err.message || "Failed to save note")
    } finally {
      setSavingNote(false)
    }
  }

  // Synthesize Activity Timeline Events
  const activityTimeline = useMemo(() => {
    if (!lead) return []

    const events = []

    // 1. If real activities exist from backend API, map them directly
    if (Array.isArray(activities) && activities.length > 0) {
      activities.forEach((act, idx) => {
        if (!act) return
        const actId = act._id || act.id || `act-${idx}`
        const actDate = act.createdAt ? new Date(act.createdAt) : new Date()
        const actorName = act.actor?.name || "System"
        const actType = act.type || ""

        if (actType === "lead.created" || actType === "created") {
          events.push({
            id: actId,
            type: "created",
            title: "Lead Created",
            description: act.payload?.source
              ? `Lead ingested from ${act.payload.source}${act.payload?.company ? ` (${act.payload.company})` : ""}`
              : "Lead record created",
            actor: actorName,
            timestamp: actDate,
            icon: Sparkles,
            iconBg: "bg-blue-100 text-blue-600 border-blue-200",
            category: "status",
          })
        } else if (actType === "lead.status_changed" || actType === "status_changed") {
          events.push({
            id: actId,
            type: "status_change",
            title: act.payload?.toStatus ? `Status Changed to ${act.payload.toStatus}` : "Status Changed",
            description: act.payload?.fromStatus && act.payload?.toStatus
              ? `Transitioned from ${act.payload.fromStatus} to ${act.payload.toStatus}`
              : act.payload?.note || "Stage updated in sales pipeline",
            actor: actorName,
            timestamp: actDate,
            icon: History,
            iconBg: "bg-purple-100 text-purple-600 border-purple-200",
            category: "status",
            badge: act.payload?.toStatus,
          })
        } else if (actType === "lead.owner_changed" || actType === "owner_changed") {
          events.push({
            id: actId,
            type: "assignment",
            title: `Assigned to ${act.payload?.toOwnerName || "Staff"}`,
            description: act.payload?.reason
              ? `Reason: ${act.payload.reason} (Previous: ${act.payload?.fromOwnerName || "Unassigned"})`
              : `Reassigned from ${act.payload?.fromOwnerName || "Unassigned"}`,
            actor: actorName,
            timestamp: actDate,
            icon: User,
            iconBg: "bg-emerald-100 text-emerald-600 border-emerald-200",
            category: "assignment",
          })
        } else if (actType === "lead.note_added" || actType === "note_added") {
          events.push({
            id: actId,
            type: "note",
            title: "Note Added",
            description: act.payload?.note || "Note added to lead record",
            actor: actorName,
            timestamp: actDate,
            icon: MessageSquare,
            iconBg: "bg-indigo-100 text-indigo-600 border-indigo-200",
            category: "notes",
          })
        } else if (actType.startsWith("lead.followup") || actType.startsWith("followup")) {
          const isCompleted = actType.includes("completed")
          events.push({
            id: actId,
            type: isCompleted ? "followup_completed" : "followup_scheduled",
            title: isCompleted ? "Follow-up Completed" : "Follow-up Scheduled",
            description: act.payload?.outcomeNotes || act.payload?.notes || act.payload?.title || "Follow-up touchpoint",
            actor: actorName,
            timestamp: actDate,
            icon: isCompleted ? CheckCircle2 : CalendarClock,
            iconBg: isCompleted ? "bg-teal-100 text-teal-600 border-teal-200" : "bg-amber-100 text-amber-600 border-amber-200",
            category: "followup",
          })
        } else if (actType.startsWith("whatsapp.") || actType.startsWith("whatsapp_")) {
          const isInbound = actType.includes("received") || act.payload?.direction === "inbound"
          events.push({
            id: actId,
            type: isInbound ? "whatsapp_received" : "whatsapp_sent",
            title: isInbound ? "WhatsApp Inbound Message" : "WhatsApp Outbound Reply",
            description: act.payload?.text || act.payload?.body || "WhatsApp conversation event",
            actor: actorName,
            timestamp: actDate,
            icon: MessageCircle,
            iconBg: isInbound
              ? "bg-emerald-100 text-emerald-600 border-emerald-200"
              : "bg-teal-100 text-teal-700 border-teal-200",
            category: "notes",
            badge: isInbound ? "Inbound" : "Outbound",
          })
        } else if (actType.startsWith("quotation.") || actType.startsWith("quotation_")) {
          const isSent = actType.includes("sent")
          const isUpload = actType.includes("uploaded")
          events.push({
            id: actId,
            type: actType,
            title: isSent ? "Quotation Sent via Email" : isUpload ? "Quotation Document Uploaded" : "Quotation Requested",
            description: act.payload?.recipientEmail
              ? `Sent to ${act.payload.recipientEmail} (${act.payload.filename || "PDF"})${act.payload.providerMessageId ? ` [ID: ${act.payload.providerMessageId}]` : ""}`
              : act.payload?.filename
              ? `Uploaded: ${act.payload.filename} (${act.payload.fileSize ? `${Math.round(act.payload.fileSize / 1024)} KB` : "PDF"})`
              : act.payload?.evidence || "Customer quotation request registered",
            actor: actorName,
            timestamp: actDate,
            icon: isSent ? Send : isUpload ? UploadCloud : Receipt,
            iconBg: isSent
              ? "bg-emerald-100 text-emerald-600 border-emerald-200"
              : isUpload
              ? "bg-purple-100 text-purple-600 border-purple-200"
              : "bg-amber-100 text-amber-600 border-amber-200",
            category: "notes",
            badge: isSent ? "Sent" : isUpload ? "Uploaded" : "Requested",
          })
        } else if (actType.startsWith("brochure.") || actType.startsWith("brochure_")) {
          const isSent = actType.includes("sent")
          events.push({
            id: actId,
            type: actType,
            title: isSent ? "Product Brochure Sent via Email" : "Brochure Requested",
            description: act.payload?.recipientEmail
              ? `Sent to ${act.payload.recipientEmail} (${act.payload.filename || "PDF"}) [${act.payload.trigger || "Autonomous AI"}]`
              : act.payload?.evidence || act.payload?.productName || "Product brochure requested",
            actor: actorName,
            timestamp: actDate,
            icon: isSent ? Send : FileCheck,
            iconBg: isSent ? "bg-teal-100 text-teal-600 border-teal-200" : "bg-sky-100 text-sky-600 border-sky-200",
            category: "notes",
            badge: isSent ? "Auto-Sent" : "Requested",
          })
        } else if (actType === "deal.closed_won" || actType === "deal.amount_updated") {
          const isWon = actType === "deal.closed_won"
          events.push({
            id: actId,
            type: actType,
            title: isWon ? "Deal Closed-Won!" : "Expected Deal Amount Updated",
            description: isWon
              ? `Closing Amount: ${act.payload?.currency || "INR"} ${act.payload?.closedWonAmount?.toLocaleString?.() || act.payload?.closedWonAmount}${act.payload?.closingNotes ? ` — Note: ${act.payload.closingNotes}` : ""}`
              : `Expected Amount: ${act.payload?.currency || "INR"} ${act.payload?.expectedDealAmount?.toLocaleString?.() || act.payload?.expectedDealAmount}`,
            actor: actorName,
            timestamp: actDate,
            icon: isWon ? CheckCircle2 : DollarSign,
            iconBg: isWon ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-blue-100 text-blue-700 border-blue-200",
            category: "status",
          })
        } else if (actType === "email.failed") {
          events.push({
            id: actId,
            type: actType,
            title: "Email Dispatch Failed",
            description: `${act.payload?.templateType || "Email"} to ${act.payload?.recipientEmail || "recipient"}: ${act.payload?.error || "Dispatch failed"}`,
            actor: actorName,
            timestamp: actDate,
            icon: AlertCircle,
            iconBg: "bg-rose-100 text-rose-600 border-rose-200",
            category: "status",
          })
        } else {
          events.push({
            id: actId,
            type: actType,
            title: actType.replace("lead.", "").replace("_", " ").toUpperCase(),
            description: typeof act.payload === "object" ? JSON.stringify(act.payload) : String(act.payload || ""),
            actor: actorName,
            timestamp: actDate,
            icon: Clock,
            iconBg: "bg-slate-100 text-slate-600 border-slate-200",
            category: "status",
          })
        }
      })

      // Combine with active/scheduled follow-ups that aren't already represented
      if (Array.isArray(followUps)) {
        followUps.forEach((fu) => {
          if (!fu || !fu.createdAt) return
          const fuTime = new Date(fu.createdAt).getTime()
          const exists = events.some((e) => e.category === "followup" && Math.abs(e.timestamp.getTime() - fuTime) < 3000)
          if (!exists) {
            events.push({
              id: `fu-sched-${fu._id || fu.id}`,
              type: "followup_scheduled",
              title: `Follow-up Scheduled: ${fu.title || fu.type || "Call"}`,
              description: `Scheduled for ${new Date(fu.scheduledAt).toLocaleString()} with priority ${fu.priority || "medium"}`,
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.createdAt),
              icon: CalendarClock,
              iconBg: "bg-amber-100 text-amber-600 border-amber-200",
              category: "followup",
            })
          }
        })
      }
    } else {
      // Fallback: Synthesize from lead metadata, statusHistory, assignmentHistory
      // 1. Lead Creation Event
      if (lead.createdAt) {
        events.push({
          id: "event-created",
          type: "created",
          title: "Lead Created",
          description: `Lead ingested from ${lead.source || "Website Form"}${
            lead.attribution?.firstTouch?.landingPage ? ` on ${lead.attribution.firstTouch.landingPage}` : ""
          }`,
          actor: lead.metadata?.receivedVia ? "Webhook / API" : "System / User",
          timestamp: new Date(lead.createdAt),
          icon: Sparkles,
          iconBg: "bg-blue-100 text-blue-600 border-blue-200",
          category: "status",
        })
      }

      // 2. Status Transitions from metadata.statusHistory
      if (Array.isArray(lead.metadata?.statusHistory)) {
        lead.metadata.statusHistory.forEach((hist, idx) => {
          if (!hist) return
          const stName = hist.toStatus || hist.status
          const timeVal = hist.transitionedAt || hist.changedAt
          if (!stName) return
          events.push({
            id: `status-${idx}`,
            type: "status_change",
            title: `Status Changed to ${stName}`,
            description: hist.fromStatus
              ? `Transitioned from ${hist.fromStatus} to ${stName}`
              : hist.note || `Stage updated in sales pipeline`,
            actor: hist.transitionedBy || hist.changedBy || "System User",
            timestamp: timeVal ? new Date(timeVal) : new Date(),
            icon: History,
            iconBg: "bg-purple-100 text-purple-600 border-purple-200",
            category: "status",
            badge: stName,
          })
        })
      }

      // 3. Ownership / Assignment Transitions from assignmentHistory
      if (Array.isArray(lead.assignmentHistory)) {
        lead.assignmentHistory.forEach((assign, idx) => {
          if (!assign || !assign.assignedAt) return
          events.push({
            id: `assignment-${idx}`,
            type: "assignment",
            title: `Assigned to ${assign.toOwnerName || "Staff Member"}`,
            description: assign.reason
              ? `Reason: ${assign.reason} (Previous: ${assign.fromOwnerName || "Unassigned"})`
              : `Reassigned from ${assign.fromOwnerName || "Unassigned"}`,
            actor: assign.assignedByName || "System",
            timestamp: new Date(assign.assignedAt),
            icon: User,
            iconBg: "bg-emerald-100 text-emerald-600 border-emerald-200",
            category: "assignment",
          })
        })
      }

      // 4. Follow-up Activities
      if (Array.isArray(followUps)) {
        followUps.forEach((fu) => {
          if (!fu) return
          if (fu.createdAt) {
            events.push({
              id: `fu-created-${fu._id || fu.id}`,
              type: "followup_scheduled",
              title: `Follow-up Scheduled: ${fu.title || fu.type || "Call"}`,
              description: `Scheduled for ${new Date(fu.scheduledAt).toLocaleString()} with priority ${
                fu.priority || "medium"
              }`,
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.createdAt),
              icon: CalendarClock,
              iconBg: "bg-amber-100 text-amber-600 border-amber-200",
              category: "followup",
            })
          }
          if (fu.status === "completed" && (fu.completedAt || fu.updatedAt)) {
            events.push({
              id: `fu-completed-${fu._id || fu.id}`,
              type: "followup_completed",
              title: `Follow-up Completed: ${fu.title || fu.type}`,
              description: fu.outcomeNotes || fu.notes || "Marked as completed",
              actor: fu.assignedTo || "Staff",
              timestamp: new Date(fu.completedAt || fu.updatedAt),
              icon: CheckCircle2,
              iconBg: "bg-teal-100 text-teal-600 border-teal-200",
              category: "followup",
            })
          }
        })
      }

      // 5. Notes / Inquiries
      if (lead.message) {
        events.push({
          id: "event-note-primary",
          type: "note",
          title: "Inquiry / Note Added",
          description: lead.message,
          actor: lead.name || "Lead",
          timestamp: new Date(lead.createdAt || Date.now()),
          icon: MessageSquare,
          iconBg: "bg-indigo-100 text-indigo-600 border-indigo-200",
          category: "notes",
        })
      }
    }

    // Sort descending by timestamp
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return events
  }, [lead, activities, followUps])

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === "all") return activityTimeline
    return activityTimeline.filter((ev) => ev.category === timelineFilter)
  }, [activityTimeline, timelineFilter])

  if (!isOpen) return null

  const shortId = (lead?._id || lead?.id || "").slice(-6).toUpperCase()
  const statusInfo = STATUS_CONFIG[lead?.status] || {
    label: lead?.status || "New",
    dotColor: "bg-blue-500",
    badgeClasses: "bg-blue-50 text-blue-700 border-blue-200/80",
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Slide-out Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div className="w-screen max-w-2xl bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out animate-in slide-in-from-right">
          
          {/* =========================================================================
              DRAWER HEADER
          ========================================================================= */}
          <div className="p-4 sm:p-6 bg-slate-50/70 border-b border-slate-200 shrink-0">
            <div className="flex items-start justify-between gap-4">
              {/* Lead identity & avatar */}
              <div className="flex items-start space-x-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg uppercase shadow-sm shrink-0">
                  {lead?.name ? lead.name.charAt(0) : "L"}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-bold text-slate-900 truncate">{lead?.name || "Lead Details"}</h2>
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700">
                      #LD-{shortId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(lead?._id || lead?.id, "lead-id")}
                      className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                      title="Copy full Lead ID"
                    >
                      {copiedField === "lead-id" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {lead?.company && (
                    <div className="flex items-center space-x-1.5 text-xs text-indigo-700 font-semibold mt-0.5">
                      <Building2 className="w-3.5 h-3.5" />
                      <span className="truncate">{lead.company}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {/* Status badge with interactive dropdown */}
                    <div className="relative inline-block">
                      <select
                        value={lead?.status || "New"}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        disabled={updatingStatus}
                        className={`text-xs font-bold rounded-full pl-6 pr-6 py-1 border transition-colors cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${statusInfo.badgeClasses}`}
                      >
                        {ALL_STATUSES.map((st) => (
                          <option key={st} value={st} className="bg-white text-slate-800 font-medium">
                            {st}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`w-1.5 h-1.5 rounded-full absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${statusInfo.dotColor}`}
                      />
                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    {/* Owner / Assignee */}
                    {canAssignLead ? (
                      <div className="relative inline-flex items-center">
                        <select
                          value={
                            lead?.assignedStaffId ||
                            (staffList.find((s) => s.name === lead?.assignedTo)?._id) ||
                            (staffList.find((s) => s.name === lead?.assignedTo)?.id) ||
                            "unassigned"
                          }
                          onChange={(e) => handleAssignStaff(e.target.value)}
                          disabled={isAssigningStaff}
                          className="text-xs font-semibold rounded-full pl-6 pr-6 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                          title="Click to assign or reassign lead to a sales representative"
                        >
                          <option value="unassigned">Unassigned</option>
                          {staffList.map((st) => (
                            <option key={st.id || st._id} value={st.id || st._id}>
                              {st.name} ({st.role})
                            </option>
                          ))}
                        </select>
                        <User className="w-3 h-3 text-slate-400 absolute left-2 pointer-events-none" />
                        <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 pointer-events-none" />
                      </div>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{lead?.assignedTo || "Unassigned"}</span>
                      </span>
                    )}

                    {/* Source pill */}
                    <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      <Globe className="w-3 h-3" />
                      <span>{lead?.source || "Website"}</span>
                    </div>

                    {/* Auto-Captured Badge */}
                    {(lead?.metadata?.captureSource === "ANDROID_AUTO_CALL_CAPTURE" || lead?.metadata?.autoCaptured === true) && (
                      <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
                        <PhoneIncoming className="w-3 h-3 text-amber-600" />
                        <span>Auto Captured from Incoming Call</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons on header */}
              <div className="flex items-center space-x-1.5 shrink-0">
                <button
                  type="button"
                  onClick={fetchLeadDetails}
                  disabled={loading}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Refresh lead record"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  title="Close Drawer (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Contact Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-200/80 text-xs text-slate-600 font-mono">
              <div className="flex items-center space-x-2 truncate">
                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {lead?.email ? (
                  <a href={`mailto:${lead.email}`} className="truncate hover:text-indigo-600 hover:underline">
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-slate-400 italic">No email address</span>
                )}
              </div>
              <div className="flex items-center space-x-2 truncate">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {lead?.phone ? (
                  <a href={`tel:${lead.phone}`} className="truncate hover:text-indigo-600 hover:underline">
                    {lead.phone}
                    {lead.phoneNormalized && lead.phoneNormalized !== lead.phone && (
                      <span className="text-[10px] text-slate-400 ml-1">({lead.phoneNormalized})</span>
                    )}
                  </a>
                ) : (
                  <span className="text-slate-400 italic">No phone number</span>
                )}
              </div>
            </div>
          </div>

          {/* =========================================================================
              TABS NAVIGATION
          ========================================================================= */}
          <div className="flex items-center px-3 sm:px-6 bg-white border-b border-slate-200 shrink-0 overflow-x-auto no-scrollbar text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "timeline"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Timeline</span>
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold leading-none">
                {activityTimeline.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("notes")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "notes"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Notes</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("followups")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "followups"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Follow-ups</span>
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold leading-none">
                {followUps.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("calls")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "calls"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Calls & Recordings</span>
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold leading-none">
                {calls.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("whatsapp")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "whatsapp"
                  ? "border-emerald-600 text-emerald-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
              {whatsappMessages.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-700 font-bold">
                  {whatsappMessages.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("documents")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "documents"
                  ? "border-indigo-600 text-indigo-600 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Documents & Quotes</span>
              {lead?.quotationRequested && (
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse ml-0.5" title="Quotation Requested" />
              )}
              {activeQuotations.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold leading-none">
                  {activeQuotations.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`py-3 px-3.5 border-b-2 flex items-center space-x-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === "details"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Details & Attribution</span>
            </button>
          </div>

          {/* =========================================================================
              TAB CONTENT BODY
          ========================================================================= */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* TAB 1: ACTIVITY TIMELINE */}
            {activeTab === "timeline" && (
              <div className="space-y-4">
                {/* Timeline Filter Pills */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-400 mr-1 text-[11px]">Filter:</span>
                    {["all", "status", "assignment", "followup", "notes"].map((filterKey) => (
                      <button
                        key={filterKey}
                        type="button"
                        onClick={() => setTimelineFilter(filterKey)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                          timelineFilter === filterKey
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}
                      </button>
                    ))}
                  </div>

                  <span className="text-[11px] text-slate-400 font-mono">
                    {filteredTimeline.length} events
                  </span>
                </div>

                {loadingActivities && activities.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 space-y-2">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-medium">Loading timeline activities...</p>
                  </div>
                ) : activitiesError ? (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                    <span>{activitiesError}</span>
                    <button
                      type="button"
                      onClick={fetchLeadActivities}
                      className="px-2.5 py-1 bg-white border border-rose-300 rounded font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                ) : filteredTimeline.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 space-y-2">
                    <History className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="text-xs font-medium">No activity events found for this filter</p>
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {filteredTimeline.map((item) => {
                      const IconComponent = item.icon || Clock
                      return (
                        <div key={item.id} className="relative group">
                          {/* Circle Icon Badge on Timeline Bar */}
                          <div
                            className={`absolute -left-6 top-0 w-6 h-6 rounded-full flex items-center justify-center border text-xs shadow-2xs ${item.iconBg}`}
                          >
                            <IconComponent className="w-3 h-3" />
                          </div>

                          <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/80 hover:bg-slate-50 transition-colors">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-bold text-xs text-slate-900">{item.title}</h4>
                                <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{item.description}</p>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap shrink-0">
                                {item.timestamp ? item.timestamp.toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }) : "—"}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2 border-t border-slate-200/50">
                              <span className="flex items-center gap-1 font-medium">
                                <User className="w-3 h-3 text-slate-400" />
                                <span>{item.actor}</span>
                              </span>
                              {item.badge && (
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-200 text-slate-700">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: NOTES */}
            {activeTab === "notes" && (
              <div className="space-y-5">
                {/* Add Note Form */}
                <form onSubmit={handleAddNote} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Add New Note</span>
                    </label>
                    <span className="text-[10px] text-slate-400">Appends to lead communication notes</span>
                  </div>
                  <textarea
                    rows={3}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Enter discussion notes, call takeaways, or follow-up instructions..."
                    className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!newNote.trim() || savingNote}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      {savingNote ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Saving Note...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Save Note</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Display Current Notes */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-900">Communication Notes</h4>
                  {lead?.message ? (
                    <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans">
                      {lead.message}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      No notes recorded for this lead yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: FOLLOW-UPS */}
            {activeTab === "followups" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900">Scheduled Follow-ups</h4>
                  <Link
                    href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>+ Schedule Follow-up</span>
                  </Link>
                </div>

                {loadingFollowUps ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Loading follow-ups...
                  </div>
                ) : followUps.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-100 p-6 space-y-2">
                    <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-medium">No follow-ups scheduled for this lead</p>
                    <Link
                      href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                      className="inline-block text-xs text-indigo-600 hover:underline font-semibold mt-1"
                    >
                      Schedule first follow-up call or task
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {followUps.map((fu) => {
                      const isCompleted = fu.status === "completed"
                      const isDue = fu.status === "due"
                      const isOverdue =
                        (fu.status === "pending" || fu.status === "due") && new Date(fu.scheduledAt) < new Date()
                      return (
                        <div
                          key={fu._id || fu.id}
                          className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900 truncate">{fu.title || fu.type}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isCompleted
                                    ? "bg-emerald-100 text-emerald-800"
                                    : isDue
                                    ? "bg-amber-100 text-amber-800 animate-pulse"
                                    : isOverdue
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {isCompleted ? "Completed" : isDue ? "Due Now" : isOverdue ? "Overdue" : "Pending"}
                              </span>
                            </div>
                            <p className="text-slate-500 font-mono text-[11px]">
                              {fu.scheduledAt ? new Date(fu.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}
                              {fu.callbackTimezone ? ` (${fu.callbackTimezone})` : ""}
                            </p>
                            {fu.callbackReason && (
                              <p className="text-indigo-700 font-medium text-[11px]">
                                Reason: {fu.callbackReason}
                              </p>
                            )}
                            {fu.productContext && (
                              <p className="text-slate-500 text-[10px]">
                                Product: {fu.productContext}
                              </p>
                            )}
                            {fu.notes && fu.notes !== fu.callbackReason && (
                              <p className="text-slate-600 mt-1 text-[11px]">{fu.notes}</p>
                            )}
                          </div>

                          <div className="flex flex-col items-end space-y-2 shrink-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
                              {fu.priority || "Medium"}
                            </span>
                            {!isCompleted && (
                              <div className="flex items-center space-x-1.5 pt-1">
                                {lead?.phone && (
                                  <a
                                    href={`tel:${lead.phone}`}
                                    className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                                    title="Call Customer"
                                  >
                                    <Phone className="w-3.5 h-3.5" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleCompleteFollowUp(fu._id || fu.id)}
                                  className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-[11px] font-semibold transition-colors cursor-pointer"
                                  title="Mark as Completed"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Done</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CALLS & RECORDINGS (Phase 14) */}
            {activeTab === "calls" && (
              <div className="space-y-4">
                {/* Header bar with count and Log Call toggle button */}
                <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <PhoneCall className="w-4 h-4 text-indigo-600" />
                      <span>Telephony & Call Logs</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Target: <span className="font-mono font-semibold">{lead?.phoneNormalized || lead?.phone || "No phone"}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLogCallForm(!showLogCallForm)}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition cursor-pointer shadow-xs"
                  >
                    {showLogCallForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{showLogCallForm ? "Cancel" : "Log Call"}</span>
                  </button>
                </div>

                {/* Collapsible Log Call Form */}
                {showLogCallForm && (
                  <form
                    onSubmit={handleLogCallSubmit}
                    className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100 space-y-3 animate-in fade-in duration-200"
                  >
                    <div className="flex items-center justify-between border-b border-indigo-100/60 pb-2">
                      <span className="text-xs font-bold text-indigo-900">Record a Call Interaction</span>
                      <span className="text-[10px] text-slate-400">Updates lead timeline & last contact</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Direction</label>
                        <select
                          value={callFormData.direction}
                          onChange={(e) => setCallFormData({ ...callFormData, direction: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="outbound">Outbound (Agent initiated)</option>
                          <option value="inbound">Inbound (Client received)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Duration (seconds)</label>
                        <input
                          type="number"
                          min="0"
                          value={callFormData.duration}
                          onChange={(e) => setCallFormData({ ...callFormData, duration: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="60"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                        <select
                          value={callFormData.status}
                          onChange={(e) => setCallFormData({ ...callFormData, status: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="completed">Completed (Connected)</option>
                          <option value="busy">Busy</option>
                          <option value="no-answer">No Answer</option>
                          <option value="failed">Failed / Dropped</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Disposition</label>
                        <select
                          value={callFormData.disposition}
                          onChange={(e) => setCallFormData({ ...callFormData, disposition: e.target.value })}
                          className="w-full text-xs rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="Interested">Interested / Qualified</option>
                          <option value="Follow-up Required">Follow-up Required</option>
                          <option value="Not Interested">Not Interested</option>
                          <option value="Wrong Number">Wrong Number</option>
                          <option value="Left Voicemail">Left Voicemail</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Discussion Notes</label>
                      <textarea
                        rows={2}
                        value={callFormData.notes}
                        onChange={(e) => setCallFormData({ ...callFormData, notes: e.target.value })}
                        placeholder="Add call outcome notes, customer feedback, next steps..."
                        className="w-full text-xs rounded-lg border border-slate-300 bg-white p-2.5 font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowLogCallForm(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingCall}
                        className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:opacity-50"
                      >
                        {submittingCall ? "Saving..." : "Save Call Log"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Loading State */}
                {loadingCalls && (
                  <div className="py-8 text-center text-xs text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-indigo-500 mb-2" />
                    Loading call interactions...
                  </div>
                )}

                {/* Empty State */}
                {!loadingCalls && calls.length === 0 && (
                  <div className="py-10 text-center space-y-3 max-w-sm mx-auto">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-100">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <h5 className="font-bold text-xs text-slate-800">No calls recorded yet</h5>
                    <p className="text-[11px] text-slate-500">
                      Log calls manually using the button above, or allow agent mobile devices to sync call logs automatically.
                    </p>
                  </div>
                )}

                {/* Call Logs List */}
                {!loadingCalls && calls.length > 0 && (
                  <div className="space-y-2.5">
                    {calls.map((c) => {
                      const isOutbound = c.direction === "outbound"
                      const durationMinutes = Math.floor((c.duration || 0) / 60)
                      const durationSeconds = (c.duration || 0) % 60
                      const durationStr = durationMinutes > 0 ? `${durationMinutes}m ${durationSeconds}s` : `${durationSeconds}s`

                      return (
                        <div
                          key={c._id || c.id}
                          className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isOutbound ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}
                              >
                                {isOutbound ? <PhoneOutgoing className="w-3 h-3" /> : <PhoneIncoming className="w-3 h-3" />}
                                <span className="capitalize">{c.direction}</span>
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  c.status === "completed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : c.status === "busy"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700"
                                }`}
                              >
                                {c.status}
                              </span>
                              {c.disposition && (
                                <span className="text-[10px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                                  {c.disposition}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-500">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{durationStr}</span>
                            </div>
                          </div>

                          {c.notes && (
                            <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100 font-sans leading-relaxed">
                              {c.notes}
                            </p>
                          )}

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                            <div className="flex items-center space-x-1.5">
                              <User className="w-3 h-3 text-slate-400" />
                              <span>{c.agentId?.name || "Agent"}</span>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              {c.recording?.status === "stored" || c.recording?.status === "ready" || c.hasRecording ? (
                                <button
                                  type="button"
                                  onClick={() => setPlayingCallId(playingCallId === (c._id || c.id || c.clientCallId) ? null : (c._id || c.id || c.clientCallId))}
                                  className="inline-flex items-center text-indigo-600 hover:text-indigo-800 font-bold gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 transition"
                                >
                                  <Mic className="w-3 h-3" />
                                  <span>{playingCallId === (c._id || c.id || c.clientCallId) ? "Hide Player" : "Play Recording"}</span>
                                </button>
                              ) : c.recording?.status === "skipped_dnr" ? (
                                <span className="inline-flex items-center text-rose-600 text-[10px] font-semibold gap-1">
                                  <Shield className="w-3 h-3" /> Skipped (DNR)
                                </span>
                              ) : c.recording?.status === "expired" ? (
                                <span className="inline-flex items-center text-amber-600 text-[10px] font-semibold gap-1">
                                  <Clock className="w-3 h-3" /> Purged (30d)
                                </span>
                              ) : (
                                <span className="text-slate-400">No recording</span>
                              )}
                              <span>•</span>
                              <span>{c.startedAt ? new Date(c.startedAt).toLocaleString() : "—"}</span>
                            </div>
                          </div>
                          {/* Embedded In-Browser Audio Player (Phase 19) */}
                          {playingCallId === (c._id || c.id || c.clientCallId) && (
                            <div className="pt-2">
                              <InBrowserAudioPlayer
                                callId={c._id || c.id || c.clientCallId}
                                recording={c.recording}
                                agentName={c.agentId?.name || "Agent"}
                                leadPhone={c.number || lead?.phone}
                                direction={c.direction}
                                compact={true}
                                onClose={() => setPlayingCallId(null)}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: DETAILS & ATTRIBUTION */}
            {activeTab === "details" && (
              <div className="space-y-6 text-xs">
                {/* 0. Deal Value & Closing Information Card (Phase 5) */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Deal Value & Closing Information</span>
                    </h4>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        lead?.status === "Closed-Won" || lead?.dealStatus === "Won"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : lead?.status === "Closed-Lost" || lead?.dealStatus === "Lost"
                          ? "bg-rose-100 text-rose-800 border border-rose-200"
                          : "bg-blue-100 text-blue-800 border border-blue-200"
                      }`}
                    >
                      {lead?.status === "Closed-Won" || lead?.dealStatus === "Won"
                        ? "Won Deal"
                        : lead?.status === "Closed-Lost" || lead?.dealStatus === "Lost"
                        ? "Lost Deal"
                        : "Open Pipeline"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                    {/* Expected Deal Amount */}
                    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[11px]">Expected Deal Amount</span>
                        {!isEditingExpectedAmount && canEditLead && (
                          <button
                            type="button"
                            onClick={() => setIsEditingExpectedAmount(true)}
                            className="text-indigo-600 hover:text-indigo-800 text-[10px] font-semibold cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {isEditingExpectedAmount ? (
                        <div className="flex items-center space-x-1.5 pt-1">
                          <span className="text-xs text-slate-500 font-bold">{lead?.currency || "INR"}</span>
                          <input
                            type="number"
                            value={expectedAmountInput}
                            onChange={(e) => setExpectedAmountInput(e.target.value)}
                            placeholder="0"
                            className="w-28 px-2 py-1 text-xs border border-indigo-400 rounded focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleSaveExpectedAmount}
                            disabled={isSavingExpectedAmount}
                            className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-semibold hover:bg-indigo-700 cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingExpectedAmount(false)
                              setExpectedAmountInput(lead?.expectedDealAmount ? String(lead.expectedDealAmount) : "")
                            }}
                            className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-[10px] hover:bg-slate-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm font-bold text-slate-900">
                          {lead?.expectedDealAmount !== undefined && lead?.expectedDealAmount !== null
                            ? `${lead?.currency || "INR"} ${Number(lead.expectedDealAmount).toLocaleString()}`
                            : "— Not Set"}
                        </div>
                      )}
                    </div>

                    {/* Closed Won Amount */}
                    <div className={`p-3 rounded-lg border space-y-1.5 ${
                      lead?.status === "Closed-Won" || (lead?.closedWonAmount && Number(lead.closedWonAmount) > 0)
                        ? "bg-emerald-50/80 border-emerald-200"
                        : "bg-white border-slate-200"
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[11px] block">Closed-Won Amount</span>
                        <button
                          type="button"
                          onClick={handleOpenWonClosureModal}
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>{lead?.status === "Closed-Won" ? "Edit Won Amount" : "Close as Won"}</span>
                        </button>
                      </div>
                      <div className={`text-sm font-bold ${
                        lead?.closedWonAmount && Number(lead.closedWonAmount) > 0 ? "text-emerald-700 font-mono" : "text-slate-400"
                      }`}>
                        {lead?.closedWonAmount !== undefined && lead?.closedWonAmount !== null && Number(lead.closedWonAmount) > 0
                          ? `${lead?.currency || "INR"} ${Number(lead.closedWonAmount).toLocaleString()}`
                          : "— Not Closed"}
                      </div>
                      {lead?.closedAt && (
                        <span className="text-[10px] text-emerald-600 block">
                          Closed: {new Date(lead.closedAt).toLocaleDateString()} by {lead.closedByName || "Agent"}
                        </span>
                      )}
                    </div>
                  </div>

                  {lead?.closingNotes && (
                    <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs">
                      <span className="text-slate-400 block text-[10px] font-mono mb-0.5">Closing Deal Notes</span>
                      <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{lead.closingNotes}</p>
                    </div>
                  )}

                  {/* Deal Revision History */}
                  {Array.isArray(lead?.amountHistory) && lead.amountHistory.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                        Amount Revision History
                      </span>
                      <div className="space-y-1 font-mono text-[10px] max-h-24 overflow-y-auto">
                        {lead.amountHistory.map((hist, idx) => (
                          <div key={idx} className="flex items-center justify-between text-slate-600 bg-white p-1.5 rounded border border-slate-100">
                            <span>
                              {hist.changeType === "closed_won" ? "Closed Won:" : "Expected:"}{" "}
                              <strong className="text-slate-800">{lead.currency || "INR"} {Number(hist.amount).toLocaleString()}</strong>
                              {hist.previousAmount !== undefined && (
                                <span className="text-slate-400 ml-1">(was {Number(hist.previousAmount).toLocaleString()})</span>
                              )}
                            </span>
                            <span className="text-slate-400">
                              {new Date(hist.changedAt).toLocaleDateString([], { month: "short", day: "numeric" })} • {hist.changedByName || "User"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 1. Contact Info Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Contact Information</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Full Name</span>
                      <span className="font-semibold text-slate-800">{lead?.name || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Email Address</span>
                      <span className="font-semibold text-slate-800">{lead?.email || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Primary Phone</span>
                      <span className="font-semibold text-slate-800">{lead?.phone || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Normalized (E.164)</span>
                      <span className="font-semibold text-slate-800">{lead?.phoneNormalized || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Alternate Phone</span>
                      <span className="font-semibold text-slate-800">{lead?.alternatePhone || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Company / Organization</span>
                      <span className="font-semibold text-slate-800">{lead?.company || lead?.metadata?.company || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">City / Location</span>
                      <span className="font-semibold text-slate-800">{lead?.city || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Assigned Staff</span>
                      <span className="font-semibold text-slate-800">{lead?.assignedTo || "Unassigned"}</span>
                    </div>
                    {lead?.message && (
                      <div className="col-span-1 sm:col-span-2 pt-2 border-t border-slate-200/80">
                        <span className="text-slate-400 block text-[11px] mb-1">Message / Inquiry</span>
                        <p className="font-sans text-xs text-slate-800 whitespace-pre-wrap break-words leading-relaxed bg-white p-2.5 rounded-lg border border-slate-200">
                          {lead.message}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 1.2 Submitted Website Form Details Card */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Website Form Details</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {lead?.metadata?.receivedVia || "website_form"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Form Identifier</span>
                      <span className="font-semibold text-slate-800">{lead?.formId || "website_form"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Lead Source</span>
                      <span className="font-semibold text-slate-800">{lead?.source || "Website"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Landing Page URL</span>
                      <span className="text-slate-800 break-all block">{lead?.landingPage || lead?.attribution?.firstTouch?.landingPage || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Referrer</span>
                      <span className="text-slate-800 break-all block">{lead?.attribution?.firstTouch?.referrer || lead?.metadata?.referrer || "Direct / None"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Submission Timestamp</span>
                      <span className="text-slate-800">{lead?.createdAt ? new Date(lead.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Verification Status</span>
                      <span className={lead?.isEmailVerified ? "text-emerald-700 font-semibold" : "text-slate-600"}>
                        {lead?.verificationStatus || (lead?.isEmailVerified ? "Verified" : "Unverified")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 1.5 Custom Lead Attributes & Dynamic Form Fields */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Custom Form Fields</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {normalizedCustomFields.length} {normalizedCustomFields.length === 1 ? "field" : "fields"} recorded
                    </span>
                  </div>

                  {normalizedCustomFields.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {normalizedCustomFields.map((field) => {
                        const isArray = Array.isArray(field.value)
                        const isBool = typeof field.value === "boolean"
                        const isMultiline = typeof field.value === "string" && (field.value.includes("\n") || field.value.length > 80)

                        return (
                          <div
                            key={field.key}
                            className={`p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1.5 ${
                              isMultiline ? "sm:col-span-2" : ""
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-slate-700 truncate">{field.label}</span>
                              <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                {field.type}
                              </span>
                            </div>

                            {/* Format safely according to field type */}
                            <div className="text-xs text-slate-900 font-medium">
                              {isArray ? (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {field.value.map((item, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100"
                                    >
                                      {String(item)}
                                    </span>
                                  ))}
                                </div>
                              ) : isBool || field.type === "checkbox" ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    field.value === true || String(field.value).toLowerCase() === "true"
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : "bg-slate-100 text-slate-600 border border-slate-200"
                                  }`}
                                >
                                  {field.value === true || String(field.value).toLowerCase() === "true" ? "Yes" : "No"}
                                </span>
                              ) : field.type === "date" ? (
                                <span className="font-mono text-slate-800">
                                  {isNaN(Date.parse(field.value)) ? String(field.value) : new Date(field.value).toLocaleDateString()}
                                </span>
                              ) : field.type === "select" || field.type === "dropdown" ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-100">
                                  {String(field.value)}
                                </span>
                              ) : field.type === "number" ? (
                                <span className="font-mono font-bold text-slate-800">
                                  {String(field.value)}
                                </span>
                              ) : (
                                <p className="text-slate-800 break-words whitespace-pre-wrap leading-relaxed">
                                  {String(field.value)}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="p-3 bg-white rounded-lg border border-dashed border-slate-200 text-center text-slate-400 text-[11px] italic">
                      No custom form fields recorded for this lead record.
                    </div>
                  )}
                </div>

                {/* 2. Marketing Attribution (Multi-touch) */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Multi-touch Marketing Attribution</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">First-touch write once</span>
                  </div>

                  <div className="space-y-3">
                    {/* First Touch */}
                    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                      <span className="text-[11px] font-bold text-indigo-700 block">First Touch Attribution</span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Source</span>
                          <span className="font-semibold text-slate-800">{lead?.attribution?.firstTouch?.source || lead?.source || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Medium</span>
                          <span className="text-slate-800">{lead?.attribution?.firstTouch?.medium || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Campaign</span>
                          <span className="text-slate-800">{lead?.attribution?.firstTouch?.campaign || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">GCLID</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.gclid || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">FBCLID</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.fbclid || "—"}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Landing Page</span>
                          <span className="text-slate-800 truncate block">{lead?.attribution?.firstTouch?.landingPage || lead?.landingPage || "—"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Last Touch if different */}
                    {lead?.attribution?.lastTouch?.source && (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                        <span className="text-[11px] font-bold text-slate-700 block">Last Touch Attribution</span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Source</span>
                            <span className="font-semibold text-slate-800">{lead.attribution.lastTouch.source}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Medium</span>
                            <span className="text-slate-800">{lead.attribution.lastTouch.medium || "—"}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">Campaign</span>
                            <span className="text-slate-800">{lead.attribution.lastTouch.campaign || "—"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. System Metadata & Partitioning */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-600" />
                    <span>System Record & Partition</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tenant ID:</span>
                      <span className="font-bold text-indigo-700">{lead?.tenantId || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email Verified:</span>
                      <span className={lead?.isEmailVerified ? "text-emerald-600 font-bold" : "text-slate-500"}>
                        {lead?.verificationStatus || (lead?.isEmailVerified ? "Verified" : "Unverified")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Created At:</span>
                      <span>{lead?.createdAt ? new Date(lead.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Contacted:</span>
                      <span>{lead?.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : "Never"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: WHATSAPP MESSAGE MIRROR */}
            {activeTab === "whatsapp" && (
              <div className="flex flex-col h-[580px] max-h-[72vh] bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                {/* Chat Header */}
                <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                      <MessageCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{lead?.name || "WhatsApp Contact"}</span>
                        <span className="text-[10px] font-mono font-normal text-slate-500">
                          ({lead?.phoneNormalized || lead?.phone || "No phone"})
                        </span>
                      </div>
                      <div className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                        <span>WhatsApp Message Mirror</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fetchWhatsAppMessages}
                    disabled={loadingWhatsApp}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Refresh conversation"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingWhatsApp ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {/* Error Banner */}
                {whatsAppError && (
                  <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>{whatsAppError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWhatsAppError(null)}
                      className="text-rose-400 hover:text-rose-600 text-xs font-bold px-1"
                    >
                      &times;
                    </button>
                  </div>
                )}

                {/* Chat Messages Container */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f0f2f5]">
                  {loadingWhatsApp && whatsappMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
                      <span className="text-xs font-medium">Loading WhatsApp messages...</span>
                    </div>
                  ) : whatsappMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <MessageSquare className="w-6 h-6" />
                      </div>
                      <div className="max-w-xs">
                        <h4 className="text-xs font-bold text-slate-800">No WhatsApp messages yet</h4>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Messages synced from your linked phone WhatsApp will appear here automatically.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {whatsappMessages.map((msg, index) => {
                        const isInbound = msg.direction === "inbound"
                        const msgDate = msg.timestamp ? new Date(msg.timestamp) : new Date()

                        return (
                          <div
                            key={msg._id || msg.id || index}
                            className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-2xs text-xs relative ${
                                isInbound
                                  ? "bg-white border border-slate-200 text-slate-800 rounded-tl-xs"
                                  : "bg-emerald-600 text-white rounded-tr-xs"
                              }`}
                            >
                              {/* Message sender label for inbound */}
                              {isInbound && (
                                <div className="text-[10px] font-bold text-emerald-700 mb-0.5">
                                  {msg.senderPhone || lead?.name || "Customer"}
                                </div>
                              )}

                              {/* Message Body */}
                              <p className="whitespace-pre-wrap break-words leading-relaxed text-xs">
                                {msg.body || "[No message content]"}
                              </p>

                              {/* Footer timestamp & status ticks */}
                              <div
                                className={`flex items-center justify-end space-x-1 mt-1 text-[9px] ${
                                  isInbound ? "text-slate-400" : "text-emerald-100"
                                }`}
                              >
                                <span>
                                  {msgDate.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {!isInbound && (
                                  <span className="inline-flex items-center ml-1">
                                    {msg.status === "read" ? (
                                      <CheckCheck className="w-3.5 h-3.5 text-sky-200" title="Read" />
                                    ) : msg.status === "delivered" ? (
                                      <CheckCheck className="w-3.5 h-3.5 text-emerald-200" title="Delivered" />
                                    ) : msg.status === "failed" ? (
                                      <AlertCircle className="w-3.5 h-3.5 text-rose-300" title="Failed" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 text-emerald-200" title="Sent" />
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={chatBottomRef} />
                    </>
                  )}
                </div>

                {/* Read-Only Mirror Footer */}
                <div className="px-4 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-[11px] text-slate-600 font-medium">Read-only message mirror synced from linked phone WhatsApp</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Replies are sent directly from your phone</span>
                </div>
              </div>
            )}

            {/* TAB: DOCUMENTS & COMMUNICATION (Phases 1 & 4) */}
            {activeTab === "documents" && (
              <div className="space-y-6 text-xs">
                {/* Quotation Requested Alert Banner */}
                {lead?.quotationRequested && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span className="font-bold text-amber-900 text-xs">
                          Quotation Required — Customer Requested Quotation
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 uppercase">
                        {lead.quotationStatus || "Requested"}
                      </span>
                    </div>

                    {lead.quotationRequestedEvidence && (
                      <div className="p-2.5 bg-white/90 border border-amber-200/80 rounded-lg text-slate-700 text-xs italic">
                        &ldquo;{lead.quotationRequestedEvidence}&rdquo;
                        {lead.quotationRequestedAt && (
                          <span className="block not-italic text-[10px] text-slate-400 mt-1 font-mono">
                            Detected: {new Date(lead.quotationRequestedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Section 1: Upload Quotation Document */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <UploadCloud className="w-4 h-4 text-indigo-600" />
                      <span>Upload Quotation Document (PDF)</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">Max 25MB • Secure GridFS</span>
                  </div>

                  <form onSubmit={handleUploadQuotation} className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-700 block">
                        Select Quotation PDF File
                      </label>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => setQuotationFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border border-slate-200 rounded-lg p-1.5 bg-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-700 block">
                        Quotation Reference / Notes (Optional)
                      </label>
                      <input
                        type="text"
                        value={quotationNotes}
                        onChange={(e) => setQuotationNotes(e.target.value)}
                        placeholder="e.g. Standard 20-bed hospital package proposal v1"
                        className="w-full p-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={!quotationFile || uploadingQuotation}
                        className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm cursor-pointer"
                      >
                        {uploadingQuotation ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Uploading PDF...</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud className="w-3.5 h-3.5" />
                            <span>Upload Quotation</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Section 2: Uploaded Quotations List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Receipt className="w-4 h-4 text-indigo-600" />
                      <span>Uploaded Quotations</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {activeQuotations.length} {activeQuotations.length === 1 ? "document" : "documents"}
                    </span>
                  </div>

                  {loadingQuotations ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      Loading quotations...
                    </div>
                  ) : activeQuotations.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl space-y-1 text-xs">
                      <FileText className="w-8 h-8 text-slate-300 mx-auto mb-1" />
                      <p className="font-semibold text-slate-600">No quotation documents uploaded yet</p>
                      <p className="text-[11px] text-slate-400">Upload a PDF quotation above to send to the client</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeQuotations.map((q) => {
                        const isSent = q.sentCount > 0
                        return (
                          <div
                            key={q._id}
                            className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1 flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                  <FileText className="w-4 h-4 text-purple-600 shrink-0" />
                                  <span className="font-bold text-slate-900 truncate text-xs">{q.originalName}</span>
                                  <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 font-bold rounded text-[10px]">
                                    v{q.version || 1}
                                  </span>
                                  {isSent ? (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-full text-[10px]">
                                      Sent ({q.sentCount}x)
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-full text-[10px]">
                                      Draft / Not Sent
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                                  <span>{q.fileSize ? `${Math.round(q.fileSize / 1024)} KB` : "PDF"}</span>
                                  <span>•</span>
                                  <span>Uploaded by {q.uploadedByName || "Staff"} on {new Date(q.createdAt).toLocaleDateString()}</span>
                                </div>
                                {q.notes && (
                                  <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 mt-1">
                                    {q.notes}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center space-x-2 shrink-0">
                                <a
                                  href={apiClient.getQuotationDownloadUrl(q._id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download</span>
                                </a>

                                <button
                                  type="button"
                                  onClick={() => handleOpenSendModal(q)}
                                  className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition cursor-pointer"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>{isSent ? "Resend Email" : "Send via Email"}</span>
                                </button>

                                {canDeleteDocument && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenDeleteModal(q)}
                                    title={isSent ? "Void / Archive Quotation" : "Delete Quotation"}
                                    className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Sent History List */}
                            {Array.isArray(q.sentHistory) && q.sentHistory.length > 0 && (
                              <div className="pt-2 border-t border-slate-100 text-[10px] font-mono text-slate-500 space-y-1">
                                <span className="font-bold text-slate-700 block">Dispatch History:</span>
                                {q.sentHistory.map((sh, sIdx) => (
                                  <div key={sIdx} className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded">
                                    <span>Sent to <strong className="text-slate-800">{sh.recipientEmail}</strong> by {sh.sentByName || "Agent"}</span>
                                    <span>{new Date(sh.sentAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Archived / Voided Quotations Section (Sent Quotation Protection) */}
                  {voidedQuotations.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-600 flex items-center gap-1.5">
                          <Archive className="w-3.5 h-3.5 text-slate-400" />
                          <span>Archived & Voided Quotations ({voidedQuotations.length})</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">Preserved for audit compliance</span>
                      </div>
                      <div className="space-y-2">
                        {voidedQuotations.map((vq) => (
                          <div
                            key={vq._id}
                            className="p-3 bg-slate-50/80 border border-slate-200 rounded-xl space-y-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-0.5 flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-medium text-slate-700 truncate text-xs line-through">
                                    {vq.originalName}
                                  </span>
                                  <span className="px-1.5 py-0.2 bg-slate-200 text-slate-600 font-bold rounded text-[9px]">
                                    v{vq.version || 1}
                                  </span>
                                  <span className="px-2 py-0.2 bg-rose-100 text-rose-700 font-bold rounded-full text-[9px] uppercase tracking-wide">
                                    Voided
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  Voided {vq.voidedAt ? new Date(vq.voidedAt).toLocaleDateString() : ""} {vq.voidedByName ? `by ${vq.voidedByName}` : ""} • Sent {vq.sentCount || 0}x
                                </div>
                              </div>
                              <a
                                href={apiClient.getQuotationDownloadUrl(vq._id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download archived audit copy"
                                className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition shrink-0"
                              >
                                <Download className="w-3 h-3" />
                                <span>Audit PDF</span>
                              </a>
                            </div>

                            {/* Preserved Delivery History */}
                            {Array.isArray(vq.sentHistory) && vq.sentHistory.length > 0 && (
                              <div className="pt-1.5 border-t border-slate-200/60 text-[9px] font-mono text-slate-500 space-y-1">
                                <span className="font-bold text-slate-600 block">Preserved Dispatch Audit:</span>
                                {vq.sentHistory.map((sh, sIdx) => (
                                  <div key={sIdx} className="flex items-center justify-between bg-white/70 px-2 py-0.5 rounded border border-slate-100">
                                    <span>Sent to <strong>{sh.recipientEmail}</strong></span>
                                    <span>{new Date(sh.sentAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 3: Unified Communication Timeline */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-indigo-600" />
                      <span>Unified Communication Timeline (Emails & Documents)</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {commHistory.length} events
                    </span>
                  </div>

                  {loadingCommHistory ? (
                    <div className="py-6 text-center text-slate-400 text-xs">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-1.5" />
                      Loading communication timeline...
                    </div>
                  ) : commHistory.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                      No email communications dispatched for this lead yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {commHistory.map((item) => {
                        const isQuotation = item.templateType === "quotation"
                        const isSent = item.status === "sent" || item.status === "delivered"
                        return (
                          <div
                            key={item._id}
                            className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <div className={`p-1.5 rounded-lg ${isQuotation ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"}`}>
                                  {isQuotation ? <Receipt className="w-3.5 h-3.5" /> : <FileCheck className="w-3.5 h-3.5" />}
                                </div>
                                <div>
                                  <span className="font-bold text-slate-900 block">{item.emailSubject}</span>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    To: <strong className="text-slate-700">{item.recipientEmail}</strong> • Sender: {item.senderEmail}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-col items-end space-y-1">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isSent ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                }`}>
                                  {item.status?.toUpperCase() || "SENT"}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {item.sentAt ? new Date(item.sentAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-mono">
                              <span>
                                Trigger: <strong className="text-slate-700">{item.trigger === "auto" ? "Autonomous AI Trigger" : "Manual Agent Send"}</strong>
                              </span>
                              {item.providerMessageId && (
                                <span className="text-indigo-600 truncate max-w-[200px]" title={item.providerMessageId}>
                                  ID: {item.providerMessageId}
                                </span>
                              )}
                            </div>

                            {item.errorMessage && (
                              <p className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded border border-rose-200 font-mono">
                                Error: {item.errorMessage}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* =========================================================================
              DRAWER FOOTER ACTIONS
          ========================================================================= */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 shrink-0 flex items-center justify-between gap-3 text-xs">
            <div>
              {canDeleteLead && (
                <button
                  type="button"
                  onClick={() => {
                    if (onDeleteLead) onDeleteLead(lead)
                  }}
                  className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Lead</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Link
                href={`/communication/follow-ups?leadId=${lead?._id || lead?.id}&action=schedule`}
                className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Schedule Follow-up</span>
              </Link>

              {canEditLead && (
                <button
                  type="button"
                  onClick={() => {
                    if (onEditLead) onEditLead(lead)
                  }}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Lead</span>
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* =========================================================================
          MODAL 1: CONFIRM CLOSED-WON DEAL (Phase 5)
      ========================================================================= */}
      {wonClosureModalOpen && (
        <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-200 transform transition-all p-4 sm:p-6 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Confirm Deal Closed-Won</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter the final agreed deal closing amount to record revenue and close this lead.
                </p>
              </div>
            </div>

            {/* Reference Card */}
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Expected Deal Value (Reference):</span>
                <span className="font-bold text-slate-800 font-mono">
                  {lead?.expectedDealAmount !== undefined && lead?.expectedDealAmount !== null && Number(lead.expectedDealAmount) > 0
                    ? `${lead?.currency || "INR"} ${Number(lead.expectedDealAmount).toLocaleString()}`
                    : "Not Set"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[11px]">
                <span className="text-slate-500 font-medium">Closing Representative:</span>
                <span className="font-semibold text-slate-700 flex items-center gap-1">
                  <User className="w-3 h-3 text-slate-400" />
                  {user?.name || user?.email || "Current User"}
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmWonClosure} className="space-y-4 pt-1">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Final Closed Amount ({lead?.currency || "INR"}) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs font-bold text-slate-400">
                    {lead?.currency || "INR"}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={wonAmountInput}
                    onChange={(e) => {
                      setWonAmountInput(e.target.value)
                      if (wonAmountError) setWonAmountError(null)
                    }}
                    placeholder="e.g. 150000"
                    className={`w-full pl-12 pr-3 py-2 text-sm font-semibold bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      wonAmountError ? "border-rose-400 ring-1 ring-rose-400" : "border-slate-300"
                    }`}
                  />
                </div>
                {wonAmountError ? (
                  <p className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{wonAmountError}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400">Must be greater than 0 to record won revenue</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  Closing Notes / Contract Reference (Optional)
                </label>
                <textarea
                  rows={3}
                  value={wonNotesInput}
                  onChange={(e) => setWonNotesInput(e.target.value)}
                  placeholder="e.g. 20-bed HMS license with 1-year AMC and OT module included..."
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setWonClosureModalOpen(false)
                    setWonAmountError(null)
                  }}
                  disabled={isSavingWon}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingWon || !wonAmountInput || Number(wonAmountInput) <= 0}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition cursor-pointer"
                >
                  {isSavingWon ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving Won Deal...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm Closed-Won</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: SEND QUOTATION VIA EMAIL (Phase 1 & Phase 3)
      ========================================================================= */}
      {sendModalQuotation && (
        <div className="fixed inset-0 z-60 overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-200 transform transition-all p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl shrink-0">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Send Quotation via Email</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review email details before dispatching PDF attachment to customer.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSendModalQuotation(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Attached file summary banner */}
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 truncate">
                <Receipt className="w-4 h-4 text-purple-700 shrink-0" />
                <span className="font-bold text-purple-900 truncate">
                  {sendModalQuotation.originalName}
                </span>
                <span className="px-1.5 py-0.2 bg-purple-200 text-purple-800 rounded font-bold text-[10px]">
                  v{sendModalQuotation.version || 1}
                </span>
              </div>
              <span className="text-[10px] text-purple-700 font-mono shrink-0">
                {sendModalQuotation.fileSize ? `${Math.round(sendModalQuotation.fileSize / 1024)} KB` : "PDF"}
              </span>
            </div>

            <form onSubmit={handleSendQuotationSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Recipient Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={sendRecipientEmail}
                  onChange={(e) => setSendRecipientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Subject Line <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={sendSubject}
                  onChange={(e) => setSendSubject(e.target.value)}
                  placeholder="Quotation for..."
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 block">
                  Email Message Body
                </label>
                <textarea
                  rows={4}
                  value={sendBody}
                  onChange={(e) => setSendBody(e.target.value)}
                  placeholder="Enter email message body..."
                  className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 font-sans leading-relaxed"
                />
              </div>

              <p className="text-[11px] text-slate-400 italic">
                The quotation PDF will be attached and sent via your tenant&apos;s SMTP provider. Dispatched transaction will be recorded on the lead timeline.
              </p>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSendModalQuotation(null)}
                  disabled={isSendingQuotation}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingQuotation || !sendRecipientEmail.trim()}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition cursor-pointer"
                >
                  {isSendingQuotation ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Sending Email...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Quotation</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quotation Delete Confirmation Modal */}
      {deleteModalQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {deleteModalQuotation.sentCount > 0 ? "Void & Archive Quotation" : "Delete Quotation"}
                  </h3>
                  <p className="text-[11px] text-slate-400">Lead Document Management</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModalQuotation(null)}
                disabled={isDeletingQuotation}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
              <p className="font-semibold text-slate-800">
                Are you sure you want to delete this quotation?
              </p>
              <div className="flex items-center space-x-2 text-[11px] text-slate-600">
                <FileText className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span className="font-bold text-slate-900 truncate">{deleteModalQuotation.originalName}</span>
                <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 font-bold rounded text-[10px]">
                  v{deleteModalQuotation.version || 1}
                </span>
                <span className="text-slate-400 font-mono">
                  ({deleteModalQuotation.fileSize ? `${Math.round(deleteModalQuotation.fileSize / 1024)} KB` : "PDF"})
                </span>
              </div>
            </div>

            {deleteModalQuotation.sentCount > 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 space-y-1">
                <div className="flex items-center space-x-1.5 font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Audit History Notice</span>
                </div>
                <p>
                  This quotation has been sent to a customer {deleteModalQuotation.sentCount} time(s). To protect audit compliance and customer communication history, it will be marked as <strong>Voided/Archived</strong> rather than permanently erased.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                This document has not been sent. Deleting will permanently remove the quotation record and its stored file. This action cannot be undone.
              </p>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteModalQuotation(null)}
                disabled={isDeletingQuotation}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteQuotation}
                disabled={isDeletingQuotation}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition cursor-pointer"
              >
                {isDeletingQuotation ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{deleteModalQuotation.sentCount > 0 ? "Archiving..." : "Deleting..."}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{deleteModalQuotation.sentCount > 0 ? "Confirm Void & Archive" : "Delete Quotation"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
