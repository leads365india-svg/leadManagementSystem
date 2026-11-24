const crypto = require("crypto")
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Account = require("../models/Account")
const { getJwtSecret } = require("../middleware/authMiddleware")
const { getAccountByCustomDomainCached, isPlatformDomain, sanitizeHostname } = require("../utils/customDomainCache")
const audit = require("../services/auditService")

const JWT_EXPIRES_IN = "24h"

const getSuperAdminConfig = () => {
  const rawEmail = process.env.SUPER_ADMIN_EMAIL || process.env.SUPERADMIN_EMAIL || ""
  const rawPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || ""
  const rawName = process.env.SUPER_ADMIN_NAME || process.env.SUPERADMIN_NAME || ""

  return {
    configuredEmail: typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : "",
    configuredPassword: typeof rawPassword === "string" ? rawPassword.trim() : "",
    configuredName: typeof rawName === "string" ? rawName.trim() : "",
  }
}

const login = async (req, res) => {
  try {
    const rawIdentifier = (req.body.email || req.body.identifier || req.body.username || "").toString()
    const password = req.body.password !== undefined && req.body.password !== null ? String(req.body.password) : ""
    const isSuperAdminPortal = req.body.portal === "super_admin" || req.body.isSuperAdminLogin === true

    // Input validation
    if (!rawIdentifier || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      })
    }

    const invalidCredentialsResponse = (code = "INVALID_CREDENTIALS", customMsg = null) => {
      res.status(401).json({
        success: false,
        error: customMsg || "Invalid email or password",
        code,
      })
    }

    const normalizedIdentifier = rawIdentifier.toLowerCase().trim()
    const targetTenantId =
      (req.body && (req.body.tenantId || req.body.accountId)) ||
      req.headers["x-tenant-id"] ||
      ""

    let cleanTenantId = typeof targetTenantId === "string" ? targetTenantId.trim() : ""
    if (cleanTenantId && require("mongoose").Types.ObjectId.isValid(cleanTenantId)) {
      const acct = await Account.findById(cleanTenantId).select("accountId").lean()
      if (acct && acct.accountId) {
        cleanTenantId = acct.accountId
      }
    }

    const { configuredEmail, configuredPassword, configuredName } = getSuperAdminConfig()
    const isSuperAdminIdentifier = Boolean(configuredEmail && normalizedIdentifier === configuredEmail)

    let user = null

    // 1. If target tenant is supplied (e.g. from portal URL or custom domain), prioritize tenant-scoped user query
    if (cleanTenantId) {
      user = await User.findOne({
        email: normalizedIdentifier,
        tenantId: cleanTenantId,
      }).select("+password")
    }

    // 2. Global lookup by email
    if (!user) {
      user = await User.findOne({ email: normalizedIdentifier }).select("+password")
    }

    // If identifier matches configured Super Admin email or user in DB has role super_admin
    const isSuperAdminUser = isSuperAdminIdentifier || (user && user.role === "super_admin")

    if (isSuperAdminPortal || isSuperAdminUser) {
      // Super Admin Authentication Path
      // Missing environment credentials must fail closed
      if (!configuredEmail || !configuredPassword) {
        console.error("❌ Super Admin login failed: SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not configured in environment.")
        return res.status(500).json({
          success: false,
          error: "Super Admin authentication is not configured on the server. Please contact system administrator.",
        })
      }

      // When authenticating as the environment-configured Super Admin, enforce environment configuration
      if (isSuperAdminIdentifier || (!user && isSuperAdminPortal)) {
        if (normalizedIdentifier !== configuredEmail) {
          return invalidCredentialsResponse()
        }

        // Constant-time timing-safe password comparison against environment password
        const isPasswordMatch = crypto.timingSafeEqual(
          Buffer.from(crypto.createHash("sha256").update(password).digest("hex")),
          Buffer.from(crypto.createHash("sha256").update(configuredPassword).digest("hex")),
        )
        if (!isPasswordMatch) {
          return invalidCredentialsResponse()
        }

        // Retrieve or sync Super Admin account in MongoDB
        if (!user) {
          user = await User.findOne({ role: "super_admin" }).select("+password")
        }
        if (!user) {
          user = new User({
            name: configuredName || "Super Admin",
            email: configuredEmail,
            password: configuredPassword,
            role: "super_admin",
            status: "active",
            tenantId: null,
          })
          await user.save()
        } else {
          let needsSave = false
          if (user.email !== configuredEmail) {
            user.email = configuredEmail
            needsSave = true
          }
          if (user.role !== "super_admin") {
            user.role = "super_admin"
            needsSave = true
          }
          if (user.status !== "active" || user.isActive === false) {
            user.status = "active"
            user.isActive = true
            needsSave = true
          }
          const hashMatches = await user.comparePassword(configuredPassword)
          if (!hashMatches) {
            user.password = configuredPassword
            needsSave = true
          }
          if (needsSave) {
            await user.save()
          }
        }
      } else if (user && user.role === "super_admin") {
        // Super Admin in database (e.g. from tests or prior migration)
        const isMatch = await user.comparePassword(password)
        if (!isMatch) {
          return invalidCredentialsResponse()
        }
      } else {
        // Non-super-admin user attempting to login through Super Admin portal
        return res.status(403).json({
          success: false,
          error: "Access denied: Non-Super Admin accounts cannot log in through the Super Admin portal.",
        })
      }

      // Disallow Super Admin credentials from authenticating into a tenant-specific portal
      if (cleanTenantId && !isSuperAdminPortal) {
        return res.status(403).json({
          success: false,
          error: "Access denied: Super Admin credentials cannot be used for tenant portal login.",
        })
      }
    } else {
      // Tenant / Client User Authentication Path
      if (!user) {
        console.warn(`[Auth:TenantLogin] User not found for identifier: ${normalizedIdentifier}`)
        return res.status(401).json({
          success: false,
          error: "No account found with this email address. Please check your email or contact support.",
          code: "USER_NOT_FOUND",
        })
      }

      // Tenant users must never be super_admin
      if (user.role === "super_admin") {
        return res.status(403).json({
          success: false,
          error: "Access denied: Platform Super Admin accounts must sign in via the Super Admin portal.",
          code: "SUPER_ADMIN_PORTAL_MISMATCH",
        })
      }

      // Ensure tenant admin has synchronized tenantId from Account if previously unset
      if (!user.tenantId && user._id) {
        const userAccount = await Account.findOne({ adminUserId: user._id }).select("accountId").lean()
        if (userAccount && userAccount.accountId) {
          user.tenantId = userAccount.accountId
          await User.findByIdAndUpdate(user._id, { tenantId: userAccount.accountId })
        }
      }

      // Check if user is suspended
      if (user.status === "suspended") {
        return res.status(403).json({
          success: false,
          error: "Your account is currently suspended. Please contact support.",
          code: "ACCOUNT_SUSPENDED",
        })
      }

      // Strict Domain-to-Tenant Lock for White-Label Domains
      const rawDomain =
        (req.body && req.body.domain) ||
        req.headers["x-tenant-domain"] ||
        req.headers["x-forwarded-host"] ||
        req.headers.origin ||
        ""

      const cleanReqDomain = sanitizeHostname(rawDomain)

      if (cleanReqDomain && !isPlatformDomain(cleanReqDomain)) {
        const domainAccount = await getAccountByCustomDomainCached(cleanReqDomain)

        if (domainAccount) {
          // Enforce: User MUST belong to this domain's tenant
          // Super admins or users from different tenants are strictly rejected on dedicated white-label domains
          if (user.role === "super_admin") {
            console.warn(`[Auth:TenantLogin] Super Admin attempted login on dedicated white-label domain: ${cleanReqDomain}`)
            return res.status(403).json({
              success: false,
              error: "Access denied: Platform Super Admin accounts must sign in via the Super Admin portal.",
              code: "SUPER_ADMIN_DOMAIN_MISMATCH",
            })
          }

          const userTenant =
            user.tenantId ||
            (user._id && domainAccount.adminUserId && domainAccount.adminUserId.toString() === user._id.toString()
              ? domainAccount.accountId
              : null)

          if (!userTenant || userTenant !== domainAccount.accountId) {
            console.warn(`[Auth:TenantLogin] Domain mismatch for user ${normalizedIdentifier}. Domain: ${cleanReqDomain}, userTenant: ${userTenant}, domainTenant: ${domainAccount.accountId}`)
            return res.status(403).json({
              success: false,
              error: "Access denied: This account belongs to another organization and cannot sign in on this portal domain.",
              code: "DOMAIN_TENANT_MISMATCH",
            })
          }

          // If domain is dedicated to a child workspace, verify user has active membership
          if (domainAccount.boundWorkspace && user.role !== "account_admin") {
            const WorkspaceMembership = require("../models/WorkspaceMembership")
            const isMember = await WorkspaceMembership.findOne({
              tenantId: userTenant,
              workspaceId: domainAccount.boundWorkspace._id,
              userId: user._id,
              status: "active",
            })
              .setOptions({ skipTenantFilter: true })
              .lean()

            if (!isMember) {
              return res.status(403).json({
                success: false,
                error: `Cross-workspace access denied: Your session does not belong to workspace '${domainAccount.boundWorkspace.name}'.`,
                code: "WORKSPACE_MEMBERSHIP_REQUIRED",
              })
            }
          }
        }
      }

      // Verify password strictly against MongoDB hash using bcrypt
      const isMatch = await user.comparePassword(password)
      if (!isMatch) {
        console.warn(`[Auth:TenantLogin] Password comparison failed for user: ${normalizedIdentifier} (tenant: ${user.tenantId || "none"})`)
        return res.status(401).json({
          success: false,
          error: "Incorrect password. Please verify your password and try again.",
          code: "INVALID_PASSWORD",
        })
      }
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
          customDomain: account.customDomain || "",
          logoUrl: account.logoUrl || "",
          primaryColor: account.primaryColor || "#4f46e5",
          pageTitle: account.pageTitle || account.displayName || account.companyName,
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
    res.clearCookie("active_tenant_id", {
      path: "/",
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
    })
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
    res.clearCookie("active_tenant_id", {
      path: "/",
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
    })

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
    const { getEffectiveTenant } = require("../middleware/tenantContext")
    const { tenantId: effectiveTenantId } = getEffectiveTenant(req)

    if (req.user.role !== "super_admin") {
      let account = req.tenantAccount || null
      if (!account && req.user.tenantId) {
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
          customDomain: account.customDomain || "",
          logoUrl: account.logoUrl || "",
          primaryColor: account.primaryColor || "#4f46e5",
          pageTitle: account.pageTitle || account.displayName || account.companyName,
        }
      }
    } else if (effectiveTenantId) {
      const account = req.tenantAccount || (await Account.findOne({ accountId: effectiveTenantId }).lean())
      if (account) {
        accountData = {
          id: account._id.toString(),
          accountId: account.accountId,
          companyName: account.companyName,
          displayName: account.displayName,
          status: account.status,
          customDomain: account.customDomain || "",
          logoUrl: account.logoUrl || "",
          primaryColor: account.primaryColor || "#4f46e5",
          pageTitle: account.pageTitle || account.displayName || account.companyName,
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
          tenantId: req.user.role === "super_admin" ? (accountData ? accountData.accountId : null) : (req.user.tenantId || null),
          effectiveTenantId: req.user.role === "super_admin" ? (accountData ? accountData.accountId : null) : (req.user.tenantId || null),
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

// GET /api/auth/tenant-info?tenantId=ACC-XXXX or ?domain=crm.medical365.in
const getTenantInfo = async (req, res) => {
  try {
    const rawTerm = (req.query.tenantId || req.query.domain || req.query.identifier || "").toString().trim()
    if (!rawTerm) {
      return res.status(400).json({
        success: false,
        error: "Tenant ID or domain identifier is required",
      })
    }

    // Clean term to match customDomain or slug (strip protocol, path, port)
    const cleanDomain = rawTerm.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase()
    let account = await Account.findOne({
      $or: [
        { accountId: rawTerm },
        { slug: cleanDomain },
        { customDomain: cleanDomain },
      ],
    }).lean()

    if (!account) {
      account = await getAccountByCustomDomainCached(cleanDomain)
    }

    if (!account) {
      return res.status(404).json({
        success: false,
        error: "No active Leads Account found with this identifier or domain",
      })
    }

    if (account.boundWorkspace) {
      const ws = account.boundWorkspace
      return res.status(200).json({
        success: true,
        data: {
          accountId: account.accountId,
          companyName: ws.branding?.displayName || ws.name,
          displayName: ws.branding?.displayName || ws.name,
          status: ws.status || "active",
          slug: ws.slug || "",
          customDomain: cleanDomain,
          logoUrl: ws.branding?.logoUrl || account.logoUrl || "",
          primaryColor: ws.branding?.primaryColor || account.primaryColor || "#4f46e5",
          pageTitle: ws.branding?.displayName || ws.name,
          workspaceId: ws._id,
          workspaceSlug: ws.slug,
          isWorkspaceDomain: true,
        },
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
 * GET /api/auth/branding?domain=crm.medical365.in
 * Public endpoint to fetch tenant white-label branding by customDomain.
 * Never exposes credentials or sensitive account secrets.
 */
const getBranding = async (req, res) => {
  try {
    // Strictly isolate public branding cache between hostnames and origins
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    res.setHeader("Vary", "Host, Origin, X-Tenant-Domain")

    const rawDomain =
      req.query.domain ||
      req.headers["x-tenant-domain"] ||
      req.headers["x-forwarded-host"] ||
      req.headers.origin ||
      req.headers.host ||
      ""

    const normalizeDomain = (val) => {
      if (!val || typeof val !== "string") return ""
      return val
        .trim()
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .split(":")[0]
        .toLowerCase()
    }

    const host = normalizeDomain(rawDomain)

    if (
      !host ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".vercel.app") ||
      host === "admin.leads365.in" ||
      host === "leads365.in"
    ) {
      return res.status(200).json({
        success: true,
        data: {
          isWhiteLabel: false,
        },
      })
    }

    const account = await getAccountByCustomDomainCached(host)

    if (!account) {
      return res.status(200).json({
        success: true,
        data: {
          isWhiteLabel: false,
          unconfiguredDomain: true,
        },
      })
    }

    if (account.boundWorkspace) {
      const ws = account.boundWorkspace
      return res.status(200).json({
        success: true,
        data: {
          isWhiteLabel: true,
          isWorkspaceDomain: true,
          workspaceId: ws._id,
          workspaceSlug: ws.slug,
          workspaceName: ws.name,
          tenantId: account.accountId,
          accountId: account.accountId,
          companyName: ws.branding?.displayName || ws.name,
          displayName: ws.branding?.displayName || ws.name,
          browserPageTitle: ws.branding?.displayName || ws.name,
          logoUrl: ws.branding?.logoUrl || account.logoUrl || "",
          brandPrimaryColor: ws.branding?.primaryColor || account.primaryColor || "#4f46e5",
        },
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        isWhiteLabel: true,
        tenantId: account.accountId,
        accountId: account.accountId,
        companyName: account.companyName,
        displayName: account.displayName || account.companyName,
        browserPageTitle: account.pageTitle || account.displayName || account.companyName,
        logoUrl: account.logoUrl || "",
        brandPrimaryColor: account.primaryColor || "#4f46e5",
      },
    })
  } catch (error) {
    console.error("Error retrieving domain branding:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve branding metadata",
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
    res.clearCookie("active_tenant_id", {
      path: "/",
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
    })

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
  getBranding,
  acceptInvite,
  resetPasswordWithToken,
  logoutAll,
}
