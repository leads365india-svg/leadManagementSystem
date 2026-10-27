const { Router } = require("express")
const {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
} = require("../controllers/teamController")
const { authenticate, requirePermission } = require("../middleware/authMiddleware")

const router = Router()

// All team endpoints require authentication
router.use(authenticate)

// List teams available to all authenticated tenant users
router.get("/", getTeams)

// Team management requires teams.manage permission
router.post("/", requirePermission("teams.manage"), createTeam)
router.put("/:id", requirePermission("teams.manage"), updateTeam)
router.delete("/:id", requirePermission("teams.manage"), deleteTeam)

module.exports = router

