const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Account = require("../models/Account")
const { getJwtSecret } = require("../middleware/authMiddleware")

const JWT_EXPIRES_IN = "24h"

const login = async (req, res) => {
  try {
    const { email, password } = req.body

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    const invalidCredentialsResponse = () => {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password")
    if (!user) {
      return invalidCredentialsResponse()
    }

    // Check if user is suspended
    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        error: "Account has been suspended. Please contact support.",
      })
    }

    // If user belongs to a tenant or is an account admin, check if the tenant account is active
    let accountData = null
    const accountQuery = []
    if (user.tenantId) {
      accountQuery.push({ accountId: user.tenantId })
    }
    if (user._id) {
      accountQuery.push({ adminUserId: user._id })
    }

    if (accountQuery.length > 0) {
      const account = await Account.findOne({ $or: accountQuery }).lean()
      if (account) {
        if (account.status === "suspended") {
          return res.status(403).json({
            success: false,
            error: `Your Leads Account (${account.companyName}) is currently suspended. Please contact your administrator.`,
          })
        }
        accountData = {
          id: account._id.toString(),
          accountId: account.accountId,
          companyName: account.companyName,
          displayName: account.displayName,
          status: account.status,
        }
        // Ensure user tenantId is synchronized if missing
        if (!user.tenantId && account.accountId) {
          user.tenantId = account.accountId
          await User.findByIdAndUpdate(user._id, { tenantId: account.accountId })
        }
      }
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return invalidCredentialsResponse()
    }

    // Sign JWT using validated secret
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      getJwtSecret(),
      { expiresIn: JWT_EXPIRES_IN },
    )

    // Set secure HTTP-only cookies with role-appropriate isolation
    const isProduction = process.env.NODE_ENV === "production"
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    }
    const clearOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    }

    if (user.role === "super_admin") {
      res.cookie("superadmin_token", token, cookieOptions)
      res.clearCookie("client_token", clearOptions)
    } else {
      res.cookie("client_token", token, cookieOptions)
      // Clear any prior Super Admin session to prevent identity leakage
      res.clearCookie("superadmin_token", clearOptions)
    }

    const roleTitle =
      user.role === "account_admin"
        ? "Leads Account Admin"
        : user.role === "super_admin"
          ? "Super Admin"
          : user.role

    const authUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      roleTitle,
      tenantId: user.tenantId,
      status: user.status,
      account: accountData,
    }

    res.status(200).json({
      success: true,
      data: {
        user: authUser,
      },
      message: "Authentication successful",
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({
      success: false,
      error: "Authentication failed. Please try again later.",
    })
  }
}

const logout = async (_req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === "production"
    const clearOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    }
    res.clearCookie("superadmin_token", clearOptions)
    res.clearCookie("client_token", clearOptions)

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error during logout",
    })
  }
}

const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      })
    }

    let accountData = null
    const accountQuery = []
    if (req.user.tenantId) {
      accountQuery.push({ accountId: req.user.tenantId })
    }
    if (req.user.id) {
      accountQuery.push({ adminUserId: req.user.id })
    }

    if (accountQuery.length > 0) {
      const account = await Account.findOne({ $or: accountQuery }).lean()
      if (account) {
        accountData = {
          id: account._id.toString(),
          accountId: account.accountId,
          companyName: account.companyName,
          displayName: account.displayName,
          status: account.status,
        }
      }
    }

    const roleTitle =
      req.user.role === "account_admin"
        ? "Leads Account Admin"
        : req.user.role === "super_admin"
          ? "Super Admin"
          : req.user.role

    res.status(200).json({
      success: true,
      data: {
        user: {
          ...req.user,
          roleTitle,
          account: accountData,
        },
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch user profile",
    })
  }
}

// GET /api/auth/tenant-info?tenantId=ACC-XXXX
const getTenantInfo = async (req, res) => {
  try {
    const { tenantId } = req.query
    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      return res.status(400).json({
        success: false,
        error: "Tenant ID is required",
      })
    }

    const account = await Account.findOne({ accountId: tenantId.trim() }).lean()
    if (!account) {
      return res.status(404).json({
        success: false,
        error: "No active Leads Account found with this Tenant ID",
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        accountId: account.accountId,
        companyName: account.companyName,
        displayName: account.displayName,
        status: account.status,
      },
    })
  } catch (error) {
    console.error("Error fetching tenant info:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve tenant info",
    })
  }
}

module.exports = {
  login,
  logout,
  getMe,
  getTenantInfo,
}
