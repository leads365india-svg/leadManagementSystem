# Security, Privacy & Tenant Isolation

Leads-365 CRM implements defense-in-depth security to protect multi-tenant integrity, prevent bot spam, and protect against replay attacks.

---

## 1. Multi-Tenant Isolation

- **Ambient Context Binding:** Every integration request is strictly bound to its verified `tenantId` via `runWithTenantContext`.
- **Zero Client Trust:** The server never trusts a `tenantId` parameter passed in incoming HTTP request bodies or query parameters. The tenant identity is resolved strictly from the authenticated API key hash or public Site Key.
- **Cross-Tenant Prevention:** Database queries on `Integration`, `IntegrationEvent`, and `Lead` enforce strict MongoDB tenant filters via `tenantIsolationPlugin`.
- **RBAC Controls:** Integration creation, modification, key rotation, and deletion require authenticated users with the `account_admin` or `super_admin` role.

---

## 2. API Key Protection & Cryptographic Hashing

- **One-Way SHA-256 Storage:** The raw API key (`lf_live_...`) is displayed **only once** upon generation. The database stores only a constant-time verifiable SHA-256 hash (`apiKeyHash`).
- **Timing-Safe Comparison:** Hash lookups and HMAC checks execute via `crypto.timingSafeEqual` to eliminate timing attacks.
- **Credential Encryption:** Third-party OAuth tokens, passwords, and private secrets are encrypted at rest with AES-256-GCM.
- **Immediate Invalidation:** Rotating an API key immediately wipes the previous hash, preventing revoked keys from authenticating.

---

## 3. Replay Protection & Timestamp Verification

- **5-Minute Window:** When an `X-Timestamp` header is supplied, requests older than 300,000 ms (or with clock skew > 60 seconds into the future) are rejected with HTTP 401 Unauthorized.
- **Idempotency Fingerprint:** Submissions carrying `X-Idempotency-Key` create an index in MongoDB. If a network retry occurs with the same key, the CRM returns the existing lead with HTTP 200 without creating duplicate records.

---

## 4. Bot & Anti-Spam Protections

- **Honeypot Trap:** All frontend forms include `<input type="text" name="_hp_trap" style="display:none" tabIndex="-1" />`. Humans never interact with this field; automated bot scripts fill it out and are silently dropped with HTTP 400.
- **Domain Blocking:** Accounts can configure disposable email domain blocks (e.g. `mailinator.com`, `tempmail.com`, `yopmail.com`).
- **Rate Limiting:** Webhook ingestion is capped by IP at 60 requests per minute.

