const fs = require('fs');
const filePath = 'frontend/app/settings/lead-feeds/lead-feeds-client.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add icons to lucide-react import
const iconTarget = `  LayoutGrid,
  ArrowUpRight,
} from "lucide-react"`;

const iconReplacement = `  LayoutGrid,
  ArrowUpRight,
  Plus,
  Trash2,
  Terminal,
  PlayCircle,
  Edit3,
} from "lucide-react"`;

// 2. Add state hooks after line 116
const stateTarget = `  const [showRotateSiteKeyModal, setShowRotateSiteKeyModal] = useState(false)`;

const stateReplacement = `  const [showRotateSiteKeyModal, setShowRotateSiteKeyModal] = useState(false)

  // ========================================================
  // Multi-Platform Website Integrations Studio State
  // ========================================================
  const [websiteIntegrations, setWebsiteIntegrations] = useState([])
  const [loadingIntegrations, setLoadingIntegrations] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSnippetsModal, setShowSnippetsModal] = useState(false)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [showTestModal, setShowTestModal] = useState(false)
  const [integrationSnippets, setIntegrationSnippets] = useState(null)
  const [loadingSnippets, setLoadingSnippets] = useState(false)
  const [testingIntegration, setTestingIntegration] = useState(false)
  const [integrationTestResult, setIntegrationTestResult] = useState(null)
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState("all")
  const [activeSnippetTab, setActiveSnippetTab] = useState("wordpress")
  const [copiedSnippetCode, setCopiedSnippetCode] = useState(false)

  // Creation form state
  const [createForm, setCreateForm] = useState({
    name: "",
    type: "wordpress",
    websiteDomain: "",
    allowedOrigins: "",
    defaultStatus: "New",
    leadSource: "",
    assignedStaffId: "unassigned",
  })
  const [creatingIntegration, setCreatingIntegration] = useState(false)
  const [createdIntegrationCredentials, setCreatedIntegrationCredentials] = useState(null)

  // Field mapping state
  const [editingMappings, setEditingMappings] = useState([])
  const [savingMappings, setSavingMappings] = useState(false)

  // Custom test payload state
  const [testPayloadText, setTestPayloadText] = useState("")`;

// 3. Add handler functions before loadIndiaMartStatus
const handlersTarget = `  // Load IndiaMART Status`;

const handlersReplacement = `  // Load Website Integrations
  const fetchWebsiteIntegrations = useCallback(async () => {
    try {
      setLoadingIntegrations(true)
      const res = await apiClient.getIntegrations()
      if (res && res.success) {
        const all = res.data || []
        const websiteTypes = ["website", "wordpress", "html", "php", "react", "nextjs", "webhook", "generic"]
        const filtered = all.filter((i) => websiteTypes.includes(i.type))
        setWebsiteIntegrations(filtered)
      }
    } catch (err) {
      console.error("Failed to load website integrations:", err)
    } finally {
      setLoadingIntegrations(false)
    }
  }, [])

  // Create new integration
  const handleCreateIntegration = async (e) => {
    e.preventDefault()
    if (!createForm.name.trim()) {
      toast.error("Please enter a name for the integration")
      return
    }

    try {
      setCreatingIntegration(true)
      const origins = createForm.allowedOrigins
        ? createForm.allowedOrigins.split(/[\\n,]+/).map((o) => o.trim()).filter(Boolean)
        : []

      const payload = {
        name: createForm.name.trim(),
        type: createForm.type,
        assignedStaffId: createForm.assignedStaffId,
        settings: {
          websiteDomain: createForm.websiteDomain.trim(),
          allowedOrigins: origins,
          defaultStatus: createForm.defaultStatus,
          leadSource: createForm.leadSource.trim() || undefined,
          duplicateHandling: "reject",
        },
      }

      const res = await apiClient.createIntegration(payload)
      if (res && res.success) {
        toast.success("Website integration created successfully!")
        setCreatedIntegrationCredentials({
          rawApiKey: res.rawApiKey,
          siteKey: res.siteKey || res.data?.siteKey,
          name: res.data?.name,
          type: res.data?.type,
        })
        fetchWebsiteIntegrations()
      } else {
        toast.error(res?.error || "Failed to create integration")
      }
    } catch (err) {
      toast.error(err.message || "Failed to create integration")
    } finally {
      setCreatingIntegration(false)
    }
  }

  // Open Code Snippets modal
  const handleOpenSnippets = async (integration) => {
    setSelectedIntegration(integration)
    setShowSnippetsModal(true)
    setActiveSnippetTab(integration.type || "wordpress")
    try {
      setLoadingSnippets(true)
      const res = await apiClient.getIntegrationSnippets(integration.id || integration._id)
      if (res && res.success && res.data) {
        setIntegrationSnippets(res.data.snippets)
      }
    } catch (err) {
      toast.error("Failed to load integration code snippets")
    } finally {
      setLoadingSnippets(false)
    }
  }

  // Open Field Mapping modal
  const handleOpenMapping = (integration) => {
    setSelectedIntegration(integration)
    setEditingMappings(
      Array.isArray(integration.fieldMapping) && integration.fieldMapping.length > 0
        ? JSON.parse(JSON.stringify(integration.fieldMapping))
        : [
            { sourceField: "name", targetField: "name", transform: "trim", defaultValue: "" },
            { sourceField: "email", targetField: "email", transform: "lowercase", defaultValue: "" },
            { sourceField: "phone", targetField: "phone", transform: "phone_e164", defaultValue: "" },
            { sourceField: "message", targetField: "message", transform: "trim", defaultValue: "" },
          ]
    )
    setShowMappingModal(true)
  }

  // Save Field Mappings
  const handleSaveMapping = async () => {
    if (!selectedIntegration) return
    try {
      setSavingMappings(true)
      const validMappings = editingMappings.filter((m) => m.sourceField && m.targetField)
      const res = await apiClient.updateIntegration(selectedIntegration.id || selectedIntegration._id, {
        fieldMapping: validMappings,
      })
      if (res && res.success) {
        toast.success("Field mapping updated successfully!")
        setShowMappingModal(false)
        fetchWebsiteIntegrations()
      } else {
        toast.error(res?.error || "Failed to update field mappings")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update field mappings")
    } finally {
      setSavingMappings(false)
    }
  }

  // Open Test Modal
  const handleOpenTest = (integration) => {
    setSelectedIntegration(integration)
    setIntegrationTestResult(null)
    setTestPayloadText(
      JSON.stringify(
        {
          name: "Test Lead (" + integration.name + ")",
          email: "test.lead@example.com",
          phone: "+919876543210",
          message: "Testing website lead ingestion pipeline",
          source: integration.settings?.leadSource || "Website Test",
        },
        null,
        2
      )
    )
    setShowTestModal(true)
  }

  // Run Test
  const handleRunTest = async () => {
    if (!selectedIntegration) return
    try {
      setTestingIntegration(true)
      let parsed = {}
      try {
        parsed = JSON.parse(testPayloadText)
      } catch (e) {
        toast.error("Invalid JSON payload: " + e.message)
        return
      }

      const res = await apiClient.testIntegration(selectedIntegration.id || selectedIntegration._id, parsed)
      if (res && res.success) {
        setIntegrationTestResult(res.data)
        toast.success("Test lead simulation executed successfully!")
      } else {
        toast.error(res?.error || "Test simulation failed")
      }
    } catch (err) {
      toast.error(err.message || "Test lead failed")
    } finally {
      setTestingIntegration(false)
    }
  }

  // Toggle active/inactive
  const handleToggleIntegrationStatus = async (integration) => {
    const newStatus = integration.status === "active" ? "inactive" : "active"
    try {
      const res = await apiClient.updateIntegration(integration.id || integration._id, {
        status: newStatus,
      })
      if (res && res.success) {
        toast.success(\`Integration marked as \${newStatus}\`)
        fetchWebsiteIntegrations()
      }
    } catch (err) {
      toast.error("Failed to update status")
    }
  }

  // Rotate Key
  const handleRotateIntegrationKey = async (integration) => {
    if (!confirm(\`Are you sure you want to rotate the API key for "\${integration.name}"? The existing key will be immediately invalidated.\`)) {
      return
    }
    try {
      const res = await apiClient.rotateIntegrationApiKey(integration.id || integration._id)
      if (res && res.success) {
        toast.success("API key rotated successfully!")
        setNewlyGeneratedKey(res.data?.rawApiKey)
        setShowRotateModal(true)
        fetchWebsiteIntegrations()
      }
    } catch (err) {
      toast.error("Failed to rotate key")
    }
  }

  // Delete Integration
  const handleDeleteIntegration = async (integration) => {
    if (!confirm(\`Are you sure you want to delete "\${integration.name}"? Incoming submissions from this website will be rejected.\`)) {
      return
    }
    try {
      const res = await apiClient.deleteIntegration(integration.id || integration._id)
      if (res && res.success) {
        toast.success("Integration deleted successfully")
        fetchWebsiteIntegrations()
      }
    } catch (err) {
      toast.error("Failed to delete integration")
    }
  }

  // Load IndiaMART Status`;

// 4. Update loadAllStatuses and activeTab === "website"
const statusTarget = `      await Promise.allSettled([
        loadSettings(),
        loadIndiaMartStatus(),`;

const statusReplacement = `      await Promise.allSettled([
        loadSettings(),
        fetchWebsiteIntegrations(),
        loadIndiaMartStatus(),`;

const tabTarget = `    } else if (activeTab === "website") {
      loadSettings()
    } else if (activeTab === "indiamart") {`;

const tabReplacement = `    } else if (activeTab === "website") {
      loadSettings()
      fetchWebsiteIntegrations()
    } else if (activeTab === "indiamart") {`;

let normalized = content.replace(/\r\n/g, '\n');
let t1 = iconTarget.replace(/\r\n/g, '\n');
let r1 = iconReplacement.replace(/\r\n/g, '\n');
let t2 = stateTarget.replace(/\r\n/g, '\n');
let r2 = stateReplacement.replace(/\r\n/g, '\n');
let t3 = handlersTarget.replace(/\r\n/g, '\n');
let r3 = handlersReplacement.replace(/\r\n/g, '\n');
let t4 = statusTarget.replace(/\r\n/g, '\n');
let r4 = statusReplacement.replace(/\r\n/g, '\n');
let t5 = tabTarget.replace(/\r\n/g, '\n');
let r5 = tabReplacement.replace(/\r\n/g, '\n');

if (!normalized.includes(t1)) { console.error('Icon target not found'); process.exit(1); }
normalized = normalized.replace(t1, r1);

if (!normalized.includes(t2)) { console.error('State target not found'); process.exit(1); }
normalized = normalized.replace(t2, r2);

if (!normalized.includes(t3)) { console.error('Handlers target not found'); process.exit(1); }
normalized = normalized.replace(t3, r3);

if (!normalized.includes(t4)) { console.error('Status target not found'); process.exit(1); }
normalized = normalized.replace(t4, r4);

if (!normalized.includes(t5)) { console.error('Tab target not found'); process.exit(1); }
normalized = normalized.replace(t5, r5);

fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched lead-feeds-client.jsx state and handlers');

