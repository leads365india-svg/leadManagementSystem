const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")
const https = require("https")
const mongoose = require("mongoose")
const recordingStorage = require("./recordingStorage")
const audioConverter = require("./audioConverter")
const { sanitizeErrorMessage, resolveGeminiModel, makeHttpsRequest } = require("./aiProvider.service")

/**
 * AI Speech-to-Text (STT) Service - Phase 3: AI Call Intelligence
 * 
 * Transcribes recorded CRM calls into speaker-labeled, timestamped text segments.
 * 
 * Features:
 * - Native Google Gemini 3.8 Flash audio comprehension via REST API
 * - Multi-language: Hindi, English, and Hinglish conversation transcription
 * - Direct GridFS audio stream buffering (zero duplicate storage systems)
 * - Strict enterprise privacy: 'store: false' for request-level logging control
 * - Header-based API key transport ('x-goog-api-key') with zero query param exposure
 * - Zero unsupported sampling parameters (no temperature, top_p, top_k, candidate_count)
 * - Safe error sanitization and timeout protection
 * - Strict live-only Gemini transcription (zero hardcoded or fabricated transcripts)
 */

const SUPPORTED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/amr",
  "audio/3gpp",
  "audio/3gp",
])

const MAX_INLINE_AUDIO_BYTES = 25 * 1024 * 1024 // Legacy constant retained for compatibility
const FILES_API_THRESHOLD_BYTES = Number(process.env.AI_FILES_API_THRESHOLD_BYTES) || 5 * 1024 * 1024 // 5 MB
const LONG_AUDIO_DURATION_THRESHOLD_SEC = 600 // 10 minutes
const LONG_AUDIO_SIZE_THRESHOLD_BYTES = 8 * 1024 * 1024 // 8 MB
const CHUNK_DURATION_SEC = 600 // 10 minutes
const CHUNK_OVERLAP_SEC = 5 // 5 seconds
const CHUNK_STT_TIMEOUT_MS = Number(process.env.AI_STT_CHUNK_TIMEOUT_MS) || 300000 // 5 minutes per chunk
const STT_MAX_OUTPUT_TOKENS = Number(process.env.AI_STT_MAX_OUTPUT_TOKENS) || 32768 // High output limit per chunk
const FILES_API_TIMEOUT_MS = Number(process.env.AI_FILES_API_TIMEOUT_MS) || 180000

/**
 * Low-level HTTPS helper returning headers and parsed JSON body for Gemini Files API.
 */
function rawHttpsRequest(urlStr, { method = "GET", headers = {}, body = null, timeoutMs = FILES_API_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr)
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      }

      const req = https.request(options, (res) => {
        let raw = ""
        res.on("data", (chunk) => {
          raw += chunk
        })
        res.on("end", () => {
          let data = raw
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch (_) {}

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, headers: res.headers, data })
          } else {
            const snippet = typeof raw === "string" ? sanitizeErrorMessage(raw.slice(0, 500)) : ""
            reject(new Error(`HTTP ${res.statusCode}: ${snippet}`))
          }
        })
      })

      req.on("error", (err) => reject(new Error(sanitizeErrorMessage(err.message))))
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Gemini Files API request timed out after ${Math.round(timeoutMs / 1000)} seconds`))
      })

      if (body && typeof body.pipe === "function") {
        body.on("error", (err) => {
          req.destroy(new Error(sanitizeErrorMessage(err.message)))
        })
        body.pipe(req)
      } else {
        if (body !== null && body !== undefined) {
          req.write(body)
        }
        req.end()
      }
    } catch (err) {
      reject(new Error(sanitizeErrorMessage(err.message)))
    }
  })
}

const defaultFilesApiClient = {
  async uploadFile({ filePath = null, audioBuffer = null, sizeBytes = 0, mimeType = "audio/mp3", displayName = "audio_chunk.mp3", apiKey }) {
    const cleanKey = apiKey.trim()
    const totalBytes = sizeBytes || (audioBuffer ? audioBuffer.length : fs.statSync(filePath).size)
    const cleanMime = SUPPORTED_AUDIO_MIMES.has(mimeType) ? mimeType : "audio/mp3"

    // 1. Initiate resumable upload session
    const initMeta = JSON.stringify({ file: { display_name: displayName } })
    const startRes = await rawHttpsRequest("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      headers: {
        "x-goog-api-key": cleanKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(totalBytes),
        "X-Goog-Upload-Header-Content-Type": cleanMime,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(initMeta),
      },
      body: initMeta,
    })

    const uploadUrl = startRes.headers["x-goog-upload-url"]
    if (!uploadUrl) {
      throw new Error("Gemini Files API did not return an upload URL.")
    }

    // 2. Upload binary payload via stream (filePath) or Buffer
    const streamOrBuffer = filePath ? fs.createReadStream(filePath) : audioBuffer
    const uploadRes = await rawHttpsRequest(uploadUrl, {
      method: "PUT",
      headers: {
        "x-goog-api-key": cleanKey,
        "Content-Length": String(totalBytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: streamOrBuffer,
      timeoutMs: FILES_API_TIMEOUT_MS,
    })

    const uploadedFile = uploadRes.data?.file || uploadRes.data
    if (!uploadedFile || !uploadedFile.uri || !uploadedFile.name) {
      throw new Error("Gemini Files API upload succeeded but returned incomplete file metadata.")
    }
    return uploadedFile
  },

  async getFile({ fileName, apiKey }) {
    const cleanName = String(fileName || "").replace(/^\/+/, "")
    const res = await rawHttpsRequest(`https://generativelanguage.googleapis.com/v1beta/${cleanName}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey.trim(),
      },
      timeoutMs: 30000,
    })
    return res.data?.file || res.data
  },

  async deleteFile({ fileName, apiKey }) {
    if (!fileName) return
    const cleanName = String(fileName).replace(/^\/+/, "")
    await rawHttpsRequest(`https://generativelanguage.googleapis.com/v1beta/${cleanName}`, {
      method: "DELETE",
      headers: {
        "x-goog-api-key": apiKey.trim(),
      },
      timeoutMs: 30000,
    }).catch(() => {})
  },
}

/**
 * Polls Gemini Files API until file state becomes ACTIVE.
 */
async function waitForGeminiFileActive({
  file,
  apiKey,
  filesApiClient = defaultFilesApiClient,
  maxWaitMs = 120000,
  pollIntervalMs = 2000,
}) {
  if (!file || !file.name) {
    throw new Error("Uploaded Gemini file metadata is missing name.")
  }

  let current = file
  const deadline = Date.now() + maxWaitMs
  while (true) {
    const state = String(current.state || "ACTIVE").toUpperCase()
    if (state === "ACTIVE") {
      return current
    }
    if (state === "FAILED") {
      throw new Error(`Gemini file processing failed: ${current.error?.message || "Unknown file error"}`)
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Gemini file '${file.name}' to become ACTIVE (last state: ${state}).`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    current = await filesApiClient.getFile({ fileName: file.name, apiKey })
  }
}

function isTransientSttError(err) {
  const msg = String(err?.message || err || "").toLowerCase()
  if (!msg) return false
  if (
    msg.includes("api key is required") ||
    msg.includes("obsolete or shut down") ||
    msg.includes("invalid gemini model") ||
    msg.includes("http 400") ||
    msg.includes("http 401") ||
    msg.includes("http 403") ||
    msg.includes("http 404")
  ) {
    return false
  }
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("http 429") ||
    msg.includes("http 500") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("eai_again") ||
    msg.includes("socket hang up") ||
    msg.includes("empty response received")
  )
}

async function withTransientRetry(fn, { maxRetries = 1, retryDelayMs = 1500 } = {}) {
  let attempt = 0
  while (true) {
    try {
      return await fn(attempt)
    } catch (err) {
      if (attempt >= maxRetries || !isTransientSttError(err)) {
        throw err
      }
      attempt++
      console.warn(`⚠️ [STT] Transient error on attempt ${attempt}, retrying once: ${sanitizeErrorMessage(err.message)}`)
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }
  }
}

/**
 * Downloads audio stream from GridFS or remote URL into an in-memory Buffer.
 */
async function fetchAudioBuffer({ call, timeoutMs = 30000 }) {
  if (!call || !call.recording) {
    throw new Error("Call object does not contain valid recording metadata.")
  }

  const rec = call.recording
  const fileId = rec.mp3FileId || rec.fileId

  // Case 1: GridFS Audio Storage
  if (fileId) {
    return new Promise((resolve, reject) => {
      try {
        const bucket = recordingStorage.getBucket()
        const objectId = typeof fileId === "string" ? new mongoose.Types.ObjectId(fileId) : fileId
        const downloadStream = bucket.openDownloadStream(objectId)

        const chunks = []
        let totalSize = 0

        downloadStream.on("data", (chunk) => {
          chunks.push(chunk)
          totalSize += chunk.length
          if (totalSize > MAX_INLINE_AUDIO_BYTES) {
            downloadStream.destroy(new Error(`Audio size (${totalSize} bytes) exceeds maximum inline processing limit of 25MB.`))
          }
        })

        downloadStream.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            mimeType: "audio/mp3",
            sizeBytes: totalSize,
          })
        })

        downloadStream.on("error", (err) => {
          reject(new Error(`Failed to retrieve recording from GridFS: ${sanitizeErrorMessage(err.message)}`))
        })

        const timer = setTimeout(() => {
          downloadStream.destroy(new Error("GridFS audio read timed out after 30 seconds."))
        }, timeoutMs)

        downloadStream.on("close", () => clearTimeout(timer))
      } catch (err) {
        reject(new Error(`GridFS download initialization error: ${sanitizeErrorMessage(err.message)}`))
      }
    })
  }

  // Case 2: Remote URL (e.g. ImageKit or CDN)
  const remoteUrl = rec.imagekitMp3Url || rec.imagekitUrl || rec.url
  if (remoteUrl) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(remoteUrl)
        const client = parsed.protocol === "https:" ? https : require("http")

        const req = client.get(remoteUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(fetchAudioBuffer({ call: { recording: { url: res.headers.location } }, timeoutMs }))
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} while fetching remote recording from CDN.`))
          }

          const chunks = []
          let totalBytes = 0

          res.on("data", (chunk) => {
            chunks.push(chunk)
            totalBytes += chunk.length
            if (totalBytes > MAX_INLINE_AUDIO_BYTES) {
              res.destroy(new Error("Remote audio size exceeds 25MB limit."))
            }
          })

          res.on("end", () => {
            resolve({
              buffer: Buffer.concat(chunks),
              mimeType: res.headers["content-type"] || "audio/mp3",
              sizeBytes: totalBytes,
            })
          })
        })

        req.on("error", (err) => reject(new Error(`Remote audio request error: ${sanitizeErrorMessage(err.message)}`)))
        req.setTimeout(timeoutMs, () => req.destroy(new Error("Remote audio download timed out.")))
      } catch (err) {
        reject(new Error(`Invalid remote audio URL: ${sanitizeErrorMessage(err.message)}`))
      }
    })
  }

  throw new Error("Call recording has neither a GridFS fileId nor an active remote storage URL.")
}

/**
 * Transcribes audio via Google Gemini REST API.
 * Uses Gemini Files API for files/chunks > 5 MB (or when useFilesApi is requested)
 * and uses high maxOutputTokens to avoid transcript JSON truncation.
 */
async function transcribeAudioWithGemini({
  audioBuffer = null,
  filePath = null,
  sizeBytes = 0,
  mimeType = "audio/mp3",
  duration = 0,
  apiKey,
  modelOverride = null,
  httpClient = makeHttpsRequest,
  filesApiClient = defaultFilesApiClient,
  useFilesApi = false,
  timeoutMs = CHUNK_STT_TIMEOUT_MS,
  maxOutputTokens = STT_MAX_OUTPUT_TOKENS,
  pollIntervalMs = 2000,
}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("A valid Gemini API key is required for speech-to-text.")
  }

  if (!audioBuffer && (!filePath || !fs.existsSync(filePath))) {
    throw new Error("Either audioBuffer or a valid filePath is required for transcription.")
  }

  const resolvedSize = Number(sizeBytes) || (audioBuffer ? audioBuffer.length : fs.statSync(filePath).size)
  const cleanMime = SUPPORTED_AUDIO_MIMES.has(mimeType) ? mimeType : "audio/mp3"
  const shouldUseFilesApi = Boolean(useFilesApi || resolvedSize > FILES_API_THRESHOLD_BYTES)

  const model = modelOverride || resolveGeminiModel()

  const systemPrompt = `You are an expert Speech-to-Text Transcriber for a business CRM.
Your objective is to accurately transcribe this sales phone call conversation into speaker-labeled, timestamped segments.

RULES:
1. Support English, Hindi, and mixed Hinglish. ALWAYS write Hindi and Hinglish speech in Romanized Hinglish using the Latin/English alphabet (e.g., "Hamare paas OPD, IPD, OT aur Bed Management sab available hai") — NEVER use Devanagari script. Keep English product/business terms (OPD, IPD, OT, HMS, CRM, Demo, Quotation, etc.) in standard English spelling. Pure English speech remains standard English.
2. Accurately identify speakers as "Agent" or "Customer". If uncertain, label as "unknown". Do not fabricate identities.
3. Provide realistic start and end timestamps in seconds starting from 0.0 for this audio clip.
4. If the audio is completely silent, empty, or contains no intelligible speech, return segments: [] and transcriptText: '' — NEVER invent or fabricate dialogue.
5. Output MUST be valid JSON adhering strictly to this schema:
{
  "language": "hi | en | hi-en | other",
  "duration": <number of seconds>,
  "transcriptText": "<Full combined text of the call>",
  "segments": [
    {
      "speaker": "Agent | Customer | unknown",
      "startTime": 0.0,
      "endTime": 3.5,
      "text": "Exact spoken text in this segment"
    }
  ]
}`

  const headers = {
    "x-goog-api-key": apiKey.trim(),
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  let uploadedGeminiFile = null
  try {
    let mediaPart
    if (shouldUseFilesApi) {
      const displayName = `call_audio_${Date.now()}.mp3`
      uploadedGeminiFile = await filesApiClient.uploadFile({
        filePath,
        audioBuffer,
        sizeBytes: resolvedSize,
        mimeType: cleanMime,
        displayName,
        apiKey,
      })

      const activeFile = await waitForGeminiFileActive({
        file: uploadedGeminiFile,
        apiKey,
        filesApiClient,
        pollIntervalMs,
      })

      mediaPart = {
        fileData: {
          mimeType: activeFile.mimeType || cleanMime,
          fileUri: activeFile.uri,
        },
      }
    } else {
      const buf = audioBuffer || fs.readFileSync(filePath)
      mediaPart = {
        inlineData: {
          mimeType: cleanMime,
          data: buf.toString("base64"),
        },
      }
    }

    const requestBody = {
      // Controls request-level API logging behavior on Google AI Studio
      store: false,
      contents: [
        {
          role: "user",
          parts: [
            mediaPart,
            {
              text: systemPrompt,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    }

    let response
    try {
      response = await httpClient(endpoint, requestBody, headers, { timeoutMs })
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err.message))
    }

    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      throw new Error("Empty response received from Gemini Speech-to-Text API.")
    }

    let parsed
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      throw new Error(`Failed to parse Gemini STT output: ${sanitizeErrorMessage(parseErr.message)}. Raw text: ${sanitizeErrorMessage(rawText.slice(0, 200))}`)
    }

    const segments = Array.isArray(parsed.segments)
      ? parsed.segments.map((s) => ({
          speaker: typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : "unknown",
          startTime: typeof s.startTime === "number" && !isNaN(s.startTime) ? Math.max(0, s.startTime) : 0,
          endTime: typeof s.endTime === "number" && !isNaN(s.endTime) ? Math.max(0, s.endTime) : 0,
          text: String(s.text || "").trim(),
        })).filter((s) => s.text.length > 0)
      : []

    const trimmedParsedText = typeof parsed.transcriptText === "string" ? parsed.transcriptText.trim() : ""
    const transcriptText = trimmedParsedText || segments.map((s) => `[${s.speaker}]: ${s.text}`).join("\n")
    const usageMetadata = response?.usageMetadata || {}

    return {
      provider: "gemini",
      model,
      language: parsed.language || "auto",
      duration: typeof parsed.duration === "number" ? parsed.duration : duration,
      transcriptText,
      segments,
      usedFilesApi: shouldUseFilesApi,
      usage: {
        inputTokens: usageMetadata.promptTokenCount || null,
        outputTokens: usageMetadata.candidatesTokenCount || null,
        audioDurationSeconds: duration,
      },
    }
  } finally {
    if (uploadedGeminiFile?.name) {
      await filesApiClient.deleteFile({ fileName: uploadedGeminiFile.name, apiKey }).catch(() => {})
    }
  }
}

/**
 * Merges ordered chunk transcripts into a single timeline with adjusted timestamps
 * and deduplicated overlap regions.
 */
function mergeChunkTranscripts(chunkEntries = [], { totalDurationSec = 0, overlapSec = CHUNK_OVERLAP_SEC } = {}) {
  const ordered = [...chunkEntries].sort((a, b) => (a.index || 0) - (b.index || 0))
  const mergedSegments = []
  const textParts = []
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let hasInputTokens = false
  let hasOutputTokens = false
  let detectedLanguage = "auto"

  const normalizeText = (txt) =>
    String(txt || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()

  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    const offset = Number(entry.offsetSeconds) || 0
    const res = entry.result || {}

    if (detectedLanguage === "auto" && res.language && res.language !== "auto") {
      detectedLanguage = res.language
    }

    if (typeof res.usage?.inputTokens === "number") {
      totalInputTokens += res.usage.inputTokens
      hasInputTokens = true
    }
    if (typeof res.usage?.outputTokens === "number") {
      totalOutputTokens += res.usage.outputTokens
      hasOutputTokens = true
    }

    const prevBoundaryEnd = i > 0 ? offset + overlapSec + 2 : -1
    const tailNorms = mergedSegments.slice(-6).map((s) => normalizeText(s.text)).filter(Boolean)

    const chunkSegs = Array.isArray(res.segments) ? res.segments : []
    if (chunkSegs.length > 0) {
      for (const seg of chunkSegs) {
        const startTime = Math.round((offset + (Number(seg.startTime) || 0)) * 100) / 100
        const endTime = Math.round((offset + (Number(seg.endTime) || Number(seg.startTime) || 0)) * 100) / 100
        const text = String(seg.text || "").trim()
        if (!text) continue

        const norm = normalizeText(text)
        const inOverlapWindow = i > 0 && startTime <= prevBoundaryEnd
        const isDuplicateInOverlap =
          inOverlapWindow &&
          tailNorms.some((prevNorm) => prevNorm && (prevNorm === norm || (norm.length >= 12 && (prevNorm.includes(norm) || norm.includes(prevNorm)))))

        if (isDuplicateInOverlap) {
          continue
        }

        mergedSegments.push({
          speaker: seg.speaker || "unknown",
          startTime,
          endTime: Math.max(startTime, endTime),
          text,
        })
      }
    } else if (typeof res.transcriptText === "string" && res.transcriptText.trim()) {
      textParts.push(res.transcriptText.trim())
    }
  }

  const transcriptText =
    mergedSegments.length > 0
      ? mergedSegments.map((s) => `${s.speaker}: ${s.text}`).join("\n")
      : textParts.join("\n")

  const lastEntry = ordered[ordered.length - 1]
  const lastModel = lastEntry?.result?.model || resolveGeminiModel()
  const maxSegmentEnd = mergedSegments.reduce((max, s) => Math.max(max, s.endTime || 0), 0)

  return {
    provider: "gemini",
    model: lastModel,
    language: detectedLanguage,
    duration: Number(totalDurationSec) || maxSegmentEnd || 0,
    transcriptText,
    segments: mergedSegments,
    chunkCount: ordered.length,
    usage: {
      inputTokens: hasInputTokens ? totalInputTokens : null,
      outputTokens: hasOutputTokens ? totalOutputTokens : null,
      audioDurationSeconds: Number(totalDurationSec) || maxSegmentEnd || 0,
    },
  }
}

/**
 * Runs an async worker over items with bounded concurrency (default 1, max 2).
 */
async function mapWithConcurrency(items, concurrency = 1, workerFn) {
  const bound = Math.max(1, Math.min(2, Number(concurrency) || 1))
  const results = new Array(items.length)
  let nextIdx = 0

  async function runWorker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++
      results[idx] = await workerFn(items[idx], idx)
    }
  }

  const workers = []
  for (let i = 0; i < Math.min(bound, items.length); i++) {
    workers.push(runWorker())
  }
  await Promise.all(workers)
  return results
}

/**
 * High-level orchestration for Call Speech-to-Text.
 * Automatically splits long recordings (>10m or >8MB) into 10-minute overlapping chunks
 * and uses Gemini Files API for uploads >5MB, with full temp-file cleanup in finally.
 */
async function processSpeechToText({
  call,
  audioBuffer = null,
  filePath = null,
  mimeType = null,
  apiKey = null,
  httpClient = makeHttpsRequest,
  filesApiClient = defaultFilesApiClient,
  audioTools = audioConverter,
  concurrency = 1,
  chunkDurationSec = CHUNK_DURATION_SEC,
  overlapSec = CHUNK_OVERLAP_SEC,
  chunkTimeoutMs = CHUNK_STT_TIMEOUT_MS,
  retryDelayMs = 1500,
  useFilesApi = false,
  onProgress = null,
}) {
  if (!call) {
    throw new Error("Call record is required for speech-to-text processing.")
  }

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!effectiveKey || typeof effectiveKey !== "string" || !effectiveKey.trim()) {
    throw new Error("Speech-to-text requires GEMINI_API_KEY / GOOGLE_AI_API_KEY; fake fallback transcripts are disabled.")
  }

  const cleanMime = mimeType || "audio/mp3"
  let tempInputCleanup = null
  let tempChunksCleanup = null
  let resolvedFilePath = filePath || null
  let resolvedBuffer = audioBuffer || null

  try {
    // 1. Download recording from storage directly to temp file when not supplied directly
    let fileSizeBytes = resolvedBuffer
      ? resolvedBuffer.length
      : (resolvedFilePath && fs.existsSync(resolvedFilePath) ? fs.statSync(resolvedFilePath).size : 0)

    if (!resolvedBuffer && !resolvedFilePath) {
      const downloaded = await audioTools.downloadRecordingToTempFile({ call })
      resolvedFilePath = downloaded.filePath
      fileSizeBytes = downloaded.sizeBytes
      tempInputCleanup = downloaded.cleanup
    }

    let callDurationSec = Number(call.recording?.duration || call.duration || call.durationSeconds || 0) || 0

    // If duration missing and we have a file on disk, probe duration via FFmpeg
    if (callDurationSec <= 0 && resolvedFilePath && fs.existsSync(resolvedFilePath) && typeof audioTools.probeAudio === "function") {
      try {
        const probed = await audioTools.probeAudio(resolvedFilePath)
        if (probed?.isValid && probed.duration > 0) {
          callDurationSec = Number(probed.duration)
        }
      } catch (_) {}
    }

    const shouldChunk =
      callDurationSec > LONG_AUDIO_DURATION_THRESHOLD_SEC ||
      fileSizeBytes > LONG_AUDIO_SIZE_THRESHOLD_BYTES

    let sttResult

    if (shouldChunk) {
      // Ensure we have a temp file on disk before invoking FFmpeg splitter
      if (!resolvedFilePath && resolvedBuffer) {
        const bufTempPath = path.join(os.tmpdir(), `stt_buf_${Date.now()}_${crypto.randomBytes(5).toString("hex")}.audio`)
        fs.writeFileSync(bufTempPath, resolvedBuffer)
        resolvedFilePath = bufTempPath
        tempInputCleanup = () => {
          try { if (fs.existsSync(bufTempPath)) fs.unlinkSync(bufTempPath) } catch (_) {}
        }
      }

      const splitResult = await audioTools.splitAudioIntoChunks({
        inputPath: resolvedFilePath,
        totalDurationSec: callDurationSec,
        chunkDurationSec,
        overlapSec,
      })
      tempChunksCleanup = splitResult.cleanup

      const chunks = splitResult.chunks || []
      if (chunks.length === 0) {
        throw new Error("Audio chunking produced zero processable audio segments.")
      }

      console.log(`ℹ️ [STT] Splitting long call ${call._id} (${Math.round(splitResult.totalDurationSec || callDurationSec)}s, ${fileSizeBytes} bytes) into ${chunks.length} chunk(s)...`)

      const chunkEntries = await mapWithConcurrency(chunks, concurrency, async (chunk) => {
        const res = await withTransientRetry(
          () =>
            transcribeAudioWithGemini({
              audioBuffer: chunk.audioBuffer || null,
              filePath: chunk.filePath || null,
              sizeBytes: chunk.sizeBytes || chunk.audioBuffer?.length || 0,
              mimeType: chunk.mimeType || "audio/mp3",
              duration: chunk.durationSec || chunkDurationSec,
              apiKey: effectiveKey,
              httpClient,
              filesApiClient,
              useFilesApi: Boolean(useFilesApi || (chunk.sizeBytes || 0) > FILES_API_THRESHOLD_BYTES),
              timeoutMs: chunkTimeoutMs,
            }),
          { maxRetries: 1, retryDelayMs }
        )

        if (typeof onProgress === "function") {
          await Promise.resolve(onProgress({ chunkIndex: chunk.index, totalChunks: chunks.length })).catch(() => {})
        }

        return {
          index: chunk.index,
          offsetSeconds: chunk.offsetSeconds ?? chunk.startSec ?? 0,
          result: res,
        }
      })

      sttResult = mergeChunkTranscripts(chunkEntries, {
        totalDurationSec: splitResult.totalDurationSec || callDurationSec,
        overlapSec,
      })
    } else {
      console.log(`ℹ️ Invoking Gemini STT for call ${call._id} (${fileSizeBytes} bytes audio)...`)
      sttResult = await withTransientRetry(
        () =>
          transcribeAudioWithGemini({
            audioBuffer: resolvedBuffer,
            filePath: resolvedFilePath,
            sizeBytes: fileSizeBytes,
            mimeType: cleanMime,
            duration: callDurationSec,
            apiKey: effectiveKey,
            httpClient,
            filesApiClient,
            useFilesApi: Boolean(useFilesApi || fileSizeBytes > FILES_API_THRESHOLD_BYTES),
            timeoutMs: chunkTimeoutMs,
          }),
        { maxRetries: 1, retryDelayMs }
      )
    }

    const hasTranscriptText = Boolean(sttResult?.transcriptText && sttResult.transcriptText.trim())
    const hasSegments = Array.isArray(sttResult?.segments) && sttResult.segments.length > 0
    if (!hasTranscriptText && !hasSegments) {
      throw new Error("Gemini STT returned an empty transcript.")
    }

    return sttResult
  } finally {
    if (typeof tempChunksCleanup === "function") {
      try { tempChunksCleanup() } catch (_) {}
    }
    if (typeof tempInputCleanup === "function") {
      try { tempInputCleanup() } catch (_) {}
    }
  }
}

module.exports = {
  fetchAudioBuffer,
  transcribeAudioWithGemini,
  processSpeechToText,
  waitForGeminiFileActive,
  defaultFilesApiClient,
  isTransientSttError,
  withTransientRetry,
  mergeChunkTranscripts,
  SUPPORTED_AUDIO_MIMES,
  MAX_INLINE_AUDIO_BYTES,
  FILES_API_THRESHOLD_BYTES,
  LONG_AUDIO_DURATION_THRESHOLD_SEC,
  LONG_AUDIO_SIZE_THRESHOLD_BYTES,
  CHUNK_DURATION_SEC,
  CHUNK_OVERLAP_SEC,
  CHUNK_STT_TIMEOUT_MS,
  STT_MAX_OUTPUT_TOKENS,
}
