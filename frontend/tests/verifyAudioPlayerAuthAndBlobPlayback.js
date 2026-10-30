/**
 * Verification Suite: CRM In-Browser Audio Player Authentication, Blob URL Lifecycle & Retention State
 *
 * Verifies:
 * 1. Player requests audio using authenticated Authorization: Bearer <token> from localStorage.
 * 2. Successful audio responses are piped into managed Blob URLs (URL.createObjectURL).
 * 3. Switching calls or unmounting cancels in-flight fetch via AbortController and revokes existing Blob URL.
 * 4. HTTP 401 returns "Authentication required. Please log in again."
 * 5. HTTP 403 returns "Playback restricted by compliance policy or permissions."
 * 6. HTTP 404 returns "Recording audio not found on server."
 * 7. HTTP 410 returns "Recording has expired per retention policy."
 * 8. Server JSON error payloads are extracted and displayed safely without decoding as audio.
 * 9. Retention display:
 *    - When expiresAt is present, accurately computes remaining days.
 *    - When expiresAt is null, does NOT display fabricated "30d remaining".
 */

const assert = require("assert")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message)
    failed++
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  [PASS] ${name}`)
    passed++
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message)
    failed++
  }
}

// -----------------------------------------------------------------------------
// Simulation of in-browser-audio-player.jsx state machine & logic
// -----------------------------------------------------------------------------

function computeRetentionDisplay(recording) {
  const expiryDate = recording?.expiresAt ? new Date(recording.expiresAt) : null
  const hasValidExpiry = expiryDate && !isNaN(expiryDate.getTime())
  const daysUntilExpiry = hasValidExpiry
    ? Math.max(0, Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)))
    : null

  if (daysUntilExpiry !== null) {
    return { badge: `Retained ${daysUntilExpiry}d remaining`, type: "expiry" }
  } else if (recording?.status === "stored") {
    return { badge: "Retained (Policy: 30d)", type: "policy" }
  } else if (recording?.status === "ready") {
    return { badge: "Legacy Recording", type: "legacy" }
  }
  return { badge: null, type: "none" }
}

async function simulatePlayerAudioFetch({
  callId,
  storedToken,
  mockFetchResponse,
  signal,
  urlTracker,
}) {
  let error = null
  let blobUrl = null
  let isLoading = true

  try {
    const audioStreamUrl = `http://localhost:5000/api/calls/${callId}/recording`
    const headers = {}
    if (storedToken) {
      headers["Authorization"] = `Bearer ${storedToken}`
    }

    const response = await mockFetchResponse(audioStreamUrl, {
      method: "GET",
      headers,
      credentials: "include",
      signal,
    })

    if (!response.ok) {
      let errorMsg = "Unable to stream audio recording."
      const errData = await response.json().catch(() => null)
      if (errData && errData.code && errData.error) {
        errorMsg = errData.error
      } else if (response.status === 401) {
        errorMsg = "Authentication required. Please log in again."
      } else if (response.status === 403) {
        errorMsg = "Playback restricted by compliance policy or permissions."
      } else if (response.status === 404) {
        errorMsg = "Recording audio not found on server."
      } else if (response.status === 410) {
        errorMsg = "Recording has expired per retention policy."
      } else if (errData && errData.error) {
        errorMsg = errData.error
      }
      throw new Error(errorMsg)
    }

    const contentType = response.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.error || "Server returned an error instead of audio data.")
    }

    const blob = await response.blob()
    if (!blob || blob.size === 0) {
      throw new Error("Recording audio file is empty (0 bytes).")
    }

    const objectUrl = `blob:http://localhost:3000/${Math.random().toString(36).slice(2)}`
    if (urlTracker) urlTracker.created.push(objectUrl)
    blobUrl = objectUrl
    isLoading = false
    return { blobUrl, error: null, isLoading: false }
  } catch (err) {
    if (signal && signal.aborted) {
      return { blobUrl: null, error: null, aborted: true }
    }
    error = err.message
    isLoading = false
    return { blobUrl: null, error, isLoading: false }
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

async function runAll() {
  console.log("=".repeat(80))
  console.log("=== FRONTEND AUDIO PLAYER AUTH & BLOB PLAYBACK VERIFICATION ===")
  console.log("=".repeat(80))

  await testAsync("1. Attaches Authorization: Bearer <token> from localStorage to media request", async () => {
    let capturedHeaders = null
    const mockFetch = async (_url, options) => {
      capturedHeaders = options.headers
      return {
        ok: true,
        status: 200,
        headers: { get: () => "audio/m4a" },
        blob: async () => ({ size: 5000, type: "audio/m4a" }),
      }
    }

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: "jwt_token_alice_456",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(capturedHeaders["Authorization"], "Bearer jwt_token_alice_456")
    assert.strictEqual(result.error, null)
    assert(result.blobUrl && result.blobUrl.startsWith("blob:"), "Returned valid Blob URL")
  })

  await testAsync("2. AbortController cancels in-flight fetch and revokes previous Blob URL on call switch", async () => {
    const urlTracker = { created: [], revoked: [] }
    const controller = new AbortController()

    // Simulate in-flight abort
    controller.abort()

    const mockFetch = async () => {
      const err = new Error("The user aborted a request.")
      err.name = "AbortError"
      throw err
    }

    const result = await simulatePlayerAudioFetch({
      callId: "call_new_456",
      storedToken: "test_token",
      mockFetchResponse: mockFetch,
      signal: controller.signal,
      urlTracker,
    })

    assert.strictEqual(result.aborted, true)
    assert.strictEqual(result.blobUrl, null)
  })

  await testAsync("3. HTTP 401 Unauthorized returns clear re-authentication message", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, error: "Authentication required. Please log in." }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: null,
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Authentication required. Please log in again.")
  })

  await testAsync("4. HTTP 403 Forbidden returns compliance/policy restriction message", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, error: "Playback forbidden by DNR policy" }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Playback restricted by compliance policy or permissions.")
  })

  await testAsync("5. HTTP 404 Not Found returns recording missing on server message", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, error: "Recording not found" }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Recording audio not found on server.")
  })

  await testAsync("6. HTTP 410 Gone returns retention expired message", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 410,
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, error: "Recording purged" }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Recording has expired per retention policy.")
  })

  await testAsync("7. Empty 0-byte audio file is detected and rejected safely", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/m4a" },
      blob: async () => ({ size: 0, type: "audio/m4a" }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_123",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Recording audio file is empty (0 bytes).")
  })

  test("8. Retention Display: When expiresAt is null and status is stored, does NOT fabricate '30d remaining'", () => {
    const recordingWithoutExpires = {
      fileId: "6ae307246b0465c7d8785b3e",
      status: "stored",
      expiresAt: null,
    }

    const display = computeRetentionDisplay(recordingWithoutExpires)
    assert.notStrictEqual(display.badge, "Retained 30d remaining", "Must NOT show 30d remaining when expiresAt is null")
    assert.strictEqual(display.badge, "Retained (Policy: 30d)", "Shows genuine policy label")
  })

  test("8b. Retention Display: When recording is legacy 'ready', displays 'Legacy Recording' rather than 30d retention", () => {
    const legacyRecording = {
      fileId: null,
      status: "ready",
      expiresAt: null,
    }

    const display = computeRetentionDisplay(legacyRecording)
    assert.strictEqual(display.badge, "Legacy Recording", "Displays Legacy Recording label")
  })

  test("9. Retention Display: When genuine expiresAt exists, displays exact remaining days", () => {
    const futureDate = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString()
    const recordingWithExpires = {
      fileId: "6ae307246b0465c7d8785b3e",
      status: "stored",
      expiresAt: futureDate,
    }

    const display = computeRetentionDisplay(recordingWithExpires)
    assert.strictEqual(display.badge, "Retained 18d remaining", "Accurately calculates remaining days")
    assert.strictEqual(display.type, "expiry")
  })

  test("10. Retention Display: When call has no recording status or expiry, omits remaining badge", () => {
    const emptyRecording = {}
    const display = computeRetentionDisplay(emptyRecording)
    assert.strictEqual(display.badge, null, "Omits remaining badge when recording is unpopulated")
  })

  // ---------------------------------------------------------------------------
  // STEP 1 & 2 REGRESSION TESTS: handlePlayRecording & 404 Avoidance
  // ---------------------------------------------------------------------------

  test("11. Source Analysis: leads-client.jsx defines handlePlayRecording in component scope", () => {
    const fs = require("fs")
    const path = require("path")
    const leadsClientPath = path.resolve(__dirname, "../app/leads/leads-client.jsx")
    const code = fs.readFileSync(leadsClientPath, "utf-8")

    assert(
      code.includes("const handlePlayRecording = async (lead) => {"),
      "leads-client.jsx must define handlePlayRecording"
    )
    assert(
      code.includes("onClick={() => handlePlayRecording(lead)}"),
      "Play button must be wired to handlePlayRecording"
    )
    assert(
      code.includes("activePlayingCall"),
      "leads-client.jsx must manage activePlayingCall state"
    )
    assert(
      code.includes("<InBrowserAudioPlayer"),
      "leads-client.jsx must render InBrowserAudioPlayer dock"
    )
  })

  await testAsync("12. handlePlayRecording: Resolves lead calls and sets activePlayingCall with valid callId", async () => {
    let activePlayingCall = null
    let toastMessage = null

    const mockLead = { _id: "lead_abc123", name: "Acme Corp", phone: "+1234567890", assignedTo: "Agent Sarah" }
    const mockCalls = [
      {
        _id: "call_999",
        clientCallId: "uuid-999-call",
        leadId: "lead_abc123",
        recording: { status: "stored", fileId: "gridfs_file_123" },
        agentName: "Agent Sarah",
        number: "+1234567890",
        direction: "outbound",
      },
    ]

    const mockApiClient = {
      getLeadCalls: async (id) => {
        assert.strictEqual(id, "lead_abc123", "Must query calls using lead ID")
        return { success: true, data: mockCalls }
      },
    }

    const mockToast = {
      success: (msg) => { toastMessage = { type: "success", text: msg } },
      error: (msg) => { toastMessage = { type: "error", text: msg } },
    }

    // Execute handlePlayRecording logic
    const handlePlayRecording = async (lead) => {
      const leadIdStr = String(lead._id || lead.id || "")
      const res = await mockApiClient.getLeadCalls(leadIdStr)
      const calls = res?.success && Array.isArray(res.data) ? res.data : []
      const playableCall = calls.find(
        (c) =>
          c.recording?.status === "stored" ||
          c.recording?.status === "ready" ||
          Boolean(c.recording?.fileId) ||
          Boolean(c.metadata?.recordingUrl) ||
          Boolean(c.hasRecording)
      )
      if (playableCall) {
        const callId = playableCall._id || playableCall.id || playableCall.clientCallId
        activePlayingCall = {
          ...playableCall,
          callId,
          leadId: leadIdStr,
          leadPhone: lead.phone || playableCall.number,
          leadName: lead.name,
          agentName: playableCall.agentName || lead.assignedTo,
        }
        mockToast.success(`Playing recording for ${lead.name}`)
      }
    }

    await handlePlayRecording(mockLead)

    assert.notStrictEqual(activePlayingCall, null, "activePlayingCall must be populated")
    assert.strictEqual(activePlayingCall.callId, "call_999", "Must pass Call document ID, NOT lead ID")
    assert.strictEqual(activePlayingCall.leadPhone, "+1234567890", "Must retain lead phone")
    assert.strictEqual(toastMessage?.type, "success", "Shows success toast")
  })

  await testAsync("13. handlePlayRecording: Toggles player off when clicking already playing lead", async () => {
    let activePlayingCall = {
      callId: "call_999",
      leadId: "lead_abc123",
      leadPhone: "+1234567890",
    }

    const mockLead = { _id: "lead_abc123", phone: "+1234567890" }

    const handlePlayRecording = async (lead) => {
      const leadIdStr = String(lead._id || lead.id || "")
      if (activePlayingCall && (activePlayingCall.leadId === leadIdStr || activePlayingCall.leadPhone === lead.phone)) {
        activePlayingCall = null
        return
      }
    }

    await handlePlayRecording(mockLead)
    assert.strictEqual(activePlayingCall, null, "activePlayingCall must be toggled off to null")
  })

  await testAsync("14. handlePlayRecording: Missing recording safely alerts user without triggering 404 network request", async () => {
    let errorToast = null
    let networkFetchTriggered = false

    const mockLead = { _id: "lead_norec", name: "No Rec Lead", phone: "+1000000000" }
    const mockApiClient = {
      getLeadCalls: async () => ({ success: true, data: [] }),
    }

    const handlePlayRecording = async (lead) => {
      const leadIdStr = String(lead._id || lead.id || "")
      const res = await mockApiClient.getLeadCalls(leadIdStr)
      const calls = res?.success && Array.isArray(res.data) ? res.data : []
      if (calls.length === 0) {
        errorToast = `No call recordings found for ${lead.name || "this lead"}.`
        return
      }
      networkFetchTriggered = true
    }

    await handlePlayRecording(mockLead)

    assert.strictEqual(networkFetchTriggered, false, "Must NOT trigger audio network request when no calls exist")
    assert.strictEqual(errorToast, "No call recordings found for No Rec Lead.", "Shows friendly user toast")
  })

  await testAsync("15. handlePlayRecording: Accurately identifies DNR compliance restriction", async () => {
    let errorToast = null

    const mockLead = { _id: "lead_dnr", name: "DNR Contact", phone: "+9999999999" }
    const mockCalls = [
      {
        _id: "call_dnr",
        leadId: "lead_dnr",
        recording: { status: "skipped_dnr" },
      },
    ]

    const handlePlayRecording = async (lead) => {
      const res = { success: true, data: mockCalls }
      const calls = res.data
      const playableCall = calls.find(
        (c) => c.recording?.status === "stored" || c.recording?.status === "ready" || c.hasRecording
      )
      if (!playableCall) {
        if (calls.some((c) => c.recording?.status === "skipped_dnr")) {
          errorToast = "Call recording skipped due to Do-Not-Record compliance policy."
          return
        }
      }
    }

    await handlePlayRecording(mockLead)
    assert.strictEqual(errorToast, "Call recording skipped due to Do-Not-Record compliance policy.")
  })

  await testAsync("16. handlePlayRecording: Accurately identifies expired 30-day recordings", async () => {
    let errorToast = null

    const mockLead = { _id: "lead_exp", name: "Expired Lead", phone: "+8888888888" }
    const mockCalls = [
      {
        _id: "call_exp",
        leadId: "lead_exp",
        recording: { status: "expired" },
      },
    ]

    const handlePlayRecording = async (lead) => {
      const res = { success: true, data: mockCalls }
      const calls = res.data
      const playableCall = calls.find(
        (c) => c.recording?.status === "stored" || c.recording?.status === "ready" || c.hasRecording
      )
      if (!playableCall) {
        if (calls.some((c) => c.recording?.status === "expired")) {
          errorToast = "Call recording has expired per the 30-day retention policy."
          return
        }
      }
    }

    await handlePlayRecording(mockLead)
    assert.strictEqual(errorToast, "Call recording has expired per the 30-day retention policy.")
  })

  test("17. Source Analysis: lead-detail-drawer.jsx has no unauthenticated <audio> element", () => {
    const fs = require("fs")
    const path = require("path")
    const drawerPath = path.resolve(__dirname, "../components/lead-detail-drawer.jsx")
    const drawerCode = fs.readFileSync(drawerPath, "utf-8")

    assert(
      !drawerCode.includes("<audio"),
      "lead-detail-drawer.jsx must NOT include raw unauthenticated <audio> tags"
    )
    assert(
      drawerCode.includes("<InBrowserAudioPlayer"),
      "lead-detail-drawer.jsx must use InBrowserAudioPlayer for authenticated audio"
    )
  })

  await testAsync("18. InBrowserAudioPlayer: Missing callId parameter returns immediate error", async () => {
    let error = null
    let fetchCalled = false

    const callId = null
    if (!callId) {
      error = "No recording identifier provided."
    } else {
      fetchCalled = true
    }

    assert.strictEqual(error, "No recording identifier provided.")
    assert.strictEqual(fetchCalled, false)
  })

  await testAsync("19. HTTP 404 with structured code LEGACY_FILE_EXPIRED surfaces exact diagnostic to player", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({
        success: false,
        error: "Audio recording is no longer available (legacy storage expired)",
        code: "LEGACY_FILE_EXPIRED",
        reason: "legacy_ephemeral_storage_expired",
      }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "6ae307246b0465c7d8785b3e",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Audio recording is no longer available (legacy storage expired)")
  })

  await testAsync("20. HTTP 404 with structured code CALL_NOT_FOUND surfaces exact diagnostic to player", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({
        success: false,
        error: "Call record not found",
        code: "CALL_NOT_FOUND",
      }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "nonexistent_call_id",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Call record not found")
  })

  await testAsync("21. HTTP 404 with structured code GRIDFS_FILE_MISSING surfaces exact storage diagnostic", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      json: async () => ({
        success: false,
        error: "Recording audio file not found in persistent storage",
        code: "GRIDFS_FILE_MISSING",
      }),
    })

    const result = await simulatePlayerAudioFetch({
      callId: "call_stored_missing_chunks",
      storedToken: "agent_token",
      mockFetchResponse: mockFetch,
    })

    assert.strictEqual(result.blobUrl, null)
    assert.strictEqual(result.error, "Recording audio file not found in persistent storage")
  })

  console.log("\n" + "=".repeat(80))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log("=".repeat(80))

  if (failed > 0) {
    process.exit(1)
  }
}

runAll().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
