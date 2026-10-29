const fs = require("fs")
const path = require("path")

const accountCtrlPath = path.resolve(__dirname, "../controllers/accountController.js")
let content = fs.readFileSync(accountCtrlPath, "utf8").replace(/\r\n/g, "\n")

// 1. Add generateSafeSlug helper if not already present
if (!content.includes("const generateSafeSlug =")) {
  const targetTop = `// Generate clean, secure unique tenant/account ID with collision protection`
  const helperCode = `// Helper to generate unique, URL-safe slug from company name
const generateSafeSlug = async (name) => {
  if (!name || typeof name !== "string") return ""
  let base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!base) base = "tenant"
  let candidate = base
  let counter = 1
  while (await Account.findOne({ slug: candidate })) {
    counter++
    candidate = \`\${base}-\${counter}\`
  }
  return candidate
}

// Generate clean, secure unique tenant/account ID with collision protection`
  content = content.replace(targetTop, helperCode)
}

// 2. Add slug in createAccount
if (!content.includes("const slug = await generateSafeSlug")) {
  const targetCreate = `  const normalizedStatus = status === "suspended" ? "suspended" : "active"
  const accountId = await generateUniqueAccountId()`

  const replacementCreate = `  const normalizedStatus = status === "suspended" ? "suspended" : "active"
  const accountId = await generateUniqueAccountId()
  const slug = await generateSafeSlug(companyName || displayName)`

  content = content.replace(targetCreate, replacementCreate)

  const targetAccNew = `      companyName: companyName.trim(),
      displayName: displayName.trim(),`

  const replacementAccNew = `      companyName: companyName.trim(),
      displayName: displayName.trim(),
      slug,`

  content = content.replace(targetAccNew, replacementAccNew)
}

// 3. Add slug in transformedAccounts
if (!content.includes("slug: acc.slug || \"\",")) {
  const targetTransformed = `      contactNumber: acc.contactNumber || "",
      status: acc.status,`

  const replacementTransformed = `      contactNumber: acc.contactNumber || "",
      status: acc.status,
      slug: acc.slug || "",`

  content = content.replace(targetTransformed, replacementTransformed)
}

fs.writeFileSync(accountCtrlPath, content, "utf8")
console.log("accountController.js patched with slug generation.")
