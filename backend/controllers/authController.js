const crypto = require("crypto")
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Account = require("../models/Account")
const { getJwtSecret } = require("../middleware/authMiddleware")
const audit = require("../services/auditService")

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

    // Verify password immediately to fail fast and avoid unnecessary DB queries on invalid attempts
    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return invalidCredentialsResponse()
    }

    // If tenant user/admin (non-super-admin), retrieve tenant account metadata
    let accountData = null
    if (user.role !== "super_admin") {
      let account = null
      if (user.tenantId) {
        account = await Account.findOne({ accountId: user.tenantId }).lean()
      }
      if (!account && user._id) {
        account = await Account.findOne({ adminUserId: user._id }).lean()
      }

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

    // Record login timestamp
    const loginTimestamp = new Date()
    user.lastLoginAt = loginTimestamp

    // Sign JWT using validated secret including tokenVersion for session invalidation
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tokenVersion: user.tokenVersion || 1,
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

    const { resolveUserPermissions } = require("../middleware/authMiddleware")
    const { permissions: userPermissions, roleName: resolvedRoleName } =
      await resolveUserPermissions(user)

    const authUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      roleTitle: resolvedRoleName,
      tenantId: user.tenantId,
      status: user.status,
      isActive: user.isActive !== false && user.status !== "suspended",
      phone: user.phone || user.contactNumber || "",
      teamId: user.teamId || null,
      managerId: user.managerId || null,
      maxOpenLeads: user.maxOpenLeads ?? 50,
      lastLoginAt: user.lastLoginAt,
      permissions: userPermissions,
      account: accountData,
    }

    // Asynchronously record lastLoginAt and audit trail without delaying client response
    Promise.all([
      User.updateOne({ _id: user._id }, { $set: { lastLoginAt: loginTimestamp } }),
      audit.log({
        tenantId: user.tenantId,
        actor: user,
        action: audit.AUDIT_ACTIONS.AUTH_LOGIN,
        entity: "auth",
        entityId: user._id,
        summary: `User ${user.name} (${user.email}) logged in successfully`,
        details: {
          role: user.role,
          roleTitle: resolvedRoleName,
        },
        req,
      }),
    ]).catch((err) => console.error("Post-login background update error:", err))

    res.status(200).json({
      success: true,
      data: {
        user: authUser,
        token,
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

const logout = async (req, res) => {
  try {
    if (req.user) {
      await audit.log({
        tenantId: req.user.tenantId,
        actor: req.user,
        action: audit.AUDIT_ACTIONS.AUTH_LOGOUT,
        entity: "auth",
        entityId: req.user.id || req.user._id,
        summary: `User ${req.user.name} logged out`,
        req,
      })
    }
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
    if (req.user.role !== "super_admin") {
      let account = null
      if (req.user.tenantId) {
        account = await Account.findOne({ accountId: req.user.tenantId }).lean()
      }
      if (!account && req.user.id) {
        account = await Account.findOne({ adminUserId: req.user.id }).lean()
      }
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

    const cleanTerm = tenantId.trim().toLowerCase()
    const account = await Account.findOne({
      $or: [
        { accountId: tenantId.trim() },
        { slug: cleanTerm },
        { customDomain: cleanTerm },
      ],
    }).lean()

    if (!account) {
      return res.status(404).json({
        success: false,
        error: "No active Leads Account found with this identifier or slug",
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        accountId: account.accountId,
        companyName: account.companyName,
        displayName: account.displayName,
        status: account.status,
        slug: account.slug || "",
        customDomain: account.customDomain || "",
        logoUrl: account.logoUrl || "",
        primaryColor: account.primaryColor || "#4f46e5",
        pageTitle: account.pageTitle || account.displayName || account.companyName,
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

/**
 * POST /api/auth/accept-invite
 * Invited staff member sets their initial password
 */
const acceptInvite = async (req, res) => {
  try {
    const { token, email, password } = req.body || {}
    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Invite token, email, and new password are required.",
      })
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters.",
      })
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex")
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      inviteTokenHash: tokenHash,
      inviteTokenExpiresAt: { $gt: new Date() },
    }).select("+password")

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired invite token. Please request a new invite link.",
      })
    }

    user.password = password
    user.inviteTokenHash = null
    user.inviteTokenExpiresAt = null
    user.tokenVersion = (user.tokenVersion || 1) + 1
    user.isActive = true
    user.status = "active"
    await user.save()

    await audit.log({
      tenantId: user.tenantId,
      actor: user,
      action: audit.AUDIT_ACTIONS.AUTH_INVITE_ACCEPTED,
      entity: "user",
      entityId: user._id,
      summary: `Staff member ${user.name} (${user.email}) set their initial password`,
      req,
    })

    res.status(200).json({
      success: true,
      message: "Password set successfully. You can now log in with your credentials.",
    })
  } catch (error) {
    console.error("Error accepting invite:", error)
    res.status(500).json({ success: false, error: "Failed to set password" })
  }
}

/**
 * POST /api/auth/reset-password
 * Complete password reset with one-time token
 */
const resetPasswordWithToken = async (req, res) => {
  try {
    const { token, email, password } = req.body || {}
    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Reset token, email, and new password are required.",
      })
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters.",
      })
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex")
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordTokenHash: tokenHash,
      resetPasswordTokenExpiresAt: { $gt: new Date() },
    }).select("+password")

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired password reset token.",
      })
    }

    user.password = password
    user.resetPasswordTokenHash = null
    user.resetPasswordTokenExpiresAt = null
    user.tokenVersion = (user.tokenVersion || 1) + 1
    await user.save()

    await audit.log({
      tenantId: user.tenantId,
      actor: user,
      action: audit.AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
      entity: "user",
      entityId: user._id,
      summary: `User ${user.name} (${user.email}) completed password reset via token`,
      req,
    })

    res.status(200).json({
      success: true,
      message: "Password reset successfully. Please log in with your new password.",
    })
  } catch (error) {
    console.error("Error completing password reset:", error)
    res.status(500).json({ success: false, error: "Failed to reset password" })
  }
}

/**
 * POST /api/auth/logout-all
 * Revoke all active sessions by incrementing user's tokenVersion
 */
const logoutAll = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    await User.findByIdAndUpdate(req.user.id, {
      $inc: { tokenVersion: 1 },
    })

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
      message: "All active sessions have been terminated. Please log in again.",
    })
  } catch (error) {
    console.error("Error logging out all sessions:", error)
    res.status(500).json({ success: false, error: "Failed to revoke sessions" })
  }
}

module.exports = {
  login,
  logout,
  getMe,
  getTenantInfo,
  acceptInvite,
  resetPasswordWithToken,
  logoutAll,
}
