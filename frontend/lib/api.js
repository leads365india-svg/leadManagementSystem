const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"

class ApiClient {
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`

    const config = {
      method: options.method || "GET",
      // Include credentials so HTTP-only session cookies are sent across origins
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    }

    try {
      const response = await fetch(url, config)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401 && typeof window !== "undefined") {
          const isAuthEndpoint =
            endpoint === "/auth/me" ||
            endpoint === "/auth/login" ||
            endpoint.startsWith("/auth/tenant-info")
          const isLoginPage = window.location.pathname.includes("/login")
          if (!isAuthEndpoint && !isLoginPage) {
            const redirectUrl = window.location.pathname.startsWith("/super-admin")
              ? "/super-admin/login?session=expired"
              : "/portal/login?session=expired"
            window.location.href = redirectUrl
          }
        }
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      return data
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(error.message)
      } else {
        throw new Error("API request failed with an unexpected error")
      }
    }
  }

  // --- Lead Endpoints ---
  async getLeads(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/leads${queryString ? `?${queryString}` : ""}`)
  }

  async createLead(lead) {
    return this.request("/leads", {
      method: "POST",
      body: JSON.stringify(lead),
    })
  }

  async getLeadStats() {
    return this.request("/leads/stats")
  }

  async deleteLead(id) {
    return this.request(`/leads/${id}`, {
      method: "DELETE",
    })
  }

  async updateLead(id, data) {
    return this.request(`/leads/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  async updateLeadStatus(id, status) {
    return this.request(`/leads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    })
  }

  async getLeadById(id) {
    return this.request(`/leads/${id}`)
  }

  async getLeadActivities(leadId, query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/leads/${leadId}/activities${queryString ? `?${queryString}` : ""}`)
  }

  // --- Follow-ups Management Endpoints ---
  async getFollowUps(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/follow-ups${queryString ? `?${queryString}` : ""}`)
  }

  async getFollowUpStats() {
    return this.request("/follow-ups/stats")
  }

  async getFollowUpById(id) {
    return this.request(`/follow-ups/${id}`)
  }

  async createFollowUp(data) {
    return this.request("/follow-ups", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateFollowUp(id, data) {
    return this.request(`/follow-ups/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  async completeFollowUp(id, data = {}) {
    return this.request(`/follow-ups/${id}/complete`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async deleteFollowUp(id) {
    return this.request(`/follow-ups/${id}`, {
      method: "DELETE",
    })
  }

  // --- Authentication Endpoints ---
  async login(credentials) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    })
  }

  async logout() {
    return this.request("/auth/logout", {
      method: "POST",
    })
  }

  async getMe() {
    return this.request("/auth/me")
  }

  async getTenantInfo(tenantId) {
    return this.request(`/auth/tenant-info?tenantId=${encodeURIComponent(tenantId)}`)
  }

  // --- Super Admin Endpoints ---
  async getSuperAdminStats() {
    return this.request("/super-admin/stats")
  }

  async getSuperAdminAccounts(params = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/super-admin/accounts${queryString ? `?${queryString}` : ""}`)
  }

  async getSuperAdminAccountById(id) {
    return this.request(`/super-admin/accounts/${id}`)
  }

  async createSuperAdminAccount(payload) {
    return this.request("/super-admin/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateSuperAdminAccount(accountId, payload) {
    return this.request(`/super-admin/accounts/${accountId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async updateAccountStatus(accountId, status) {
    return this.request(`/super-admin/accounts/${accountId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    })
  }

  async getPermissions() {
    return this.request("/super-admin/permissions")
  }

  async updatePermissions(permissions) {
    return this.request("/super-admin/permissions", {
      method: "PUT",
      body: JSON.stringify({ permissions }),
    })
  }

  // --- Lead Feeds & Website Integration Endpoints ---
  async getLeadFeedSettings() {
    return this.request("/integrations/settings/website")
  }

  async updateLeadFeedSettings(payload) {
    return this.request("/integrations/settings/website", {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async rotateLeadFeedApiKey() {
    return this.request("/integrations/settings/website/rotate-key", {
      method: "POST",
    })
  }

  async rotateLeadFeedSiteKey() {
    return this.request("/integrations/settings/website/rotate-site-key", {
      method: "POST",
    })
  }

  async sendLeadFeedTest() {
    return this.request("/integrations/settings/website/test", {
      method: "POST",
    })
  }

  // --- Phase 11 Integration Core & Source Registry ---
  async getIntegrations(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/integrations${queryString ? `?${queryString}` : ""}`)
  }

  async createIntegration(payload) {
    return this.request("/integrations", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getIntegrationById(id) {
    return this.request(`/integrations/${id}`)
  }

  async updateIntegration(id, payload) {
    return this.request(`/integrations/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async rotateIntegrationApiKey(id) {
    return this.request(`/integrations/${id}/rotate-key`, {
      method: "POST",
    })
  }

  async deleteIntegration(id) {
    return this.request(`/integrations/${id}`, {
      method: "DELETE",
    })
  }

  async getLeadSources() {
    return this.request("/integrations/sources")
  }

  async upsertLeadSource(payload) {
    return this.request("/integrations/sources", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getIntegrationEvents(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/integrations/events${queryString ? `?${queryString}` : ""}`)
  }

  async replayIntegrationEvent(id) {
    return this.request(`/integrations/events/${id}/replay`, {
      method: "POST",
    })
  }

  async syncLegacyIntegrations() {
    return this.request("/integrations/sync-legacy", {
      method: "POST",
    })
  }

  // --- Phase 12: Meta (Facebook + Instagram) Lead Ads Endpoints ---
  async connectMetaIntegration(payload) {
    return this.request("/integrations/meta/connect", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getMetaAuthUrl() {
    return this.request("/integrations/meta/auth-url")
  }

  async triggerMetaBackfill(id, days = 7) {
    return this.request(`/integrations/meta/${id}/backfill`, {
      method: "POST",
      body: JSON.stringify({ days }),
    })
  }

  async getMetaStatus() {
    const res = await this.request("/integrations?type=meta")
    const integrations = res?.data || res?.integrations || []
    return {
      success: true,
      configured: integrations.length > 0,
      integration: integrations[0] || null,
    }
  }

  // --- Phase 13: IndiaMART Integration Endpoints ---
  async connectIndiaMartIntegration(payload) {
    return this.request("/integrations/indiamart/connect", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getIndiaMartStatus() {
    return this.request("/integrations/indiamart/status")
  }

  async getIndiaMARTStatus() {
    return this.request("/integrations/indiamart/status")
  }

  async triggerIndiaMartSync(id, options = {}) {
    return this.request(`/integrations/indiamart/${id}/sync`, {
      method: "POST",
      body: JSON.stringify(options),
    })
  }

  // --- Phase 23: Google Ads Lead Form Webhook Endpoints ---
  async getGoogleAdsStatus() {
    return this.request("/integrations/google/status")
  }

  async connectGoogleAdsIntegration(payload) {
    return this.request("/integrations/google/connect", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async rotateGoogleAdsKey() {
    return this.request("/integrations/google/rotate-key", {
      method: "POST",
    })
  }

  async sendGoogleAdsTestLead() {
    return this.request("/integrations/google/test", {
      method: "POST",
    })
  }

  // --- Staff & Team Management Endpoints (Phase 4) ---
  async getStaff(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/staff${queryString ? `?${queryString}` : ""}`)
  }

  async createStaff(payload) {
    return this.request("/staff", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getStaffById(id) {
    return this.request(`/staff/${id}`)
  }

  async updateStaff(id, payload) {
    return this.request(`/staff/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async toggleStaffStatus(id) {
    return this.request(`/staff/${id}/deactivate`, {
      method: "PATCH",
    })
  }

  async resetStaffPassword(id, payload = {}) {
    return this.request(`/staff/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getTeams() {
    return this.request("/teams")
  }

  async createTeam(payload) {
    return this.request("/teams", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateTeam(id, payload) {
    return this.request(`/teams/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async deleteTeam(id) {
    return this.request(`/teams/${id}`, {
      method: "DELETE",
    })
  }

  // --- Roles & Scoped Permissions Endpoints (Phase 5: RBAC v2) ---
  async getRoles() {
    return this.request("/roles")
  }

  async getAvailableRolePermissions() {
    return this.request("/roles/permissions/available")
  }

  async getRoleById(id) {
    return this.request(`/roles/${id}`)
  }

  async createRole(payload) {
    return this.request("/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateRole(id, payload) {
    return this.request(`/roles/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async deleteRole(id) {
    return this.request(`/roles/${id}`, {
      method: "DELETE",
    })
  }

  // --- Lead Assignment & Rules Endpoints (Phase 7: Lead Ownership & Assignment) ---
  async assignLead(leadId, payload) {
    return this.request(`/leads/${leadId}/assign`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
  }

  async bulkAssignLeads(payload) {
    return this.request("/leads/bulk-assign", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getUnassignedPoolStats() {
    return this.request("/leads/pool/stats")
  }

  async getAssignmentRules() {
    return this.request("/assignment-rules")
  }

  async createAssignmentRule(payload) {
    return this.request("/assignment-rules", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateAssignmentRule(id, payload) {
    return this.request(`/assignment-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  }

  async deleteAssignmentRule(id) {
    return this.request(`/assignment-rules/${id}`, {
      method: "DELETE",
    })
  }

  async reorderAssignmentRules(ruleIds) {
    return this.request("/assignment-rules/reorder", {
      method: "POST",
      body: JSON.stringify({ ruleIds }),
    })
  }

  async getStaffOpenLeads(staffId) {
    return this.request(`/staff/${staffId}/open-leads`)
  }

  // --- Phase 14: Call, Device & Recording Endpoints ---
  async getCalls(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/calls${queryString ? `?${queryString}` : ""}`)
  }

  async getCallById(id) {
    return this.request(`/calls/${id}`)
  }

  async logCall(payload) {
    return this.request("/calls", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateCall(id, payload) {
    return this.request(`/calls/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
  }

  async getCallMetrics(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/calls/metrics${queryString ? `?${queryString}` : ""}`)
  }

  async getDevices(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/devices${queryString ? `?${queryString}` : ""}`)
  }

  async registerDevice(payload) {
    return this.request("/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async updateDeviceStatus(id, status) {
    return this.request(`/devices/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    })
  }

  // --- Mobile API Endpoints (Phase 15: Device Authentication & Mobile Sync) ---
  async mobileLogin(payload) {
    return this.request("/mobile/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async mobileRefresh(payload) {
    return this.request("/mobile/auth/refresh", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async mobileLogout() {
    return this.request("/mobile/auth/logout", {
      method: "POST",
    })
  }

  async mobileGetStatus() {
    return this.request("/mobile/status")
  }

  async mobileUpdatePushToken(pushToken) {
    return this.request("/mobile/push-token", {
      method: "POST",
      body: JSON.stringify({ pushToken }),
    })
  }

  async mobileSyncLeads(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/mobile/leads${queryString ? `?${queryString}` : ""}`)
  }

  async mobileReportCall(payload) {
    return this.request("/mobile/calls", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async mobileGetRecordingTicket(callId) {
    return this.request(`/mobile/calls/${callId}/recording-ticket`, {
      method: "POST",
    })
  }

  // --- Phase 18: Privacy & Do-Not-Record Endpoints ---
  async getDnrRules() {
    return this.request("/privacy/dnr")
  }

  async addDnrRule(payload) {
    return this.request("/privacy/dnr", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async removeDnrRule(ruleId) {
    return this.request(`/privacy/dnr/${ruleId}`, {
      method: "DELETE",
    })
  }

  async updateLeadPrivacy(leadId, payload) {
    return this.request(`/privacy/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
  }

  // --- Phase 21: Call Ingestion (Manual Upload) Endpoints ---
  async ingestAudioCall(audioBlob, customHeaders = {}) {
    const url = `${API_BASE_URL}/calls/ingestion/audio`
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": audioBlob.type || "audio/mp4",
        ...customHeaders,
      },
      body: audioBlob,
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || `Upload failed with status ${response.status}`)
    }
    return data
  }

  async ingestCsvCalls(payload) {
    return this.request("/calls/ingestion/csv", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getIngestionReviewQueue(query = {}) {
    const searchParams = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.append(key, value.toString())
      }
    })
    const queryString = searchParams.toString()
    return this.request(`/calls/ingestion/review${queryString ? `?${queryString}` : ""}`)
  }

  async matchIngestionCall(payload) {
    return this.request("/calls/ingestion/match", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getIngestionStats() {
    return this.request("/calls/ingestion/stats")
  }
}

export const apiClient = new ApiClient()
