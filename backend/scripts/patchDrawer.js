const fs = require("fs")
const path = require("path")

const drawerPath = path.resolve(__dirname, "../../frontend/components/lead-detail-drawer.jsx")
let content = fs.readFileSync(drawerPath, "utf8")

// 1. Add onLeadUpdatedRef and fix fetchLeadDetails
const oldBlock1 = `  // Update lead when initialLead or leadId changes
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead)
    }
  }, [initialLead])

  // Fetch full lead details on drawer open
  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return
    try {
      setLoading(true)
      const res = await apiClient.getLeadById(leadId)
      if (res.success && res.data) {
        setLead(res.data)
        if (onLeadUpdated) onLeadUpdated(res.data)
      }
    } catch (err) {
      console.error("Failed to load lead details:", err)
      // If initialLead exists, we keep it as fallback
    } finally {
      setLoading(false)
    }
  }, [leadId, onLeadUpdated])`

const newBlock1 = `  const onLeadUpdatedRef = useRef(onLeadUpdated)
  useEffect(() => {
    onLeadUpdatedRef.current = onLeadUpdated
  })

  // Update lead when initialLead or leadId changes (keyed by ID to prevent loop)
  const initialLeadId = initialLead?._id || initialLead?.id
  useEffect(() => {
    if (initialLead) {
      setLead(initialLead)
    }
  }, [initialLeadId])

  // Fetch full lead details on drawer open (Passive read: does NOT notify parent to avoid cascading re-renders)
  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return
    try {
      setLoading(true)
      const res = await apiClient.getLeadById(leadId)
      if (res.success && res.data) {
        setLead(res.data)
      }
    } catch (err) {
      console.error("Failed to load lead details:", err)
      // If initialLead exists, we keep it as fallback
    } finally {
      setLoading(false)
    }
  }, [leadId])`

// 2. Fix drawer open useEffect dependencies
const oldBlock2 = `  useEffect(() => {
    if (isOpen && leadId) {
      fetchLeadDetails()
      fetchLeadFollowUps()
      fetchLeadActivities()
      fetchLeadCalls()
    }
  }, [isOpen, leadId, fetchLeadDetails, fetchLeadFollowUps, fetchLeadActivities, fetchLeadCalls])`

const newBlock2 = `  useEffect(() => {
    if (isOpen && leadId) {
      fetchLeadDetails()
      fetchLeadFollowUps()
      fetchLeadActivities()
      fetchLeadCalls()
    }
  }, [isOpen, leadId])`

// Normalize \r\n to \n for replacement
const normalizedContent = content.replace(/\r\n/g, "\n")
const normalizedOld1 = oldBlock1.replace(/\r\n/g, "\n")
const normalizedNew1 = newBlock1.replace(/\r\n/g, "\n")
const normalizedOld2 = oldBlock2.replace(/\r\n/g, "\n")
const normalizedNew2 = newBlock2.replace(/\r\n/g, "\n")

if (!normalizedContent.includes(normalizedOld1)) {
  console.error("Could not find oldBlock1 in file")
  process.exit(1)
}
if (!normalizedContent.includes(normalizedOld2)) {
  console.error("Could not find oldBlock2 in file")
  process.exit(1)
}

const updated = normalizedContent
  .replace(normalizedOld1, normalizedNew1)
  .replace(normalizedOld2, normalizedNew2)

fs.writeFileSync(drawerPath, updated, "utf8")
console.log("Successfully patched lead-detail-drawer.jsx!")
