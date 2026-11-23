const mongoose = require("mongoose")
const dotenv = require("dotenv")
const path = require("path")

dotenv.config({ path: path.join(__dirname, "../.env") })

const FollowUp = require("../models/FollowUp")
const Lead = require("../models/Lead")
const { runWithTenantContext } = require("../middleware/tenantContext")
const {
  getTenantDayBounds,
  ACTIVE_INCOMPLETE_STATUSES,
  buildTimeQuery,
} = require("../controllers/followUpController")

async function run() {
  console.log("Connecting to MongoDB...")
  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Connected successfully.")

  // 1. Check existing tenant
  const realTenantId = "ACC-3E87985C"
  const { start: startOfToday, end: endOfToday, now } = getTenantDayBounds("Asia/Kolkata")
  const activeStatusQuery = { $in: ACTIVE_INCOMPLETE_STATUSES }

  const combineReal = (extra) => {
    const andConds = [{ tenantId: realTenantId }]
    if (Array.isArray(extra)) andConds.push(...extra)
    else if (extra) andConds.push(extra)
    return andConds.length === 1 ? andConds[0] : { $and: andConds }
  }

  await runWithTenantContext({ tenantId: realTenantId }, async () => {
    const realStats = {
      total: await FollowUp.countDocuments(combineReal()),
      upcoming: await FollowUp.countDocuments(combineReal([{ status: activeStatusQuery }, buildTimeQuery({ $gt: endOfToday })])),
      overdue: await FollowUp.countDocuments(combineReal([{ status: activeStatusQuery }, buildTimeQuery({ $lt: now })])),
      today: await FollowUp.countDocuments(combineReal([{ status: activeStatusQuery }, buildTimeQuery({ $gte: startOfToday, $lte: endOfToday })])),
      completed: await FollowUp.countDocuments(combineReal({ status: "completed" })),
      pending: await FollowUp.countDocuments(combineReal({ status: activeStatusQuery })),
    }

    console.log("REAL TENANT STATS:", realStats)

    const realOverdueList = await FollowUp.find(combineReal([{ status: activeStatusQuery }, buildTimeQuery({ $lt: now })])).lean()
    console.log("REAL OVERDUE LIST COUNT:", realOverdueList.length)
    console.log("REAL MATCH OVERDUE?", realStats.overdue === realOverdueList.length)
    if (realOverdueList.length > 0) {
      console.log("Real Overdue Lead:", realOverdueList[0].customerName, "| Status:", realOverdueList[0].status, "| ScheduledAt:", realOverdueList[0].scheduledAt)
    }

    const realUpcomingList = await FollowUp.find(combineReal([{ status: activeStatusQuery }, buildTimeQuery({ $gt: endOfToday })])).lean()
    console.log("REAL UPCOMING LIST COUNT:", realUpcomingList.length)
    console.log("REAL MATCH UPCOMING?", realStats.upcoming === realUpcomingList.length)
  })

  // 2. Synthetic Test
  const testTenantId = "ACC-TEST-VERIFY-" + Date.now()
  console.log("\n--- Testing Synthetic Tenant:", testTenantId, "---")

  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const todayDate = new Date(Math.min(endOfToday.getTime() - 60000, now.getTime() + 30 * 60 * 1000))

  await runWithTenantContext({ tenantId: testTenantId }, async () => {
    const dummyLead = await Lead.create({
      tenantId: testTenantId,
      name: "Synthetic Lead",
      phone: "+919999900000",
      email: "synthetic@test.com",
      status: "New",
    })

    await FollowUp.insertMany([
      {
        tenantId: testTenantId,
        leadId: dummyLead._id,
        customerName: "Overdue Test Client",
        customerPhone: "+919999900001",
        scheduledAt: pastDate,
        status: "due",
        type: "call",
        priority: "high",
      },
      {
        tenantId: testTenantId,
        leadId: dummyLead._id,
        customerName: "Upcoming Test Client",
        customerPhone: "+919999900002",
        scheduledAt: futureDate,
        status: "pending",
        type: "meeting",
        priority: "medium",
      },
      {
        tenantId: testTenantId,
        leadId: dummyLead._id,
        customerName: "Today Test Client",
        customerPhone: "+919999900003",
        scheduledAt: todayDate,
        status: "pending",
        type: "call",
        priority: "high",
      },
      {
        tenantId: testTenantId,
        leadId: dummyLead._id,
        customerName: "Completed Test Client",
        customerPhone: "+919999900004",
        scheduledAt: pastDate,
        status: "completed",
        type: "email",
        priority: "low",
      },
      {
        tenantId: testTenantId,
        leadId: dummyLead._id,
        customerName: "Cancelled Test Client",
        customerPhone: "+919999900005",
        scheduledAt: pastDate,
        status: "cancelled",
        type: "task",
        priority: "low",
      },
    ])

    try {
      const combineTest = (extra) => {
        const andConds = [{ tenantId: testTenantId }]
        if (Array.isArray(extra)) andConds.push(...extra)
        else if (extra) andConds.push(extra)
        return andConds.length === 1 ? andConds[0] : { $and: andConds }
      }

      const testStats = {
        total: await FollowUp.countDocuments(combineTest()),
        upcoming: await FollowUp.countDocuments(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $gt: endOfToday })])),
        overdue: await FollowUp.countDocuments(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $lt: now })])),
        today: await FollowUp.countDocuments(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $gte: startOfToday, $lte: endOfToday })])),
        completed: await FollowUp.countDocuments(combineTest({ status: "completed" })),
        pending: await FollowUp.countDocuments(combineTest({ status: activeStatusQuery })),
      }

      const testOverdueList = await FollowUp.find(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $lt: now })])).lean()
      const testUpcomingList = await FollowUp.find(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $gt: endOfToday })])).lean()
      const testTodayList = await FollowUp.find(combineTest([{ status: activeStatusQuery }, buildTimeQuery({ $gte: startOfToday, $lte: endOfToday })])).lean()
      const testCompletedList = await FollowUp.find(combineTest({ status: "completed" })).lean()
      const testPendingList = await FollowUp.find(combineTest({ status: activeStatusQuery })).lean()
      const testTotalList = await FollowUp.find(combineTest()).lean()

      console.log("SYNTHETIC STATS:", testStats)
      console.log("Matches:", {
        overdue: testStats.overdue === testOverdueList.length,
        upcoming: testStats.upcoming === testUpcomingList.length,
        today: testStats.today === testTodayList.length,
        completed: testStats.completed === testCompletedList.length,
        pending: testStats.pending === testPendingList.length,
        total: testStats.total === testTotalList.length,
      })

      if (
        testStats.overdue === 1 &&
        testOverdueList.length === 1 &&
        testStats.upcoming === 1 &&
        testUpcomingList.length === 1 &&
        testStats.today === 1 &&
        testTodayList.length === 1 &&
        testStats.completed === 1 &&
        testCompletedList.length === 1 &&
        testStats.pending === 3 &&
        testPendingList.length === 3 &&
        testStats.total === 5 &&
        testTotalList.length === 5
      ) {
        console.log("✅ ALL CONSISTENCY ASSERTIONS PASSED PERFECTLY!")
      } else {
        console.error("❌ ASSERTION FAILURE IN CONSISTENCY!")
        process.exitCode = 1
      }
    } finally {
      // Clean up synthetic documents
      await FollowUp.deleteMany({ tenantId: testTenantId })
      await Lead.deleteMany({ tenantId: testTenantId })
      console.log("Cleaned up synthetic test records.")
    }
  })

  await mongoose.disconnect()
  console.log("Disconnected from MongoDB.")
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
