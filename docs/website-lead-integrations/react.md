# React Website Lead Integration Guide

This guide covers integrating client-side React single-page applications (SPAs) or component libraries with **Leads-365 CRM**.

---

## 1. Security Architecture

- **Public Site Key:** React uses `X-Site-Key: lf_site_...`. Never expose your private `lf_live_...` key in React frontend code or client bundles.
- **Allowed Origins:** Ensure your React application's domain (e.g. `https://app.mycompany.com` or `http://localhost:3000`) is configured in the integration's **Allowed Origins**.
- **Anti-Bot Protection:** Includes a hidden honeypot field `_hp_trap`.

---

## 2. Reusable React Form Component (`LeadCaptureForm.jsx`)

```jsx
import React, { useState } from 'react';

export default function LeadCaptureForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
    productChoice: '',
    _hp_trap: '' // Hidden anti-bot trap
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const CRM_ENDPOINT = 'https://your-crm-domain.com/api/integrations/leads/website';
  const PUBLIC_SITE_KEY = 'lf_site_YOUR_PUBLIC_SITE_KEY';

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(CRM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': PUBLIC_SITE_KEY
        },
        body: JSON.stringify({
          ...formData,
          source: 'React Website',
          landingPage: typeof window !== 'undefined' ? window.location.href : ''
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit enquiry');
      }

      setSuccess(true);
      setFormData({
        name: '',
        email: '',
        phone: '',
        company: '',
        message: '',
        productChoice: '',
        _hp_trap: ''
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 bg-white rounded-xl shadow border border-slate-200 space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Contact Sales Team</h3>

      {/* Hidden honeypot input */}
      <input
        type="text"
        name="_hp_trap"
        value={formData._hp_trap}
        onChange={handleChange}
        style={{ display: 'none' }}
        tabIndex={-1}
        autoComplete="off"
      />

      <div>
        <label className="block text-xs font-semibold text-slate-700">Full Name *</label>
        <input
          type="text"
          name="name"
          required
          value={formData.name}
          onChange={handleChange}
          placeholder="Jane Doe"
          className="mt-1 w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">Email Address</label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="jane@company.com"
          className="mt-1 w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">Phone Number *</label>
        <input
          type="tel"
          name="phone"
          required
          value={formData.phone}
          onChange={handleChange}
          placeholder="+1 555-0199"
          className="mt-1 w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">Company Name</label>
        <input
          type="text"
          name="company"
          value={formData.company}
          onChange={handleChange}
          placeholder="Acme Corp"
          className="mt-1 w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">Message</label>
        <textarea
          name="message"
          rows={3}
          value={formData.message}
          onChange={handleChange}
          placeholder="How can we help your business?"
          className="mt-1 w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg">
          Thank you! Your enquiry has been received. Our team will contact you shortly.
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-sm transition disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit Lead'}
      </button>
    </form>
  );
}
```

