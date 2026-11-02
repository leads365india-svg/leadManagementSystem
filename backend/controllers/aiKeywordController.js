const mongoose = require("mongoose")
const { AIKeywordTopic } = require("../models/AIKeywordTopic")
const { TenantBusinessProfile } = require("../models/TenantBusinessProfile")
const BusinessProduct = require("../models/BusinessProduct")
const { AIKnowledgeSource } = require("../models/AIKnowledgeSource")
const aiProviderService = require("../services/aiProvider.service")
const audit = require("../services/auditService")

/**
 * AI Keyword & Topic Controller - Phase 2: AI Keyword Generation & Admin Approval
 * Strict tenant scoping and Account Admin authorization enforced across all methods.
 */

// Helper to resolve tenantId safely
function getTenantId(req) {
  return req.tenantId || req.user?.tenantId
}

/**
 * 1. POST /api/ai-keywords/generate
 * Generates topics & keywords from tenant business profile, products, and completed knowledge sources.
 */
async function generateKeywords(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const { mode = "append", defaultStatus = "PENDING_APPROVAL" } = req.body || {}

    // Fetch tenant business assets
    const [profile, products, knowledgeSources] = await Promise.all([
      TenantBusinessProfile.findOne({ tenantId }),
      BusinessProduct.find({ tenantId, status: { $ne: "archived" }, isArchived: { $ne: true } }),
      AIKnowledgeSource.find({ tenantId, status: "COMPLETED" }),
    ])

    // Verify that at least some knowledge exists for this tenant
    const hasAssets = Boolean(
      (profile && profile.businessName) ||
      (products && products.length > 0) ||
      (knowledgeSources && knowledgeSources.length > 0)
    )

    if (!hasAssets) {
      return res.status(400).json({
        success: false,
        message: "No business knowledge found. Please create your Business Profile, Products, or Knowledge Documents first before generating keywords.",
      })
    }

    // Call AI provider abstraction
    const generationResult = await aiProviderService.generateKeywordsAndTopics({
      profile,
      products,
      knowledgeSources,
    })

    const generatedTopics = generationResult.topics || []
    if (generatedTopics.length === 0) {
      return res.status(422).json({
        success: false,
        message: "Unable to generate keywords from current knowledge assets. Ensure product descriptions or knowledge sources contain sufficient details.",
      })
    }

    // If mode is 'replace_drafts', remove existing unapproved topics before inserting new ones
    if (mode === "replace_drafts") {
      await AIKeywordTopic.deleteMany({
        tenantId,
        status: { $in: ["DRAFT", "PENDING_APPROVAL"] },
      })
    }

    // Prepare topic documents
    const initialStatus = ["DRAFT", "PENDING_APPROVAL"].includes(defaultStatus)
      ? defaultStatus
      : "PENDING_APPROVAL"

    const docsToInsert = generatedTopics.map((t) => ({
      tenantId,
      name: t.name,
      category: t.category || "Sales & Inquiries",
      status: initialStatus,
      confidenceScore: t.confidenceScore || 0.85,
      primaryKeywords: Array.isArray(t.primaryKeywords) ? t.primaryKeywords : [],
      synonyms: Array.isArray(t.synonyms) ? t.synonyms : [],
      customerQuestions: Array.isArray(t.customerQuestions) ? t.customerQuestions : [],
      productTerminology: Array.isArray(t.productTerminology) ? t.productTerminology : [],
      discussionPoints: Array.isArray(t.discussionPoints) ? t.discussionPoints : [],
      relatedProductIds: Array.isArray(t.relatedProductIds) ? t.relatedProductIds : [],
      sourceReferences: Array.isArray(t.sourceReferences) ? t.sourceReferences : [],
      generatedAt: new Date(),
    }))

    const savedTopics = await AIKeywordTopic.insertMany(docsToInsert)

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.generate",
      entity: "AIKeywordTopic",
      summary: `Generated ${savedTopics.length} AI discussion topics via ${generationResult.provider}`,
      details: {
        count: savedTopics.length,
        provider: generationResult.provider,
        mode,
        initialStatus,
      },
    })

    return res.status(201).json({
      success: true,
      message: `Generated ${savedTopics.length} discussion topics successfully`,
      provider: generationResult.provider,
      count: savedTopics.length,
      topics: savedTopics,
    })
  } catch (err) {
    console.error("Error in generateKeywords:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to generate AI keywords" })
  }
}

/**
 * 2. GET /api/ai-keywords
 * Lists topics with status filtering, category filtering, search, pagination, and KPI stats.
 */
async function listKeywords(req, res) {
  try {
    const tenantId = getTenantId(req)
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant context missing" })
    }

    const {
      status,
      category,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query

    const filter = { tenantId }

    if (status && status.toUpperCase() !== "ALL") {
      filter.status = status.toUpperCase()
    }

    if (category && category.trim()) {
      filter.category = category.trim()
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      filter.$or = [
        { name: searchRegex },
        { primaryKeywords: searchRegex },
        { category: searchRegex },
      ]
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
    const skip = (pageNum - 1) * limitNum

    const sortOptions = {}
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1

    // Parallel fetch: topics, count, and overall KPI counts
    const [topics, totalMatching, allTenantTopics] = await Promise.all([
      AIKeywordTopic.find(filter)
        .populate("relatedProductIds", "name type category price")
        .populate("sourceReferences.sourceId", "title sourceType")
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AIKeywordTopic.countDocuments(filter),
      AIKeywordTopic.find({ tenantId }, { status: 1 }).lean(),
    ])

    const stats = {
      total: allTenantTopics.length,
      draft: allTenantTopics.filter((t) => t.status === "DRAFT").length,
      pending: allTenantTopics.filter((t) => t.status === "PENDING_APPROVAL").length,
      approved: allTenantTopics.filter((t) => t.status === "APPROVED").length,
      rejected: allTenantTopics.filter((t) => t.status === "REJECTED").length,
      archived: allTenantTopics.filter((t) => t.status === "ARCHIVED").length,
    }

    return res.status(200).json({
      success: true,
      topics,
      total: totalMatching,
      page: pageNum,
      totalPages: Math.ceil(totalMatching / limitNum) || 1,
      stats,
    })
  } catch (err) {
    console.error("Error in listKeywords:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to list AI keywords" })
  }
}

/**
 * 3. GET /api/ai-keywords/:id
 * Fetches a single topic by ID with tenant isolation.
 */
async function getKeywordById(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
      .populate("relatedProductIds", "name type category price")
      .populate("sourceReferences.sourceId", "title sourceType")

    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    return res.status(200).json({ success: true, topic })
  } catch (err) {
    console.error("Error in getKeywordById:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch topic" })
  }
}

/**
 * 4. PUT /api/ai-keywords/:id
 * Updates topic fields (name, category, keywords, questions, discussion points).
 */
async function updateKeyword(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    const {
      name,
      category,
      confidenceScore,
      primaryKeywords,
      synonyms,
      customerQuestions,
      productTerminology,
      discussionPoints,
      relatedProductIds,
    } = req.body || {}

    if (name !== undefined) topic.name = String(name).trim()
    if (category !== undefined) topic.category = String(category).trim()
    if (typeof confidenceScore === "number") topic.confidenceScore = Math.min(Math.max(confidenceScore, 0), 1)

    // Helper to format string or array input cleanly
    const parseArray = (input) => {
      if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean)
      if (typeof input === "string") return input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      return []
    }

    if (primaryKeywords !== undefined) topic.primaryKeywords = parseArray(primaryKeywords)
    if (synonyms !== undefined) topic.synonyms = parseArray(synonyms)
    if (customerQuestions !== undefined) topic.customerQuestions = parseArray(customerQuestions)
    if (productTerminology !== undefined) topic.productTerminology = parseArray(productTerminology)
    if (discussionPoints !== undefined) topic.discussionPoints = parseArray(discussionPoints)
    if (relatedProductIds !== undefined) topic.relatedProductIds = Array.isArray(relatedProductIds) ? relatedProductIds : []

    topic.version = (topic.version || 1) + 1
    await topic.save()

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.update",
      entity: "AIKeywordTopic",
      entityId: topic._id,
      summary: `Updated AI topic: "${topic.name}"`,
    })

    return res.status(200).json({
      success: true,
      message: "Topic updated successfully",
      topic,
    })
  } catch (err) {
    console.error("Error in updateKeyword:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to update topic" })
  }
}

/**
 * 5. PATCH /api/ai-keywords/:id/approve
 * Approves a single topic. Only APPROVED topics can be used in call analysis.
 */
async function approveKeyword(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    topic.status = "APPROVED"
    topic.approvedAt = new Date()
    topic.approvedBy = req.user?._id || null
    topic.rejectionReason = ""
    await topic.save()

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.approve",
      entity: "AIKeywordTopic",
      entityId: topic._id,
      summary: `Approved AI topic: "${topic.name}"`,
    })

    return res.status(200).json({
      success: true,
      message: "Topic approved successfully",
      topic,
    })
  } catch (err) {
    console.error("Error in approveKeyword:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to approve topic" })
  }
}

/**
 * 6. PATCH /api/ai-keywords/:id/reject
 * Rejects a topic with an optional reason.
 */
async function rejectKeyword(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params
    const { reason = "" } = req.body || {}

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    topic.status = "REJECTED"
    topic.rejectionReason = String(reason).trim().slice(0, 500)
    await topic.save()

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.reject",
      entity: "AIKeywordTopic",
      entityId: topic._id,
      summary: `Rejected AI topic: "${topic.name}"`,
      details: { reason: topic.rejectionReason },
    })

    return res.status(200).json({
      success: true,
      message: "Topic rejected successfully",
      topic,
    })
  } catch (err) {
    console.error("Error in rejectKeyword:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to reject topic" })
  }
}

/**
 * 7. POST /api/ai-keywords/bulk-approve
 * Bulk approves multiple topics by IDs.
 */
async function bulkApproveKeywords(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { ids = [] } = req.body || {}

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Please provide an array of topic IDs" })
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id))
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: "No valid topic IDs provided" })
    }

    const result = await AIKeywordTopic.updateMany(
      { _id: { $in: validIds }, tenantId },
      {
        $set: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: req.user?._id || null,
          rejectionReason: "",
        },
      }
    )

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.bulk_approve",
      entity: "AIKeywordTopic",
      summary: `Bulk approved ${result.modifiedCount} AI topics`,
      details: { count: result.modifiedCount, ids: validIds },
    })

    return res.status(200).json({
      success: true,
      message: `Successfully approved ${result.modifiedCount} topics`,
      modifiedCount: result.modifiedCount,
    })
  } catch (err) {
    console.error("Error in bulkApproveKeywords:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to bulk approve topics" })
  }
}

/**
 * 8. PATCH /api/ai-keywords/:id/archive
 * Archives a topic so it is no longer used in active operations.
 */
async function archiveKeyword(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    topic.status = "ARCHIVED"
    topic.archivedAt = new Date()
    topic.archivedBy = req.user?._id || null
    await topic.save()

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.archive",
      entity: "AIKeywordTopic",
      entityId: topic._id,
      summary: `Archived AI topic: "${topic.name}"`,
    })

    return res.status(200).json({
      success: true,
      message: "Topic archived successfully",
      topic,
    })
  } catch (err) {
    console.error("Error in archiveKeyword:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to archive topic" })
  }
}

/**
 * 9. DELETE /api/ai-keywords/:id
 * Deletes or archives a topic.
 */
async function deleteKeyword(req, res) {
  try {
    const tenantId = getTenantId(req)
    const { id } = req.params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid topic ID" })
    }

    const topic = await AIKeywordTopic.findOne({ _id: id, tenantId })
    if (!topic) {
      return res.status(404).json({ success: false, message: "Topic not found" })
    }

    await AIKeywordTopic.deleteOne({ _id: id, tenantId })

    // Audit log
    await audit.log({
      req,
      action: "ai_keyword.delete",
      entity: "AIKeywordTopic",
      entityId: topic._id,
      summary: `Deleted AI topic: "${topic.name}"`,
    })

    return res.status(200).json({
      success: true,
      message: "Topic deleted successfully",
    })
  } catch (err) {
    console.error("Error in deleteKeyword:", err)
    return res.status(500).json({ success: false, message: err.message || "Failed to delete topic" })
  }
}

module.exports = {
  generateKeywords,
  listKeywords,
  getKeywordById,
  updateKeyword,
  approveKeyword,
  rejectKeyword,
  bulkApproveKeywords,
  archiveKeyword,
  deleteKeyword,
}
