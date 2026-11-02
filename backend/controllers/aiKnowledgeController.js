const mongoose = require("mongoose")
const { TenantBusinessProfile, INDUSTRY_CATEGORIES } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKnowledgeSource, KNOWLEDGE_SOURCE_TYPES } = require("../models/AIKnowledgeSource")
const Account = require("../models/Account")
const audit = require("../services/auditService")
const { validateDocumentUpload, sanitizeFileName, extractDocumentContent } = require("../services/documentExtractor")
const { extractWebsiteContent, validateUrlSecurity } = require("../services/websiteExtractor")
const mediaStorage = require("../services/mediaStorage.service")
const { isImageKitConfigured } = require("../services/imagekit.service")
const { runWithTenantContext } = require("../middleware/tenantContext")

// ==========================================
// 1. BUSINESS PROFILE CONTROLLERS
// ==========================================

/**
 * GET /api/ai-knowledge/profile
 * Authenticated: Retrieve current tenant's business profile
 */
const getBusinessProfile = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context not found on user session" })
    }

    let profile = await TenantBusinessProfile.findOne({ tenantId })

    // If tenant does not have a profile yet, provide a baseline populated from Account
    if (!profile) {
      const account = await Account.findOne({ accountId: tenantId }).lean()
      profile = {
        tenantId,
        businessName: account?.companyName || "My Business",
        industry: "Other",
        customIndustry: "",
        description: "",
        website: "",
        contactEmail: account?.adminEmail || req.user?.email || "",
        contactPhone: account?.contactNumber || "",
        address: { street: "", city: "", state: "", country: "India", postalCode: "" },
        languages: ["English", "Hindi"],
        status: "active",
        isNewProfile: true,
      }
    }

    return res.status(200).json({
      success: true,
      data: profile,
      availableIndustries: INDUSTRY_CATEGORIES,
    })
  } catch (error) {
    console.error("[getBusinessProfile Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to retrieve business profile" })
  }
}

/**
 * PUT /api/ai-knowledge/profile
 * Authenticated (requireAccountAdmin): Create or update business profile
 */
const updateBusinessProfile = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const {
      businessName,
      industry,
      customIndustry,
      description,
      website,
      contactEmail,
      contactPhone,
      address,
      languages,
      status,
    } = req.body

    if (!businessName || typeof businessName !== "string" || businessName.trim().length < 2) {
      return res.status(400).json({ success: false, error: "Business name must be at least 2 characters" })
    }

    if (industry && !INDUSTRY_CATEGORIES.includes(industry)) {
      return res.status(400).json({
        success: false,
        error: `Invalid industry. Supported categories: ${INDUSTRY_CATEGORIES.join(", ")}`,
      })
    }

    const updateData = {
      tenantId,
      businessName: businessName.trim(),
      industry: industry || "Other",
      customIndustry: customIndustry ? customIndustry.trim() : "",
      description: description ? description.trim() : "",
      website: website ? website.trim() : "",
      contactEmail: contactEmail ? contactEmail.trim().toLowerCase() : "",
      contactPhone: contactPhone ? contactPhone.trim() : "",
      address: {
        street: address?.street ? address.street.trim() : "",
        city: address?.city ? address.city.trim() : "",
        state: address?.state ? address.state.trim() : "",
        country: address?.country ? address.country.trim() : "India",
        postalCode: address?.postalCode ? address.postalCode.trim() : "",
      },
      languages: Array.isArray(languages)
        ? languages.map((l) => (typeof l === "string" ? l.trim() : "")).filter(Boolean)
        : ["English", "Hindi"],
      status: status === "inactive" ? "inactive" : "active",
    }

    const profile = await runWithTenantContext(tenantId, async () => {
      return await TenantBusinessProfile.findOneAndUpdate({ tenantId }, updateData, {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      })
    })

    // Record audit event
    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.profile_update",
      entity: "TenantBusinessProfile",
      entityId: profile._id,
      summary: `Updated business profile for '${profile.businessName}'`,
      details: {
        businessName: profile.businessName,
        industry: profile.industry,
        languages: profile.languages,
      },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Business profile saved successfully",
      data: profile,
    })
  } catch (error) {
    console.error("[updateBusinessProfile Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to update business profile" })
  }
}

// ==========================================
// 2. PRODUCT AND SERVICE LIBRARY CONTROLLERS
// ==========================================

/**
 * GET /api/ai-knowledge/products
 * Authenticated: List products and services for current tenant with search and filtering
 */
const listProducts = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const {
      page = 1,
      limit = 20,
      search = "",
      type = "all",
      status = "active",
      category = "",
    } = req.query

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20))
    const skip = (pageNum - 1) * limitNum

    const filter = { tenantId }

    if (status === "archived") {
      filter.isArchived = true
    } else if (status === "all") {
      filter.isArchived = false
    } else {
      filter.isArchived = false
      filter.status = status
    }

    if (type && type !== "all") {
      filter.type = type.toUpperCase()
    }

    if (category && category.trim()) {
      filter.category = new RegExp(category.trim(), "i")
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      filter.$or = [
        { name: searchRegex },
        { category: searchRegex },
        { description: searchRegex },
      ]
    }

    const [products, total] = await Promise.all([
      BusinessProduct.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      BusinessProduct.countDocuments(filter),
    ])

    // Attach count of associated knowledge sources for each product
    const productIds = products.map((p) => p._id)
    const sourceCounts = await AIKnowledgeSource.aggregate([
      { $match: { tenantId, productId: { $in: productIds }, isArchived: false } },
      { $group: { _id: "$productId", count: { $sum: 1 } } },
    ])
    const countMap = {}
    sourceCounts.forEach((s) => {
      countMap[s._id.toString()] = s.count
    })

    const enrichedProducts = products.map((p) => ({
      ...p,
      knowledgeSourcesCount: countMap[p._id.toString()] || 0,
    }))

    return res.status(200).json({
      success: true,
      data: {
        products: enrichedProducts,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum) || 1,
          limit: limitNum,
        },
      },
    })
  } catch (error) {
    console.error("[listProducts Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to list products and services" })
  }
}

/**
 * POST /api/ai-knowledge/products
 * Authenticated (requireAccountAdmin): Create new product or service
 */
const createProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const {
      name,
      type,
      category,
      description,
      price,
      features,
      notes,
      status,
    } = req.body

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: "Name is required and must be at least 2 characters" })
    }

    const normalizedType = type ? type.toUpperCase() : "PRODUCT"
    if (!["PRODUCT", "SERVICE"].includes(normalizedType)) {
      return res.status(400).json({ success: false, error: "Type must be either PRODUCT or SERVICE" })
    }

    // Check for duplicate name among active products for this tenant
    const existing = await BusinessProduct.findOne({
      tenantId,
      name: new RegExp(`^${name.trim()}$`, "i"),
      isArchived: false,
    })
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `A ${existing.type.toLowerCase()} named '${name.trim()}' already exists in your library.`,
      })
    }

    const newProduct = new BusinessProduct({
      tenantId,
      name: name.trim(),
      type: normalizedType,
      category: category ? category.trim() : "",
      description: description ? description.trim() : "",
      price: {
        amount: Number(price?.amount) >= 0 ? Number(price.amount) : 0,
        currency: price?.currency ? price.currency.trim().toUpperCase() : "INR",
        billingCycle: price?.billingCycle || "one-time",
      },
      features: Array.isArray(features)
        ? features.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean)
        : [],
      notes: notes ? notes.trim() : "",
      status: status === "inactive" ? "inactive" : "active",
      isArchived: false,
    })

    await newProduct.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.product_create",
      entity: "BusinessProduct",
      entityId: newProduct._id,
      summary: `Created ${newProduct.type.toLowerCase()} '${newProduct.name}'`,
      details: {
        name: newProduct.name,
        type: newProduct.type,
        category: newProduct.category,
      },
      req,
    })

    return res.status(201).json({
      success: true,
      message: `${normalizedType === "PRODUCT" ? "Product" : "Service"} created successfully`,
      data: newProduct,
    })
  } catch (error) {
    console.error("[createProduct Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to create product" })
  }
}

/**
 * GET /api/ai-knowledge/products/:id
 * Authenticated: Get single product by ID
 */
const getProductById = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid product ID" })
    }

    const product = await BusinessProduct.findOne({ _id: req.params.id, tenantId }).lean()
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" })
    }

    const knowledgeSourcesCount = await AIKnowledgeSource.countDocuments({
      tenantId,
      productId: product._id,
      isArchived: false,
    })

    return res.status(200).json({
      success: true,
      data: {
        ...product,
        knowledgeSourcesCount,
      },
    })
  } catch (error) {
    console.error("[getProductById Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to fetch product" })
  }
}

/**
 * PUT /api/ai-knowledge/products/:id
 * Authenticated (requireAccountAdmin): Update product or service
 */
const updateProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid product ID" })
    }

    const product = await BusinessProduct.findOne({ _id: req.params.id, tenantId })
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" })
    }

    const {
      name,
      type,
      category,
      description,
      price,
      features,
      notes,
      status,
    } = req.body

    if (name) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ success: false, error: "Name must be at least 2 characters" })
      }
      // Check duplicate if name changed
      if (name.trim().toLowerCase() !== product.name.toLowerCase()) {
        const duplicate = await BusinessProduct.findOne({
          tenantId,
          _id: { $ne: product._id },
          name: new RegExp(`^${name.trim()}$`, "i"),
          isArchived: false,
        })
        if (duplicate) {
          return res.status(409).json({
            success: false,
            error: `Another product/service with name '${name.trim()}' already exists.`,
          })
        }
      }
      product.name = name.trim()
    }

    if (type) {
      const normalizedType = type.toUpperCase()
      if (["PRODUCT", "SERVICE"].includes(normalizedType)) {
        product.type = normalizedType
      }
    }

    if (category !== undefined) product.category = category ? category.trim() : ""
    if (description !== undefined) product.description = description ? description.trim() : ""
    if (price !== undefined) {
      product.price = {
        amount: Number(price?.amount) >= 0 ? Number(price.amount) : product.price.amount,
        currency: price?.currency ? price.currency.trim().toUpperCase() : product.price.currency,
        billingCycle: price?.billingCycle || product.price.billingCycle,
      }
    }
    if (features !== undefined && Array.isArray(features)) {
      product.features = features.map((f) => (typeof f === "string" ? f.trim() : "")).filter(Boolean)
    }
    if (notes !== undefined) product.notes = notes ? notes.trim() : ""
    if (status && ["active", "inactive"].includes(status)) {
      product.status = status
    }

    await product.save()

    // Sync product name to associated knowledge sources
    await AIKnowledgeSource.updateMany(
      { tenantId, productId: product._id },
      { $set: { productName: product.name } }
    )

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.product_update",
      entity: "BusinessProduct",
      entityId: product._id,
      summary: `Updated ${product.type.toLowerCase()} '${product.name}'`,
      details: { name: product.name, type: product.type },
      req,
    })

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    })
  } catch (error) {
    console.error("[updateProduct Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to update product" })
  }
}

/**
 * PATCH /api/ai-knowledge/products/:id/status
 * Authenticated (requireAccountAdmin): Toggle active / inactive status
 */
const toggleProductStatus = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid product ID" })
    }

    const product = await BusinessProduct.findOne({ _id: req.params.id, tenantId })
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" })
    }

    product.status = product.status === "active" ? "inactive" : "active"
    await product.save()

    return res.status(200).json({
      success: true,
      message: `Product marked as ${product.status}`,
      data: product,
    })
  } catch (error) {
    console.error("[toggleProductStatus Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to update product status" })
  }
}

/**
 * DELETE /api/ai-knowledge/products/:id
 * Authenticated (requireAccountAdmin): Safely archive or remove product
 */
const archiveOrDeleteProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid product ID" })
    }

    const product = await BusinessProduct.findOne({ _id: req.params.id, tenantId })
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" })
    }

    // Check if any knowledge sources reference this product
    const refCount = await AIKnowledgeSource.countDocuments({
      tenantId,
      productId: product._id,
      isArchived: false,
    })

    const hardDeleteRequested = req.query.hardDelete === "true"

    if (refCount > 0 || !hardDeleteRequested) {
      // Safe archival strategy: preserve historical integrity
      product.isArchived = true
      product.status = "archived"
      product.archivedAt = new Date()
      product.archivedBy = req.user?.name || "Admin"
      await product.save()

      await audit.log({
        tenantId,
        actor: req.user,
        action: "ai_knowledge.product_archive",
        entity: "BusinessProduct",
        entityId: product._id,
        summary: `Archived product '${product.name}' (${refCount} references protected)`,
        details: { name: product.name, refCount },
        req,
      })

      return res.status(200).json({
        success: true,
        message:
          refCount > 0
            ? `Product '${product.name}' is referenced by ${refCount} knowledge source(s) and has been safely archived to protect historical data.`
            : `Product '${product.name}' has been archived.`,
        archived: true,
        referenceCount: refCount,
      })
    }

    // No references and explicit hard delete requested
    await BusinessProduct.deleteOne({ _id: product._id, tenantId })

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.product_delete",
      entity: "BusinessProduct",
      entityId: product._id,
      summary: `Permanently deleted unreferenced product '${product.name}'`,
      details: { name: product.name },
      req,
    })

    return res.status(200).json({
      success: true,
      message: `Product '${product.name}' deleted permanently.`,
      archived: false,
      deleted: true,
    })
  } catch (error) {
    console.error("[archiveOrDeleteProduct Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to delete product" })
  }
}

// ==========================================
// 3. AI KNOWLEDGE SOURCES CONTROLLERS
// ==========================================

/**
 * GET /api/ai-knowledge/sources
 * Authenticated: List knowledge sources for current tenant with status and type filtering
 */
const listKnowledgeSources = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const {
      page = 1,
      limit = 20,
      status = "all",
      sourceType = "all",
      productId = "",
      search = "",
    } = req.query

    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20))
    const skip = (pageNum - 1) * limitNum

    const filter = { tenantId, isArchived: false }

    if (status && status !== "all") {
      filter.status = status.toUpperCase()
    }

    if (sourceType && sourceType !== "all") {
      filter.sourceType = sourceType.toLowerCase()
    }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      filter.productId = productId
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      filter.$or = [
        { title: searchRegex },
        { productName: searchRegex },
        { "fileDetails.originalFileName": searchRegex },
        { "websiteDetails.url": searchRegex },
      ]
    }

    const [sources, total, statusAgg] = await Promise.all([
      AIKnowledgeSource.find(filter)
        .select("-extractedText") // Exclude bulky text from list view for performance
        .populate("productId", "name type category")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AIKnowledgeSource.countDocuments(filter),
      AIKnowledgeSource.aggregate([
        { $match: { tenantId, isArchived: false } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            totalWords: { $sum: "$wordCount" },
          },
        },
      ]),
    ])

    const summary = {
      total: 0,
      completed: 0,
      processing: 0,
      failed: 0,
      pending: 0,
      totalWords: 0,
    }

    statusAgg.forEach((agg) => {
      const s = (agg._id || "").toLowerCase()
      summary.total += agg.count
      summary.totalWords += agg.totalWords || 0
      if (s === "completed") summary.completed = agg.count
      else if (s === "processing") summary.processing = agg.count
      else if (s === "failed") summary.failed = agg.count
      else if (s === "pending") summary.pending = agg.count
    })

    return res.status(200).json({
      success: true,
      data: {
        sources,
        summary,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum) || 1,
          limit: limitNum,
        },
      },
    })
  } catch (error) {
    console.error("[listKnowledgeSources Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to list knowledge sources" })
  }
}

/**
 * GET /api/ai-knowledge/sources/:id
 * Authenticated: Get source details including extracted text preview
 */
const getKnowledgeSourceById = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid source ID" })
    }

    const source = await AIKnowledgeSource.findOne({
      _id: req.params.id,
      tenantId,
      isArchived: false,
    })
      .populate("productId", "name type category price")
      .lean()

    if (!source) {
      return res.status(404).json({ success: false, error: "Knowledge source not found" })
    }

    return res.status(200).json({
      success: true,
      data: source,
    })
  } catch (error) {
    console.error("[getKnowledgeSourceById Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to fetch knowledge source details" })
  }
}

/**
 * GET /api/ai-knowledge/sources/:id/preview
 * Authenticated: Get safe truncated preview of extracted text
 */
const getKnowledgeSourcePreview = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid source ID" })
    }

    const source = await AIKnowledgeSource.findOne({
      _id: req.params.id,
      tenantId,
      isArchived: false,
    }).lean()

    if (!source) {
      return res.status(404).json({ success: false, error: "Knowledge source not found" })
    }

    const maxLength = Math.min(Math.max(parseInt(req.query.maxLength, 10) || 1000, 50), 5000)
    const rawText = source.extractedText || ""
    const previewText = rawText.slice(0, maxLength) + (rawText.length > maxLength ? "..." : "")

    return res.status(200).json({
      success: true,
      data: {
        id: source._id,
        title: source.title,
        sourceType: source.sourceType,
        status: source.status,
        previewText,
        totalCharacters: source.textLength || rawText.length,
        wordCount: source.wordCount || 0,
        isTruncated: rawText.length > maxLength,
      },
    })
  } catch (error) {
    console.error("[getKnowledgeSourcePreview Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to fetch source preview" })
  }
}

/**
 * POST /api/ai-knowledge/sources/upload
 * Authenticated (requireAccountAdmin): Upload and extract document (PDF, DOCX, XLSX, CSV, TXT)
 */
const uploadDocumentSource = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No document file was uploaded" })
    }

    const { title, productId } = req.body

    // 1. Validate file constraints
    const validation = validateDocumentUpload({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    })

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error })
    }

    const cleanFileName = sanitizeFileName(req.file.originalname)
    const normalizedType = validation.normalizedType

    // 2. Validate product reference if provided
    let resolvedProductId = null
    let resolvedProductName = ""
    if (productId && productId.trim() && productId !== "none") {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, error: "Invalid associated product ID" })
      }
      const product = await BusinessProduct.findOne({ _id: productId, tenantId, isArchived: false })
      if (!product) {
        return res.status(404).json({ success: false, error: "Associated product does not exist in your account" })
      }
      resolvedProductId = product._id
      resolvedProductName = product.name
    }

    // 3. Optional Cloud Storage in ImageKit (if configured)
    let storageDetails = {
      originalFileName: req.file.originalname,
      sanitizedFileName: cleanFileName,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      storageProvider: "none",
      fileId: "",
      fileUrl: "",
    }

    if (isImageKitConfigured()) {
      try {
        const uploadRes = await mediaStorage.uploadFile({
          file: req.file.buffer,
          fileName: cleanFileName,
          tenantId,
          category: "documents",
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          tags: ["knowledge-source", normalizedType, tenantId],
        })

        if (uploadRes && uploadRes.success) {
          storageDetails = {
            ...storageDetails,
            storageProvider: "imagekit",
            fileId: uploadRes.fileId || "",
            fileUrl: uploadRes.url || "",
            storagePath: uploadRes.filePath || "",
          }
        }
      } catch (storageErr) {
        console.warn("[UploadDocumentSource] ImageKit upload skipped/failed:", storageErr.message)
        // Non-blocking: proceed with local buffer extraction
      }
    }

    // 4. Create AIKnowledgeSource record
    const sourceTitle = title && title.trim() ? title.trim() : cleanFileName

    const source = new AIKnowledgeSource({
      tenantId,
      title: sourceTitle,
      sourceType: normalizedType,
      productId: resolvedProductId,
      productName: resolvedProductName,
      status: "PROCESSING",
      fileDetails: storageDetails,
      uploadedBy: {
        userId: req.user?._id || null,
        name: req.user?.name || "Admin",
        email: req.user?.email || "",
      },
    })
    await source.save()

    // 5. Extract text content immediately
    const extractRes = await extractDocumentContent({
      buffer: req.file.buffer,
      fileName: cleanFileName,
      sourceType: normalizedType,
    })

    if (extractRes.success) {
      source.status = "COMPLETED"
      source.extractedText = extractRes.text
      source.textLength = extractRes.textLength
      source.wordCount = extractRes.wordCount
      source.metadata = extractRes.metadata
      source.lastExtractedAt = new Date()
      source.errorMessage = ""
    } else {
      source.status = "FAILED"
      source.errorMessage = extractRes.error || "Text extraction failed"
      source.metadata = extractRes.metadata
    }

    await source.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.source_upload",
      entity: "AIKnowledgeSource",
      entityId: source._id,
      summary: `Uploaded knowledge source '${source.title}' (${normalizedType.toUpperCase()}) - ${source.status}`,
      details: {
        title: source.title,
        sourceType: source.sourceType,
        status: source.status,
        wordCount: source.wordCount,
      },
      req,
    })

    return res.status(201).json({
      success: true,
      message:
        source.status === "COMPLETED"
          ? `Document uploaded and extracted successfully (${source.wordCount.toLocaleString()} words).`
          : `Document uploaded, but extraction encountered an issue: ${source.errorMessage}`,
      data: source,
    })
  } catch (error) {
    console.error("[uploadDocumentSource Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to process document upload" })
  }
}

/**
 * POST /api/ai-knowledge/sources/website
 * Authenticated (requireAccountAdmin): Add public website URL with strict SSRF validation & text extraction
 */
const addWebsiteSource = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const { url, title, productId } = req.body

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ success: false, error: "A valid public website URL is required" })
    }

    const cleanUrl = url.trim()

    // 1. Resolve product reference if provided
    let resolvedProductId = null
    let resolvedProductName = ""
    if (productId && productId.trim() && productId !== "none") {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, error: "Invalid associated product ID" })
      }
      const product = await BusinessProduct.findOne({ _id: productId, tenantId, isArchived: false })
      if (!product) {
        return res.status(404).json({ success: false, error: "Associated product not found in your account" })
      }
      resolvedProductId = product._id
      resolvedProductName = product.name
    }

    let parsedDomain = ""
    try {
      parsedDomain = new URL(cleanUrl).hostname
    } catch (e) {
      return res.status(400).json({ success: false, error: "Malformed website URL: " + e.message })
    }

    // 2. Strict SSRF Security Validation before issuing network requests
    try {
      await validateUrlSecurity(cleanUrl)
    } catch (ssrfErr) {
      return res.status(400).json({
        success: false,
        error: ssrfErr.message,
      })
    }

    const sourceTitle = title && title.trim() ? title.trim() : `Website: ${parsedDomain}`

    // 2. Initialize source record in PROCESSING state
    const source = new AIKnowledgeSource({
      tenantId,
      title: sourceTitle,
      sourceType: "website",
      productId: resolvedProductId,
      productName: resolvedProductName,
      status: "PROCESSING",
      websiteDetails: {
        url: cleanUrl,
        domain: parsedDomain,
        fetchedAt: new Date(),
      },
      uploadedBy: {
        userId: req.user?._id || null,
        name: req.user?.name || "Admin",
        email: req.user?.email || "",
      },
    })
    await source.save()

    // 3. Fetch and extract content securely with SSRF protection
    const extractRes = await extractWebsiteContent(cleanUrl)

    if (extractRes.success) {
      source.status = "COMPLETED"
      source.extractedText = extractRes.text
      source.textLength = extractRes.textLength
      source.wordCount = extractRes.wordCount
      source.websiteDetails = {
        url: extractRes.finalUrl || cleanUrl,
        domain: extractRes.domain || parsedDomain,
        httpStatus: extractRes.httpStatus,
        resolvedIp: extractRes.resolvedIp,
        fetchedAt: new Date(),
      }
      source.lastExtractedAt = new Date()
      source.errorMessage = ""
    } else {
      source.status = "FAILED"
      source.errorMessage = extractRes.error || "Failed to extract website text"
      source.websiteDetails = {
        url: cleanUrl,
        domain: parsedDomain,
        httpStatus: extractRes.httpStatus || null,
        resolvedIp: extractRes.resolvedIp || "",
        fetchedAt: new Date(),
      }
    }

    await source.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.source_website",
      entity: "AIKnowledgeSource",
      entityId: source._id,
      summary: `Added website knowledge source '${source.title}' - ${source.status}`,
      details: {
        url: cleanUrl,
        status: source.status,
        wordCount: source.wordCount,
      },
      req,
    })

    return res.status(201).json({
      success: true,
      message:
        source.status === "COMPLETED"
          ? `Website content extracted successfully (${source.wordCount.toLocaleString()} words).`
          : `Website registered, but extraction encountered an issue: ${source.errorMessage}`,
      data: source,
    })
  } catch (error) {
    console.error("[addWebsiteSource Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to process website extraction" })
  }
}

/**
 * POST /api/ai-knowledge/sources/manual
 * Authenticated (requireAccountAdmin): Add manually entered business / product knowledge text
 */
const addManualSource = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    const { title, content, category, productId, tags } = req.body

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, error: "Title is required" })
    }

    if (!content || typeof content !== "string" || content.trim().length < 10) {
      return res.status(400).json({ success: false, error: "Knowledge content must be at least 10 characters" })
    }

    let resolvedProductId = null
    let resolvedProductName = ""
    if (productId && productId.trim() && productId !== "none") {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, error: "Invalid associated product ID" })
      }
      const product = await BusinessProduct.findOne({ _id: productId, tenantId, isArchived: false })
      if (!product) {
        return res.status(404).json({ success: false, error: "Associated product not found" })
      }
      resolvedProductId = product._id
      resolvedProductName = product.name
    }

    const cleanContent = content.trim().slice(0, 500000)
    const wordCount = cleanContent.split(/\s+/).filter(Boolean).length

    const source = new AIKnowledgeSource({
      tenantId,
      title: title.trim(),
      sourceType: "manual",
      productId: resolvedProductId,
      productName: resolvedProductName,
      status: "COMPLETED",
      manualDetails: {
        content: cleanContent,
        category: category ? category.trim() : "General Business Information",
        tags: Array.isArray(tags) ? tags.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean) : [],
      },
      extractedText: cleanContent,
      textLength: cleanContent.length,
      wordCount,
      lastExtractedAt: new Date(),
      uploadedBy: {
        userId: req.user?._id || null,
        name: req.user?.name || "Admin",
        email: req.user?.email || "",
      },
    })

    await source.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.source_manual",
      entity: "AIKnowledgeSource",
      entityId: source._id,
      summary: `Created manual knowledge source '${source.title}' (${wordCount} words)`,
      details: { title: source.title, wordCount },
      req,
    })

    return res.status(201).json({
      success: true,
      message: `Manual knowledge entry saved successfully (${wordCount.toLocaleString()} words).`,
      data: source,
    })
  } catch (error) {
    console.error("[addManualSource Error]:", error)
    return res.status(500).json({ success: false, error: error.message || "Failed to add manual knowledge source" })
  }
}

/**
 * POST /api/ai-knowledge/sources/:id/retry
 * Authenticated (requireAccountAdmin): Retry extraction on a failed or pending source
 */
const retryKnowledgeSource = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid source ID" })
    }

    const source = await AIKnowledgeSource.findOne({ _id: req.params.id, tenantId, isArchived: false })
    if (!source) {
      return res.status(404).json({ success: false, error: "Knowledge source not found" })
    }

    source.retryCount = (source.retryCount || 0) + 1
    source.status = "PROCESSING"
    await source.save()

    if (source.sourceType === "website") {
      const url = source.websiteDetails?.url
      if (!url) {
        source.status = "FAILED"
        source.errorMessage = "Missing website URL for retry"
        await source.save()
        return res.status(400).json({ success: false, error: "Missing website URL in source record" })
      }

      const extractRes = await extractWebsiteContent(url)
      if (extractRes.success) {
        source.status = "COMPLETED"
        source.extractedText = extractRes.text
        source.textLength = extractRes.textLength
        source.wordCount = extractRes.wordCount
        source.lastExtractedAt = new Date()
        source.errorMessage = ""
      } else {
        source.status = "FAILED"
        source.errorMessage = extractRes.error || "Retry extraction failed"
      }
      await source.save()
    } else if (source.sourceType === "manual") {
      source.extractedText = source.manualDetails?.content || source.extractedText || ""
      source.textLength = source.extractedText.length
      source.wordCount = source.extractedText.split(/\s+/).filter(Boolean).length
      source.status = "COMPLETED"
      source.lastExtractedAt = new Date()
      source.errorMessage = ""
      await source.save()
    } else {
      // Document file retry
      // If file URL exists in ImageKit, attempt to re-fetch buffer
      if (source.fileDetails?.fileUrl) {
        try {
          const fetchRes = await fetch(source.fileDetails.fileUrl)
          if (fetchRes.ok) {
            const arrayBuffer = await fetchRes.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const extractRes = await extractDocumentContent({
              buffer,
              fileName: source.fileDetails.originalFileName || source.title,
              sourceType: source.sourceType,
            })

            if (extractRes.success) {
              source.status = "COMPLETED"
              source.extractedText = extractRes.text
              source.textLength = extractRes.textLength
              source.wordCount = extractRes.wordCount
              source.metadata = extractRes.metadata
              source.lastExtractedAt = new Date()
              source.errorMessage = ""
            } else {
              source.status = "FAILED"
              source.errorMessage = extractRes.error
            }
            await source.save()
          } else {
            throw new Error(`Failed to fetch stored file from storage (HTTP ${fetchRes.status})`)
          }
        } catch (fetchErr) {
          source.status = "FAILED"
          source.errorMessage = `Could not re-fetch file for retry: ${fetchErr.message}. Please upload the document again.`
          await source.save()
        }
      } else {
        source.status = "FAILED"
        source.errorMessage = "Source file is not stored in cloud storage. Please upload the document again."
        await source.save()
      }
    }

    return res.status(200).json({
      success: true,
      message:
        source.status === "COMPLETED"
          ? `Retry successful! Extracted ${source.wordCount.toLocaleString()} words.`
          : `Retry completed with status: ${source.status} (${source.errorMessage})`,
      data: source,
    })
  } catch (error) {
    console.error("[retryKnowledgeSource Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to retry extraction" })
  }
}

/**
 * DELETE /api/ai-knowledge/sources/:id
 * Authenticated (requireAccountAdmin): Safely remove a knowledge source
 */
const deleteKnowledgeSource = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant context missing" })
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid source ID" })
    }

    const source = await AIKnowledgeSource.findOne({ _id: req.params.id, tenantId })
    if (!source) {
      return res.status(404).json({ success: false, error: "Knowledge source not found" })
    }

    // Delete file from ImageKit if fileId is stored
    if (source.fileDetails?.fileId && isImageKitConfigured()) {
      try {
        await mediaStorage.deleteFile(source.fileDetails.fileId, tenantId)
      } catch (delErr) {
        console.warn("[deleteKnowledgeSource] ImageKit file deletion warning:", delErr.message)
      }
    }

    // Soft delete or remove record
    source.isArchived = true
    await source.save()

    await audit.log({
      tenantId,
      actor: req.user,
      action: "ai_knowledge.source_delete",
      entity: "AIKnowledgeSource",
      entityId: source._id,
      summary: `Removed knowledge source '${source.title}'`,
      details: { title: source.title, sourceType: source.sourceType },
      req,
    })

    return res.status(200).json({
      success: true,
      message: `Knowledge source '${source.title}' removed successfully.`,
    })
  } catch (error) {
    console.error("[deleteKnowledgeSource Error]:", error)
    return res.status(500).json({ success: false, error: "Failed to delete knowledge source" })
  }
}

module.exports = {
  // Business Profile
  getBusinessProfile,
  updateBusinessProfile,
  // Products & Services
  listProducts,
  createProduct,
  getProductById,
  updateProduct,
  toggleProductStatus,
  archiveOrDeleteProduct,
  // AI Knowledge Sources
  listKnowledgeSources,
  getKnowledgeSourceById,
  getKnowledgeSourcePreview,
  uploadDocumentSource,
  addWebsiteSource,
  addManualSource,
  retryKnowledgeSource,
  deleteKnowledgeSource,
}
