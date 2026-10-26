# Leads-365: Next Roadmap
## Call recording automation, multi-platform lead capture, and website plugins

**Repo analysed:** `teammedical365-coder/Leads-365`, latest commit `aa3f5d8` "worked on follow ups" (23 Oct 2026), 18 commits.
**Scope of this document:** what to build next to reach three targets:
1. Calls made by agents on their phones are **recorded automatically and sent to the lead dashboard**, only for calls with leads, and stored in your own MongoDB for **30 days**.
2. Leads arrive **automatically from Google Ads, Facebook/Instagram, IndiaMART and other platforms**.
3. **Plugins and kits** capture leads from WordPress, Wix and other website builders.

> **How I analysed it:** I read the code on GitHub `main` (backend models, controllers, routes, middleware, start-up, tests, and the frontend pages and API client). I did not run the app or its tests, because they need a live MongoDB. If you have work that is not pushed to GitHub, tell me and I will re-check, because several things I describe as "not built" may exist only on your machine.
>
> **Numbering note:** Phase numbers in this file start again from 1. They do not match the earlier roadmap file or the "Phase 2/Phase 3" names inside your test files.

---

## 1. Where the repo stands now

### 1.1 What is built and working

| Area | Status | Details |
|---|---|---|
| Server hardening | ✅ | Auth required on all lead and follow-up routes. `checkPermission` now returns 401 when there is no user. Production start-up rejects a weak or placeholder `JWT_SECRET`. CORS is an allow-list, with a separate permissive CORS only for the website webhook. CSRF check covers both session cookies. 2 MB body limit, graceful shutdown, a real `/health` check |
| Auth and tenants | ✅ | Cookie JWT login, suspended user and suspended account checks, Super Admin creates agencies and an Account Admin for each. Frontend has `AuthContext` and `AuthGuard` |
| Leads | ✅ | Create, list with search, filter, sort and pagination, view, edit (name, email, phone, status, source, assignee, message), delete, stats |
| Pipeline | ✅ basic | Five fixed statuses (New, Engaged, Proposal Sent, Closed-Won, Closed-Lost) with alias mapping, so the sidebar views (New, Active, Order Placed, Lost) work. Each status change is appended to `metadata.statusHistory` |
| Follow-ups | ✅ | `FollowUp` model, 7 endpoints (list, stats, get, create, edit, complete, delete), upcoming / overdue / today / completed filters, a 1,743-line page, and a test suite |
| Website webhook | ✅ strong | Per-tenant API key (hashed, rotatable), idempotency keys, accepted-forms filter, blocked email domains, HMAC email verification, duplicate policy, phone normalisation, a fixed staff assignee, stats, test lead. Server-side snippets for PHP, Node and cURL |
| Super Admin | ✅ | Accounts CRUD with white-label fields, suspension, permission editor |
| Tests | 🟡 | 12 Node scripts that hit a running server and Atlas. They are not wired to CI, and `npm test` runs only the security script |

### 1.2 Progress against the previous roadmap

You said the earlier phases are done. This is what GitHub `main` shows:

| Previous phase | Status on GitHub | Evidence |
|---|---|---|
| 0 Security hardening | ✅ mostly | Fixed in commit "fix all security things". Leftovers in section 1.3 |
| 1 Tenant isolation layer | ❌ | Each controller still builds its own tenant filter (`getEffectiveTenant` is copied into `leadController` and `followUpController`). `Lead.tenantId` still defaults to `"default-tenant"` |
| 2 Engineering foundations | 🟡 | Graceful shutdown, health check and tests exist. No validation library, structured logging, CI or Docker |
| 3 App shell | 🟡 | Auth guard done. Navigation is still a 989-line top header, and routes are still duplicated (`/leads`, `/portal/leads`) |
| 4 Staff and teams | ❌ | `User.role` is only `super_admin` or `account_admin`. `/settings/staff` is a placeholder |
| 5 RBAC v2 | ❌ | One global `RolePermission` document for `account_admin`, read from the database on every request |
| 6 Audit log | ❌ | No model or code |
| 7 White-label runtime | ❌ | Branding fields are used only in the Super Admin page |
| 8 Lead model v2 | 🟡 | Phone edit works. No `ownerId`, normalised phone field, or attribution fields |
| 9 Pipeline and sources config | 🟡 | Fixed statuses with history. `source` is still free text |
| 10 Lead detail and timeline | ❌ | No lead detail page or drawer. History lives in `metadata` only |
| 11 Lead list v2 | 🟡 | Filters and sidebar views exist. No Kanban, bulk actions or saved views |
| 12 Assignment and ownership | ❌ | `assignedTo` and `assignedStaffId` are strings on Lead and FollowUp. No rules, history or pool. Assign Leads is a placeholder |
| 13 to 14 Import, export, custom fields | ❌ | Placeholders |
| 15 Background jobs | ❌ | No Redis, queue or scheduler. The backend has 9 dependencies and none are for jobs or file handling |
| 16 Follow-ups | ✅ | Built. Reminders and notifications are not (Reminders page is a placeholder) |

**Still placeholders (17 pages):** Call Reports, Meetings, Reminders, Call Ingestion, Call Reports (reports), Leads Report, Meeting Reports, Performance, Custom Fields, Do-Not-Record, Field Arrangement, Message Templates, Report Builder, Staff, Assign Leads, Data Management, Import Leads.

### 1.3 Findings that affect the new features

| # | Severity | Finding | Why it matters now |
|---|---|---|---|
| 1 | **High** | **No agent accounts.** The Android app and "only my leads" recording both need a per-agent identity | Hard blocker for the call app |
| 2 | **High** | **No lead ownership.** Owner is a name string, not a user ID | The app cannot know which leads belong to which phone |
| 3 | **High** | **No tenant-isolation layer**, and the new modules add more collections (calls, devices, recordings) that must never leak | One missed filter exposes another agency's calls |
| 4 | **High** | **CSRF origin check uses `startsWith`.** `http://localhost:3000.evil.com` passes the check for `http://localhost:3000` | Needs an exact-match comparison |
| 5 | **High** | **The development JWT fallback applies whenever `NODE_ENV` is not exactly `production`.** A deployed server missing that variable signs tokens with a publicly visible default | Any real deployment must fail closed |
| 6 | Medium | **No browser-safe way to post leads.** The webhook needs a secret `x-api-key`, so a form on a static site, Wix or WordPress cannot use it without exposing the key. Allowed-origin rules (in your own PDF) are not implemented | Blocks the website snippet and plugins |
| 7 | Medium | **Source is hardcoded as `"Website"`** in the webhook, and leads have no UTM, click-ID or campaign fields | Meta, Google and IndiaMART leads cannot be told apart |
| 8 | Medium | **Webhook and manual create have separate validation and duplicate logic** | Every new channel would copy it a third, fourth and fifth time |
| 9 | Medium | **Global rate limit of 200 requests per 15 minutes per IP** | A sales office behind one IP, or phones syncing every few minutes, will hit it. Mobile and webhook routes need their own limiters |
| 10 | Medium | **`checkPermission` queries the database on every request** | Mobile sync and webhooks multiply that load |
| 11 | Low | `Lead.tenantId` defaults to `"default-tenant"`, and `/api/follow-ups` and `/api/followups` are both mounted | Cleanup |
| 12 | Low | README still describes another author's project | Cleanup |

---

## 2. What the targets need first

| Target | Hard prerequisites | Why |
|---|---|---|
| **Call recording** | Agent accounts, scoped RBAC, lead ownership, a normalised phone number on leads, a job queue, a lead detail view | The app logs in as an agent, syncs only that agent's leads, matches calls by phone number, uploads in the background, and the dashboard needs somewhere to play the audio |
| **Platform lead capture** | One shared lead-creation service, a source and attribution model, a job queue, an integration registry | Meta, Google and IndiaMART all need the same dedupe, assignment and tracking, and Meta needs async processing |
| **Plugins** | A browser-safe key with allowed origins, per-platform payload adapters, attribution capture | Plugins and snippets run in places where a secret key cannot live |

That is why Phases 1 to 10 come first, even though they are not glamorous.

---

## 3. Roadmap overview

Effort is in **working days for one developer using AI coding help**. It is a planning guide, not a promise.

| # | Phase | Group | Depends on | Days |
|---|---|---|---|---|
| 1 | Security leftovers and repo hygiene | Foundation | none | 2 |
| 2 | Android feasibility spike *(runs in parallel)* | Foundation | none | 3 |
| 3 | Tenant isolation layer | Foundation | 1 | 4 |
| 4 | Staff and agent accounts | Foundation | 3 | 5 |
| 5 | RBAC v2: roles and scoped permissions | Foundation | 4 | 6 |
| 6 | Lead model v2 and shared lead service | Foundation | 3 | 5 |
| 7 | Lead ownership and assignment | Foundation | 4, 5, 6 | 6 |
| 8 | Audit log | Foundation | 5 | 3 |
| 9 | Background jobs infrastructure | Foundation | 1 | 3 |
| 10 | Lead detail drawer and activity timeline | Foundation | 6, 7 | 6 |
| 11 | Integration core and source registry | Lead sources | 6, 7, 9 | 5 |
| 12 | Meta (Facebook and Instagram) Lead Ads | Lead sources | 11 | 7 |
| 13 | Meta App Review submission *(long wait, start early)* | Lead sources | 12 | 2 |
| 14 | Call, device and recording data model, call-log API | Calling | 5, 6, 10 | 5 |
| 15 | Device authentication and mobile sync API | Calling | 4, 7, 14 | 5 |
| 16 | Recording storage in MongoDB with 30-day purge | Calling | 9, 14 | 4 |
| 17 | Android app MVP | Calling | 2, 15, 16 | 18 |
| 18 | Do-Not-Record, consent and privacy controls | Calling | 14, 17 | 4 |
| 19 | Call Reports and recording playback | Calling | 10, 16 | 5 |
| 20 | Android hardening and distribution | Calling | 17 | 10 |
| 21 | Call Ingestion (manual upload) | Calling | 16, 19 | 3 |
| 22 | Website snippet, allowed origins and attribution | Lead sources | 11 | 4 |
| 23 | Google Ads lead form webhook | Lead sources | 11 | 3 |
| 24 | Generic connector (Zapier, Make, n8n, Pabbly) | Lead sources | 11 | 3 |
| 25 | IndiaMART integration | Lead sources | 11 | 4 |
| 26 | Integration Studio UI and monitoring | Lead sources | 12, 22, 23, 24, 25 | 5 |
| 27 | Platform adapters and kits (Webflow, Typeform, Tally, Jotform, Shopify, Google Forms) | Plugins | 22, 24 | 4 |
| 28 | Wix integration kit | Plugins | 22, 24 | 3 |
| 29 | WordPress plugin: core and Contact Form 7 | Plugins | 22 | 7 |
| 30 | WordPress form adapters | Plugins | 29 | 5 |
| 31 | White-label plugin builder | Plugins | 29, 30 | 4 |
| 32 | Transcription and AI call summary | AI | 16, 19 | 5 |
| 33 | Cloud telephony fallback *(optional)* | Calling | 14, 16 | 7 |
| 34 | Production readiness | Launch | all | 6 |
| | | | **Total** | **171** |

### Why this order

- **Phases 1 to 10** are the shared foundation for both big features.
- **Phases 11 to 13 come before calling on purpose.** Meta's App Review takes weeks and you cannot speed it up. Submit it early, then build the calling features while you wait.
- **Phase 2 (the Android spike)** needs no backend, so do it in week one. If the recording file cannot be found and matched on your target phones, you learn that for 3 days of cost and can switch to the telephony fallback (Phase 33) before investing in the app.
- **Calling (14 to 21)** comes before the remaining lead sources because call recording is your must-have.
- **Plugins (27 to 31)** come last because they depend on the browser-safe key and the generic connector.

### Release points

| Release | After phase | What you can say you have |
|---|---|---|
| **Internal alpha** | 10 | Agents, scoped roles, ownership, lead timeline |
| **Call recording pilot** | 21 | Phones record, upload to MongoDB, play in the dashboard, expire at 30 days |
| **Lead capture beta** | 26 | Meta, Google, IndiaMART, website and generic sources feeding one pipeline |
| **Plugin release** | 31 | WordPress plugin and Wix kit |
| **v1.0** | 34 | Transcripts, monitoring, backups, production setup |

---

## 4. Phases in detail

---

## GROUP A: Foundation

### Phase 1: Security leftovers and repo hygiene
**Goal:** Close the remaining holes from section 1.3 before new surfaces (mobile, webhooks, plugins) multiply them.
**Depends on:** nothing.

**Work**
- **CSRF origin check:** compare the origin exactly against the allow-list (parse with `new URL(origin).origin`), not with `startsWith`.
- **Fail closed:** in `getJwtSecret()`, throw when `JWT_SECRET` is missing or weak in every environment except an explicit `NODE_ENV=development` or `test`. A missing `NODE_ENV` must be treated as production.
- **Lead and follow-up models:** remove `default: "default-tenant"` from `Lead.tenantId`. Make `tenantId` required. Write a one-off script that finds leads still on `default-tenant` and reports them before you delete or move them.
- **Rate limiters:** keep the global limiter for the dashboard, but add separate limiters for `/api/integrations/*` (per API key), `/api/mobile/*` (per device, added in Phase 15) and login. Make the key function configurable so it is not purely IP-based.
- **Permission cache:** cache the `RolePermission` lookup for 30 to 60 seconds (invalidate it when the Super Admin saves).
- **Cleanup:** mount only `/api/follow-ups`, remove `optionalAuthenticate` if unused, rewrite the README to describe this project, and add `.env.example` entries for everything added in later phases.
- **Tests:** add one test that proves each fix (evil-prefix origin is rejected, server refuses to start without a strong secret outside development).

**Done when:** the prefix-origin request gets 403; a server with no `NODE_ENV` and no secret exits; the README matches the project.
**Effort:** 2 days

---

### Phase 2: Android feasibility spike *(run in parallel with Phases 1, 3, 4)*
**Goal:** Prove, on the real phones your agencies will use, that the plan for recording works before you build the backend around it.
**Depends on:** nothing. A throwaway app, not connected to your backend.

**Why this comes first:** the whole call-recording plan relies on the phone's own dialer recording the call and your app finding the file afterwards. Phone makers differ in whether, where and how they save recordings. Three days here can save weeks.

**Work**
- Create a minimal Kotlin app (Android Studio, Jetpack Compose is optional).
- Detect the end of a call (phone state plus a call-log query).
- Ask the user to choose the recordings folder with the system folder picker and persist the permission.
- List files in that folder and find the one that matches the last call by timestamp, duration and number (many makers put the number or contact name in the file name).
- Upload that file to any test endpoint (a free request-catcher is enough).
- Run the same test on **at least 3 to 5 phones** from different makers (for example Samsung, Xiaomi/Redmi, Vivo, Oppo/Realme), on Android 12 to 15 if you can.
- For each phone, write down: is auto-record available and where is the setting; is it per-contact or all calls; the folder path; the file name pattern; the file format; how long after the call the file appears; whether the app survives in the background after 30 minutes and after a reboot.

**Deliverable:** a one-page compatibility table, plus a go / no-go decision for each phone brand. Brands that fail go on the "use the telephony fallback" list.

**Done when:** you can state for each tested phone whether recording sync works, with evidence.
**Effort:** 3 days

---

### Phase 3: Tenant isolation layer
**Goal:** Make cross-tenant leaks structurally hard, so new collections (calls, devices, recordings, integrations) are safe by default.
**Depends on:** Phase 1.

**Work**
- Keep the tenant on each request in `AsyncLocalStorage`, set by a small middleware right after `authenticate`.
- Write a Mongoose plugin that adds `tenantId` to the filter of `find`, `findOne`, `count`, `update*`, `delete*` and `aggregate`, and stamps it on `save`/`insertMany`. Apply it to Lead, FollowUp, LeadFeedConfig and every new tenant-owned model. The Super Admin passes an explicit "no tenant scope" flag.
- Delete the copied `getEffectiveTenant` helpers from both controllers and use one shared function.
- Change `User.email` uniqueness to `{ tenantId, email }` so one person can work for two agencies. Keep Super Admin emails globally unique.
- **GridFS note:** the plugin does not cover GridFS collections (they do not use Mongoose models). Recording access in Phase 16 must filter on `metadata.tenantId` by hand, behind one helper.
- Add a cross-tenant test suite: create two tenants and prove that every endpoint refuses to read or write the other's data.

**Done when:** removing a manual tenant filter from a controller does not leak data; the cross-tenant suite passes for leads and follow-ups.
**Effort:** 4 days

---

### Phase 4: Staff and agent accounts
**Goal:** Let an Account Admin create the people who work leads. This is the identity that the Android app and ownership depend on.
**Depends on:** Phase 3.

**Work**
- Extend `User.role` to `super_admin`, `account_admin`, `manager`, `agent`. Add `phone`, `teamId`, `managerId`, `isActive`, `lastLoginAt`, `maxOpenLeads`.
- Add a `Team` model (name, manager, members).
- Build **Settings → Staff**, replacing the placeholder: list, create, edit, deactivate (never hard delete), reset password, move between teams.
- Invite flow: admin creates the user, the system emails a one-time set-password link (until Phase 11 email exists, show the link to the admin to share). Add forgot-password and change-password.
- Sessions: short-lived access token plus rotating refresh token, with "log out everywhere". Mobile devices will use the same mechanism in Phase 15.
- Deactivated users are blocked immediately and flagged so their open leads can be reassigned (done in Phase 7).
- Add a per-agency user-limit hook for later billing.

**Done when:** an Account Admin creates a manager and an agent, the agent logs in, and a deactivated agent is blocked on the next request.
**Effort:** 5 days

---

### Phase 5: RBAC v2: roles and scoped permissions
**Goal:** Replace the single global permission set with per-tenant roles that understand "own, team, all". Recording access depends on this.
**Depends on:** Phase 4.

**Work**
- A `Role` model per tenant (name, permissions, `isSystem`). Seed defaults: Account Admin, Manager, Agent, Viewer.
- New permission keys, keeping the old ones working: `leads.view.own | team | all`, `leads.assign`, `calls.view.own | team | all`, `calls.log`, `recordings.listen`, `recordings.download`, `recordings.manage`, `devices.manage`, `integrations.manage`, `donotrecord.manage`, `audit.view`.
- Put the user's permissions in the access token and add a `requirePermission(key)` middleware. Remove the per-request database lookup.
- A shared `scopeFilter(user, resource)` that turns own / team / all into a query filter, used by every list endpoint.
- Keep the Super Admin's role as a **ceiling**: an agency can only grant permissions the Super Admin allowed.
- Migrate the existing `RolePermission` document into the new model without breaking current accounts.
- Frontend: Roles screen for the Account Admin, and hide pages and buttons the user cannot use. The server stays the only real enforcement.

**Done when:** an agent sees only their own leads and follow-ups, a manager sees their team, an admin sees all, and a forbidden request returns 403 even if the UI is bypassed.
**Effort:** 6 days

---

### Phase 6: Lead model v2 and shared lead service
**Goal:** Give every channel (manual, webhook, Meta, Google, IndiaMART, plugins, phone calls) one way to create and update a lead.
**Depends on:** Phase 3.

**Work**
- New fields on `Lead`: `phoneNormalized` (E.164, default country India), `alternatePhone`, `company`, `city`, `ownerId` (ObjectId, replaces `assignedStaffId`), `teamId`, `tags[]`, `sourceId`, `attribution` (first-touch and last-touch source, medium, campaign, term, content, `gclid`, `fbclid`, `adId`, `adSetId`, `campaignId`, landing page, referrer), `lastContactedAt`, `deletedAt` (soft delete).
- A `leadService.createOrMergeLead({ tenantId, source, payload, options })` that does validation, phone normalisation, duplicate detection on phone **and** email, attribution update (first touch is write-once), and returns `created | merged | duplicate_rejected`.
- Refactor the manual create, update and website webhook paths to call it. Remove their private duplicate logic.
- Indexes: `{tenantId, phoneNormalized}`, `{tenantId, ownerId, status}`, `{tenantId, sourceId, createdAt}`.
- Migration script (with a dry-run mode): normalise existing phones, map `assignedStaffId` to `ownerId` where a matching user exists, move `metadata.statusHistory` into the timeline when Phase 10 arrives.

**Why phone normalisation matters for calls:** the Android app and any telephony provider identify a lead only by the number dialed. If `+91 98765 43210` and `09876543210` are stored differently, recordings will not match.

**Done when:** all lead creation routes behave identically on duplicates; any phone format finds the same lead; first-touch attribution survives later enquiries.
**Effort:** 5 days

---

### Phase 7: Lead ownership and assignment
**Goal:** Every lead has one accountable owner, and new leads are routed automatically.
**Depends on:** Phases 4, 5 and 6.

**Work**
- `ownerId` is the single source of truth. Add `assignmentHistory` (from, to, by, at, reason).
- **Unassigned pool:** leads with no matching rule land here.
- **Assignment rules** per tenant, in priority order: by source, by team, round-robin, fewest open leads (respecting `maxOpenLeads`), and a fixed agent per integration (replacing the single fixed staff in Lead Feeds).
- **Assign Leads page** (replacing the placeholder): pick leads, pick an agent or rule, assign in bulk.
- Visibility follows Phase 5 scope. Changing an owner needs `leads.assign`.
- When a user is deactivated, offer a wizard to send their open leads to the pool or to a chosen person.
- Hook `leadService` so new leads from any channel run the rules.
- Follow-ups follow the lead's owner unless explicitly assigned.

**Done when:** a new webhook lead is assigned by the configured rule, appears only for that agent, and every change is in `assignmentHistory`.
**Effort:** 6 days

---

### Phase 8: Audit log
**Goal:** Record who did what, so access to recordings, key rotations and reassignments are accountable.
**Depends on:** Phase 5.

**Work**
- `AuditLog` model (tenantId, actor, action, entity, entityId, summary, IP, user agent, timestamp), append-only, indexed by tenant and time.
- An `audit.log()` helper, first used for: login, staff and role changes, lead delete, bulk reassignment, API key rotation and integration changes, device registration and revocation, and (from Phase 16) every recording listen, download and deletion.
- Audit viewer for Account Admins with filters.
- Retention setting with a scheduled cleanup (the scheduler arrives in Phase 9).

**Done when:** each listed action writes an entry that cannot be edited or removed through the API.
**Effort:** 3 days

---

### Phase 9: Background jobs infrastructure
**Goal:** Add the queue and scheduler that webhooks, Meta, recording purge and transcription rely on.
**Depends on:** Phase 1.

**Work**
- Redis plus BullMQ, with a separate worker process (its own entry file and Docker service). If you want to avoid Redis for now, use a Mongo-backed queue, but BullMQ is the better long-term choice.
- Conventions: retries with exponential backoff, a dead-letter list, per-tenant job tagging, idempotency keys.
- A scheduler for recurring jobs: recording purge (Phase 16), audit retention, Meta reconciliation (Phase 12), follow-up reminders later.
- An admin-only queue monitor (Bull Board) kept off the public routes.
- Move heavy work out of request handlers: webhook post-processing and lead assignment.

**Done when:** a job survives a worker restart; a failing job retries and lands in the dead-letter list; a sample recurring job runs.
**Effort:** 3 days

---

### Phase 10: Lead detail drawer and activity timeline
**Goal:** Give each lead one place where its full story is visible, including calls and recordings later.
**Depends on:** Phases 6 and 7.

**Work**
- Lead detail drawer (slides out from the list without leaving the page, as in your PDF) with tabs: Timeline, Notes, Follow-ups, Calls (empty state until Phase 19), Details.
- `Activity` collection (tenantId, leadId, type, actor, payload, createdAt) written by one `activity.record()` service. Events: created, status changed, owner changed, note added, field edited, follow-up created or completed, source updated.
- Move `metadata.statusHistory` into proper activity entries (migration).
- Notes (add, edit own, delete own), tags, and the owner shown with a change control.
- Permission checks follow Phase 5 scope.

**Done when:** every change to a lead appears on its timeline with who and when, and the drawer opens from the leads list and from follow-ups.
**Effort:** 6 days

---

## GROUP B: Start the Meta clock

### Phase 11: Integration core and source registry
**Goal:** One framework that every platform connector plugs into.
**Depends on:** Phases 6, 7 and 9.

**Work**
- `Integration` model per tenant: type (`website`, `google_ads`, `meta`, `zapier`, `indiamart`, `wordpress`, `wix`, ...), status, credentials (encrypted), field mapping, assigned rule, stats. Migrate the existing `LeadFeedConfig.websiteSource` into it without breaking the current API key.
- `LeadSource` records for each tenant (Website, Facebook, Instagram, Google Ads, IndiaMART, Referral, Walk-in, and so on) with a normalisation table, so "insta", "IG" and "instagram" become one source.
- `IntegrationEvent` log: every incoming payload stored raw (with secrets removed) plus the result, with a **replay** action.
- A common intake pipeline: authenticate, return 200 fast, push the payload to the queue, then normalise, call `leadService.createOrMergeLead`, run assignment, and write stats. Retries are safe because of idempotency keys.
- Refactor the existing website webhook onto this pipeline and keep its URL and behaviour unchanged.
- Credentials encryption helper (AES-GCM with a key from the environment), used for Meta tokens, IndiaMART keys and telephony keys later.

**Done when:** the website webhook still passes its existing tests on the new pipeline, and a failed event can be replayed.
**Effort:** 5 days

---

### Phase 12: Meta (Facebook and Instagram) Lead Ads
**Goal:** Leads from Meta lead forms arrive automatically, with campaign and ad details.
**Depends on:** Phase 11.

**Work**
- Create the Meta app (in development mode first). Required permissions include `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` and `ads_management`.
- **Connect flow:** an agency admin clicks "Connect Facebook", logs in with Facebook Login, picks their Page and the app subscribes the Page to the `leadgen` field. Store the page token encrypted. Handle token expiry and show "reconnect needed" in the UI.
- **Webhook endpoint:** answer Meta's verification handshake and verify each notification's `X-Hub-Signature-256`. The notification carries only a lead ID, so return 200 quickly and queue the work.
- **Worker:** fetch the full lead from the Graph API, map form fields to lead fields (default mapping plus per-form custom mapping), add attribution (campaign, ad set, ad, platform Facebook or Instagram, form ID) and call `leadService`.
- **Reconciliation job:** Meta keeps leads only for a limited time (about 90 days), and webhooks can be missed. Poll each connected form every 15 to 30 minutes and import anything missing, deduplicating on the Meta lead ID.
- **Backfill:** on connect, import the last N days.
- Test with Meta's Lead Ads testing tool and test users in development mode. **Do not wait for approval to build this.**

**Done when:** a test lead submitted through Meta's tool appears in the CRM within seconds with the right source and campaign, and a lead missed by the webhook is recovered by the reconciliation job.
**Effort:** 7 days

---

### Phase 13: Meta App Review submission *(mostly waiting)*
**Goal:** Get approval to use lead retrieval for real agencies. Meta decides on its own timeline, so submit as soon as Phase 12 works in development mode.
**Depends on:** Phase 12.

**Work**
- Complete **Business Verification** for the business that owns the app.
- Prepare a public **privacy policy** and terms page that cover lead data (what you collect, where it is stored, retention, deletion on request). Add a data-deletion request URL.
- Record the **screencast**: connect a Page, submit a test lead, show it arriving in the CRM. Reviewers reject submissions that never show an actual lead being retrieved.
- Write a clear use-case description per permission.
- Submit, answer reviewer questions quickly, and resubmit if asked.
- **Meanwhile:** agencies can send Meta leads through the generic connector (Phase 24) using Zapier, Make or Pabbly, which already hold approved Meta apps.

**Done when:** `leads_retrieval` and the other permissions are approved for live mode, and your app can be used by pages you do not own.
**Effort:** 2 days of your time (plus waiting)

---

## GROUP C: Call recording

### Phase 14: Call, device and recording data model, and call-log API
**Goal:** The data structures that every calling feature shares.
**Depends on:** Phases 5, 6 and 10.

**Work**
- `Call` model: tenantId, leadId, agentId, deviceId, direction, number (raw and normalised), startedAt, duration, status (completed, missed, rejected), disposition, notes, `source` (`android_sync`, `manual`, later `exotel`, `twilio`), and a `recording` object (`fileId`, `sizeBytes`, `sha256`, `status`: `none | pending | stored | expired | failed | skipped_dnr`, `expiresAt`).
- `Device` model: tenantId, userId, label, model, OS version, app version, push token, status (active, revoked), lastSeenAt, lastSyncAt. (Authentication is Phase 15.)
- Indexes: `{tenantId, leadId, startedAt}`, `{tenantId, agentId, startedAt}`, `{tenantId, "recording.status"}`.
- Call-log endpoints: create (from the app), list with scope filters (own / team / all), get one, update disposition and notes.
- Link calls to the lead timeline (an activity entry per call) and update `lastContactedAt`.
- Matching helper: given a normalised number and a time, find the lead for this agent (and fall back to "unknown number" when none).

**Done when:** an authenticated test client can log a call for a lead, and it shows in the call list with the correct scope.
**Effort:** 5 days

---

### Phase 15: Device authentication and mobile sync API
**Goal:** Let the Android app log in as an agent, receive only that agent's leads, and report calls.
**Depends on:** Phases 4, 7 and 14.

**Work**
- **Device registration:** agent logs in, the app registers the device and receives a device-bound token pair (access plus refresh, refresh stored in Android Keystore). Admins can list and **revoke** devices; a revoked device is rejected immediately.
- **Lead sync endpoint** (`GET /api/mobile/leads?since=<timestamp>`): returns only leads where `ownerId` is the agent, with the minimum fields (id, name, normalised phone, status, next follow-up). Supports delta sync by `updatedAt` and returns deletions and reassignments so the app can remove leads that are no longer the agent's.
- **Call endpoints:** `POST /api/mobile/calls` (report a call that ended), and `POST /api/mobile/calls/:id/recording-ticket` (check eligibility, see Phase 16).
- **Push:** register an FCM token and send a push when a new lead is assigned (queued job).
- **Rate limits** per device, separate from the dashboard limiter.
- **Versioning:** a minimum supported app version header, so you can force old apps to update.
- Security: every mobile endpoint enforces tenant and agent from the token, never from the request body.

**Done when:** a test client registers a device, receives only its agent's leads, reports a call, and stops working the moment the device is revoked.
**Effort:** 5 days

---

### Phase 16: Recording storage in MongoDB with a 30-day purge
**Goal:** Store recordings in your own MongoDB, only for lead calls, and delete them automatically after 30 days.
**Depends on:** Phases 9 and 14.

**Work**
- Start from the `recordingStorage.js` module I gave you earlier. It uses **GridFS** with these routes: `PUT /api/calls/:callId/recording` (upload) and `GET /api/calls/:callId/recording` (stream, with seeking).
- **Upload rules** (already in that module): the call must exist, belong to the calling agent and be linked to a lead, otherwise it is rejected before any audio is read. Allowed audio types only, a size cap, a SHA-256 check and duplicate protection.
- **Bypass the JSON body parser** for the upload route. Audio streams straight from the request, so it needs its own larger size limit and its own rate limiter.
- **Retention:** store `expiresAt` on each file (`RECORDING_RETENTION_DAYS=30`). Run the purge as a repeatable BullMQ job (Phase 9). Do not rely on a TTL index: it removes file records but leaves the audio chunks behind. When purged, set `recording.status = expired` and keep the call log, notes and (later) the transcript.
- **Tenant safety:** every GridFS query goes through one helper that adds `metadata.tenantId` (Phase 3 note). Add indexes on `metadata.expiresAt` and `{metadata.tenantId, metadata.leadId}`.
- **Audit:** write an entry for every listen and download (Phase 8). Require `recordings.listen` and the right scope.
- **Capacity planning:** phone recorders typically produce roughly 0.5 to 1 MB per minute. Measure your phones in Phase 2 and compute: minutes per day × MB per minute × 30. Put recordings in a **separate database or cluster** from the CRM data so playback never slows leads.
- **Backups:** database snapshots would keep audio longer than 30 days. Either exclude the recordings database from long-term backups or set its backup retention to 30 days or less.
- **Escape hatch:** keep storage behind a small interface (`save`, `stream`, `delete`) so you can move to Cloudflare R2 or S3 with a 30-day lifecycle rule later without changing the app.

**Done when:** an authorised user can play a lead call recording, an upload for a non-lead call is refused, and a recording older than 30 days disappears (both the file record and its chunks) while the call log stays.
**Effort:** 4 days

---

### Phase 17: Android app MVP
**Goal:** The Kotlin app that detects lead calls, finds the recording and uploads it, with nothing else sent.
**Depends on:** Phases 2, 15 and 16.

**Work**
- **Project setup:** Kotlin, Jetpack Compose, Retrofit/OkHttp, Room (local lead cache and upload queue), WorkManager (background jobs), FCM, Android Keystore. Min SDK chosen from your Phase 2 phone list.
- **Screens:** login and device registration; permission onboarding checklist (phone state, call log, notifications, battery-optimisation exemption, autostart, and the recordings folder picker) with a live "ready / not ready" status; My Leads (search, lead detail, Call button); post-call screen (outcome, note, optional follow-up); call history with sync status; settings and diagnostics.
- **Call flow:** agent taps Call, the app opens the normal dialer with the number. A phone-state listener detects the end of the call, then the app reads the call log entry.
- **Lead-only filter (the privacy rule):** the app caches the agent's lead numbers (normalised). After a call, it checks the dialed or incoming number against that list. **If there is no match, it stops. It does not open or read any recording file.**
- **Recording finder:** for a matched call, find the file in the chosen folder by timestamp window, duration and number. Retry for a few minutes because some makers write the file late.
- **Upload:** report the call (`POST /api/mobile/calls`), get permission to upload (the server checks the call is a lead call for this agent), then stream the file with `PUT /api/calls/:id/recording`. Use WorkManager with exponential backoff, a Wi-Fi-only option, and the file hash for safe retries.
- **Sync:** pull leads by delta; show a caller pop-up for lead numbers (needs the overlay permission); handle leads reassigned away (remove them locally).
- **Not in the MVP:** the telephony fallback, AI features, iOS.

**Done when:** on two or more of your tested phones, a call to a lead produces a playable recording in the dashboard within a few minutes, and a call to a non-lead number produces nothing on the server.
**Effort:** 18 days

---

### Phase 18: Do-Not-Record, consent and privacy controls
**Goal:** Keep unwanted recordings out and meet your legal duties.
**Depends on:** Phases 14 and 17.

**Work**
- **Do-Not-Record page** (replacing the placeholder): numbers and lead tags that must never be recorded. The list syncs to the app, which then skips them (no read, no upload). The server also refuses a recording for a matching number.
- **Per-lead switch:** "do not record this lead", available to agents and admins.
- **Consent:** a per-agency setting for how consent is handled (for example the agent states it at the start of the call, or a message is sent to the lead), plus a stored consent record per lead. Show a clear notice in the app and tell agents exactly what is uploaded.
- **Agent transparency:** a "what was uploaded" list in the app, so an agent can see that only lead calls leave the phone.
- **Erasure:** deleting or anonymising a lead also deletes its recordings immediately.
- **Policy text:** privacy notice for agencies. Recording calls can be restricted by law in some places, so agencies should confirm their obligations. You are not providing legal advice.
- The app never deletes or moves files in the phone's recorder folder.

**Done when:** a Do-Not-Record number produces no upload and no server record, and deleting a lead removes its audio.
**Effort:** 4 days

---

### Phase 19: Call Reports and recording playback
**Goal:** Let managers and agents see calls and listen to recordings in the dashboard.
**Depends on:** Phases 10 and 16.

**Work**
- Replace the **Call Reports** placeholders with a real list: filters (agent, date range, direction, outcome, has recording), counts, durations.
- **Calls tab** in the lead drawer with an embedded audio player (uses the streaming route, with seek), the call outcome, and notes.
- Show recording state clearly: stored, expires in N days, expired, skipped, failed, or "no recording found".
- Permissions: agents see their own, managers their team's, admins all. Download needs `recordings.download` and is audited.
- A "missing recordings" view: calls with a call-log entry but no recording, to spot phones that are not recording.

**Done when:** a manager can open a lead, play yesterday's call, and see which calls from the week have no recording.
**Effort:** 5 days

---

### Phase 20: Android hardening and distribution
**Goal:** Make the app reliable on the phones agencies actually use.
**Depends on:** Phase 17.

**Work**
- **Battery and autostart:** per-maker guidance and deep links for Xiaomi, Oppo, Vivo, Samsung and others; detect when the app has been killed and warn the agent.
- **Self-test:** a "test recording" button that checks the folder is receiving files, and a daily check that alerts when a lead call produced no file.
- **Resilience:** survive reboot, handle low storage, resume interrupted uploads, handle slow networks, guard against uploading the same file twice, and cap the offline queue.
- **Foreground service rules** for current Android versions, with a clear notification.
- **Security:** certificate pinning optional, no sensitive data in logs, encrypted local database for the lead cache, clear data on logout or device revoke.
- **Distribution:** Google Play restricts call-log permissions to default phone apps, so plan on **direct APK distribution or your own device management**, not the Play Store. Set up release signing, an in-app update check using the minimum-version header from Phase 15, and a download page per agency.
- **Compatibility matrix:** keep the Phase 2 table up to date and publish a supported-phone list for agencies.
- **Pilot:** run it with a small team for two weeks and fix what breaks.

**Done when:** a pilot team of agents runs it for two weeks with more than 95% of lead calls producing a recording, on supported phones.
**Effort:** 10 days

---

### Phase 21: Call Ingestion (manual upload)
**Goal:** Handle recordings that did not come through the app.
**Depends on:** Phases 16 and 19.

**Work**
- **Call Ingestion page** (replacing the placeholder): upload one or many audio files, or a CSV of call records.
- Match each file to a lead by phone number (from the file name or a CSV column) and to an agent. Unmatched items go to a review queue where staff can match manually or create the lead.
- Same storage, retention (30 days from upload), permissions and Do-Not-Record checks as Phase 16.
- Validate type and size and sanitise file names. Show counts of matched, unmatched and failed items.

**Done when:** 100 uploaded files are matched to leads, with unmatched files available for manual review.
**Effort:** 3 days

---

## GROUP D: More lead sources

### Phase 22: Website snippet, allowed origins and attribution
**Goal:** A safe way to capture leads from any website form, with source tracking.
**Depends on:** Phase 11.

**Work**
- **Public site key** (separate from the secret API key) tied to a list of **allowed origins**. Requests from other origins are rejected, and the webhook no longer needs a secret in browser code. Keep the secret key for server-to-server use only.
- Abuse protection for public keys: rate limits per key and per IP, a honeypot field, and an optional CAPTCHA check.
- **JavaScript snippet** served from your domain (versioned): finds forms on the page automatically, lets the site choose which ones to track, posts on submit (with `sendBeacon` or `fetch keepalive`), captures UTM values, `gclid`, `fbclid`, referrer and landing page, and stores first-touch and last-touch in a cookie.
- Server side: map these fields into `attribution` through `leadService` (Phase 6) and run source normalisation (Phase 11).
- Repeat enquiries from an existing lead update last touch and add a timeline entry, not a duplicate.
- Lead Feeds UI: show the copy-paste snippet with the site key, the allowed-origins editor and a test button.

**Done when:** a form on a test site with no server code creates a lead with source, campaign and click ID, and a request from a non-allowed origin is rejected.
**Effort:** 4 days

---

### Phase 23: Google Ads lead form webhook
**Goal:** Leads from Google lead form assets arrive automatically.
**Depends on:** Phase 11.

**Work**
- A webhook endpoint per agency (a unique URL) and a **key** that the agency pastes into the lead form's delivery settings in Google Ads. Verify the key on every request (compare with a constant-time check).
- Map Google's payload (user column data such as name, email, phone, plus campaign, ad group, form and click ID fields) into lead fields and attribution.
- Handle Google's **test** submissions (the "send test data" button) so they are marked as tests and do not pollute reports.
- Idempotency on Google's lead ID. Return 200 fast and process on the queue.
- Setup guide inside the Integration Studio with a copy button for the URL and key.

**Done when:** pressing "send test data" in Google Ads creates a test lead with the right mapping, and a real submission creates a normal lead with campaign details.
**Effort:** 3 days

---

### Phase 24: Generic connector for Zapier, Make, n8n and Pabbly
**Goal:** One documented endpoint that covers every tool you have not built a native connector for, including Meta leads while App Review is pending.
**Depends on:** Phase 11.

**Work**
- A per-agency **feed endpoint** with its own secret, accepting JSON with flexible field names and a `source` value.
- A field-mapping screen: map incoming keys to lead fields, with a **test payload** area that shows how a sample would map.
- Ready-to-copy templates and screenshots for: Zapier ("Facebook Lead Ads" to webhook), Make, n8n (free self-hosted) and Pabbly.
- Same dedupe, attribution, assignment, queueing and event log as the other integrations.

**Done when:** a Zapier or Make scenario posts a Facebook lead and it appears in the CRM with source Facebook.
**Effort:** 3 days

---

### Phase 25: IndiaMART integration
**Goal:** Capture IndiaMART enquiries automatically.
**Depends on:** Phase 11.

**Work**
- **First, confirm how an agency can get leads out of IndiaMART on their plan** (a push to a URL or a CRM key that your server can poll). The options depend on IndiaMART's current offering and the agency's plan, so check before building.
- Store the agency's credentials encrypted. If the method is polling, run a queued job every few minutes with a "last fetched" watermark.
- Map the buyer fields (name, mobile, email, product, message, city) to lead fields, set the source to IndiaMART, and deduplicate against existing leads.
- Connection health: last sync time and error count in the Integration Studio.

**Done when:** a new IndiaMART enquiry becomes a lead with source IndiaMART and is assigned by your rules.
**Effort:** 4 days

---

### Phase 26: Integration Studio UI and monitoring
**Goal:** One screen where an agency sets up and watches all its lead sources, like your PDF's "Webhook & Integration Studio".
**Depends on:** Phases 12, 22, 23, 24 and 25.

**Work**
- Replace the "Coming Soon" tiles in Lead Feeds with real cards: Website, Meta, Google Ads, IndiaMART, Zapier/Make, WordPress, Wix. Each shows status (connected, error, needs reconnect), last lead received and counts.
- Per-integration settings: assignment rule, default tags, field mapping, duplicate policy.
- **Event log** with search, payload view (secrets removed) and a **replay** button for failed events.
- **Alerts:** notify admins when an integration has errors or has received nothing for an unusual time.
- Key management for the secret key and site key: create, rotate, revoke, with the audit entries from Phase 8.

**Done when:** an admin can see every source's health on one page, open a failed event and replay it successfully.
**Effort:** 5 days

---

## GROUP E: Plugins and kits

### Phase 27: Platform adapters and kits
**Goal:** Cover form builders that already offer webhooks, with correct field mapping and short setup guides.
**Depends on:** Phases 22 and 24.

**Work**
- Server-side **payload adapters** that detect and normalise each platform's format: Webflow forms, Typeform, Tally, Jotform, Shopify (customer and form events) and Google Forms (through an Apps Script snippet).
- A **setup guide per platform** shown inside the Integration Studio, with the exact URL, headers and a screenshot-style step list.
- A sample **Apps Script** for Google Forms that posts on submit.
- A test endpoint per adapter that shows how a sample payload is mapped.
- Squarespace and other builders: use the website snippet (Phase 22) or the generic connector (Phase 24), with a short guide.

**Done when:** a test submission from each listed platform creates a correctly mapped lead.
**Effort:** 4 days

---

### Phase 28: Wix integration kit
**Goal:** Wix sites send form submissions to the CRM with no plugin to install.
**Depends on:** Phases 22 and 24.

**Work**
- **Primary method:** a Wix Automation triggered by a form submission with the "send via webhook" action pointing at the agency's feed URL. This needs the Velo (developer mode) feature enabled on the site. Write the exact steps and a field-mapping table.
- **Wix payload adapter:** Wix sends its own structure, so detect it and map it (name, email, phone, form name, page).
- **Respond fast:** Wix retries a webhook that does not answer quickly. Return 200 immediately and queue the work (already the Phase 11 pipeline), and make idempotency keys cover the retries.
- **Fallback method:** a short Velo `fetch` snippet for sites that want custom forms, posting to the public site-key endpoint.
- **UTM capture note:** Wix cannot always pass tracking values through its automation, so document how to add hidden fields or use the snippet for attribution.
- A larger Wix developer app (OAuth and signed webhooks) is only worth it if you later want a marketplace listing. It is out of scope here.

**Done when:** a Wix form submission creates a correctly mapped lead, and a retry from Wix does not create a duplicate.
**Effort:** 3 days

---

### Phase 29: WordPress plugin: core and Contact Form 7
**Goal:** A plugin agencies install once to capture leads reliably, including forms the website snippet can miss.
**Depends on:** Phase 22.

**Work**
- Plugin skeleton: settings page (API endpoint, site key or secret, tenant label), a **connection test** button, an enable switch per form, and a delivery log.
- **Contact Form 7 adapter:** hook the form's "mail sent" event, build the payload, and send it.
- **Delivery reliability:** send asynchronously, retry with backoff through WordPress's scheduled actions, and store failures so an admin can resend. Use an idempotency key per submission.
- **Attribution:** a small script stores UTM values, `gclid`, `fbclid`, the referrer and the landing page in a first-touch cookie and adds them to each submission.
- **Field mapping screen:** map form field names to lead fields, with sensible defaults.
- **Privacy:** respect consent checkboxes where the form has them and document what data is sent.
- Security basics: capability checks, nonces, input sanitising, and secrets kept in options, never printed.
- Build and test on a clean WordPress install with recent PHP versions.
- Hook names and filters change between versions of each form plugin, so check the current developer documentation of Contact Form 7 while building.

**Done when:** a Contact Form 7 submission appears in the CRM with source and attribution, and a CRM outage later recovers by resend.
**Effort:** 7 days

---

### Phase 30: WordPress form adapters
**Goal:** Support the other common WordPress form tools and WooCommerce.
**Depends on:** Phase 29.

**Work**
- Adapters for **Elementor Pro Forms**, **WPForms**, **Gravity Forms**, **Fluent Forms** and **Ninja Forms**, each in its own file so one plugin's change cannot break the others.
- **WooCommerce** (optional): create a lead on new customer registration or on checkout when an agency wants it, with a setting to turn it off.
- Auto-detect which form plugins are active and show only those.
- Per-form enable and mapping, using the same screens as Phase 29.
- A test submission button per adapter.
- Check each form plugin's current developer documentation for the correct submit hook before building its adapter.

**Done when:** each supported form plugin sends a correctly mapped test lead.
**Effort:** 5 days

---

### Phase 31: White-label plugin builder
**Goal:** Each agency gets a WordPress plugin that carries its own name, logo and credentials.
**Depends on:** Phases 29 and 30.

**Work**
- A "Download WordPress plugin" button in the Integration Studio that builds a zip on the server with the agency's plugin name, logo, colours and endpoint pre-filled, and a **site key** embedded (never the secret key).
- Unique plugin folder name per agency so two agencies' plugins can run on one site.
- **Update channel:** the plugin checks your server for a newer version and shows the standard WordPress update notice, with signed downloads.
- Versioning and a changelog, plus a minimum-supported-version check that warns when the CRM API changes.
- Optional later step: submit a generic (unbranded) version to the WordPress plugin directory.

**Done when:** an agency downloads its branded zip, installs it, and leads flow without typing any credentials.
**Effort:** 4 days

---

## GROUP F: AI, fallback and launch

### Phase 32: Transcription and AI call summary
**Goal:** Turn stored recordings into searchable text and a short summary.
**Depends on:** Phases 16 and 19.

**Work**
- A queue job after each stored recording: speech-to-text behind an adapter (self-hosted Whisper variants for free use, or a hosted service such as Deepgram), with Hindi and English.
- **Speaker separation:** Whisper does not separate speakers by itself, so use a diarization step or a provider that includes it. If your phone recorders save stereo audio, the two channels already separate agent and customer.
- An LLM step that returns structured output: summary (three points), buyer sentiment, intent signals and a suggested next step. Treat the stage change as a **suggestion** with a confidence score, not an automatic move, and let the agent accept it.
- Store transcript and summary on the `Call`. They stay after the audio expires at 30 days, unless the agency chooses to delete them too.
- Show transcript and summary in the lead drawer next to the audio player, and add transcript search.
- Per-agency switch (off by default), usage counting, and respect for Do-Not-Record.

**Done when:** a stored call has a transcript and summary on the lead page within a few minutes, and turning the feature off stops processing.
**Effort:** 5 days

---

### Phase 33: Cloud telephony fallback *(optional)*
**Goal:** Cover phones that cannot record, and iPhones.
**Depends on:** Phases 14 and 16. Do this when Phase 2 shows important phone brands failing.

**Work**
- A provider adapter interface (`placeCall`, `parseWebhook`, `fetchRecording`) with one provider implemented first (Exotel, Knowlarity or Twilio, depending on cost and Indian number rules).
- Click-to-call from the dashboard: the system calls the agent first and then the lead, and the provider records on its servers.
- A webhook with signature verification receives the call result and the recording link; a queue job downloads the file and stores it through the **same Phase 16 storage**, with the same lead-only, tenant and 30-day rules.
- Per-agency provider credentials, encrypted, with a connection test.
- Note the trade-offs for agencies: per-minute cost, a virtual caller ID instead of the agent's SIM, and number registration rules in India.

**Done when:** a call placed from the dashboard produces a recording in the same player as an Android-synced call.
**Effort:** 7 days

---

### Phase 34: Production readiness
**Goal:** Launch safely and keep it running.
**Depends on:** all earlier phases.

**Work**
- **Containers:** Docker images for the API, the worker and the frontend, plus a compose file with Redis. Separate dev, staging and production settings.
- **CI/CD:** a pipeline that installs, lints, runs the tests and deploys on merge. Convert the 12 test scripts to run against an in-memory or test database without a live server.
- **Observability:** error tracking, uptime checks, and alerts on queue depth, failed jobs, webhook errors, upload failures and the purge job not running.
- **Data safety:** tested backups for the main database, the recordings database set to a retention that matches 30 days, secrets rotation procedure, and a restore drill.
- **Performance:** index review against real queries, a load test with a realistic number of leads and concurrent uploads, and dashboard caching.
- **Security pass:** dependency audit, tenant-isolation test run, penetration checklist, and review of every public endpoint's rate limits.
- **Documentation:** admin runbook, agency onboarding guide (Meta connection, Google key, plugin install, app install), and a support checklist.

**Done when:** a staging environment mirrors production, a backup restore has been rehearsed, alerts fire on a forced failure, and the load test meets your targets.
**Effort:** 6 days

---

## 5. Decisions and lead times

| Item | Decide or start by | Notes |
|---|---|---|
| **Meta Business Verification and App Review** | Start before Phase 12 ends | Verification and review are outside your control and can take weeks. Phase 24 is the workaround |
| **Phones for the pilot** | Phase 2 | Buy or borrow 3 to 5 phones from different makers. This decides how far the free recording approach reaches |
| **Recording database location** | Phase 16 | Separate database or cluster, sized from your measured MB per minute |
| **Redis hosting** | Phase 9 | A managed free tier is enough to start |
| **App distribution** | Phase 20 | Direct APK or device management, not the Play Store |
| **Privacy policy and consent wording** | Phases 13 and 18 | Needed for Meta review and for agencies |
| **IndiaMART access method** | Phase 25 | Confirm what the agency's plan allows before building |
| **Transcription provider** | Phase 32 | Self-hosted for cost, hosted for speed and diarization |

## 6. Main risks

| Risk | Impact | Mitigation |
|---|---|---|
| A target phone brand does not expose recordings | The free recording approach fails for that brand | Phase 2 spike, supported-phone list, Phase 33 fallback |
| Background apps get killed by phone makers | Missed uploads | Phase 20 onboarding, self-test and the "missing recordings" report |
| Meta review is slow or rejected | No native Meta capture | Zapier/Make connector in Phase 24, early submission, a clear screencast |
| Recording storage grows faster than expected | Database cost and slow playback | Measure in Phase 2, separate database, 25 MB per-file cap, option to move to object storage |
| Recording consent rules vary by place | Legal exposure for agencies | Consent controls in Phase 18, clear notice, advise agencies to check local law |
| One-person team, 171 working days | Long timeline | Release points in section 3; Phases 32 and 33 are optional; ship the call pilot after Phase 21 |

## 7. If you only do five things first

1. **Phase 2.** Prove recording sync on real phones before anything else.
2. **Phases 3 to 7.** Tenant isolation, agent accounts, scoped roles, a shared lead service and ownership are what the app and the integrations stand on.
3. **Phases 11 to 13.** Build the Meta integration and submit it, then build the call features while Meta reviews.
4. **Phases 14 to 17.** The recording path from phone to MongoDB, lead-only.
5. **Phase 22.** The browser-safe snippet and allowed origins, which also unlock the plugins.
