const express = require("express")
const {
  getCustomFields,
  getCustomFieldById,
  createCustomField,
  updateCustomField,
  deleteCustomField,
} = require("../controllers/customFieldController")
const { authenticate, requireAccountAdmin } = require("../middleware/authMiddleware")

const router = express.Router()

// All custom field routes require authenticated tenant session
router.get("/", authenticate, getCustomFields)
router.post("/", authenticate, requireAccountAdmin, createCustomField)
router.get("/:id", authenticate, getCustomFieldById)
router.put("/:id", authenticate, requireAccountAdmin, updateCustomField)
router.delete("/:id", authenticate, requireAccountAdmin, deleteCustomField)

module.exports = router
