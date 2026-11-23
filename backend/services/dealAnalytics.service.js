const mongoose = require("mongoose")
const Lead = require("../models/Lead")

/**
 * Deal Analytics Service - Phase 5: Deal Value & Revenue Reporting
 * 
 * Aggregates revenue and deal metrics strictly scoped to the authenticated tenant.
 * Enforces rule: ONLY confirmed Closed-Won deals count toward closing revenue.
 */

async function getTenantDealMetrics(tenantId, options = {}) {
  if (!tenantId) {
    throw new Error("tenantId is required for deal metrics")
  }

  const cleanTenantId = String(tenantId).trim()
  const { startDate = null, endDate = null, agentId = null } = options

  const dateFilter = {}
  if (startDate || endDate) {
    dateFilter.closedAt = {}
    if (startDate) dateFilter.closedAt.$gte = new Date(startDate)
    if (endDate) dateFilter.closedAt.$lte = new Date(endDate)
  }

  // Base match filter for Won deals within tenant
  const wonMatch = {
    tenantId: cleanTenantId,
    status: "Closed-Won",
    deletedAt: null,
    ...(agentId ? { $or: [{ ownerId: new mongoose.Types.ObjectId(agentId) }, { closedBy: new mongoose.Types.ObjectId(agentId) }] } : {}),
    ...dateFilter,
  }

  // All active deals match for pipeline overview
  const allDealsMatch = {
    tenantId: cleanTenantId,
    deletedAt: null,
    ...(agentId ? { ownerId: new mongoose.Types.ObjectId(agentId) } : {}),
  }

  const [wonAggregation, pipelineOverview, agentBreakdown, productBreakdown, recentWonDeals] = await Promise.all([
    // 1. Won Revenue Totals
    Lead.aggregate([
      { $match: wonMatch },
      {
        $group: {
          _id: null,
          totalWonRevenue: {
            $sum: {
              $cond: [
                { $gt: ["$closedWonAmount", 0] },
                "$closedWonAmount",
                { $ifNull: ["$expectedDealAmount", 0] },
              ],
            },
          },
          wonDealsCount: { $sum: 1 },
          averageDealSize: {
            $avg: {
              $cond: [
                { $gt: ["$closedWonAmount", 0] },
                "$closedWonAmount",
                { $ifNull: ["$expectedDealAmount", 0] },
              ],
            },
          },
        },
      },
    ]),

    // 2. Open vs Won vs Lost Pipeline
    Lead.aggregate([
      { $match: allDealsMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          expectedRevenue: { $sum: { $ifNull: ["$expectedDealAmount", 0] } },
        },
      },
    ]),

    // 3. Agent-wise Closing Revenue
    Lead.aggregate([
      { $match: wonMatch },
      {
        $group: {
          _id: {
            agentId: { $ifNull: ["$closedBy", "$ownerId"] },
            agentName: { $ifNull: ["$closedByName", "$assignedTo"] },
          },
          revenue: {
            $sum: {
              $cond: [
                { $gt: ["$closedWonAmount", 0] },
                "$closedWonAmount",
                { $ifNull: ["$expectedDealAmount", 0] },
              ],
            },
          },
          wonDealsCount: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 15 },
    ]),

    // 4. Product-wise Closing Revenue (from metadata.aiCustomerRequestedProduct or source)
    Lead.aggregate([
      { $match: wonMatch },
      {
        $group: {
          _id: { $ifNull: ["$metadata.aiCustomerRequestedProduct", "$metadata.productInterest", "General Software"] },
          revenue: {
            $sum: {
              $cond: [
                { $gt: ["$closedWonAmount", 0] },
                "$closedWonAmount",
                { $ifNull: ["$expectedDealAmount", 0] },
              ],
            },
          },
          wonDealsCount: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),

    // 5. Recent Won Deals List
    Lead.find(wonMatch)
      .select("name email phone company closedWonAmount expectedDealAmount currency closedAt closedByName status")
      .sort({ closedAt: -1, updatedAt: -1 })
      .limit(10)
      .setOptions({ skipTenantFilter: true })
      .lean(),
  ])

  const wonStats = wonAggregation[0] || {
    totalWonRevenue: 0,
    wonDealsCount: 0,
    averageDealSize: 0,
  }

  let totalExpectedPipeline = 0
  let openDealsCount = 0
  let lostDealsCount = 0

  for (const p of pipelineOverview) {
    if (p._id !== "Closed-Won" && p._id !== "Closed-Lost") {
      totalExpectedPipeline += p.expectedRevenue || 0
      openDealsCount += p.count || 0
    } else if (p._id === "Closed-Lost") {
      lostDealsCount += p.count || 0
    }
  }

  return {
    totalWonRevenue: Math.round(wonStats.totalWonRevenue || 0),
    wonDealsCount: wonStats.wonDealsCount || 0,
    averageDealSize: Math.round(wonStats.averageDealSize || 0),
    currency: "INR",
    pipeline: {
      totalExpectedPipeline: Math.round(totalExpectedPipeline),
      openDealsCount,
      lostDealsCount,
    },
    agentWiseClosingRevenue: agentBreakdown.map((a) => ({
      agentId: a._id.agentId,
      agentName: a._id.agentName || "Unassigned",
      revenue: Math.round(a.revenue),
      wonDealsCount: a.wonDealsCount,
    })),
    productWiseClosingRevenue: productBreakdown.map((p) => ({
      productName: p._id || "General Software",
      revenue: Math.round(p.revenue),
      wonDealsCount: p.wonDealsCount,
    })),
    recentWonDeals,
  }
}

module.exports = {
  getTenantDealMetrics,
  computeTenantDealAnalytics: getTenantDealMetrics,
}
