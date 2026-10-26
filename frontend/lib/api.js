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
}

export const apiClient = new ApiClient()
