const express = require("express")
const router = express.Router()
const {
  listWorkspaces,
  createWorkspace,
  getWorkspaceById,
  updateWorkspace,
  archiveWorkspace,
  listMemberships,
  addMembership,
  removeMembership,
  toggleWorkspaceMode,
  listServiceCatalog,
  createServiceCatalogItem,
  getPublicServices,
  getMasterDashboard,
  getUnassignedQueue,
  assignUnassignedItem,
  getWorkspaceDomain,
  setWorkspaceDomain,
  verifyWorkspaceDomain,
  removeWorkspaceDomain,
} = require("../controllers/workspaceController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")

// Public service discovery (unauthenticated, siteKey authorized)
router.get("/public/services", getPublicServices)

// All downstream routes require authenticated session
router.use(authenticate)

// Organization Mode Toggle
router.post("/mode/toggle", requireAccountAdmin, toggleWorkspaceMode)

// Service Catalog Management
router.get("/service-catalog", listServiceCatalog)
router.post("/service-catalog", requireAccountAdmin, createServiceCatalogItem)

// Master Dashboard & Review Queue (Org Admin only - must precede /:workspaceId)
router.get("/dashboard/master", requireAccountAdmin, getMasterDashboard)
router.get("/unassigned/queue", requireAccountAdmin, getUnassignedQueue)
router.post("/unassigned/assign", requireAccountAdmin, assignUnassignedItem)

// Workspace CRUD
router.get("/", listWorkspaces)
router.post("/", requireAccountAdmin, createWorkspace)
router.get("/:workspaceId", getWorkspaceById)
router.put("/:workspaceId", updateWorkspace)
router.delete("/:workspaceId", requireAccountAdmin, archiveWorkspace)

// Workspace Membership Management
router.get("/:workspaceId/members", listMemberships)
router.post("/:workspaceId/members", addMembership)
router.delete("/:workspaceId/members/:userId", removeMembership)

// Workspace Custom Domain Management
router.get("/:workspaceId/domain", getWorkspaceDomain)
router.post("/:workspaceId/domain", requireAccountAdmin, setWorkspaceDomain)
router.post("/:workspaceId/domain/verify", requireAccountAdmin, verifyWorkspaceDomain)
router.delete("/:workspaceId/domain", requireAccountAdmin, removeWorkspaceDomain)

module.exports = router
