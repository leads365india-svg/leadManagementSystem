const RawAICallAnalysis = require("../models/AICallAnalysis")
const AICallAnalysis = RawAICallAnalysis.AICallAnalysis || RawAICallAnalysis
const Call = require("../models/Call")
const Lead = require("../models/Lead")
const FollowUp = require("../models/FollowUp")
const RawAILeadPriority = require("../models/AILeadPriority")
const AILeadPriority = RawAILeadPriority.AILeadPriority || RawAILeadPriority
const RawAIKeywordTopic = require("../models/AIKeywordTopic")
const AIKeywordTopic = RawAIKeywordTopic.AIKeywordTopic || RawAIKeywordTopic

/**
 * AI Business Insights & Sales Intelligence Service - Phase 4: Modules A & E
 * 
 * Provides scalable, server-side MongoDB aggregation pipelines for:
 * - Sales Performance KPIs & Conversion Funnel
 * - Customer objection distribution & competitive mentions
 * - Approved topic coverage & knowledge gap identification
 * - Agent outcome & conversion tracking
 * 
 * Performance & Scalability Rules:
 * - Aggregations execute directly on MongoDB; raw audio and full transcripts are never loaded into memory.
 * - Deduplicates repeated analysis versions to prevent double-counting.
 * - Conversion metrics strictly reflect real CRM Closed-Won states.
 */

async function getSalesIntelligenceDashboard({
  tenantId,
  dateRange = "all",
  agentId = null,
  callOutcome = null,
  topic = null,
}) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  // 1. Construct Date Boundary
  let startDate = null
  const now = new Date()
  if (dateRange === "today") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  } else if (dateRange === "week") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (dateRange === "month") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  // 2. Build Analysis Match Filter
  const matchFilter = {
    tenantId,
    status: "COMPLETED",
  }
  if (startDate) {
    matchFilter.createdAt = { $gte: startDate }
  }
  if (callOutcome && callOutcome !== "all") {
    matchFilter.callOutcome = callOutcome
  }
  if (topic && topic !== "all") {
    matchFilter["topicMatches.topicName"] = topic
  }

  // 3. Aggregate Canonical Latest Analyses
  const analysisPipeline = [
    { $match: matchFilter },
    { $sort: { analysisVersion: -1 } },
    {
      $group: {
        _id: "$callId",
        latestAnalysis: { $first: "$$ROOT" },
      },
    },
    { $replaceRoot: { newRoot: "$latestAnalysis" } },
  ]

  const analyses = await AICallAnalysis.aggregate(analysisPipeline)
  const callIds = analyses.map((a) => a.callId)

  // 4. Fetch Associated Calls for Agent and Duration aggregation
  const callMatch = {
    tenantId,
    _id: { $in: callIds },
  }
  if (agentId && agentId !== "all") {
    callMatch.agentId = new mongoose.Types.ObjectId(agentId)
  }

  const calls = await Call.find(callMatch)
    .populate("agentId", "name email role")
    .setOptions({ skipTenantFilter: true })
    .lean()

  const validCallIdSet = new Set(calls.map((c) => c._id.toString()))
  const filteredAnalyses = analyses.filter((a) => validCallIdSet.has(a.callId.toString()))

  // 5. Total Eligible Recorded Calls
  const totalEligibleCalls = await Call.countDocuments({
    tenantId,
    hasRecording: true,
  }).setOptions({ skipTenantFilter: true })

  // 6. Real CRM Conversion Counts from Lead collection
  const leadMatch = { tenantId }
  if (startDate) leadMatch.createdAt = { $gte: startDate }

  const [totalLeads, convertedLeadsCount, lostLeadsCount] = await Promise.all([
    Lead.countDocuments(leadMatch).setOptions({ skipTenantFilter: true }),
    Lead.countDocuments({ ...leadMatch, status: "Closed-Won" }).setOptions({ skipTenantFilter: true }),
    Lead.countDocuments({ ...leadMatch, status: "Closed-Lost" }).setOptions({ skipTenantFilter: true }),
  ])

  // 7. Follow-Up Metrics
  const followUpMatch = { tenantId }
  if (startDate) followUpMatch.createdAt = { $gte: startDate }

  const [totalFollowUps, completedFollowUps] = await Promise.all([
    FollowUp.countDocuments(followUpMatch).setOptions({ skipTenantFilter: true }),
    FollowUp.countDocuments({ ...followUpMatch, status: "completed" }).setOptions({ skipTenantFilter: true }),
  ])

  const followUpCompletionRate = totalFollowUps > 0 ? Math.round((completedFollowUps / totalFollowUps) * 100) : 0

  // 8. High-Intent Leads Count
  const highIntentLeadsCount = await AILeadPriority.countDocuments({
    tenantId,
    priorityCategory: "HIGH_INTENT",
    status: { $in: ["ACTIVE", "ACCEPTED"] },
  }).setOptions({ skipTenantFilter: true })

  // 9. Compute Breakdown Statistics
  const outcomeDistribution = {}
  const sentimentTrends = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, MIXED: 0 }
  const objectionCounts = {}
  const productInterestCounts = {}
  const topicCounts = {}
  let totalDurationSecs = 0
  let qualifiedCallsCount = 0
  let followUpsRequiredCount = 0

  const callMap = new Map(calls.map((c) => [c._id.toString(), c]))
  const agentStatsMap = new Map()

  filteredAnalyses.forEach((a) => {
    // Outcomes
    const oc = a.callOutcome || "UNRESOLVED"
    outcomeDistribution[oc] = (outcomeDistribution[oc] || 0) + 1
    if (["INTERESTED", "DEAL_CLOSED", "FOLLOW_UP_REQUIRED"].includes(oc)) {
      qualifiedCallsCount++
    }
    if (["FOLLOW_UP_REQUIRED", "CALL_BACK_LATER"].includes(oc)) {
      followUpsRequiredCount++
    }

    // Sentiment
    const s = a.sentiment || "NEUTRAL"
    if (sentimentTrends[s] !== undefined) sentimentTrends[s]++

    // Objections
    if (Array.isArray(a.objections)) {
      a.objections.forEach((obj) => {
        const clean = obj.trim()
        if (clean) objectionCounts[clean] = (objectionCounts[clean] || 0) + 1
      })
    }

    // Product Interests
    if (Array.isArray(a.productInterests)) {
      a.productInterests.forEach((prod) => {
        const clean = prod.trim()
        if (clean) productInterestCounts[clean] = (productInterestCounts[clean] || 0) + 1
      })
    }

    // Matched Topics
    if (Array.isArray(a.topicMatches)) {
      a.topicMatches.forEach((tm) => {
        if (tm.topicName) {
          topicCounts[tm.topicName] = (topicCounts[tm.topicName] || 0) + 1
        }
      })
    }

    // Associated Call Info
    const c = callMap.get(a.callId.toString())
    if (c) {
      totalDurationSecs += c.recording?.duration || c.duration || 0
      const agentIdKey = c.agentId?._id?.toString() || "unassigned"
      const agentName = c.agentId?.name || "Unassigned"

      if (!agentStatsMap.has(agentIdKey)) {
        agentStatsMap.set(agentIdKey, {
          agentId: agentIdKey,
          name: agentName,
          totalCalls: 0,
          qualifiedCalls: 0,
          durations: 0,
        })
      }
      const st = agentStatsMap.get(agentIdKey)
      st.totalCalls++
      st.durations += c.recording?.duration || c.duration || 0
      if (["INTERESTED", "DEAL_CLOSED", "FOLLOW_UP_REQUIRED"].includes(oc)) {
        st.qualifiedCalls++
      }
    }
  })

  const analyzedSalesCalls = filteredAnalyses.length
  const averageCallDuration = analyzedSalesCalls > 0 ? Math.round(totalDurationSecs / analyzedSalesCalls) : 0
  const callAnalysisCompletionRate = totalEligibleCalls > 0 ? Math.round((analyzedSalesCalls / totalEligibleCalls) * 100) : 0

  // 10. Funnel Construction
  const conversionFunnel = [
    { stage: "Total Leads", count: totalLeads },
    { stage: "Calls Handled", count: analyzedSalesCalls },
    { stage: "Qualified Inquiries", count: qualifiedCallsCount },
    { stage: "Closed-Won Deals", count: convertedLeadsCount },
  ]

  // Top Objections Formatted
  const topObjections = Object.entries(objectionCounts)
    .map(([objection, count]) => ({ objection, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Top Products Formatted
  const topProducts = Object.entries(productInterestCounts)
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Top Topics Formatted
  const topApprovedTopics = Object.entries(topicCounts)
    .map(([topicName, count]) => ({ topicName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Agent Performance List
  const agentPerformance = Array.from(agentStatsMap.values()).map((ag) => ({
    agentId: ag.agentId,
    name: ag.name,
    totalCalls: ag.totalCalls,
    qualifiedCalls: ag.qualifiedCalls,
    qualificationRate: ag.totalCalls > 0 ? Math.round((ag.qualifiedCalls / ag.totalCalls) * 100) : 0,
    averageDuration: ag.totalCalls > 0 ? Math.round(ag.durations / ag.totalCalls) : 0,
  }))

  return {
    kpis: {
      analyzedSalesCalls,
      qualifiedCalls: qualifiedCallsCount,
      convertedLeads: convertedLeadsCount,
      lostOpportunities: lostLeadsCount,
      followUpsRequired: followUpsRequiredCount,
      highIntentLeads: highIntentLeadsCount,
      averageCallDuration,
      callAnalysisCompletionRate,
      followUpCompletionRate,
    },
    outcomeDistribution,
    sentimentTrends,
    conversionFunnel,
    agentPerformance,
    objectionDistribution: topObjections,
    productInterestDistribution: topProducts,
    approvedTopicFrequency: topApprovedTopics,
  }
}

/**
 * Obtains topic-level intelligence cross-referencing approved topics.
 */
async function getTopicIntelligence({ tenantId }) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  // 1. Fetch only APPROVED topics for tenant
  const approvedTopics = await AIKeywordTopic.find({
    tenantId,
    status: "APPROVED",
  })
    .select("name category primaryKeywords")
    .setOptions({ skipTenantFilter: true })
    .lean()

  // 2. Aggregate matched topics across completed analyses
  const topicStats = await AICallAnalysis.aggregate([
    { $match: { tenantId, status: "COMPLETED" } },
    { $unwind: "$topicMatches" },
    {
      $group: {
        _id: "$topicMatches.topicId",
        topicName: { $first: "$topicMatches.topicName" },
        frequency: { $sum: 1 },
        avgConfidence: { $avg: "$topicMatches.confidenceScore" },
      },
    },
    { $sort: { frequency: -1 } },
  ])

  const statsMap = new Map(topicStats.map((ts) => [ts._id?.toString(), ts]))

  const frequentlyDiscussed = []
  const rarelyDiscussed = []

  approvedTopics.forEach((t) => {
    const stat = statsMap.get(t._id.toString())
    const count = stat?.frequency || 0
    const item = {
      topicId: t._id,
      name: t.name,
      category: t.category,
      frequency: count,
      avgConfidence: stat?.avgConfidence ? Math.round(stat.avgConfidence * 100) : null,
    }
    if (count >= 2) {
      frequentlyDiscussed.push(item)
    } else {
      rarelyDiscussed.push(item)
    }
  })

  return {
    totalApprovedTopics: approvedTopics.length,
    frequentlyDiscussed: frequentlyDiscussed.sort((a, b) => b.frequency - a.frequency),
    rarelyDiscussed: rarelyDiscussed.sort((a, b) => a.frequency - b.frequency),
  }
}

module.exports = {
  getSalesIntelligenceDashboard,
  getTopicIntelligence,
}
