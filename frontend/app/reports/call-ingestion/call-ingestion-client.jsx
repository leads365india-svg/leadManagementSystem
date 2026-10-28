"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import Breadcrumb from "@/components/breadcrumb"
import dynamic from "next/dynamic"

const InBrowserAudioPlayer = dynamic(() => import("@/components/in-browser-audio-player"), {
  ssr: false,
})

import {
  UploadCloud,
  FileAudio,
  FileSpreadsheet,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  User,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Database,
  Music,
  Check,
  X,
  Sparkles,
} from "lucide-react"

export default function CallIngestionClient() {
  const [activeTab, setActiveTab] = useState("audio") // "audio" | "csv" | "review"
  const [stats, setStats] = useState({
    totalManual: 0,
    matched: 0,
    unmatched: 0,
    withRecording: 0,
  })
  const [loadingStats, setLoadingStats] = useState(true)

  // Audio Upload Form State
  const [audioFile, setAudioFile] = useState(null)
  const [extractedPhone, setExtractedPhone] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [direction, setDirection] = useState("outbound")
  const [duration, setDuration] = useState("60")
  const [disposition, setDisposition] = useState("connected")
  const [notes, setNotes] = useState("")
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const [audioUploadResult, setAudioUploadResult] = useState(null)

  // CSV Batch Form State
  const [csvText, setCsvText] = useState("")
  const [csvFile, setCsvFile] = useState(null)
  const [ingestingCsv, setIngestingCsv] = useState(false)
  const [csvResult, setCsvResult] = useState(null)

  // Review Queue State
  const [reviewCalls, setReviewCalls] = useState([])
  const [totalReview, setTotalReview] = useState(0)
  const [loadingReview, setLoadingReview] = useState(false)
  const [searchReview, setSearchReview] = useState("")
  const [reviewPage, setReviewPage] = useState(1)

  // Match Modal State
  const [selectedCallForMatch, setSelectedCallForMatch] = useState(null)
  const [matchMode, setMatchMode] = useState("existing") // "existing" | "new"
  const [leadSearchQuery, setLeadSearchQuery] = useState("")
  const [leadsList, setLeadsList] = useState([])
  const [searchingLeads, setSearchingLeads] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState("")
  const [newLeadForm, setNewLeadForm] = useState({ name: "", phone: "", email: "" })
  const [submittingMatch, setSubmittingMatch] = useState(false)

  // Load Ingestion Stats
  const fetchStats = useCallback(async () => {
    try {
      setLoadingStats(true)
      const res = await apiClient.getIngestionStats()
      if (res.success && res.stats) {
        setStats(res.stats)
      }
    } catch (err) {
      console.warn("Could not fetch ingestion stats:", err.message)
    } finally {
      setLoadingStats(false)
    }
  }, [])

  // Load Review Queue
  const fetchReviewQueue = useCallback(async () => {
    try {
      setLoadingReview(true)
      const res = await apiClient.getIngestionReviewQueue({
        page: reviewPage,
        limit: 20,
        search: searchReview,
      })
      if (res.success) {
        setReviewCalls(res.calls || [])
        setTotalReview(res.total || 0)
      }
    } catch (err) {
      toast.error("Failed to load review queue: " + err.message)
    } finally {
      setLoadingReview(false)
    }
  }, [reviewPage, searchReview])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    if (activeTab === "review") {
      fetchReviewQueue()
    }
  }, [activeTab, fetchReviewQueue])

  // Extract phone number candidate from audio filename
  const handleAudioFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAudioFile(file)
    setAudioUploadResult(null)

    // Regex for phone in filename: e.g. 9876543210_call.mp3 or +919876543210
    const name = file.name
    const match = name.match(/(?:\+?91|0)?[6-9]\d{9}/) || name.match(/\d{10,12}/)
    if (match) {
      setExtractedPhone(match[0])
      setManualPhone(match[0])
    } else {
      setExtractedPhone("")
      setManualPhone("")
    }
  }

  // Handle Audio Submission
  const handleAudioSubmit = async (e) => {
    e.preventDefault()
    if (!audioFile) {
      toast.error("Please select an audio file to upload")
      return
    }

    const targetPhone = (manualPhone || extractedPhone).trim()
    if (!targetPhone) {
      toast.error("Please provide a phone number for lead matching")
      return
    }

    try {
      setUploadingAudio(true)
      const headers = {
        "x-filename": audioFile.name,
        "x-phone-number": targetPhone,
        "x-duration": duration,
        "x-direction": direction,
        "x-disposition": disposition,
        "x-notes": notes,
      }

      const res = await apiClient.ingestAudioCall(audioFile, headers)
      setAudioUploadResult(res)
      if (res.status === "matched") {
        toast.success(`Matched to lead: ${res.lead?.name || "Lead verified"}`)
      } else {
        toast("Audio uploaded. No lead matched; queued for review.", { icon: "ℹ️" })
      }
      fetchStats()
      // Reset form
      setAudioFile(null)
      setNotes("")
    } catch (err) {
      toast.error(err.message || "Audio ingestion failed")
    } finally {
      setUploadingAudio(false)
    }
  }

  // Handle CSV File Selection
  const handleCsvFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (event) => {
      setCsvText(event.target?.result || "")
    }
    reader.readAsText(file)
  }

  // Handle CSV Ingestion
  const handleCsvSubmit = async (e) => {
    e.preventDefault()
    if (!csvText.trim()) {
      toast.error("Please provide CSV text or upload a CSV file")
      return
    }

    try {
      setIngestingCsv(true)
      const res = await apiClient.ingestCsvCalls({ csvText })
      setCsvResult(res.data)
      toast.success(res.message || "Batch processed successfully")
      fetchStats()
    } catch (err) {
      toast.error(err.message || "CSV batch ingestion failed")
    } finally {
      setIngestingCsv(false)
    }
  }

  // Search Leads for Manual Match Modal
  const searchLeads = async (query) => {
    setLeadSearchQuery(query)
    if (!query || query.length < 2) {
      setLeadsList([])
      return
    }
    try {
      setSearchingLeads(true)
      const res = await apiClient.getLeads({ search: query, limit: 8 })
      setLeadsList(res.data || res.leads || [])
    } catch (err) {
      console.warn("Lead search error:", err.message)
    } finally {
      setSearchingLeads(false)
    }
  }

  // Open Match Modal for an Unmatched Call
  const openMatchModal = (call) => {
    setSelectedCallForMatch(call)
    setSelectedLeadId("")
    setLeadSearchQuery("")
    setLeadsList([])
    setNewLeadForm({
      name: "",
      phone: call.number || "",
      email: "",
    })
    setMatchMode("existing")
  }

  // Submit Match
  const handleMatchSubmit = async (e) => {
    e.preventDefault()
    if (!selectedCallForMatch) return

    try {
      setSubmittingMatch(true)
      const payload = {
        callId: selectedCallForMatch._id,
      }
      if (matchMode === "existing") {
        if (!selectedLeadId) {
          toast.error("Please select a lead to link")
          return
        }
        payload.leadId = selectedLeadId
      } else {
        if (!newLeadForm.name.trim()) {
          toast.error("Please enter a name for the new lead")
          return
        }
        payload.newLead = newLeadForm
      }

      const res = await apiClient.matchIngestionCall(payload)
      toast.success(res.message || "Call matched successfully")
      setSelectedCallForMatch(null)
      fetchReviewQueue()
      fetchStats()
    } catch (err) {
      toast.error(err.message || "Failed to match call")
    } finally {
      setSubmittingMatch(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Top Header / Breadcrumb */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Breadcrumb
            items={[
              { label: "Reports", href: "/reports/call-reports" },
              { label: "Call Ingestion (Manual Upload)" },
            ]}
          />
          <div className="mt-2 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-6 h-6 text-indigo-600" />
                Call Ingestion & Manual Recording Upload
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Ingest non-app phone recordings and CSV call logs with automatic lead matching, Do-Not-Record guards, and a review queue.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/communication/call-reports"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-sm font-medium transition"
              >
                <PhoneCall className="w-4 h-4" />
                View in Call Reports
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Manual Calls</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">
                {loadingStats ? <RefreshCw className="w-5 h-5 animate-spin text-slate-400" /> : stats.totalManual}
              </h3>
            </div>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
              <UploadCloud className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Matched to Leads</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">
                {loadingStats ? <RefreshCw className="w-5 h-5 animate-spin text-slate-400" /> : stats.matched}
              </h3>
            </div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Review Queue</p>
              <h3 className="text-2xl font-bold text-amber-600 mt-1">
                {loadingStats ? <RefreshCw className="w-5 h-5 animate-spin text-slate-400" /> : stats.unmatched}
              </h3>
            </div>
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
              <HelpCircle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recordings Stored</p>
              <h3 className="text-2xl font-bold text-indigo-600 mt-1">
                {loadingStats ? <RefreshCw className="w-5 h-5 animate-spin text-slate-400" /> : stats.withRecording}
              </h3>
            </div>
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <Music className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 mb-6 bg-white rounded-t-xl px-4 pt-2">
          <button
            onClick={() => setActiveTab("audio")}
            className={`py-3 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${
              activeTab === "audio"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileAudio className="w-4 h-4" />
            Audio Recording Upload
          </button>
          <button
            onClick={() => setActiveTab("csv")}
            className={`py-3 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${
              activeTab === "csv"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV Call Records Batch
          </button>
          <button
            onClick={() => setActiveTab("review")}
            className={`py-3 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition ${
              activeTab === "review"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            Review Queue
            {stats.unmatched > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 rounded-full">
                {stats.unmatched}
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: AUDIO UPLOAD */}
        {activeTab === "audio" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-indigo-600" />
                Upload Call Recording
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Upload audio files (.mp4, .m4a, .mp3, .wav, .aac, .amr). The phone number is automatically parsed from the filename or specified below.
              </p>

              <form onSubmit={handleAudioSubmit} className="space-y-5">
                {/* File Drop Area */}
                <div className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-indigo-50/20 transition cursor-pointer relative">
                  <input
                    type="file"
                    accept="audio/*,.m4a,.mp3,.wav,.aac,.amr,.mp4"
                    onChange={handleAudioFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center">
                    <FileAudio className="w-12 h-12 text-indigo-500 mb-2" />
                    <p className="text-sm font-semibold text-slate-800">
                      {audioFile ? audioFile.name : "Click to select or drag audio recording here"}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Max file size: 50 MB. Stored securely in MongoDB GridFS with 30-day retention.
                    </p>
                    {audioFile && (
                      <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">
                        <Check className="w-3.5 h-3.5" /> {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    )}
                  </div>
                </div>

                {/* Form Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone Number (for Lead Matching) *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 9876543210 or +919876543210"
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                      required
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    {extractedPhone && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Auto-detected from filename: {extractedPhone}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Call Direction</label>
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="outbound">Outbound (Agent to Lead)</option>
                      <option value="inbound">Inbound (Lead to Agent)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Duration (Seconds)</label>
                    <input
                      type="number"
                      min="0"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Disposition / Outcome</label>
                    <input
                      type="text"
                      placeholder="e.g. connected, interested, demo scheduled"
                      value={disposition}
                      onChange={(e) => setDisposition(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Call Summary</label>
                  <textarea
                    rows="2"
                    placeholder="Brief notes about the conversation..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={uploadingAudio || !audioFile}
                    className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {uploadingAudio ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Uploading & Streaming to GridFS...
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        Ingest Recording & Match Lead
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Upload Result Alert */}
              {audioUploadResult && (
                <div
                  className={`mt-6 p-4 rounded-xl border ${
                    audioUploadResult.status === "matched"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {audioUploadResult.status === "matched" ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <h4 className="font-bold text-sm">
                        {audioUploadResult.status === "matched"
                          ? `Matched to Lead: ${audioUploadResult.lead?.name}`
                          : "Unmatched — Added to Review Queue"}
                      </h4>
                      <p className="text-xs mt-1 text-slate-600">{audioUploadResult.message}</p>
                      {audioUploadResult.call?._id && (
                        <div className="mt-3">
                          <InBrowserAudioPlayer
                            callId={audioUploadResult.call._id}
                            leadName={audioUploadResult.lead?.name || audioUploadResult.call.number}
                            duration={audioUploadResult.call.duration}
                            compact={true}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Side Card: Ingestion Rules & Policy Safeguards */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Privacy & Retention Safeguards
                </h3>
                <ul className="text-xs text-slate-600 space-y-2.5">
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1 flex-shrink-0" />
                    <span>
                      <strong>Do-Not-Record (DNR) Policy:</strong> Audio uploads for phone numbers or leads with active DNR rules are rejected server-side.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1 flex-shrink-0" />
                    <span>
                      <strong>30-Day Auto Purge:</strong> Recordings expire and chunks are removed automatically 30 days after upload.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1 flex-shrink-0" />
                    <span>
                      <strong>Tenant Isolation:</strong> Audio files are strictly scoped by tenant partition and agent role.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="bg-indigo-50/60 rounded-xl border border-indigo-100 p-5">
                <h3 className="font-bold text-indigo-900 text-sm mb-2">Filename Matching Tips</h3>
                <p className="text-xs text-indigo-700 leading-relaxed">
                  Name your audio files containing the lead phone number (e.g. <code>9876543210_call.mp3</code>) for zero-click automatic detection and linking.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CSV BATCH INGESTION */}
        {activeTab === "csv" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                Batch Ingest Call Records via CSV
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Paste CSV call logs or upload a .csv file to batch import phone call histories with automatic lead resolution.
              </p>

              <form onSubmit={handleCsvSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Upload CSV File or Paste Raw CSV Text
                  </label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvFileChange}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 mb-3"
                  />
                  <textarea
                    rows="8"
                    placeholder="phone,duration,direction,disposition,notes,date&#10;9876543210,120,outbound,connected,Discussed annual plan,2026-10-27T10:00:00Z&#10;9123456780,45,inbound,inquiry,Pricing inquiry,2026-10-27T11:30:00Z"
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    className="w-full font-mono text-xs px-3.5 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={ingestingCsv || !csvText.trim()}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm shadow-sm transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {ingestingCsv ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Processing Batch...
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        Run CSV Batch Ingestion
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCsvText("phone,duration,direction,disposition,notes\n9876543210,140,outbound,connected,Customer product demo\n9112233445,60,inbound,follow-up,Requested quote")
                    }}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
                  >
                    Load Sample CSV
                  </button>
                </div>
              </form>

              {/* CSV Processing Results */}
              {csvResult && (
                <div className="mt-6 border-t border-slate-200 pt-5">
                  <h3 className="font-bold text-slate-900 text-sm mb-3">Batch Processing Results</h3>
                  <div className="grid grid-cols-4 gap-3 mb-4 text-center">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <p className="text-xs text-slate-500">Total Rows</p>
                      <p className="text-lg font-bold text-slate-900">{csvResult.total}</p>
                    </div>
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                      <p className="text-xs text-emerald-600">Matched</p>
                      <p className="text-lg font-bold text-emerald-700">{csvResult.matched}</p>
                    </div>
                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                      <p className="text-xs text-amber-600">Review Queue</p>
                      <p className="text-lg font-bold text-amber-700">{csvResult.unmatched}</p>
                    </div>
                    <div className="bg-rose-50 p-3 rounded-lg border border-rose-200">
                      <p className="text-xs text-rose-600">Failed / Errors</p>
                      <p className="text-lg font-bold text-rose-700">{csvResult.failed}</p>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                    {csvResult.items?.map((item, idx) => (
                      <div key={idx} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500">#{item.row}</span>
                          <span className="font-semibold text-slate-800">{item.phone || "No Phone"}</span>
                          {item.leadName && (
                            <span className="text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded">
                              Matched: {item.leadName}
                            </span>
                          )}
                          {item.error && <span className="text-rose-600">{item.error}</span>}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                            item.status === "matched"
                              ? "bg-emerald-100 text-emerald-800"
                              : item.status === "unmatched"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Side Card: CSV Format Specification */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                Supported CSV Columns
              </h3>
              <div className="text-xs text-slate-600 space-y-2">
                <p>
                  <strong>phone (required):</strong> 10-digit mobile number, with or without country code.
                </p>
                <p>
                  <strong>duration:</strong> Call duration in seconds (integer).
                </p>
                <p>
                  <strong>direction:</strong> <code>outbound</code> or <code>inbound</code>.
                </p>
                <p>
                  <strong>disposition:</strong> <code>connected</code>, <code>interested</code>, etc.
                </p>
                <p>
                  <strong>notes:</strong> Summary or call comments.
                </p>
                <p>
                  <strong>date / startedat:</strong> ISO-8601 date timestamp.
                </p>
                <p>
                  <strong>clientcallid:</strong> Optional idempotency key to prevent accidental duplicate imports.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: UNMATCHED REVIEW QUEUE */}
        {activeTab === "review" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-amber-600" />
                  Unmatched Calls Review Queue
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Calls logged manually without a known CRM lead. Staff can link them to an existing lead or quick-create a new lead.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by phone..."
                    value={searchReview}
                    onChange={(e) => setSearchReview(e.target.value)}
                    className="pl-9 pr-4 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none w-48 sm:w-64"
                  />
                </div>
                <button
                  onClick={fetchReviewQueue}
                  className="p-2 border border-slate-300 hover:bg-slate-50 rounded-lg text-slate-600 transition"
                  title="Refresh Queue"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingReview ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Table */}
            {loadingReview ? (
              <div className="p-12 text-center text-slate-500">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
                Loading review queue...
              </div>
            ) : reviewCalls.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800">Review Queue is Clear</h4>
                <p className="text-xs text-slate-500 mt-1">All uploaded calls have been successfully matched to CRM leads.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Phone Number</th>
                      <th className="py-3 px-4">Direction & Time</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Recording</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reviewCalls.map((call) => (
                      <tr key={call._id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3.5 px-4 font-semibold text-slate-900">
                          {call.number}
                          <span className="block text-[11px] font-normal text-slate-500">
                            {call.phoneNormalized}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 font-medium capitalize text-xs">
                            {call.direction === "inbound" ? (
                              <PhoneIncoming className="w-3.5 h-3.5 text-blue-500" />
                            ) : (
                              <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            {call.direction}
                          </span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            {new Date(call.startedAt).toLocaleString()}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">
                          {call.duration}s
                        </td>
                        <td className="py-3.5 px-4">
                          {call.recording?.fileId || call.recording?.status === "stored" ? (
                            <div className="w-48">
                              <InBrowserAudioPlayer
                                callId={call._id}
                                leadName={call.number}
                                duration={call.duration}
                                compact={true}
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">No audio</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-500 max-w-xs truncate">
                          {call.notes || "—"}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => openMatchModal(call)}
                            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition"
                          >
                            Resolve Lead
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RESOLUTION / MATCH MODAL */}
      {selectedCallForMatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-600" />
                Resolve Unmatched Call
              </h3>
              <button
                onClick={() => setSelectedCallForMatch(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-3 bg-slate-50 p-3 rounded-lg text-xs text-slate-600">
              <p>
                <strong>Unmatched Number:</strong> {selectedCallForMatch.number}
              </p>
              <p className="mt-0.5">
                <strong>Date:</strong> {new Date(selectedCallForMatch.startedAt).toLocaleString()} ({selectedCallForMatch.duration}s)
              </p>
            </div>

            <div className="mt-4 flex border-b border-slate-200 text-xs font-semibold">
              <button
                onClick={() => setMatchMode("existing")}
                className={`py-2 px-3 border-b-2 transition ${
                  matchMode === "existing"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500"
                }`}
              >
                Link to Existing Lead
              </button>
              <button
                onClick={() => setMatchMode("new")}
                className={`py-2 px-3 border-b-2 transition ${
                  matchMode === "new"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500"
                }`}
              >
                Quick-Create New Lead
              </button>
            </div>

            <form onSubmit={handleMatchSubmit} className="mt-4 space-y-4">
              {matchMode === "existing" ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Search CRM Leads</label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Type lead name or phone..."
                      value={leadSearchQuery}
                      onChange={(e) => searchLeads(e.target.value)}
                      className="w-full pl-9 pr-3.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  {/* Search Results Dropdown */}
                  {leadsList.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                      {leadsList.map((lead) => (
                        <div
                          key={lead._id}
                          onClick={() => setSelectedLeadId(lead._id)}
                          className={`p-2.5 cursor-pointer flex items-center justify-between hover:bg-indigo-50/50 ${
                            selectedLeadId === lead._id ? "bg-indigo-50 font-bold text-indigo-900" : ""
                          }`}
                        >
                          <div>
                            <p className="font-semibold">{lead.name}</p>
                            <p className="text-[11px] text-slate-500">{lead.phone}</p>
                          </div>
                          {selectedLeadId === lead._id && <Check className="w-4 h-4 text-indigo-600" />}
                        </div>
                      ))}
                    </div>
                  )}
                  {searchingLeads && (
                    <p className="text-xs text-slate-400 mt-1">Searching leads...</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Lead Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. John Doe"
                      value={newLeadForm.name}
                      onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                      required
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={newLeadForm.phone}
                      onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                      required
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      placeholder="john@example.com"
                      value={newLeadForm.email}
                      onChange={(e) => setNewLeadForm({ ...newLeadForm, email: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedCallForMatch(null)}
                  className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingMatch || (matchMode === "existing" && !selectedLeadId)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submittingMatch ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Matching...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Confirm Match & Link Call
                    </>
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
