"use client"

import React, { useState, useEffect } from "react"

/**
 * Next.js LeadEnquiryForm Client Component
 *
 * Submits to the internal Next.js route: POST /api/leads
 * The server route handles secure HMAC-SHA256 signing and private API keys.
 */
export default function LeadEnquiryForm({
  source = "Next.js Website",
  customFields = [
    {
      name: "product_interest",
      label: "Product of Interest",
      type: "dropdown",
      options: ["Enterprise Suite", "Growth Plan", "Custom API Integration"],
      required: false,
    },
    {
      name: "budget",
      label: "Estimated Budget ($)",
      type: "number",
      placeholder: "e.g. 50000",
      required: false,
    },
  ],
  onSuccess,
}) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    message: "",
  })
  const [customValues, setCustomValues] = useState({})
  const [attribution, setAttribution] = useState({})
  const [honeypot, setHoneypot] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successResult, setSuccessResult] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})

  // Capture UTM parameters on client mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const captured = {}
    ;["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach(
      (k) => {
        const val = params.get(k)
        if (val) captured[k] = val.trim()
      }
    )
    captured.landingPage = window.location.href
    if (document.referrer) captured.referrer = document.referrer
    setAttribution(captured)
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: null }))
    }
  }

  const handleCustomChange = (name, value) => {
    setCustomValues((prev) => ({ ...prev, [name]: value }))
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: null }))
    }
  }

  const validate = () => {
    const errors = {}
    if (!formData.name.trim()) errors.name = "Full name is required"
    if (!formData.phone.trim()) errors.phone = "Phone number is required"
    if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email.trim())) {
        errors.email = "Please enter a valid email address"
      }
    }
    customFields.forEach((cf) => {
      if (cf.required && !customValues[cf.name]) {
        errors[cf.name] = `${cf.label} is required`
      }
    })
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setErrorMessage(null)
    setSuccessResult(null)

    if (!validate()) return

    setSubmitting(true)

    try {
      const payload = {
        ...formData,
        customFields: customValues,
        source,
        ...attribution,
        _hp_trap: honeypot,
      }

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Failed to submit enquiry")
        return
      }

      setSuccessResult({
        leadId: data.leadId,
        message: data.message || "Thank you! We will get in touch shortly.",
      })
      setFormData({ name: "", email: "", phone: "", company: "", message: "" })
      setCustomValues({})
      if (onSuccess) onSuccess(data)
    } catch (err) {
      setErrorMessage(err.message || "Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-md w-full mx-auto p-6 bg-white border border-slate-200 rounded-2xl shadow-sm text-slate-800 font-sans">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-slate-900">Contact Sales</h3>
        <p className="text-xs text-slate-500 mt-1">Submit your details and an executive will contact you shortly.</p>
      </div>

      {successResult ? (
        <div className="text-center py-8 space-y-3">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center font-bold text-xl mx-auto">
            ✓
          </div>
          <h4 className="font-bold text-slate-900 text-base">Enquiry Received!</h4>
          <p className="text-xs text-slate-600">{successResult.message}</p>
          <button
            type="button"
            onClick={() => setSuccessResult(null)}
            className="mt-3 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            Submit Another Request
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-3 text-xs">
          {/* Honeypot anti-spam trap */}
          <div style={{ display: "none" }} aria-hidden="true">
            <input
              type="text"
              name="_hp_trap"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs">
              {errorMessage}
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              placeholder="e.g. Michael Chang"
              value={formData.name}
              onChange={handleChange}
              disabled={submitting}
              className={`w-full px-3 py-2 border rounded-xl outline-none transition ${
                validationErrors.name ? "border-rose-400 bg-rose-50" : "border-slate-200 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              }`}
            />
            {validationErrors.name && (
              <span className="text-[11px] text-rose-600 mt-0.5 block">{validationErrors.name}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Phone Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                placeholder="+91 98765 43210"
                value={formData.phone}
                onChange={handleChange}
                disabled={submitting}
                className={`w-full px-3 py-2 border rounded-xl outline-none transition ${
                  validationErrors.phone ? "border-rose-400 bg-rose-50" : "border-slate-200 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                }`}
              />
              {validationErrors.phone && (
                <span className="text-[11px] text-rose-600 mt-0.5 block">{validationErrors.phone}</span>
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                placeholder="michael@corp.com"
                value={formData.email}
                onChange={handleChange}
                disabled={submitting}
                className={`w-full px-3 py-2 border rounded-xl outline-none transition ${
                  validationErrors.email ? "border-rose-400 bg-rose-50" : "border-slate-200 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                }`}
              />
              {validationErrors.email && (
                <span className="text-[11px] text-rose-600 mt-0.5 block">{validationErrors.email}</span>
              )}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Company / Organization</label>
            <input
              type="text"
              name="company"
              placeholder="Chang Enterprises"
              value={formData.company}
              onChange={handleChange}
              disabled={submitting}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none"
            />
          </div>

          {/* Configured Custom Fields */}
          {customFields.map((cf) => (
            <div key={cf.name}>
              <label className="block font-semibold text-slate-700 mb-1">
                {cf.label} {cf.required && <span className="text-rose-500">*</span>}
              </label>
              {cf.type === "dropdown" ? (
                <select
                  value={customValues[cf.name] || ""}
                  onChange={(e) => handleCustomChange(cf.name, e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none"
                >
                  <option value="">-- Select {cf.label} --</option>
                  {(cf.options || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={cf.type === "number" ? "number" : "text"}
                  placeholder={cf.placeholder || ""}
                  value={customValues[cf.name] || ""}
                  onChange={(e) => handleCustomChange(cf.name, e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none"
                />
              )}
              {validationErrors[cf.name] && (
                <span className="text-[11px] text-rose-600 mt-0.5 block">{validationErrors[cf.name]}</span>
              )}
            </div>
          ))}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Message</label>
            <textarea
              name="message"
              rows={3}
              placeholder="Describe your requirements..."
              value={formData.message}
              onChange={handleChange}
              disabled={submitting}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Send Enquiry"}
          </button>
        </form>
      )}
    </div>
  )
}
