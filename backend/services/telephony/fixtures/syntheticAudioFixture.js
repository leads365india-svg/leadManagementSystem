const crypto = require("crypto")

/**
 * Synthetic Audio Fixture Generator
 * 
 * Generates valid, deterministic in-memory WAV audio buffers
 * for local testing of audio ingestion, checksum verification,
 * and range playback without touching physical disks or external media.
 */

function createSyntheticWavBuffer({ durationSeconds = 2, sampleRate = 8000, numChannels = 1 } = {}) {
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const totalSamples = Math.floor(sampleRate * durationSeconds)
  const dataSize = totalSamples * blockAlign
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const buffer = Buffer.alloc(totalSize)

  // 1. RIFF chunk descriptor
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(totalSize - 8, 4)
  buffer.write("WAVE", 8)

  // 2. fmt sub-chunk
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20)  // AudioFormat (1 for linear PCM)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34) // BitsPerSample (16-bit)

  // 3. data sub-chunk
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)

  // 4. Deterministic gentle sine wave (440Hz A tone) to simulate real speech audio frames
  const frequency = 440
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    const sampleVal = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 16000)
    buffer.writeInt16LE(sampleVal, headerSize + (i * 2))
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")

  return {
    buffer,
    sizeBytes: buffer.length,
    durationSeconds,
    sampleRate,
    numChannels,
    sha256,
    mimeType: "audio/wav",
  }
}

module.exports = {
  createSyntheticWavBuffer,
}

