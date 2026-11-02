import React, { useState, useId } from "react"
import { submitLead } from "./lead365"
import "./form.css"

/**
 * LeadEnquiryForm - Reusable Lead Capture Component for React & Vite Applications
 *
 * @param {Object} props
 * @param {string} [props.siteKey] - Public Site Key (default: import.meta.env.VITE_LEADS365_SITE_KEY)
 * @param {string} [props.webhookUrl] - Ingestion URL (default: import.meta.env.VITE_LEADS365_WEBHOOK_URL)
 * @param {string} [props.source="React Website"] - Custom lead source tag
 * @param {Array} [props.customFields] - Array of custom field configs: [{ name, label, type, options, required, placeholder }]
 * @param {Function} [props.onSuccess] - Callback when lead is submitted successfully
 * @param {Function} [props.onError] - Callback on submission failure
 */
export default function LeadEnquiryForm({
  siteKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_LEADS365_SITE_KEY) || "",
  webhookUrl = (typeof import.meta !== "undefined" && import.meta.env?.VITE_LEADS365_WEBHOOK_URL) || "http://localhost:5000/api/integrations/leads/website",
  source = "React Website",
  customFields = [
    {
      name: "product_interest",
      label: "Product of Interest",
      type: "dropdown",
      options: ["Enterprise CRM", "Starter Suite", "Custom API Ingestion"],
      required: false,
    },
    {
      name: "budget",
      label: "Estimated Budget",
      type: "number",
      placeholder: "e.g. 50000",
      required: false,
    },
  ],
  onSuccess,
  onError,
}) {
  const formId = useId()

  // Standard form fields
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    message: "",
  })

  // Dynamic custom fields state
  const [customValues, setCustomValues] = useState({})

  // Anti-bot honeypot state (must remain empty for legitimate users)
  const [honeypot, setHoneypot] = useState("")

  // Form states
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successResult, setSuccessResult] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})

  // Standard field change
  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: null }))
    }
  }

  // Custom field change
  const handleCustomChange = (name, value) => {
    setCustomValues((prev) => ({ ...prev, [name]: value }))
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: null }))
    }
  }

  // Client-side validation
  const validate = () => {
    const errors = {}

    if (!formData.name.trim()) {
      errors.name = "Full name is required"
    } else if (formData.name.trim().length < 2) {
      errors.name = "Name must be at least 2 characters"
    }

    if (!formData.phone.trim()) {
      errors.phone = "Phone number is required"
    } else {
      const cleanPhone = formData.phone.replace(/[\s\-+()]/g, "")
      if (cleanPhone.length < 7 || cleanPhone.length > 15) {
        errors.phone = "Please enter a valid phone number (7-15 digits)"
      }
    }

    if (formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email.trim())) {
        errors.email = "Please enter a valid email address"
      }
    }

    // Validate required custom fields
    customFields.forEach((cf) => {
      if (cf.required) {
        const val = customValues[cf.name]
        if (val === undefined || val === null || String(val).trim() === "") {
          errors[cf.name] = `${cf.label} is required`
        }
      }
    })

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Form submission handler
  const handleSubmit = async (e) => {
    e.preventDefault()

    // Prevent duplicate submission clicks
    if (submitting) return

    setErrorMessage(null)
    setSuccessResult(null)

    if (!validate()) return

    setSubmitting(true)

    try {
      const result = await submitLead({
        siteKey,
        webhookUrl,
        leadData: formData,
        customFields: customValues,
        source,
        honeypot,
      })

      if (result.success) {
        setSuccessResult({
          leadId: result.leadId,
          message: "Thank you! Your enquiry has been received. Our team will contact you shortly.",
        })
        // Reset form
        setFormData({ name: "", email: "", phone: "", company: "", message: "" })
        setCustomValues({})
        setHoneypot("")
        if (onSuccess) onSuccess(result)
      } else {
        const errText = result.duplicate
          ? "You have already submitted an enquiry recently. Our team is already processing your request."
          : result.error || "Failed to submit enquiry. Please try again."
        setErrorMessage(errText)
        if (onError) onError(result)
      }
    } catch (err) {
      setErrorMessage(err.message || "A network error occurred. Please check your connection.")
      if (onError) onError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="lead365-form-card">
      <div className="lead365-header">
        <h3 className="lead365-title">Get in Touch</h3>
        <p className="lead365-subtitle">Fill out the form below and we will get back to you within 24 hours.</p>
      </div>

      {successResult ? (
        <div className="lead365-success-banner" role="alert">
          <div className="lead365-success-icon">✓</div>
          <h4>Enquiry Received!</h4>
          <p>{successResult.message}</p>
          <button
            type="button"
            className="lead365-reset-btn"
            onClick={() => setSuccessResult(null)}
          >
            Submit Another Request
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="lead365-form">
          {/* Anti-bot Honeypot field (hidden from visual view and screen readers) */}
          <div style={{ display: "none" }} aria-hidden="true">
            <label htmlFor={`${formId}-hp`}>Leave this empty</label>
            <input
              id={`${formId}-hp`}
              type="text"
              name="_hp_trap"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="lead365-alert lead365-alert-error" role="alert">
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Name Field */}
          <div className="lead365-field-group">
            <label htmlFor={`${formId}-name`} className="lead365-label">
              Full Name <span className="lead365-required">*</span>
            </label>
            <input
              id={`${formId}-name`}
              name="name"
              type="text"
              placeholder="e.g. Sarah Jenkins"
              value={formData.name}
              onChange={handleChange}
              disabled={submitting}
              className={`lead365-input ${validationErrors.name ? "lead365-input-error" : ""}`}
            />
            {validationErrors.name && (
              <span className="lead365-error-text">{validationErrors.name}</span>
            )}
          </div>

          {/* Contact Row (Phone + Email) */}
          <div className="lead365-grid-2">
            <div className="lead365-field-group">
              <label htmlFor={`${formId}-phone`} className="lead365-label">
                Phone Number <span className="lead365-required">*</span>
              </label>
              <input
                id={`${formId}-phone`}
                name="phone"
                type="tel"
                placeholder="+91 98765 43210"
                value={formData.phone}
                onChange={handleChange}
                disabled={submitting}
                className={`lead365-input ${validationErrors.phone ? "lead365-input-error" : ""}`}
              />
              {validationErrors.phone && (
                <span className="lead365-error-text">{validationErrors.phone}</span>
              )}
            </div>

            <div className="lead365-field-group">
              <label htmlFor={`${formId}-email`} className="lead365-label">
                Email Address
              </label>
              <input
                id={`${formId}-email`}
                name="email"
                type="email"
                placeholder="sarah@company.com"
                value={formData.email}
                onChange={handleChange}
                disabled={submitting}
                className={`lead365-input ${validationErrors.email ? "lead365-input-error" : ""}`}
              />
              {validationErrors.email && (
                <span className="lead365-error-text">{validationErrors.email}</span>
              )}
            </div>
          </div>

          {/* Company Field */}
          <div className="lead365-field-group">
            <label htmlFor={`${formId}-company`} className="lead365-label">
              Organization / Company
            </label>
            <input
              id={`${formId}-company`}
              name="company"
              type="text"
              placeholder="Acme Corporation"
              value={formData.company}
              onChange={handleChange}
              disabled={submitting}
              className="lead365-input"
            />
          </div>

          {/* Configurable Custom Fields */}
          {customFields.map((cf) => {
            const fieldKey = `${formId}-cf-${cf.name}`
            return (
              <div key={cf.name} className="lead365-field-group">
                <label htmlFor={fieldKey} className="lead365-label">
                  {cf.label} {cf.required && <span className="lead365-required">*</span>}
                </label>

                {cf.type === "dropdown" ? (
                  <select
                    id={fieldKey}
                    value={customValues[cf.name] || ""}
                    onChange={(e) => handleCustomChange(cf.name, e.target.value)}
                    disabled={submitting}
                    className={`lead365-input ${validationErrors[cf.name] ? "lead365-input-error" : ""}`}
                  >
                    <option value="">-- Select {cf.label} --</option>
                    {(cf.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : cf.type === "checkbox" ? (
                  <label className="lead365-checkbox-label">
                    <input
                      id={fieldKey}
                      type="checkbox"
                      checked={Boolean(customValues[cf.name])}
                      onChange={(e) => handleCustomChange(cf.name, e.target.checked)}
                      disabled={submitting}
                    />
                    <span>{cf.placeholder || `Yes, include ${cf.label}`}</span>
                  </label>
                ) : (
                  <input
                    id={fieldKey}
                    type={cf.type === "number" ? "number" : "text"}
                    placeholder={cf.placeholder || ""}
                    value={customValues[cf.name] || ""}
                    onChange={(e) => handleCustomChange(cf.name, e.target.value)}
                    disabled={submitting}
                    className={`lead365-input ${validationErrors[cf.name] ? "lead365-input-error" : ""}`}
                  />
                )}

                {validationErrors[cf.name] && (
                  <span className="lead365-error-text">{validationErrors[cf.name]}</span>
                )}
              </div>
            )
          })}

          {/* Message Field */}
          <div className="lead365-field-group">
            <label htmlFor={`${formId}-message`} className="lead365-label">
              Message or Specific Requirements
            </label>
            <textarea
              id={`${formId}-message`}
              name="message"
              rows={3}
              placeholder="Tell us about your project or enquiry..."
              value={formData.message}
              onChange={handleChange}
              disabled={submitting}
              className="lead365-input lead365-textarea"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting}
            className="lead365-submit-btn"
          >
            {submitting ? (
              <span className="lead365-btn-loading">
                <span className="lead365-spinner" /> Submitting...
              </span>
            ) : (
              "Submit Enquiry"
            )}
          </button>
        </form>
      )}
    </div>
  )
}
