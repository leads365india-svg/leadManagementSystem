# 🚀 Leads-365 — Multi-Tenant Lead Management & CRM Platform

A robust, multi-tenant lead management CRM engineered with Next.js 15, React 19, Node.js, Express, and MongoDB Mongoose. Built for sales agencies and lead-driven enterprises with strict multi-tenant isolation, role-based access control (RBAC), and automated communication workflows.

Repository: `teammedical365-coder/Leads-365`

---

## ✨ System Architecture & Core Capabilities

### 🏢 Multi-Tenant Agency Isolation
- **Tenant Partitioning**: Strict tenant separation across all operational data (Leads, Follow-ups, Integrations, and future Calls/Recordings).
- **White-Label Support**: Account-level branding, company names, contact information, and customized portal endpoints.
- **Super Admin Governance**: Global administrative portal for agency provisioning, suspension management, and RBAC permission policy control.

### 👥 Role-Based Access Control (RBAC)
- **Role Hierarchy**: Super Admin, Account Admin, Manager, and Sales Agent roles.
- **Granular Permissions**: Module-level permission gates (`leads.view`, `leads.create`, `leads.edit`, `leads.delete`, `followups.view`, `followups.manage`, `integrations.manage`, etc.).
- **In-Memory Permission Cache**: High-performance TTL caching (30–60s) preventing repetitive database queries on high-throughput requests.

### 🎯 Lead Pipeline & Workflow Engine
- **Lifecycle Pipeline**: Structured canonical status stages (`New`, `Engaged`, `Proposal Sent`, `Closed-Won`, `Closed-Lost`) with dropdown alias mapping.
- **Audit Trajectory**: Automatic state transition history tracking timestamp, actor, and status transitions.
- **Multi-criteria Filtering**: Full-text and keyword search, phone/email search, date range selectors, and pagination.

### 📅 Communication & Follow-ups Management
- **Touchpoint Types**: Scheduled phone calls, email outreach, meeting demos, tasks, and touchpoints.
- **Timeline Views**: Real-time filtering by status (`Upcoming`, `Due Today`, `Overdue`, `Completed`), priority, and touchpoint type.
- **Outcome Tracking**: Outcome recording with timestamps, completion notes, and actor attribution.

### 🔌 Inbound Lead Feeds & Webhooks
- **Website Ingestion Webhook**: High-throughput public webhook (`/api/integrations/leads/website`) supporting server-to-server snippets (PHP, Node.js, cURL).
- **Cryptographic Security**: Per-tenant hashed API credentials (`lf_live_...`), HMAC-SHA256 verification tokens, and idempotency key duplicate deduplication.
- **Domain Guardrails**: Blocked disposable email domains, strict phone normalization, and accepted form filters.

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 15 (App Router), React 19, JavaScript / JSX, Tailwind CSS, Radix UI, Lucide React.
- **Backend**: Node.js, Express 4.18, Mongoose 8.0, MongoDB Atlas.
- **Security**: Cookie-based JWT sessions, exact-origin CSRF validation, Helmet security headers, rate limiting (dashboard, auth, integration tiers), fail-closed secret enforcement.

---

## 🚦 Getting Started Locally

### Prerequisites
- Node.js 18+ (Node.js 20+ recommended)
- MongoDB Atlas cluster or local MongoDB instance
- npm 9+

### 1. Environment Configuration

#### Backend (`backend/.env`):
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/leads_management?retryWrites=true&w=majority
JWT_SECRET=your-minimum-32-character-secure-jwt-secret-here
FRONTEND_URL=http://localhost:3000
```

#### Frontend (`frontend/.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### 2. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Run Development Servers

```bash
# Start backend (Port 5000)
cd backend
npm start

# Start frontend (Port 3000)
cd ../frontend
npm run dev
```

### 4. Running Verification Test Suites

```bash
cd backend

# Security & Phase 1 verification
node tests/verifyPhase1Security.js

# All Leads management verification
node tests/verifyAllLeadsFeature.js

# Pipeline workflow verification
node tests/verifyPhase2Pipeline.js

# Follow-ups management verification
node tests/verifyPhase3FollowUps.js
```

---

## 🗺️ Roadmap & Phase Execution

Detailed engineering roadmap and phase-by-phase specifications are maintained in `LEADS365_NEXT_ROADMAP.md`.
Live execution status is tracked in `leads365_roadmap_execution_status.md`.
