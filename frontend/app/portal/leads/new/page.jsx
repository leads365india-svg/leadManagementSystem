"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { apiClient } from "@/lib/api"
import { toast } from "react-hot-toast"
import {
  UserPlus,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Mail,
  User,
  Layers,
  Sparkles,
} from "lucide-react"

export default function PortalNewLeadPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState("New")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      const msg = "Lead full name is required"
      setError(msg)
      toast.error(msg)
      return
    }

    if (!email.trim()) {
      const msg = "Lead email address is required"
      setError(msg)
      toast.error(msg)
      return
    }

    const toastId = toast.loading("Saving lead record...")
    try {
      setLoading(true)
      const response = await apiClient.createLead({
        name: name.trim(),
        email: email.trim(),
        status,
      })

      toast.dismiss(toastId)

      if (response.success) {
        setSuccess(true)
        toast.success(`Lead "${name.trim()}" created successfully!`)
        setTimeout(() => {
          router.push("/portal/leads")
        }, 1200)
      } else {
        const msg = response.error || "Failed to create lead"
        setError(msg)
        toast.error(msg)
      }
    } catch (err) {
      toast.dismiss(toastId)
      const msg = err.message || "Failed to create lead"
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Top back link */}
      <div>
        <Link
          href="/portal/leads"
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Leads Pipeline</span>
        </Link>
      </div>

      {/* Main Form Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-indigo-50/20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">Add New Lead</h1>
              <p className="text-xs text-slate-500">
                Register a new prospect into your organization pipeline
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start space-x-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Lead created successfully! Redirecting to pipeline...</span>
            </div>
          )}

          {/* Lead Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Prospect Full Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Michael Vance"
                className="w-full text-xs pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Lead Email */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Prospect Email Address <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. michael.vance@company.com"
                className="w-full text-xs pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Pipeline Stage */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
              Initial Pipeline Stage
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full text-xs px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
            >
              <option value="New">New (Fresh prospect, uncontacted)</option>
              <option value="Engaged">Engaged (Contact initiated / in discussion)</option>
              <option value="Proposal Sent">Proposal Sent (Quote / pitch submitted)</option>
              <option value="Closed-Won">Closed-Won (Successfully converted)</option>
              <option value="Closed-Lost">Closed-Lost (Disqualified or rejected)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
            <Link
              href="/portal/leads"
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || success}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50 transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Saving Lead...</span>
                </>
              ) : (
                <span>Save Prospect</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
