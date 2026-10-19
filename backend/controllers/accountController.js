const crypto = require("crypto")
const mongoose = require("mongoose")
const Account = require("../models/Account")
const User = require("../models/User")

// Helper to escape regex special characters and prevent ReDoS
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
      ]
    }

    if (status && status !== "all") {
      query.status = status
    }

    const sortConfig = {}
    sortConfig[sortBy] = sortOrder === "asc" ? 1 : -1

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
  } = req.body

  // Validation
  if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
    res.status(400).json({ success: false, error: "Company name is required" })
    return
  }
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    res.status(400).json({ success: false, error: "Display name is required" })
    return
  }
  if (!adminName || typeof adminName !== "string" || !adminName.trim()) {
    res.status(400).json({ success: false, error: "Account admin full name is required" })
    return
  }
  if (!adminEmail || typeof adminEmail !== "string" || !adminEmail.trim()) {
    res.status(400).json({ success: false, error: "Account admin email is required" })
    return
  }

  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/
  if (!emailRegex.test(adminEmail.trim())) {
    res.status(400).json({ success: false, error: "Please enter a valid admin email address" })
    return
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

  // Pre-check for duplicate user email
  const existingUser = await User.findOne({ email: adminEmail.toLowerCase().trim() })
  if (existingUser) {
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
      email: adminEmail.toLowerCase().trim(),
      password: password, // Hashed automatically by userSchema.pre('save')
      role: "account_admin",
      tenantId: accountId,
      status: normalizedStatus,
      contactNumber: typeof contactNumber === "string" ? contactNumber.trim() : "",
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
      contactNumber: typeof contactNumber === "string" ? contactNumber.trim() : "",
      status: normalizedStatus,
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
  updateAccountStatus,
}
