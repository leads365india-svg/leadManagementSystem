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
      codec = (audioMatch[1] || "").trim().toLowerCase()
      sampleRate = parseInt(audioMatch[2], 10) || 44100
      const chStr = (audioMatch[3] || "").toLowerCase()
      channels = chStr.includes("stereo") ? 2 : 1
      bitrate = parseInt(audioMatch[5], 10) || 128
    }

    const isMp3 = codec.includes("mp3") || format.includes("mp3")

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

  const ffmpegArgs = [
    "-y",
    "-i", inputPath,
    "-vn", // Drop video stream if container had one
    "-acodec", "libmp3lame",
    "-b:a", "128k",
    "-ar", "44100",
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

module.exports = {
  getFfmpegPath: () => ffmpegPath,
  probeAudio,
  convertToMp3,
  runDeduplicatedConversion,
}

