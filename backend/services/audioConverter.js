const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn } = require("child_process")
const crypto = require("crypto")

// Resolve ffmpeg binary path from ffmpeg-static or environment
let ffmpegPath = null
try {
  ffmpegPath = require("ffmpeg-static")
} catch (e) {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"
}

// In-progress conversion promises map to prevent duplicate conversions for the same call
const inProgressConversions = new Map()

/**
 * Execute FFmpeg command with promise and timeout
 */
function runFFmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error("FFmpeg executable not found"))
    }

    const proc = spawn(ffmpegPath, args)
    let stdout = ""
    let stderr = ""

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch (_) {}
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr, code })
      } else {
        const err = new Error(`FFmpeg process exited with code ${code}: ${stderr.slice(-500)}`)
        err.code = code
        err.stderr = stderr
        reject(err)
      }
    })
  })
}

/**
 * Probe an audio file to extract metadata: duration, codec, bitrate, channels, sample rate
 *
 * @param {string} filePath - Absolute path to audio file
 * @returns {Promise<{duration: number, codec: string, format: string, channels: number, sampleRate: number, bitrate: number, isValid: boolean}>}
 */
async function probeAudio(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("File does not exist for probing")
  }

  const stat = fs.statSync(filePath)
  if (stat.size === 0) {
    return {
      isValid: false,
      duration: 0,
      codec: "empty",
      format: "empty",
      channels: 0,
      sampleRate: 0,
      bitrate: 0,
      sizeBytes: 0,
      error: "Audio file is 0 bytes (empty)",
    }
  }

  try {
    // Run ffmpeg -i <file> to probe stream info (exits with 1 or 0 but outputs probe to stderr)
    const proc = spawn(ffmpegPath, ["-i", filePath])
    let stderr = ""

    await new Promise((resolve) => {
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      proc.on("close", () => resolve())
      proc.on("error", () => resolve())
    })

    if (stderr.includes("Invalid data found when processing input") || stderr.includes("does not contain any stream")) {
      return {
        isValid: false,
        duration: 0,
        codec: "corrupt",
        format: "unknown",
        channels: 0,
        sampleRate: 0,
        bitrate: 0,
        sizeBytes: stat.size,
        error: "Corrupt or unrecognized audio data",
      }
    }

    // Extract duration (Duration: 00:01:23.45)
    let duration = 0
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (durationMatch) {
      const hours = parseFloat(durationMatch[1])
      const mins = parseFloat(durationMatch[2])
      const secs = parseFloat(durationMatch[3])
      duration = Math.round((hours * 3600 + mins * 60 + secs) * 100) / 100
    }

    // Extract format from "Input #0, <format>, from..."
    let format = ""
    const formatMatch = stderr.match(/Input #0,\s*([^,]+),/)
    if (formatMatch) {
      format = formatMatch[1].trim().toLowerCase()
    }

    // Extract audio stream info (Stream #0:0: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s)
    let codec = ""
    let sampleRate = 0
    let channels = 1
    let bitrate = 0

    const audioMatch = stderr.match(/Stream #\d+:\d+(?:\[0x[0-9a-f]+\])?(?:\([^)]*\))?:\s*Audio:\s*([^,\n]+)(?:,\s*(\d+)\s*Hz)?(?:,\s*([^,\n]+))?(?:,\s*([^\n,]+))?(?:,\s*(\d+)\s*kb\/s)?/)
    if (audioMatch) {
      const rawCodec = (audioMatch[1] || "").trim().toLowerCase()
      // Clean codec string by removing parenthetical info (e.g. "pcm_s16le ([1][0]...)" -> "pcm_s16le", "aac (LC)" -> "aac")
      codec = rawCodec.split(/[\s(]/)[0]
      sampleRate = parseInt(audioMatch[2], 10) || 44100
      const chStr = (audioMatch[3] || "").toLowerCase()
      const isStereo = /stereo|2\s*channels/i.test(stderr)
      const isMono = /mono|1\s*channels/i.test(stderr)
      channels = isStereo ? 2 : (isMono ? 1 : (chStr.includes("stereo") ? 2 : 1))
      bitrate = parseInt(audioMatch[5], 10) || 128
    }

    // Precise format & container detection to avoid misidentifying WAV, WebM, AMR, μ-law as MP3
    const isWav = format.includes("wav") || codec.startsWith("pcm_")
    const isWebm = format.includes("webm") || format.includes("matroska") || codec === "opus" || codec === "vorbis"
    const isAmr = format.includes("amr") || codec.startsWith("amr")
    const isM4a = (format.includes("mp4") || format.includes("m4a") || format.includes("mov")) && !format.includes("mp3")
    const isOgg = format.includes("ogg") && !format.includes("mp3")
    const isMulaw = codec === "pcm_mulaw"

    // File is ONLY MP3 if codec is mp3/mp3float AND container is not WAV, WebM, AMR, OGG, or MP4
    const isMp3 = !isWav && !isWebm && !isAmr && !isM4a && !isOgg && (codec.startsWith("mp3") || (format === "mp3" && !codec.startsWith("pcm_")))

    return {
      isValid: true,
      duration,
      codec,
      format,
      channels,
      sampleRate,
      bitrate,
      sizeBytes: stat.size,
      isMp3,
      isWav,
      isWebm,
      isAmr,
      isM4a,
      isMulaw,
    }
  } catch (err) {
    return {
      isValid: false,
      duration: 0,
      codec: "error",
      format: "unknown",
      channels: 0,
      sampleRate: 0,
      bitrate: 0,
      sizeBytes: stat.size,
      error: err.message,
    }
  }
}

/**
 * Converts any supported audio file to browser-compatible MP3:
 * Constant bit rate: 128 kbps, Sample rate: 44.1 kHz, matching channels (stereo/mono)
 *
 * @param {string} inputPath - Path to source audio file
 * @param {string} [outputPath] - Destination path for MP3 (optional, auto-generated if omitted)
 * @returns {Promise<{outputPath: string, sizeBytes: number, duration: number, sha256: string}>}
 */
async function convertToMp3(inputPath, outputPath = null) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Input audio file does not exist for conversion")
  }

  const stat = fs.statSync(inputPath)
  if (stat.size === 0) {
    throw new Error("Cannot convert empty (0 bytes) audio file")
  }

  // Pre-validate input
  const probe = await probeAudio(inputPath)
  if (!probe.isValid) {
    throw new Error(`Cannot convert audio: ${probe.error || "Input file is corrupt or not valid audio"}`)
  }

  const finalOutput = outputPath || path.join(os.tmpdir(), `converted_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.mp3`)

  // Bypass transcoding if input is already a valid MP3 — avoids unnecessary re-encoding and quality loss
  if (probe.isMp3) {
    if (path.resolve(inputPath) !== path.resolve(finalOutput)) {
      fs.copyFileSync(inputPath, finalOutput)
    }
    const hash = crypto.createHash("sha256")
    const fileBuf = fs.readFileSync(finalOutput)
    hash.update(fileBuf)
    const sha256 = hash.digest("hex")

    return {
      outputPath: finalOutput,
      sizeBytes: stat.size,
      duration: probe.duration || 0,
      sha256,
      reEncoded: false,
    }
  }

  // Voice Call Audio Preservation:
  // 1. Maintain native channel count (mono for 1-channel phone calls) to prevent out-of-phase robotic/alien hollow voice
  // 2. Use aresample with async=1000 to correct any mobile frame timestamp drift without altering human pitch or tempo
  const channelArgs = probe.channels === 1 ? ["-ac", "1"] : ["-ac", "2"]
  const sampleRateArgs = probe.sampleRate && [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(probe.sampleRate)
    ? ["-ar", String(probe.sampleRate)]
    : ["-ar", "44100"]

  const ffmpegArgs = [
    "-y",
    "-i", inputPath,
    "-vn", // Drop video stream if container had one
    "-acodec", "libmp3lame",
    "-b:a", "128k",
    ...channelArgs,
    ...sampleRateArgs,
    "-af", "aresample=async=1000:first_pts=0",
    finalOutput,
  ]

  try {
    await runFFmpeg(ffmpegArgs, 60000)

    if (!fs.existsSync(finalOutput)) {
      throw new Error("FFmpeg completed but output MP3 file was not created")
    }

    const outStat = fs.statSync(finalOutput)
    if (outStat.size === 0) {
      fs.unlinkSync(finalOutput)
      throw new Error("FFmpeg generated an empty (0 bytes) MP3 file")
    }

    // Measure duration and checksum
    const outProbe = await probeAudio(finalOutput)
    const hash = crypto.createHash("sha256")
    const fileBuf = fs.readFileSync(finalOutput)
    hash.update(fileBuf)
    const sha256 = hash.digest("hex")

    return {
      outputPath: finalOutput,
      sizeBytes: outStat.size,
      duration: outProbe.duration || probe.duration || 0,
      sha256,
    }
  } catch (err) {
    if (fs.existsSync(finalOutput)) {
      try {
        fs.unlinkSync(finalOutput)
      } catch (_) {}
    }
    throw err
  }
}

/**
 * Deduplicated runner to ensure only one conversion runs per call/file concurrently
 */
function runDeduplicatedConversion(key, taskFn) {
  if (inProgressConversions.has(key)) {
    return inProgressConversions.get(key)
  }
  const promise = (async () => {
    try {
      return await taskFn()
    } finally {
      inProgressConversions.delete(key)
    }
  })()
  inProgressConversions.set(key, promise)
  return promise
}

const https = require("https")
const http = require("http")

/**
 * Pure helper computing 10-minute (600s) chunk intervals with 5-second overlap.
 */
function computeAudioChunkPlan({ totalDurationSec = 0, chunkDurationSec = 600, overlapSec = 5 } = {}) {
  const duration = Number(totalDurationSec) || 0
  const chunkLen = Math.max(1, Number(chunkDurationSec) || 600)
  const overlap = Math.max(0, Number(overlapSec) || 0)

  if (duration <= 0) {
    return []
  }

  if (duration <= chunkLen) {
    return [
      {
        index: 0,
        startSec: 0,
        offsetSeconds: 0,
        extractDurationSec: Math.round(duration * 100) / 100,
      },
    ]
  }

  const plan = []
  let index = 0
  let startSec = 0
  while (startSec < duration - 0.25) {
    const remaining = duration - startSec
    const extractDurationSec = Math.min(chunkLen + overlap, remaining)
    plan.push({
      index,
      startSec,
      offsetSeconds: startSec,
      extractDurationSec: Math.round(extractDurationSec * 100) / 100,
    })
    if (remaining <= chunkLen) {
      break
    }
    startSec += chunkLen
    index++
  }
  return plan
}

/**
 * Downloads a Call recording from GridFS or remote CDN directly to a temporary file on disk
 * without buffering large multi-megabyte recordings completely in Node RAM.
 */
async function downloadRecordingToTempFile({ call, timeoutMs = 180000 }) {
  if (!call || !call.recording) {
    throw new Error("Call object does not contain valid recording metadata.")
  }

  const rec = call.recording
  const fileId = rec.mp3FileId || rec.fileId
  const tempPath = path.join(os.tmpdir(), `call_rec_${call._id || Date.now()}_${crypto.randomBytes(6).toString("hex")}.audio`)

  const safeCleanup = () => {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch (_) {}
  }

  if (fileId) {
    const recordingStorage = require("./recordingStorage")
    const mongoose = require("mongoose")
    return new Promise((resolve, reject) => {
      let settled = false
      let writeStream = null
      let downloadStream = null
      let timer = null

      const fail = (err) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        try { downloadStream?.destroy() } catch (_) {}
        try { writeStream?.destroy() } catch (_) {}
        safeCleanup()
        reject(err)
      }

      try {
        const bucket = recordingStorage.getBucket()
        const objectId = typeof fileId === "string" ? new mongoose.Types.ObjectId(fileId) : fileId
        downloadStream = bucket.openDownloadStream(objectId)
        writeStream = fs.createWriteStream(tempPath)
        let sizeBytes = 0

        downloadStream.on("data", (chunk) => {
          sizeBytes += chunk.length
        })

        downloadStream.on("error", (err) => {
          fail(new Error(`Failed to retrieve recording from GridFS: ${err.message}`))
        })

        writeStream.on("error", (err) => {
          fail(new Error(`Failed writing temp recording file: ${err.message}`))
        })

        writeStream.on("finish", () => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          resolve({
            filePath: tempPath,
            sizeBytes,
            mimeType: rec.mp3FileId ? "audio/mp3" : (rec.mimeType || "audio/mp3"),
            cleanup: safeCleanup,
          })
        })

        timer = setTimeout(() => {
          fail(new Error(`GridFS audio download timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
        }, timeoutMs)

        downloadStream.pipe(writeStream)
      } catch (err) {
        fail(new Error(`GridFS download initialization error: ${err.message}`))
      }
    })
  }

  const downloadUrlToTemp = (targetUrl, redirectDepth = 0) => {
    if (redirectDepth > 5) {
      return Promise.reject(new Error("Too many redirects while downloading remote recording."))
    }
    return new Promise((resolve, reject) => {
      let settled = false
      let writeStream = null
      let req = null
      let timer = null

      const fail = (err) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        try { req?.destroy() } catch (_) {}
        try { writeStream?.destroy() } catch (_) {}
        safeCleanup()
        reject(err)
      }

      try {
        const parsed = new URL(targetUrl)
        const client = parsed.protocol === "https:" ? https : http
        req = client.get(targetUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            if (timer) clearTimeout(timer)
            settled = true
            return downloadUrlToTemp(res.headers.location, redirectDepth + 1).then(resolve, reject)
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume()
            return fail(new Error(`HTTP ${res.statusCode} while fetching remote recording from CDN.`))
          }

          writeStream = fs.createWriteStream(tempPath)
          let sizeBytes = 0
          const contentType = (res.headers["content-type"] || "audio/mp3").split(";")[0].trim()

          res.on("data", (chunk) => {
            sizeBytes += chunk.length
          })
          res.on("error", (err) => fail(new Error(`Remote stream error: ${err.message}`)))
          writeStream.on("error", (err) => fail(new Error(`Failed writing temp remote file: ${err.message}`)))
          writeStream.on("finish", () => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            resolve({
              filePath: tempPath,
              sizeBytes,
              mimeType: contentType,
              cleanup: safeCleanup,
            })
          })

          res.pipe(writeStream)
        })

        req.on("error", (err) => fail(new Error(`Remote audio request error: ${err.message}`)))
        timer = setTimeout(() => {
          fail(new Error(`Remote audio download timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
        }, timeoutMs)
      } catch (err) {
        fail(new Error(`Invalid remote audio URL: ${err.message}`))
      }
    })
  }

  const remoteUrl = rec.imagekitMp3Url || rec.imagekitUrl || rec.url
  if (remoteUrl) {
    return downloadUrlToTemp(remoteUrl)
  }

  throw new Error("Call recording has neither a GridFS fileId nor an active remote storage URL.")
}

/**
 * Splits a long audio file into sequential 10-minute MP3 chunks (with 5-second overlap)
 * inside an isolated temporary directory so callers can transcribe and clean up safely.
 */
async function splitAudioIntoChunks({
  inputPath,
  totalDurationSec = 0,
  chunkDurationSec = 600,
  overlapSec = 5,
  chunkTimeoutMs = 180000,
}) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("Input audio file does not exist for chunking.")
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leads365_audio_chunks_"))
  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (_) {}
  }

  try {
    let resolvedDuration = Number(totalDurationSec) || 0
    const probed = await probeAudio(inputPath)
    if (probed?.isValid && probed.duration > 0) {
      // Authoritative media stream duration prevents seeking past EOF when Call metadata disagrees
      resolvedDuration = Number(probed.duration)
    } else if (resolvedDuration <= 0) {
      throw new Error(`Invalid audio file: ${probed?.error || "Unable to decode audio stream"}`)
    }

    const chunks = []

    if (resolvedDuration > 0) {
      const plan = computeAudioChunkPlan({
        totalDurationSec: resolvedDuration,
        chunkDurationSec,
        overlapSec,
      })

      for (const spec of plan) {
        const outPath = path.join(tempDir, `chunk_${String(spec.index).padStart(3, "0")}.mp3`)
        const args = [
          "-y",
          "-ss", String(spec.startSec),
          "-t", String(spec.extractDurationSec),
          "-i", inputPath,
          "-vn",
          "-acodec", "libmp3lame",
          "-b:a", "64k",
          "-ac", "1",
          "-ar", "16000",
          outPath,
        ]
        await runFFmpeg(args, chunkTimeoutMs)

        if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
          throw new Error(`FFmpeg failed to produce chunk ${spec.index}.`)
        }
        const stat = fs.statSync(outPath)
        chunks.push({
          index: spec.index,
          startSec: spec.startSec,
          offsetSeconds: spec.offsetSeconds,
          durationSec: spec.extractDurationSec,
          filePath: outPath,
          sizeBytes: stat.size,
          mimeType: "audio/mp3",
        })
      }
    } else {
      // Fallback segment splitting when container lacks duration metadata
      const segPattern = path.join(tempDir, "chunk_%03d.mp3")
      await runFFmpeg(
        [
          "-y",
          "-i", inputPath,
          "-vn",
          "-f", "segment",
          "-segment_time", String(chunkDurationSec),
          "-acodec", "libmp3lame",
          "-b:a", "64k",
          "-ac", "1",
          "-ar", "16000",
          segPattern,
        ],
        chunkTimeoutMs
      )

      const files = fs
        .readdirSync(tempDir)
        .filter((f) => f.endsWith(".mp3"))
        .sort()

      if (files.length === 0) {
        throw new Error("FFmpeg produced zero audio chunks during segmentation.")
      }

      let cumulativeOffset = 0
      for (let i = 0; i < files.length; i++) {
        const fp = path.join(tempDir, files[i])
        const stat = fs.statSync(fp)
        const p = await probeAudio(fp)
        const dur = Number(p.duration) || chunkDurationSec
        chunks.push({
          index: i,
          startSec: cumulativeOffset,
          offsetSeconds: cumulativeOffset,
          durationSec: dur,
          filePath: fp,
          sizeBytes: stat.size,
          mimeType: "audio/mp3",
        })
        cumulativeOffset += dur
      }
      resolvedDuration = cumulativeOffset
    }

    return {
      tempDir,
      totalDurationSec: resolvedDuration,
      chunks,
      cleanup,
    }
  } catch (err) {
    cleanup()
    throw err
  }
}

module.exports = {
  getFfmpegPath: () => ffmpegPath,
  probeAudio,
  convertToMp3,
  runDeduplicatedConversion,
  computeAudioChunkPlan,
  downloadRecordingToTempFile,
  splitAudioIntoChunks,
}

