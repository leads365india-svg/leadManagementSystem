const fs = require("fs")
const path = require("path")

// 1. Patch Account.js to add slug field
const accountModelPath = path.resolve(__dirname, "../models/Account.js")
let accountModel = fs.readFileSync(accountModelPath, "utf8").replace(/\r\n/g, "\n")
if (!accountModel.includes("slug:")) {
  const target = `    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      required: true,
      index: true,
    },`
  const replacement = `    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      required: true,
      index: true,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      default: "",
    },`
  accountModel = accountModel.replace(target, replacement)
  fs.writeFileSync(accountModelPath, accountModel, "utf8")
  console.log("Account.js patched with slug field.")
}

// 2. Patch authController.js getTenantInfo
const authCtrlPath = path.resolve(__dirname, "../controllers/authController.js")
let authCtrl = fs.readFileSync(authCtrlPath, "utf8").replace(/\r\n/g, "\n")
const targetAuth = `    const account = await Account.findOne({ accountId: tenantId.trim() }).lean()
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
    })`

const replacementAuth = `    const cleanTerm = tenantId.trim().toLowerCase()
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
    })`

if (authCtrl.includes(targetAuth)) {
  authCtrl = authCtrl.replace(targetAuth, replacementAuth)
  fs.writeFileSync(authCtrlPath, authCtrl, "utf8")
  console.log("authController.js patched with slug and white-label branding resolution.")
}
