const mongoose = require("mongoose")
const AIAgentScorecard = require("../models/AIAgentScorecard")
const Call = require("../models/Call")
const RawAICallAnalysis = require("../models/AICallAnalysis")
const AICallAnalysis = RawAICallAnalysis.AICallAnalysis || RawAICallAnalysis
const RawAITranscript = require("../models/AITranscript")
const AITranscript = RawAITranscript.AITranscript || RawAITranscript
const Lead = require("../models/Lead")
const User = require("../models/User")
const { generateCallCoachingReport } = require("./aiSalesCoaching.service")

/**
 * AI Sales Scorecard Service - Phase 4: Agent Scorecards
 * 
 * Aggregates verified coaching metrics and CRM conversion outcomes for sales agents.
 * 
 * Strict Scoring Rules:
 * - Transparent scoring rubric based on factual transcript evaluations.
 * - Minimum sample size threshold: requires at least 3 completed call analyses.
 * - Missing data is never silently treated as zero; marked as INSUFFICIENT_SAMPLE.
 * - Real CRM conversion rate calculates actual 'Closed-Won' leads, not just interested calls.
 */

const MIN_SAMPLE_SIZE = 3

/**
 * Computes or refreshes an agent's scorecard.
 */
async function computeAgentScorecard({
  tenantId,
  agentId,
  period = "monthly",
  periodStart = null,
  periodEnd = null,
}) {
  if (!tenantId || !agentId) {
    throw new Error("tenantId and agentId are required to compute scorecard.")
  }

  const agentObjId = new mongoose.Types.ObjectId(agentId)

  // 1. Fetch completed calls assigned to agent in this tenant
  const callQuery = {
    tenantId,
    agentId: agentObjId,
    hasRecording: true,
  }
  if (periodStart || periodEnd) {
    callQuery.startedAt = {}
    if (periodStart) callQuery.startedAt.$gte = new Date(periodStart)
    if (periodEnd) callQuery.startedAt.$lte = new Date(periodEnd)
  }

  const calls = await Call.find(callQuery)
    .setOptions({ skipTenantFilter: true })
    .lean()

  const callIds = calls.map((c) => c._id)

  // 2. Fetch latest COMPLETED AICallAnalysis for these calls
  const analyses = await AICallAnalysis.find({
    tenantId,
    callId: { $in: callIds },
    status: "COMPLETED",
  })
    .sort({ analysisVersion: -1 })
    .setOptions({ skipTenantFilter: true })
    .lean()

  // Deduplicate analyses: retain only latest version per callId
  const latestAnalysisByCall = new Map()
  analyses.forEach((a) => {
    const key = a.callId.toString()
    if (!latestAnalysisByCall.has(key)) {
      latestAnalysisByCall.set(key, a)
    }
  })

  const validAnalyses = Array.from(latestAnalysisByCall.values())
  const sampleSize = validAnalyses.length

  // Check sample size threshold
  if (sampleSize < MIN_SAMPLE_SIZE) {
    // Persist insufficient sample scorecard
    const scorecard = await AIAgentScorecard.findOneAndUpdate(
      { tenantId, agentId: agentObjId, period },
      {
        tenantId,
        agentId: agentObjId,
        period,
        periodStart: periodStart ? new Date(periodStart) : null,
        periodEnd: periodEnd ? new Date(periodEnd) : null,
        sampleSize,
        sampleCoverage: "INSUFFICIENT_SAMPLE",
        metrics: {
          requirementDiscoveryScore: null,
          productKnowledgeScore: null,
          objectionHandlingScore: null,
          communicationClarityScore: null,
          nextStepDisciplineScore: null,
          customerEngagementScore: null,
          overallScore: null,
          conversionRate: null,
        },
        observedStrengths: ["Awaiting minimum sample of 3 analyzed calls"],
        improvementAreas: [],
        recommendedTrainingTopics: ["Foundation Sales Coaching"],
        lastCalculatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).setOptions({ skipTenantFilter: true })

    return scorecard
  }

  // 3. Evaluate coaching reports across all sample calls
  let totalReq = 0
  let totalProd = 0
  let totalObj = 0
  let totalComm = 0
  let totalNext = 0
  let totalEng = 0

  const allStrengths = new Set()
  const allImprovements = new Set()
  const allTraining = new Set()

  for (const analysis of validAnalyses) {
    const matchingCall = calls.find((c) => c._id.toString() === analysis.callId.toString())
    const coaching = await generateCallCoachingReport({
      call: matchingCall,
      analysis,
      tenantId,
    })

    const ds = coaching.dimensionScores
    if (ds.requirementDiscovery !== null) totalReq += ds.requirementDiscovery
    if (ds.productKnowledge !== null) totalProd += ds.productKnowledge
    if (ds.objectionHandling !== null) totalObj += ds.objectionHandling
    if (ds.communicationClarity !== null) totalComm += ds.communicationClarity
    if (ds.nextStepDiscipline !== null) totalNext += ds.nextStepDiscipline
    if (ds.customerEngagement !== null) totalEng += ds.customerEngagement

    coaching.strengths.forEach((s) => allStrengths.add(s.title))
    coaching.improvementAreas.forEach((i) => allImprovements.add(i.title))
    coaching.recommendedTrainingTopics.forEach((t) => allTraining.add(t))
  }

  const reqScore = Math.round(totalReq / sampleSize)
  const prodScore = Math.round(totalProd / sampleSize)
  const objScore = Math.round(totalObj / sampleSize)
  const commScore = Math.round(totalComm / sampleSize)
  const nextScore = Math.round(totalNext / sampleSize)
  const engScore = Math.round(totalEng / sampleSize)

  const overallScore = Math.round(
    reqScore * 0.20 +
    prodScore * 0.20 +
    objScore * 0.20 +
    commScore * 0.15 +
    nextScore * 0.15 +
    engScore * 0.10
  )

  // 4. Calculate Real CRM Conversion Rate
  // Find leads owned/assigned to this agent
  const agentLeads = await Lead.find({
    tenantId,
    $or: [{ assignedStaffId: agentObjId }, { ownerId: agentObjId }],
  })
    .setOptions({ skipTenantFilter: true })
    .lean()

  const totalLeads = agentLeads.length
  const closedWonCount = agentLeads.filter((l) => l.status === "Closed-Won").length
  const conversionRate = totalLeads > 0 ? Math.round((closedWonCount / totalLeads) * 100) : 0

  // 5. Persist or Update Scorecard
  const scorecard = await AIAgentScorecard.findOneAndUpdate(
    { tenantId, agentId: agentObjId, period },
    {
      tenantId,
      agentId: agentObjId,
      period,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      sampleSize,
      sampleCoverage: "SUFFICIENT",
      metrics: {
        requirementDiscoveryScore: reqScore,
        productKnowledgeScore: prodScore,
        objectionHandlingScore: objScore,
        communicationClarityScore: commScore,
        nextStepDisciplineScore: nextScore,
        customerEngagementScore: engScore,
        overallScore,
        conversionRate,
      },
      observedStrengths: Array.from(allStrengths).slice(0, 5),
      improvementAreas: Array.from(allImprovements).slice(0, 5),
      recommendedTrainingTopics: Array.from(allTraining).slice(0, 5),
      lastCalculatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).setOptions({ skipTenantFilter: true })

  return scorecard
}

/**
 * Lists all agent scorecards for a tenant with populated agent names.
 */
async function listAgentScorecards({ tenantId, period = "monthly" }) {
  if (!tenantId) {
    throw new Error("tenantId is required.")
  }

  // 1. Fetch all agents in tenant
  const agents = await User.find({
    tenantId,
    role: { $in: ["agent", "user", "manager"] },
    isActive: true,
  })
    .select("name email role")
    .setOptions({ skipTenantFilter: true })
    .lean()

  // 2. Fetch existing scorecards
  const scorecards = await AIAgentScorecard.find({ tenantId, period })
    .populate("agentId", "name email role")
    .setOptions({ skipTenantFilter: true })
    .lean()

  const scorecardMap = new Map()
  scorecards.forEach((sc) => {
    if (sc.agentId?._id) {
      scorecardMap.set(sc.agentId._id.toString(), sc)
    }
  })

  // Combine agents with scorecards
  const result = agents.map((agent) => {
    const sc = scorecardMap.get(agent._id.toString())
    if (sc) {
      return sc
    }
    return {
      tenantId,
      agentId: agent,
      period,
      sampleSize: 0,
      sampleCoverage: "INSUFFICIENT_SAMPLE",
      metrics: {
        requirementDiscoveryScore: null,
        productKnowledgeScore: null,
        objectionHandlingScore: null,
        communicationClarityScore: null,
        nextStepDisciplineScore: null,
        customerEngagementScore: null,
        overallScore: null,
        conversionRate: null,
      },
      observedStrengths: [],
      improvementAreas: [],
      recommendedTrainingTopics: [],
    }
  })

  return result
}

module.exports = {
  computeAgentScorecard,
  listAgentScorecards,
  MIN_SAMPLE_SIZE,
}
