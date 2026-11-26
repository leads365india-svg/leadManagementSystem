const https = require("https")
const mongoose = require("mongoose")
const recordingStorage = require("./recordingStorage")
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

const MAX_INLINE_AUDIO_BYTES = 25 * 1024 * 1024 // 25 MB max for inline Gemini payload

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
 */
async function transcribeAudioWithGemini({
  audioBuffer,
  mimeType = "audio/mp3",
  duration = 0,
  apiKey,
  modelOverride = null,
  httpClient = makeHttpsRequest,
}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("A valid Gemini API key is required for speech-to-text.")
  }

  const model = modelOverride || resolveGeminiModel()
  const base64Audio = audioBuffer.toString("base64")

  const systemPrompt = `You are an expert Speech-to-Text Transcriber for a business CRM.
Your objective is to accurately transcribe this sales phone call conversation into speaker-labeled, timestamped segments.

RULES:
1. Support English, Hindi, and mixed Hinglish. ALWAYS write Hindi and Hinglish speech in Romanized Hinglish using the Latin/English alphabet (e.g., "Hamare paas OPD, IPD, OT aur Bed Management sab available hai") — NEVER use Devanagari script. Keep English product/business terms (OPD, IPD, OT, HMS, CRM, Demo, Quotation, etc.) in standard English spelling. Pure English speech remains standard English.
2. Accurately identify speakers as "Agent" or "Customer". If uncertain, label as "unknown". Do not fabricate identities.
3. Provide realistic start and end timestamps in seconds.
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

  const requestBody = {
    // Controls request-level API logging behavior on Google AI Studio
    store: false,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: SUPPORTED_AUDIO_MIMES.has(mimeType) ? mimeType : "audio/mp3",
              data: base64Audio,
            },
          },
          {
            text: systemPrompt,
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const headers = {
    "x-goog-api-key": apiKey.trim(),
  }

  let response
  try {
    response = await httpClient(endpoint, requestBody, headers)
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
    usage: {
      inputTokens: usageMetadata.promptTokenCount || null,
      outputTokens: usageMetadata.candidatesTokenCount || null,
      audioDurationSeconds: duration,
    },
  }
}

/**
 * High-level orchestration for Call Speech-to-Text.
 * Handles audio retrieval, validation, and strict live Gemini STT execution.
 */
async function processSpeechToText({
  call,
  audioBuffer = null,
  mimeType = null,
  apiKey = null,
  httpClient = makeHttpsRequest,
}) {
  if (!call) {
    throw new Error("Call record is required for speech-to-text processing.")
  }

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!effectiveKey || typeof effectiveKey !== "string" || !effectiveKey.trim()) {
    throw new Error("Speech-to-text requires GEMINI_API_KEY / GOOGLE_AI_API_KEY; fake fallback transcripts are disabled.")
  }

  let buffer = audioBuffer
  let cleanMime = mimeType

  // Fetch audio from storage if not provided directly
  if (!buffer) {
    const fetched = await fetchAudioBuffer({ call })
    buffer = fetched.buffer
    cleanMime = cleanMime || fetched.mimeType
  }

  const callDuration = call.recording?.duration || 0

  console.log(`ℹ️ Invoking Gemini STT for call ${call._id} (${buffer.length} bytes audio)...`)
  const sttResult = await transcribeAudioWithGemini({
    audioBuffer: buffer,
    mimeType: cleanMime || "audio/mp3",
    duration: callDuration,
    apiKey: effectiveKey,
    httpClient,
  })

  const hasTranscriptText = Boolean(sttResult?.transcriptText && sttResult.transcriptText.trim())
  const hasSegments = Array.isArray(sttResult?.segments) && sttResult.segments.length > 0
  if (!hasTranscriptText || !hasSegments) {
    throw new Error("No intelligible speech detected in recording (silent or empty audio).")
  }

  return sttResult
}

module.exports = {
  fetchAudioBuffer,
  transcribeAudioWithGemini,
  processSpeechToText,
  SUPPORTED_AUDIO_MIMES,
  MAX_INLINE_AUDIO_BYTES,
}
