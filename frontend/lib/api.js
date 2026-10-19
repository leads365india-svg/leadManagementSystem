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
}

export const apiClient = new ApiClient()
