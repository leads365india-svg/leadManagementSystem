const crypto = require("crypto")
const mongoose = require("mongoose")
const Account = require("../models/Account")
const User = require("../models/User")

// Helper to escape regex special characters and prevent ReDoS
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Helper to sanitize domain strings (strips protocol, port, paths)
const sanitizeDomain = (domain) => {
  if (!domain || typeof domain !== "string") return ""
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .trim()
}

// Helper to validate domain name format (e.g. crm.domain.com or client-portal.io)
const isValidDomain = (domain) => {
  if (!domain || typeof domain !== "string") return false
  const clean = sanitizeDomain(domain)
  if (!clean || clean.includes("://") || clean.includes("/") || clean.includes(":") || clean.includes("?")) {
    return false
  }
  const domainRegex = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
  return domainRegex.test(clean)
}

// Helper to sanitize and normalize Indian mobile numbers
const normalizeIndianMobile = (number) => {
  if (!number || typeof number !== "string") return ""
  let clean = number.replace(/[\s\-+()]/g, "")
  if (clean.startsWith("91") && clean.length === 12) {
    clean = clean.slice(2)
  } else if (clean.startsWith("0")) {
    clean = clean.replace(/^0+/, "")
  }
  return clean
}

// Helper to validate Indian mobile numbers (10 digits starting with 6, 7, 8, or 9)
const isValidIndianMobile = (number) => {
  if (!number || typeof number !== "string") return false
  const clean = normalizeIndianMobile(number)
  return /^[6-9]\d{9}$/.test(clean)
}

// Generate clean, secure unique tenant/account ID with collision protection
const generateUniqueAccountId = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase()
    const candidateId = `ACC-${randomHex}`
    const existing = await Account.findOne({ accountId: candidateId })
    if (!existing) {
      return candidateId
    }
  }
  return `ACC-${crypto.randomBytes(8).toString("hex").toUpperCase()}`
}

// GET /api/super-admin/accounts - Get all accounts with filtering & pagination
const getAccounts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "all",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(50, Number(limit) || 10))
    const skip = (pageNum - 1) * limitNum

    const query = {}

    if (typeof search === "string" && search.trim()) {
      const sanitizedTerm = escapeRegex(search.trim())
      query.$or = [
        { companyName: { $regex: sanitizedTerm, $options: "i" } },
        { displayName: { $regex: sanitizedTerm, $options: "i" } },
        { accountId: { $regex: sanitizedTerm, $options: "i" } },
        { adminName: { $regex: sanitizedTerm, $options: "i" } },
        { adminEmail: { $regex: sanitizedTerm, $options: "i" } },
        { customDomain: { $regex: sanitizedTerm, $options: "i" } },
      ]
    }

    if (status && status !== "all") {
      query.status = status
    }

    const ALLOWED_ACCOUNT_SORT_FIELDS = [
      "companyName",
      "displayName",
      "accountId",
      "adminName",
      "adminEmail",
      "status",
      "createdAt",
      "updatedAt",
    ]
    const sortField = ALLOWED_ACCOUNT_SORT_FIELDS.includes(sortBy) ? sortBy : "createdAt"
    const sortConfig = {}
    sortConfig[sortField] = sortOrder === "asc" ? 1 : -1

    const [accounts, total] = await Promise.all([
      Account.find(query).sort(sortConfig).skip(skip).limit(limitNum).lean(),
      Account.countDocuments(query),
    ])

    const totalPages = Math.ceil(total / limitNum)

    const transformedAccounts = accounts.map((acc) => ({
      id: acc._id.toString(),
      accountId: acc.accountId,
      companyName: acc.companyName,
      displayName: acc.displayName,
      adminUserId: acc.adminUserId ? acc.adminUserId.toString() : "",
      adminName: acc.adminName,
      adminEmail: acc.adminEmail,
      contactNumber: acc.contactNumber || "",
      status: acc.status,
      customDomain: acc.customDomain || "",
      domainStatus: acc.domainStatus || "unconfigured",
      logoUrl: acc.logoUrl || "",
      primaryColor: acc.primaryColor || "#4f46e5",
      pageTitle: acc.pageTitle || "",
      portalUrl: `/portal/login?tenant=${acc.accountId}`,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    }))

    res.status(200).json({
      success: true,
      data: {
        accounts: transformedAccounts,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    })
  } catch (error) {
    console.error("Error fetching accounts:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch accounts list",
    })
  }
}

// GET /api/super-admin/stats - Summary metrics for Super Admin Dashboard
const getAccountStats = async (_req, res) => {
  try {
    const [totalAccounts, activeAccounts, suspendedAccounts, totalAdmins] = await Promise.all([
      Account.countDocuments(),
      Account.countDocuments({ status: "active" }),
      Account.countDocuments({ status: "suspended" }),
      User.countDocuments({ role: "account_admin" }),
    ])

    res.status(200).json({
      success: true,
      data: {
        totalAccounts,
        activeAccounts,
        suspendedAccounts,
        totalAdmins,
      },
    })
  } catch (error) {
    console.error("Error fetching account stats:", error)
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard metrics",
    })
  }
}

// GET /api/super-admin/accounts/:id - Get account details
const getAccountById = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid account ID format",
      })
      return
    }

    const account = await Account.findById(id).lean()
    if (!account) {
      res.status(404).json({
        success: false,
        error: "Leads Account not found",
      })
      return
    }

    const admin = await User.findById(account.adminUserId).lean()

    res.status(200).json({
      success: true,
      data: {
        ...account,
        id: account._id.toString(),
        portalUrl: `/portal/login?tenant=${account.accountId}`,
        adminDetails: admin
          ? {
              id: admin._id.toString(),
              name: admin.name,
              email: admin.email,
              role: admin.role,
              status: admin.status,
              contactNumber: admin.contactNumber,
            }
          : null,
      },
    })
  } catch (error) {
    console.error("Error fetching account by ID:", error)
    res.status(500).json({
      success: false,
      error: "Failed to retrieve account details",
    })
  }
}

// POST /api/super-admin/accounts - Add Leads Account with associated Account Admin
const createAccount = async (req, res) => {
  const {
    companyName,
    displayName,
    adminName,
    adminEmail,
    contactNumber = "",
    password,
    status = "active",
    customDomain = "",
    logoUrl = "",
    primaryColor = "#4f46e5",
    pageTitle = "",
    countryCode = "",
  } = req.body

  // Validation
  if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
    res.status(400).json({ success: false, error: "Company name is required" })
    return
  }
  if (companyName.trim().length < 2) {
    res.status(400).json({ success: false, error: "Company name must be at least 2 characters long" })
    return
  }
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    res.status(400).json({ success: false, error: "Display name is required" })
    return
  }
  if (displayName.trim().length < 2) {
    res.status(400).json({ success: false, error: "Display name must be at least 2 characters long" })
    return
  }
  if (!adminName || typeof adminName !== "string" || !adminName.trim()) {
    res.status(400).json({ success: false, error: "Account admin full name is required" })
    return
  }
  if (adminName.trim().length < 2) {
    res.status(400).json({ success: false, error: "Account admin full name must be at least 2 characters long" })
    return
  }
  if (!adminEmail || typeof adminEmail !== "string" || !adminEmail.trim()) {
    res.status(400).json({ success: false, error: "Account admin email is required" })
    return
  }

  // Modern RFC-compliant email validation (supports all valid TLDs and aliases)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
  if (!emailRegex.test(adminEmail.trim())) {
    res.status(400).json({ success: false, error: "Please enter a valid admin email address" })
    return
  }

  // Mobile number validation (Indian 10-digit rule when countryCode is IN, general phone rule otherwise)
  const trimmedContact = typeof contactNumber === "string" ? contactNumber.trim() : ""
  let savedContact = trimmedContact
  if (trimmedContact) {
    if (countryCode === "IN") {
      if (!isValidIndianMobile(trimmedContact)) {
        res.status(400).json({
          success: false,
          error: "Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9)",
        })
        return
      }
      savedContact = normalizeIndianMobile(trimmedContact)
    } else {
      const digitsOnly = trimmedContact.replace(/[\s\-+()]/g, "")
      if (!/^\d{7,15}$/.test(digitsOnly)) {
        res.status(400).json({
          success: false,
          error: "Please enter a valid phone number (7 to 15 digits)",
        })
        return
      }
    }
  }

  // Custom domain validation & sanitization
  let cleanDomain = ""
  if (customDomain && typeof customDomain === "string" && customDomain.trim()) {
    cleanDomain = sanitizeDomain(customDomain)
    if (!isValidDomain(cleanDomain)) {
      res.status(400).json({
        success: false,
        error: "Invalid custom domain format. Example: crm.yourcompany.com",
      })
      return
    }
    const duplicateDomain = await Account.findOne({ customDomain: cleanDomain })
    if (duplicateDomain) {
      res.status(400).json({
        success: false,
        error: "This custom domain is already registered to another account",
      })
      return
    }
  }

  // Password validation
  if (!password || typeof password !== "string" || !password.trim()) {
    res.status(400).json({ success: false, error: "Password is required" })
    return
  }
  if (password.length < 8) {
    res.status(400).json({ success: false, error: "Password must be at least 8 characters long" })
    return
  }

  // Pre-check for duplicate user email in User and Account models
  const normalizedAdminEmail = adminEmail.toLowerCase().trim()
  const existingUser = await User.findOne({ email: normalizedAdminEmail })
  const existingAccount = await Account.findOne({ adminEmail: normalizedAdminEmail })
  if (existingUser || existingAccount) {
    res.status(400).json({
      success: false,
      error: "An account or user with this email address already exists",
    })
    return
  }

  const normalizedStatus = status === "suspended" ? "suspended" : "active"
  const accountId = await generateUniqueAccountId()

  // Safe compensation/rollback transaction strategy
  let createdUser = null
  let createdAccount = null

  try {
    // 1. Create the Leads Account Admin User with Super Admin chosen password
    createdUser = new User({
      name: adminName.trim(),
      email: normalizedAdminEmail,
      password: password, // Hashed automatically by userSchema.pre('save')
      role: "account_admin",
      tenantId: accountId,
      status: normalizedStatus,
      contactNumber: savedContact,
    })
    await createdUser.save()

    // 2. Create the Associated Leads Account
    createdAccount = new Account({
      accountId,
      companyName: companyName.trim(),
      displayName: displayName.trim(),
      adminUserId: createdUser._id,
      adminName: createdUser.name,
      adminEmail: createdUser.email,
      contactNumber: savedContact,
      status: normalizedStatus,
      customDomain: cleanDomain,
      domainStatus: cleanDomain ? "pending_verification" : "unconfigured",
      logoUrl: typeof logoUrl === "string" ? logoUrl.trim() : "",
      primaryColor: typeof primaryColor === "string" && primaryColor.trim() ? primaryColor.trim() : "#4f46e5",
      pageTitle: typeof pageTitle === "string" ? pageTitle.trim() : "",
    })
    await createdAccount.save()

    res.status(201).json({
      success: true,
      message: "Leads Account and Admin created successfully",
      data: {
        account: {
          id: createdAccount._id.toString(),
          accountId: createdAccount.accountId,
          companyName: createdAccount.companyName,
          displayName: createdAccount.displayName,
          adminName: createdAccount.adminName,
          adminEmail: createdAccount.adminEmail,
          contactNumber: createdAccount.contactNumber,
          status: createdAccount.status,
          customDomain: createdAccount.customDomain,
          domainStatus: createdAccount.domainStatus,
          logoUrl: createdAccount.logoUrl,
          primaryColor: createdAccount.primaryColor,
          pageTitle: createdAccount.pageTitle,
          portalUrl: `/portal/login?tenant=${createdAccount.accountId}`,
          createdAt: createdAccount.createdAt,
        },
      },
    })
  } catch (error) {
    console.error("Error creating account:", error)

    // Full compensation rollback: clean up both user and account if created
    try {
      if (createdUser && createdUser._id) {
        await User.findByIdAndDelete(createdUser._id)
      }
      if (createdAccount && createdAccount._id) {
        await Account.findByIdAndDelete(createdAccount._id)
      }
    } catch (cleanupError) {
      console.error("Rollback cleanup error:", cleanupError)
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message)
      res.status(400).json({
        success: false,
        error: messages.join(", "),
      })
      return
    }

    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: "An account with this ID or email already exists",
      })
      return
    }

    res.status(500).json({
      success: false,
      error: "Failed to create Leads Account. Changes were safely rolled back.",
    })
  }
}

// PUT /api/super-admin/accounts/:id - Edit account details & white-label settings
const updateAccount = async (req, res) => {
  try {
    const { id } = req.params
    const {
      companyName,
      displayName,
      adminName,
      contactNumber,
      customDomain,
      logoUrl,
      primaryColor,
      pageTitle,
      countryCode = "",
    } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid account ID format",
      })
      return
    }

    const account = await Account.findById(id)
    if (!account) {
      res.status(404).json({
        success: false,
        error: "Leads Account not found",
      })
      return
    }

    // Validations
    if (companyName !== undefined) {
      if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        res.status(400).json({ success: false, error: "Company name is required" })
        return
      }
      account.companyName = companyName.trim()
    }

    if (displayName !== undefined) {
      if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
        res.status(400).json({ success: false, error: "Display name is required" })
        return
      }
      account.displayName = displayName.trim()
    }

    if (adminName !== undefined) {
      if (!adminName || typeof adminName !== "string" || !adminName.trim()) {
        res.status(400).json({ success: false, error: "Admin full name is required" })
        return
      }
      account.adminName = adminName.trim()
    }

    if (contactNumber !== undefined) {
      const trimmedContact = typeof contactNumber === "string" ? contactNumber.trim() : ""
      let savedContact = trimmedContact
      if (trimmedContact) {
        if (countryCode === "IN") {
          if (!isValidIndianMobile(trimmedContact)) {
            res.status(400).json({
              success: false,
              error: "Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9)",
            })
            return
          }
          savedContact = normalizeIndianMobile(trimmedContact)
        } else {
          const digitsOnly = trimmedContact.replace(/[\s\-+()]/g, "")
          if (!/^\d{7,15}$/.test(digitsOnly)) {
            res.status(400).json({
              success: false,
              error: "Please enter a valid phone number (7 to 15 digits)",
            })
            return
          }
        }
      }
      account.contactNumber = savedContact
    }

    if (customDomain !== undefined) {
      const cleanDomain = typeof customDomain === "string" ? sanitizeDomain(customDomain) : ""
      if (cleanDomain) {
        if (!isValidDomain(cleanDomain)) {
          res.status(400).json({
            success: false,
            error: "Invalid custom domain format. Example: crm.yourcompany.com",
          })
          return
        }
        const duplicateDomain = await Account.findOne({
          customDomain: cleanDomain,
          _id: { $ne: account._id },
        })
        if (duplicateDomain) {
          res.status(400).json({
            success: false,
            error: "This custom domain is already registered to another account",
          })
          return
        }
        if (account.customDomain !== cleanDomain) {
          account.customDomain = cleanDomain
          account.domainStatus = "pending_verification"
        }
      } else {
        account.customDomain = ""
        account.domainStatus = "unconfigured"
      }
    }

    if (logoUrl !== undefined) {
      account.logoUrl = typeof logoUrl === "string" ? logoUrl.trim() : ""
    }
    if (primaryColor !== undefined) {
      account.primaryColor =
        typeof primaryColor === "string" && primaryColor.trim() ? primaryColor.trim() : "#4f46e5"
    }
    if (pageTitle !== undefined) {
      account.pageTitle = typeof pageTitle === "string" ? pageTitle.trim() : ""
    }

    await account.save()

    // Sync Admin user details
    if (account.adminUserId) {
      const userUpdates = {}
      if (adminName !== undefined) userUpdates.name = account.adminName
      if (contactNumber !== undefined) userUpdates.contactNumber = account.contactNumber
      if (Object.keys(userUpdates).length > 0) {
        await User.findByIdAndUpdate(account.adminUserId, userUpdates)
      }
    }

    res.status(200).json({
      success: true,
      message: "Account and white-label settings updated successfully",
      data: {
        id: account._id.toString(),
        accountId: account.accountId,
        companyName: account.companyName,
        displayName: account.displayName,
        adminName: account.adminName,
        adminEmail: account.adminEmail,
        contactNumber: account.contactNumber,
        status: account.status,
        customDomain: account.customDomain,
        domainStatus: account.domainStatus,
        logoUrl: account.logoUrl,
        primaryColor: account.primaryColor,
        pageTitle: account.pageTitle,
        portalUrl: `/portal/login?tenant=${account.accountId}`,
        updatedAt: account.updatedAt,
      },
    })
  } catch (error) {
    console.error("Error updating account:", error)

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message)
      res.status(400).json({
        success: false,
        error: messages.join(", "),
      })
      return
    }

    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: "An account with this ID or domain already exists",
      })
      return
    }

    res.status(500).json({
      success: false,
      error: "Failed to update account details",
    })
  }
}

// PATCH /api/super-admin/accounts/:id/status - Toggle activate/suspend status
const updateAccountStatus = async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        error: "Invalid account ID format",
      })
      return
    }

    if (status !== "active" && status !== "suspended") {
      res.status(400).json({
        success: false,
        error: "Invalid status. Allowed values are 'active' or 'suspended'.",
      })
      return
    }

    const account = await Account.findById(id)
    if (!account) {
      res.status(404).json({
        success: false,
        error: "Leads Account not found",
      })
      return
    }

    account.status = status
    await account.save()

    // Sync status with associated Admin user
    if (account.adminUserId) {
      await User.findByIdAndUpdate(account.adminUserId, { status })
    }

    res.status(200).json({
      success: true,
      message: `Account status updated to ${status} successfully`,
      data: {
        id: account._id.toString(),
        accountId: account.accountId,
        companyName: account.companyName,
        status: account.status,
      },
    })
  } catch (error) {
    console.error("Error updating account status:", error)
    res.status(500).json({
      success: false,
      error: "Failed to update account status",
    })
  }
}

module.exports = {
  getAccounts,
  getAccountStats,
  getAccountById,
  createAccount,
  updateAccount,
  updateAccountStatus,
}
