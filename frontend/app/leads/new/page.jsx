"use client"

import React, { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import Breadcrumb from "@/components/breadcrumb"
import {
  UserPlus,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Mail,
  Phone,
  User,
  Tag,
  Users,
  FileText,
  Save,
  Sparkles,
  Building2,
} from "lucide-react"

const ALLOWED_STATUSES = [
  { value: "New", label: "New (Fresh prospect)" },
  { value: "Engaged", label: "Engaged (Active communication)" },
  { value: "Proposal Sent", label: "Proposal Sent (Awaiting decision)" },
  { value: "Closed-Won", label: "Closed-Won (Converted client)" },
  { value: "Closed-Lost", label: "Closed-Lost (Disqualified or dropped)" },
]

const LEAD_SOURCES = [
  "Website",
  "Referral",
  "Cold Outreach",
  "Google Ads",
  "Meta Ads",
  "Inbound Call",
  "Manual Entry",
]

function LeadFormContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get("id")
  const isEditMode = Boolean(editId)

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    status: "New",
    source: "Manual Entry",
    assignedTo: "Unassigned",
    message: "",
  })

  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(isEditMode)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [serverError, setServerError] = useState(null)

  // Load existing lead details if editing
  useEffect(() => {
    if (!editId) return

    const loadLeadData = async () => {
      try {
        setIsLoading(true)
        setServerError(null)
        const response = await apiClient.getLeadById(editId)
        if (response.success && response.data) {
          const lead = response.data
          setFormData({
            name: lead.name || "",
            email: lead.email || "",
            phone: lead.phone || "",
            company: lead.company || lead.metadata?.company || "",
            status: lead.status || "New",
            source: lead.source || "Manual Entry",
            assignedTo: lead.assignedTo || "Unassigned",
            message: lead.message || "",
          })
        } else {
          setServerError(response.error || "Lead not found")
        }
      } catch (err) {
        console.error("Failed to load lead details:", err)
        setServerError(err.message || "Failed to load lead details")
      } finally {
        setIsLoading(false)
      }
    }

    loadLeadData()
  }, [editId])

  const validateForm = () => {
    const newErrors = {}

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = "Lead name is required"
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters long"
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
    if (!formData.email.trim()) {
      newErrors.email = "Email address is required"
    } else if (!emailRegex.test(formData.email.trim())) {
      newErrors.email = "Please enter a valid email address (e.g. name@company.com)"
    }

    // Status validation
    if (!formData.status) {
      newErrors.status = "Status is required"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setServerError(null)

    if (!validateForm()) {
      toast.error("Please resolve the validation errors.")
      return
    }

    setIsSubmitting(true)
    const toastId = toast.loading(isEditMode ? "Updating lead record..." : "Creating new lead...")

    try {
      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        company: formData.company.trim(),
        status: formData.status,
        source: formData.source.trim(),
        assignedTo: formData.assignedTo.trim(),
        message: formData.message.trim(),
      }

      let response
      if (isEditMode) {
        response = await apiClient.updateLead(editId, payload)
      } else {
        response = await apiClient.createLead(payload)
      }

      toast.dismiss(toastId)

      if (response.success) {
        setShowSuccess(true)
        toast.success(
          isEditMode
            ? `Lead "${formData.name.trim()}" updated successfully!`
            : `Lead "${formData.name.trim()}" created successfully!`
        )

        setTimeout(() => {
          router.push("/leads")
        }, 1200)
      } else {
        const msg = response.error || (isEditMode ? "Failed to update lead" : "Failed to create lead")
        setServerError(msg)
        toast.error(msg)
      }
    } catch (error) {
      toast.dismiss(toastId)
      console.error("Error saving lead:", error)
      const msg = error.message || (isEditMode ? "Failed to update lead" : "Failed to create lead")
      setServerError(msg)
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const breadcrumbItems = [
    { label: "Dashboard", href: "/" },
    { label: "Leads", href: "/leads" },
    { label: isEditMode ? "Edit Lead" : "Add New Lead" },
  ]

  if (isLoading) {
    return (
      <div className="w-full min-h-[500px] flex flex-col items-center justify-center space-y-3">
        <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-slate-500">Loading lead record from database...</p>
      </div>
    )
  }

  return (
    <>
      <Breadcrumb items={breadcrumbItems} />
      <div className="min-h-screen bg-slate-50/70 pb-12 pt-4">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Back link */}
          <div className="mb-4">
            <Link
              href="/leads"
              className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to All Leads</span>
            </Link>
          </div>

          {/* Page Heading */}
          <div className="mb-6">
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {isEditMode ? "Edit Lead Record" : "Add New Lead"}
              </h1>
              {isEditMode && (
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                  #LD-{editId.slice(-6).toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isEditMode
                ? "Update contact details, lead status, and assignment in your pipeline."
                : "Register a new sales inquiry or prospect into MongoDB Atlas."}
            </p>
          </div>

          {/* Success Banner */}
          {showSuccess && (
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-3 text-emerald-800 text-xs font-medium animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {isEditMode
                  ? "Lead record updated successfully! Redirecting to All Leads..."
                  : "Lead record created successfully! Redirecting to All Leads..."}
              </span>
            </div>
          )}

          {/* Server Error Banner */}
          {serverError && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-3 text-rose-800 text-xs font-medium animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          {/* Main Form Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-indigo-50/20">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {isEditMode ? "Lead Information & Status" : "New Lead Information"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    All changes are immediately saved to MongoDB Atlas with multi-tenant isolation.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Full Name */}
                <div className="sm:col-span-2">
                  <label htmlFor="name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="name"
                      type="text"
                      placeholder="e.g. Alexander Vance"
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      className={`w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors ${
                        errors.name ? "border-rose-300 ring-1 ring-rose-300" : "border-slate-300"
                      }`}
                    />
                  </div>
                  {errors.name && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.name}</p>}
                </div>

                {/* 2. Email Address */}
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="email"
                      type="email"
                      placeholder="e.g. alex@company.com"
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      className={`w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono transition-colors ${
                        errors.email ? "border-rose-300 ring-1 ring-rose-300" : "border-slate-300"
                      }`}
                    />
                  </div>
                  {errors.email && <p className="text-[11px] text-rose-600 mt-1 font-medium">{errors.email}</p>}
                </div>

                {/* 3. Phone Number */}
                <div>
                  <label htmlFor="phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="phone"
                      type="text"
                      placeholder="e.g. +91 98765 43210"
                      value={formData.phone}
                      onChange={(e) => handleInputChange("phone", e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white font-mono transition-colors"
                    />
                  </div>
                </div>

                {/* 3b. Company Name */}
                <div>
                  <label htmlFor="company" className="block text-xs font-semibold text-slate-700 mb-1">
                    Company / Organization
                  </label>
                  <div className="relative">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="company"
                      type="text"
                      placeholder="e.g. Acme Health Corp"
                      value={formData.company}
                      onChange={(e) => handleInputChange("company", e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                {/* 4. Lead Status */}
                <div>
                  <label htmlFor="status" className="block text-xs font-semibold text-slate-700 mb-1">
                    Pipeline Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="status"
                    value={formData.status}
                    onChange={(e) => handleInputChange("status", e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer font-medium"
                  >
                    {ALLOWED_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 5. Lead Source */}
                <div>
                  <label htmlFor="source" className="block text-xs font-semibold text-slate-700 mb-1">
                    Lead Source
                  </label>
                  <select
                    id="source"
                    value={formData.source}
                    onChange={(e) => handleInputChange("source", e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white cursor-pointer"
                  >
                    {LEAD_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 6. Assigned To */}
                <div className="sm:col-span-2">
                  <label htmlFor="assignedTo" className="block text-xs font-semibold text-slate-700 mb-1">
                    Assigned Sales Representative
                  </label>
                  <div className="relative">
                    <Users className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="assignedTo"
                      type="text"
                      placeholder="e.g. Sarah Jenkins or Unassigned"
                      value={formData.assignedTo}
                      onChange={(e) => handleInputChange("assignedTo", e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                {/* 7. Notes & Inquiries Message */}
                <div className="sm:col-span-2">
                  <label htmlFor="message" className="block text-xs font-semibold text-slate-700 mb-1">
                    Notes & Inquiry Details
                  </label>
                  <textarea
                    id="message"
                    rows={4}
                    placeholder="Enter prospect requirements, meeting notes, or project inquiry..."
                    value={formData.message}
                    onChange={(e) => handleInputChange("message", e.target.value)}
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-colors"
                  />
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <Link
                  href="/leads"
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                >
                  Cancel
                </Link>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center space-x-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>{isEditMode ? "Saving Changes..." : "Creating Lead..."}</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>{isEditMode ? "Save Changes" : "Create Lead"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}

export default function NewLeadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-slate-500">Loading lead form...</p>
          </div>
        </div>
      }
    >
      <LeadFormContent />
    </Suspense>
  )
}
