"use client"

import React, { useState, useEffect, useCallback } from "react"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Search,
  Trash2,
  Edit3,
  Check,
  Tag,
  BookOpen,
  Package,
  Layers,
  Archive,
  HelpCircle,
  MessageSquare,
  FileText,
  Sliders,
  X,
  ChevronDown,
  Info,
  ExternalLink,
} from "lucide-react"

const CATEGORY_OPTIONS = [
  "Sales & Inquiries",
  "Product Specifications",
  "Pricing & Commercials",
  "Delivery & Logistics",
  "Warranty & Support",
  "Consultation & Services",
  "General / Other",
]

export default function AIKeywordsTab({ products = [], sources = [], profile = null }) {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  })

  // Filters
  const [statusFilter, setStatusFilter] = useState("PENDING_APPROVAL") // "PENDING_APPROVAL" | "APPROVED" | "DRAFT" | "REJECTED" | "ARCHIVED" | "ALL"
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Selection for bulk actions
  const [selectedTopicIds, setSelectedTopicIds] = useState([])

  // Generation Modal State
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationMode, setGenerationMode] = useState("append") // "append" | "replace_drafts"

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTopic, setEditingTopic] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({
    name: "",
    category: "Sales & Inquiries",
    confidenceScore: 0.85,
    primaryKeywordsText: "",
    synonymsText: "",
    customerQuestionsText: "",
    productTerminologyText: "",
    discussionPointsText: "",
    relatedProductIds: [],
  })

  // Reject Modal State
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectingTopic, setRejectingTopic] = useState(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [rejecting, setRejecting] = useState(false)

  // Details Modal State
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [selectedTopicForDetails, setSelectedTopicForDetails] = useState(null)

  // Fetch topics from backend
  const fetchTopics = useCallback(async () => {
    try {
      setLoading(true)
      const query = {
        page,
        limit: 20,
        sortBy: "createdAt",
        sortOrder: "desc",
      }

      if (statusFilter !== "ALL") {
        query.status = statusFilter
      }
      if (categoryFilter !== "all") {
        query.category = categoryFilter
      }
      if (searchQuery.trim()) {
        query.search = searchQuery.trim()
      }

      const res = await apiClient.getAIKeywords(query)
      if (res && res.success) {
        setTopics(res.topics || [])
        setStats(res.stats || { total: 0, draft: 0, pending: 0, approved: 0, rejected: 0, archived: 0 })
        setTotalPages(res.totalPages || 1)
      }
    } catch (err) {
      toast.error(err.message || "Failed to load AI discussion topics")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter, searchQuery, page])

  useEffect(() => {
    fetchTopics()
  }, [fetchTopics])

  // Handle generation trigger
  const handleGenerateKeywords = async () => {
    try {
      setGenerating(true)
      const res = await apiClient.generateAIKeywords({
        mode: generationMode,
        defaultStatus: "PENDING_APPROVAL",
      })

      if (res && res.success) {
        toast.success(`Generated ${res.count || 0} discussion topics via ${res.provider || "AI engine"}`)
        setShowGenerateModal(false)
        setStatusFilter("PENDING_APPROVAL")
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to generate AI keywords")
    } finally {
      setGenerating(false)
    }
  }

  // Single Approve
  const handleApprove = async (topic) => {
    try {
      const res = await apiClient.approveAIKeyword(topic._id)
      if (res && res.success) {
        toast.success(`Approved topic: "${topic.name}"`)
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to approve topic")
    }
  }

  // Open Reject Modal
  const handleOpenReject = (topic) => {
    setRejectingTopic(topic)
    setRejectionReason("")
    setShowRejectModal(true)
  }

  // Confirm Reject
  const handleConfirmReject = async (e) => {
    e.preventDefault()
    if (!rejectingTopic) return
    try {
      setRejecting(true)
      const res = await apiClient.rejectAIKeyword(rejectingTopic._id, rejectionReason)
      if (res && res.success) {
        toast.success(`Rejected topic: "${rejectingTopic.name}"`)
        setShowRejectModal(false)
        setRejectingTopic(null)
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to reject topic")
    } finally {
      setRejecting(false)
    }
  }

  // Bulk Approve
  const handleBulkApprove = async () => {
    if (selectedTopicIds.length === 0) return
    try {
      const res = await apiClient.bulkApproveAIKeywords(selectedTopicIds)
      if (res && res.success) {
        toast.success(res.message || `Bulk approved ${selectedTopicIds.length} topics`)
        setSelectedTopicIds([])
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to bulk approve topics")
    }
  }

  // Archive
  const handleArchive = async (topic) => {
    try {
      const res = await apiClient.archiveAIKeyword(topic._id)
      if (res && res.success) {
        toast.success(`Archived topic: "${topic.name}"`)
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to archive topic")
    }
  }

  // Delete
  const handleDelete = async (topic) => {
    if (!window.confirm(`Permanently delete topic "${topic.name}"?`)) return
    try {
      const res = await apiClient.deleteAIKeyword(topic._id)
      if (res && res.success) {
        toast.success("Topic deleted successfully")
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to delete topic")
    }
  }

  // Open Edit Modal
  const handleOpenEdit = (topic) => {
    setEditingTopic(topic)
    setEditForm({
      name: topic.name || "",
      category: topic.category || "Sales & Inquiries",
      confidenceScore: topic.confidenceScore || 0.85,
      primaryKeywordsText: Array.isArray(topic.primaryKeywords) ? topic.primaryKeywords.join(", ") : "",
      synonymsText: Array.isArray(topic.synonyms) ? topic.synonyms.join(", ") : "",
      customerQuestionsText: Array.isArray(topic.customerQuestions) ? topic.customerQuestions.join("\n") : "",
      productTerminologyText: Array.isArray(topic.productTerminology) ? topic.productTerminology.join(", ") : "",
      discussionPointsText: Array.isArray(topic.discussionPoints) ? topic.discussionPoints.join("\n") : "",
      relatedProductIds: Array.isArray(topic.relatedProductIds)
        ? topic.relatedProductIds.map((p) => (typeof p === "object" ? p._id : p))
        : [],
    })
    setShowEditModal(true)
  }

  // Save Edit
  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editForm.name || editForm.name.trim().length < 2) {
      toast.error("Topic name must be at least 2 characters")
      return
    }

    try {
      setSavingEdit(true)
      const parseComma = (text) =>
        text
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      const parseLines = (text) =>
        text
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)

      const payload = {
        name: editForm.name.trim(),
        category: editForm.category.trim(),
        confidenceScore: Number(editForm.confidenceScore) || 0.85,
        primaryKeywords: parseComma(editForm.primaryKeywordsText),
        synonyms: parseComma(editForm.synonymsText),
        customerQuestions: parseLines(editForm.customerQuestionsText),
        productTerminology: parseComma(editForm.productTerminologyText),
        discussionPoints: parseLines(editForm.discussionPointsText),
        relatedProductIds: editForm.relatedProductIds,
      }

      const res = await apiClient.updateAIKeyword(editingTopic._id, payload)
      if (res && res.success) {
        toast.success("Topic updated successfully")
        setShowEditModal(false)
        setEditingTopic(null)
        fetchTopics()
      }
    } catch (err) {
      toast.error(err.message || "Failed to update topic")
    } finally {
      setSavingEdit(false)
    }
  }

  // Toggle selection for bulk actions
  const toggleSelectTopic = (id) => {
    setSelectedTopicIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedTopicIds.length === topics.length) {
      setSelectedTopicIds([])
    } else {
      setSelectedTopicIds(topics.map((t) => t._id))
    }
  }

  // Helper: Status badge
  const renderStatusBadge = (status) => {
    switch (status) {
      case "APPROVED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Approved
          </span>
        )
      case "PENDING_APPROVAL":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Pending Approval
          </span>
        )
      case "DRAFT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Sliders className="w-3 h-3 text-blue-600" />
            Draft
          </span>
        )
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-600" />
            Rejected
          </span>
        )
      case "ARCHIVED":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Archive className="w-3 h-3 text-slate-500" />
            Archived
          </span>
        )
    }
  }

  const completedSourcesCount = sources.filter((s) => s.status === "COMPLETED").length

  return (
    <div className="space-y-6">
      {/* Top Banner & Generation Call-To-Action */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Phase 2: AI Keyword Generation & Admin Approval</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">
              AI Discussion Topics & Sales Conversation Keywords
            </h2>
            <p className="text-xs text-indigo-100 leading-relaxed">
              Automatically extract business-specific sales topics, customer inquiry patterns, and product keywords
              from your Business Profile, Products/Services, and Knowledge Documents. Review and approve topics before
              they are activated for call monitoring.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
            <button
              type="button"
              onClick={() => setShowGenerateModal(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-900 hover:bg-indigo-50 text-xs font-bold shadow-md transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Generate AI Keywords</span>
            </button>
          </div>
        </div>

        {/* Readiness Checklist Ribbon */}
        <div className="mt-5 pt-4 border-t border-indigo-700/60 flex flex-wrap items-center gap-4 text-xs text-indigo-200">
          <span className="font-semibold text-white">Knowledge Foundation:</span>
          <span className="inline-flex items-center gap-1.5">
            {profile?.businessName ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
            Profile: {profile?.businessName ? profile.businessName : "Incomplete"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {products.length > 0 ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
            Products/Services: {products.length} registered
          </span>
          <span className="inline-flex items-center gap-1.5">
            {completedSourcesCount > 0 ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
            Extracted Documents: {completedSourcesCount} completed
          </span>
        </div>
      </div>

      {/* Sub-Tabs: Topic Lifecycle Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setStatusFilter("PENDING_APPROVAL")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "PENDING_APPROVAL"
                ? "bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            <span>Pending Review</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-900">
              {stats.pending}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter("APPROVED")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "APPROVED"
                ? "bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Approved (Active)</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-200/80 text-emerald-900">
              {stats.approved}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter("DRAFT")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "DRAFT"
                ? "bg-blue-100 text-blue-900 border border-blue-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-blue-600" />
            <span>Drafts</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-200/80 text-blue-900">
              {stats.draft}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter("REJECTED")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "REJECTED"
                ? "bg-rose-100 text-rose-900 border border-rose-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Rejected</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-200/80 text-rose-900">
              {stats.rejected}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter("ARCHIVED")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "ARCHIVED"
                ? "bg-slate-200 text-slate-900 border border-slate-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-slate-600" />
            <span>Archived</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-300 text-slate-800">
              {stats.archived}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStatusFilter("ALL")
              setPage(1)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              statusFilter === "ALL"
                ? "bg-indigo-100 text-indigo-900 border border-indigo-300 shadow-2xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span>All Topics</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-indigo-200/80 text-indigo-900">
              {stats.total}
            </span>
          </button>
        </div>

        {/* Refresh & Bulk Actions */}
        <div className="flex items-center gap-2">
          {selectedTopicIds.length > 0 && (
            <button
              type="button"
              onClick={handleBulkApprove}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Bulk Approve ({selectedTopicIds.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchTopics}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="Refresh topics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search topics, keywords, terminology..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All Categories</option>
          {CATEGORY_OPTIONS.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {topics.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition cursor-pointer whitespace-nowrap"
          >
            {selectedTopicIds.length === topics.length ? "Deselect All" : "Select All"}
          </button>
        )}
      </div>

      {/* Topics Content Area */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
          <p className="text-xs">Loading AI keywords & topics...</p>
        </div>
      ) : topics.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            {statusFilter === "PENDING_APPROVAL"
              ? "No pending topics to review"
              : `No ${statusFilter.toLowerCase().replace("_", " ")} topics found`}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-5">
            Click &quot;Generate AI Keywords&quot; above to synthesize topics and keywords from your Business Profile and
            Knowledge Documents.
          </p>
          <button
            type="button"
            onClick={() => setShowGenerateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Discussion Topics</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {topics.map((topic) => {
            const isSelected = selectedTopicIds.includes(topic._id)
            const confidencePercent = Math.round((topic.confidenceScore || 0.85) * 100)

            return (
              <div
                key={topic._id}
                className={`bg-white rounded-2xl border transition-all duration-150 p-5 shadow-xs hover:shadow-md ${
                  isSelected ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-slate-200"
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectTopic(topic._id)}
                      className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          {topic.category || "Sales & Inquiries"}
                        </span>
                        {renderStatusBadge(topic.status)}
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {confidencePercent}% Confidence
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 tracking-tight">{topic.name}</h3>
                    </div>
                  </div>

                  {/* Top Action Buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    {topic.status === "PENDING_APPROVAL" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApprove(topic)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-2xs transition cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenReject(topic)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold border border-rose-200 transition cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}

                    {topic.status === "REJECTED" && (
                      <button
                        type="button"
                        onClick={() => handleApprove(topic)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200 transition cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>Override & Approve</span>
                      </button>
                    )}

                    {topic.status === "APPROVED" && (
                      <button
                        type="button"
                        onClick={() => handleArchive(topic)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                        title="Archive topic"
                      >
                        <Archive className="w-3 h-3" />
                        <span>Archive</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(topic)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                      title="Edit topic details"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(topic)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                      title="Delete topic"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Rejection Notice Banner if rejected */}
                {topic.status === "REJECTED" && topic.rejectionReason && (
                  <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Rejection Reason: </span>
                      <span>{topic.rejectionReason}</span>
                    </div>
                  </div>
                )}

                {/* Primary Keywords Chips */}
                <div className="mt-3.5 space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Tag className="w-3 h-3 text-indigo-500" />
                    <span>Primary Sales Keywords ({topic.primaryKeywords?.length || 0})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.isArray(topic.primaryKeywords) && topic.primaryKeywords.length > 0 ? (
                      topic.primaryKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-800 border border-indigo-200/80 shadow-2xs"
                        >
                          {kw}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 italic">No primary keywords defined</span>
                    )}

                    {/* Synonyms */}
                    {Array.isArray(topic.synonyms) &&
                      topic.synonyms.map((syn, idx) => (
                        <span
                          key={`syn-${idx}`}
                          className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-50 text-slate-600 border border-dashed border-slate-300"
                          title="Synonym / Variation"
                        >
                          {syn}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Customer Questions & Sales Points Grid */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                  {/* Customer Inquiries */}
                  <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-200/70 space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
                      <span>Anticipated Customer Questions</span>
                    </div>
                    {Array.isArray(topic.customerQuestions) && topic.customerQuestions.length > 0 ? (
                      <ul className="space-y-1">
                        {topic.customerQuestions.map((q, idx) => (
                          <li key={idx} className="text-xs text-slate-700 flex items-start gap-1.5">
                            <span className="text-amber-500 font-bold shrink-0">•</span>
                            <span>{q}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No customer questions generated</p>
                    )}
                  </div>

                  {/* Sales Discussion Points */}
                  <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-200/70 space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Agent Discussion Cues & Pitch Points</span>
                    </div>
                    {Array.isArray(topic.discussionPoints) && topic.discussionPoints.length > 0 ? (
                      <ul className="space-y-1">
                        {topic.discussionPoints.map((dp, idx) => (
                          <li key={idx} className="text-xs text-slate-700 flex items-start gap-1.5">
                            <span className="text-indigo-500 font-bold shrink-0">•</span>
                            <span>{dp}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No discussion cues specified</p>
                    )}
                  </div>
                </div>

                {/* Grounding & Source Citations Ribbon */}
                <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Linked Products */}
                    {Array.isArray(topic.relatedProductIds) && topic.relatedProductIds.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                        <Package className="w-3 h-3 text-emerald-600" />
                        {topic.relatedProductIds.map((p) => (typeof p === "object" ? p.name : "Product")).join(", ")}
                      </span>
                    )}

                    {/* Contributing Sources */}
                    {Array.isArray(topic.sourceReferences) && topic.sourceReferences.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-medium">
                        <BookOpen className="w-3 h-3 text-indigo-600" />
                        {topic.sourceReferences.map((s) => s.title).join("; ")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span>Version: v{topic.version || 1}</span>
                    <span>Created: {new Date(topic.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ========================================================
          MODAL 1: GENERATE AI KEYWORDS
      ======================================================== */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <Sparkles className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-slate-900">Generate AI Keywords & Topics</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                The AI Generator analyzes your verified business foundation and extracts topics, keywords, and sales
                cues. All generated topics are placed in <strong className="text-slate-800">Pending Review</strong> for
                admin approval.
              </p>

              {/* Source Assets Summary */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="font-bold text-slate-700">Inputs to be Analyzed:</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Profile</div>
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      {profile?.businessName || "Not set"}
                    </div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Products</div>
                    <div className="text-sm font-bold text-indigo-600">{products.length}</div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Documents</div>
                    <div className="text-sm font-bold text-indigo-600">{completedSourcesCount}</div>
                  </div>
                </div>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">Generation Strategy</label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name="generationMode"
                      checked={generationMode === "append"}
                      onChange={() => setGenerationMode("append")}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="font-bold text-slate-900">Append New Topics</div>
                      <div className="text-slate-500 text-[11px]">
                        Keep all existing topics and add newly generated topics to the review queue.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name="generationMode"
                      checked={generationMode === "replace_drafts"}
                      onChange={() => setGenerationMode("replace_drafts")}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="font-bold text-slate-900">Replace Unapproved Topics</div>
                      <div className="text-slate-500 text-[11px]">
                        Clean up pending and draft topics and regenerate a fresh set. Approved topics are preserved.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={generating}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleGenerateKeywords}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-60"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Generating Topics...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Start Generation</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: EDIT TOPIC MODAL
      ======================================================== */}
      {showEditModal && editingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Edit Discussion Topic & Keywords</h3>
                <p className="text-xs text-slate-500">Refine keywords, customer questions, and sales cues.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Topic Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {CATEGORY_OPTIONS.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confidence Score ({Math.round(editForm.confidenceScore * 100)}%)
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1.0"
                    step="0.05"
                    value={editForm.confidenceScore}
                    onChange={(e) => setEditForm({ ...editForm, confidenceScore: parseFloat(e.target.value) })}
                    className="w-full mt-2 accent-indigo-600"
                  />
                </div>
              </div>

              {/* Primary Keywords */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Primary Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  value={editForm.primaryKeywordsText}
                  onChange={(e) => setEditForm({ ...editForm, primaryKeywordsText: e.target.value })}
                  placeholder="e.g. solid teak, dining table, 6-seater, custom dining"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Synonyms */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Synonyms & Term Variations (comma-separated)
                </label>
                <input
                  type="text"
                  value={editForm.synonymsText}
                  onChange={(e) => setEditForm({ ...editForm, synonymsText: e.target.value })}
                  placeholder="e.g. wooden table, teak wood set, dining set"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Customer Questions */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Customer Questions (one per line)
                </label>
                <textarea
                  rows={3}
                  value={editForm.customerQuestionsText}
                  onChange={(e) => setEditForm({ ...editForm, customerQuestionsText: e.target.value })}
                  placeholder="What is the warranty period?&#10;Can we request custom dimensions?"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              {/* Agent Discussion Points */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Agent Discussion Points (one per line)
                </label>
                <textarea
                  rows={3}
                  value={editForm.discussionPointsText}
                  onChange={(e) => setEditForm({ ...editForm, discussionPointsText: e.target.value })}
                  placeholder="Walk through key capabilities.&#10;Clarify customer budget and timeline."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={savingEdit}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-60"
                >
                  {savingEdit ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 3: REJECT TOPIC MODAL
      ======================================================== */}
      {showRejectModal && rejectingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <XCircle className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-slate-900">Reject Topic</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmReject} className="mt-4 space-y-4">
              <p className="text-xs text-slate-600">
                Are you sure you want to reject topic <strong className="text-slate-900">&quot;{rejectingTopic.name}&quot;</strong>?
                It will not be activated for call monitoring.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Rejection Reason (Optional)
                </label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Obsolete product line, or terms need revision."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  disabled={rejecting}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={rejecting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-60"
                >
                  {rejecting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Rejecting...</span>
                    </>
                  ) : (
                    <span>Confirm Rejection</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

