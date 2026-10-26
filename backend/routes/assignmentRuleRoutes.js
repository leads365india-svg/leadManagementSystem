const express = require("express")
const {
  getAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
  reorderAssignmentRules,
} = require("../controllers/assignmentRuleController")
const { authenticate, checkPermission } = require("../middleware/authMiddleware")

const router = express.Router()

// Enforce authentication on all assignment rule endpoints
router.use(authenticate)

// GET /api/assignment-rules - List tenant rules
router.get("/", checkPermission(["leads.assign", "leads.view"]), getAssignmentRules)

// POST /api/assignment-rules - Create new rule
router.post("/", checkPermission("leads.assign"), createAssignmentRule)

// POST /api/assignment-rules/reorder - Reorder rule priorities
router.post("/reorder", checkPermission("leads.assign"), reorderAssignmentRules)

// PUT /api/assignment-rules/:id - Edit rule
router.put("/:id", checkPermission("leads.assign"), updateAssignmentRule)

// DELETE /api/assignment-rules/:id - Delete rule
router.delete("/:id", checkPermission("leads.assign"), deleteAssignmentRule)

module.exports = router
