const privacyService = require("../services/privacyService")
const Lead = require("../models/Lead")
const Account = require("../models/Account")
const { getEffectiveTenant } = require("../middleware/tenantContext")
const { checkDirectObjectAccess } = require("../utils/rbacScope")

/**
 * Privacy Controller - Phase 18: Do-Not-Record, Consent & Privacy Controls
 */

/**
 * GET /api/privacy/dnr
 * Retrieves all DNR phone numbers and tags for the authenticated tenant.
 */
const getDnrRules = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant ID required" })
    }

    const rules = await privacyService.getDnrRules(tenantId)
    return res.status(200).json({
      success: true,
      data: rules,
      count: rules.length,
    })
  } catch (err) {
    console.error("[PrivacyController getDnrRules Error]:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * POST /api/privacy/dnr
 * Adds a new phone number or tag to the tenant's Do-Not-Record exclusion list.
 */
const addDnrRule = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    const { type, value, reason } = req.body || {}

    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant ID required" })
    }
    if (!type || !value) {
      return res.status(400).json({ success: false, error: "Fields 'type' ('number' | 'tag') and 'value' are required" })
    }

    const result = await privacyService.addDnrRule({
      tenantId,
      type,
      value,
      reason,
      actor: req.user,
    })

    return res.status(result.alreadyExisted ? 200 : 201).json({
      success: true,
      message: result.alreadyExisted ? "Rule already exists in DNR list" : "Added to Do-Not-Record list successfully",
      data: result.rule,
    })
  } catch (err) {
    console.error("[PrivacyController addDnrRule Error]:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

/**
 * DELETE /api/privacy/dnr/:id
 * Removes a phone number or tag from the Do-Not-Record list.
 */
const removeDnrRule = async (req, res) => {
  try {
    const { tenantId } = getEffectiveTenant(req)
    const { id } = req.params

    const result = await privacyService.removeDnrRule({
      tenantId,
      ruleId: id,
      actor: req.user,
    })

    return res.status(200).json({
      success: true,
      message: "DNR rule removed successfully",
      data: result.removedRule,
    })
  } catch (err) {
    console.error("[PrivacyController removeDnrRule Error]:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

/**
 * PATCH /api/leads/:id/privacy
 * Updates individual lead DNR switch and/or consent status.
 */
const updateLeadPrivacy = async (req, res) => {
  try {
    const { id } = req.params
    const { tenantId } = getEffectiveTenant(req)
    const { doNotRecord, consent } = req.body || {}

    const lead = await Lead.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true })
    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" })
    }

    // RBAC check: allow agents with leads.edit or owner of the lead
    const access = await checkDirectObjectAccess(req.user, lead, "leads", "edit")
    if (!access.allowed && req.user.role !== "account_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ success: false, error: "Forbidden: You do not have permission to update this lead's privacy preferences" })
    }

    const result = await privacyService.updateLeadPrivacy({
      tenantId,
      leadId: id,
      doNotRecord,
      consent,
      actor: req.user,
    })

    return res.status(200).json({
      success: true,
      message: "Lead privacy controls updated successfully",
      data: result.lead,
      changes: result.changes,
    })
  } catch (err) {
    console.error("[PrivacyController updateLeadPrivacy Error]:", err)
    return res.status(err.statusCode || 500).json({ success: false, error: err.message })
  }
}

/**
 * GET /api/mobile/privacy/rules
 * Returns active DNR rules and consent policy for the mobile agent.
 */
const getMobilePrivacyRules = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "Tenant ID required" })
    }

    const rules = await privacyService.getDnrRules(tenantId)
    const account = await Account.findOne({ tenantId }).setOptions({ skipTenantFilter: true }).lean()
    const consentPolicy = account?.metadata?.consentPolicy || "implied_disclosure"

    const numbers = rules.filter((r) => r.type === "number").map((r) => r.valueNormalized || r.value)
    const tags = rules.filter((r) => r.type === "tag").map((r) => r.valueNormalized || r.value)

    return res.status(200).json({
      success: true,
      consentPolicy,
      dnrNumbers: numbers,
      dnrTags: tags,
      rulesCount: rules.length,
    })
  } catch (err) {
    console.error("[PrivacyController getMobilePrivacyRules Error]:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = {
  getDnrRules,
  addDnrRule,
  removeDnrRule,
  updateLeadPrivacy,
  getMobilePrivacyRules,
}
