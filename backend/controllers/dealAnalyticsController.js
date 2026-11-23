const { getTenantDealMetrics } = require("../services/dealAnalytics.service")
const { getEffectiveTenant } = require("../middleware/tenantContext")

/**
 * Deal Analytics Controller - Phase 5: Deal Value & Revenue Reporting
 */
async function getDealAnalyticsHandler(req, res) {
  try {
    const { tenantId, isSuperAdmin } = getEffectiveTenant(req)
    const { startDate, endDate, agentId } = req.query

    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ success: false, error: "Authentication required" })
    }

    const metrics = await getTenantDealMetrics(tenantId, {
      startDate,
      endDate,
      agentId,
    })

    return res.status(200).json({
      success: true,
      data: metrics,
    })
  } catch (err) {
    console.error("Error in getDealAnalyticsHandler:", err)
    return res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = {
  getDealAnalyticsHandler,
}
