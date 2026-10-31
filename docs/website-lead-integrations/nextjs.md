# Next.js App Router Lead Integration Guide

This guide covers integrating modern **Next.js (App Router / Pages Router)** applications with **Leads-365 CRM** while keeping your private API key completely secure on the server.

---

## 1. Security Architecture: Server-Side Forwarding

In Next.js, never store private API credentials with the `NEXT_PUBLIC_` prefix.

1. **Client Browser** $\rightarrow$ submits to your internal Next.js server route: `POST /api/contact`.
2. **Next.js Route Handler (`app/api/contact/route.js`)** $\rightarrow$ reads `process.env.LEADS365_API_KEY` and securely forwards the lead to the Leads-365 CRM webhook.

---

## 2. Step 1: Environment Variables (`.env.local`)

```env
# .env.local — Kept strictly on the server; NEVER prefix with NEXT_PUBLIC_
LEADS365_WEBHOOK_URL="https://your-crm-domain.com/api/integrations/leads/website"
LEADS365_API_KEY="lf_live_YOUR_PRIVATE_API_KEY"
```

---

## 3. Step 2: Next.js App Router Server Handler (`app/api/contact/route.js`)

```javascript
// app/api/contact/route.js
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();

    // 1. Verify honeypot anti-spam
    if (body._hp_trap) {
      return NextResponse.json({ success: false, error: 'Bot submission rejected' }, { status: 400 });
    }

    // 2. Validate essential fields
    if (!body.name || (!body.email && !body.phone)) {
      return NextResponse.json(
        { success: false, error: 'Name and either email or phone are required' },
        { status: 400 }
      );
    }

    // 3. Forward request server-to-server to Leads-365 CRM
    const response = await fetch(process.env.LEADS365_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.LEADS365_API_KEY,
        'X-Idempotency-Key': 'nextjs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
      },
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        message: body.message,
        source: 'Next.js App',
        landingPage: body.landingPage || ''
      })
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Next.js CRM Forwarding Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 });
  }
}
```

---

## 4. Step 3: Client Form Component (`app/components/ContactForm.jsx`)

```jsx
'use client';

import { useState } from 'react';

export default function ContactForm() {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ msg: '', error: false });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ msg: '', error: false });

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          landingPage: window.location.href
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit enquiry');
      }

      setStatus({ msg: 'Thank you! Your enquiry has been sent.', error: false });
      setFormData({ name: '', email: '', phone: '', message: '', _hp_trap: '' });
    } catch (err) {
      setStatus({ msg: err.message, error: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 bg-white rounded-lg shadow space-y-4">
      <input
        type="text"
        name="_hp_trap"
        value={formData._hp_trap}
        onChange={(e) => setFormData({ ...formData, _hp_trap: e.target.value })}
        className="hidden"
        tabIndex={-1}
      />

      <input
        type="text"
        required
        placeholder="Full Name *"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        className="w-full p-2.5 border rounded-lg"
      />

      <input
        type="email"
        placeholder="Email Address"
        value={formData.email}
        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        className="w-full p-2.5 border rounded-lg"
      />

      <input
        type="tel"
        required
        placeholder="Phone Number *"
        value={formData.phone}
        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
        className="w-full p-2.5 border rounded-lg"
      />

      <textarea
        placeholder="Message"
        rows={3}
        value={formData.message}
        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
        className="w-full p-2.5 border rounded-lg"
      />

      {status.msg && (
        <div className={`p-2.5 text-xs rounded ${status.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {status.msg}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Send Message'}
      </button>
    </form>
  );
}
```

