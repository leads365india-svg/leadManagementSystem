# Troubleshooting & FAQs

Common questions, error codes, and troubleshooting steps for Leads-365 website lead integrations.

---

## 1. Common HTTP Status Codes

### HTTP 401 Unauthorized
- **Cause:** Missing or invalid `X-API-Key` or `X-Site-Key`, incorrect HMAC signature, or expired `X-Timestamp`.
- **Fix:**
  1. Verify the API key in **Settings → Lead Feeds → Website Integrations**.
  2. If using public browser forms, ensure you are passing `X-Site-Key: lf_site_...`, not your private API key.
  3. If using HMAC signing, verify the raw payload string matches between client and server.

### HTTP 403 Forbidden: Origin is not permitted
- **Cause:** Public site key request sent from a domain not in the integration's **Allowed Origins**.
- **Fix:** Add your website domain (e.g. `https://mycompany.com` or `http://localhost:3000`) to the integration settings in the CRM.

### HTTP 409 Conflict: Duplicate lead detected
- **Cause:** A lead with the same email or phone number already exists, and the integration's duplicate policy is set to `reject`.
- **Fix:** If you want existing leads to be updated instead of rejected, set **Duplicate Handling** to `update` in the integration settings.

### HTTP 422 Unprocessable Entity
- **Cause:** Email domain is on the blocked disposable domain list (e.g. `mailinator.com`), or the `formId` is not in the **Accepted Forms** list.
- **Fix:** Inspect the integration settings and adjust blocked domains or accepted forms.

---

## 2. Lead Logs & Event Replay

1. Open **Settings → Lead Feeds → Activity Ledger (Events)**.
2. Filter by status (`failed`, `processed`) or by integration name.
3. Click on any event to inspect:
   - Request headers (sanitized)
   - Raw payload
   - Exact error message
   - HTTP response code
4. For failed events caused by temporary network issues or misconfigured settings, click **Replay Event** to reprocess the submission through the updated ingestion pipeline.

