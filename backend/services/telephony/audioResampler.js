/**
 * Real-Time Audio Resampler & Codec Transcoder
 * 
 * High-performance, zero-external-dependency audio transcoder for real-time telephony:
 * - ITU-T G.711 u-law (PCMU) <-> 16-bit Linear PCM (PCM16)
 * - Sample rate conversion (8kHz telephony <-> 16kHz/24kHz AI models)
 * - Pure Node.js Buffer operations with O(1) table lookups
 */

// 1. Precompute G.711 u-law to 16-bit Linear PCM Lookup Table (256 entries)
const ULAW_TO_PCM16_TABLE = new Int16Array(256)
for (let i = 0; i < 256; i++) {
  let u = ~i & 0xff
  let sign = u & 0x80
  let exponent = (u >> 4) & 0x07
  let mantissa = u & 0x0f
  let sample = ((mantissa << 3) + 0x84) << exponent
  sample -= 0x84
  ULAW_TO_PCM16_TABLE[i] = sign !== 0 ? -sample : sample
}

// 2. Linear PCM 16-bit to G.711 u-law Encoding
const CLIP = 32635
const BIAS = 0x84

function linearSampleToMulaw(pcmSample) {
  let sign = 0
  let sample = pcmSample

  if (sample < 0) {
    sample = -sample
    sign = 0x80
  }

  if (sample > CLIP) {
    sample = CLIP
  }

  sample += BIAS

  let exponent = 7
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--
  }

  let mantissa = (sample >> (exponent + 3)) & 0x0f
  let mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff
  return mulawByte
}

/**
 * Transcodes 8-bit G.711 u-law buffer to 16-bit linear PCM buffer.
 * @param {Buffer} mulawBuffer - Inbound 8-bit u-law audio buffer
 * @returns {Buffer} 16-bit signed little-endian PCM buffer (2x size)
 */
function mulawToPcm16(mulawBuffer) {
  if (!mulawBuffer || mulawBuffer.length === 0) {
    return Buffer.alloc(0)
  }

  const sampleCount = mulawBuffer.length
  const pcmBuffer = Buffer.allocUnsafe(sampleCount * 2)

  for (let i = 0; i < sampleCount; i++) {
    const pcmSample = ULAW_TO_PCM16_TABLE[mulawBuffer[i]]
    pcmBuffer.writeInt16LE(pcmSample, i * 2)
  }

  return pcmBuffer
}

/**
 * Transcodes 16-bit linear PCM buffer to 8-bit G.711 u-law buffer.
 * @param {Buffer} pcmBuffer - Inbound 16-bit signed LE PCM buffer
 * @returns {Buffer} 8-bit u-law audio buffer (1/2 size)
 */
function pcm16ToMulaw(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length === 0) {
    return Buffer.alloc(0)
  }

  const sampleCount = Math.floor(pcmBuffer.length / 2)
  const mulawBuffer = Buffer.allocUnsafe(sampleCount)

  for (let i = 0; i < sampleCount; i++) {
    const pcmSample = pcmBuffer.readInt16LE(i * 2)
    mulawBuffer[i] = linearSampleToMulaw(pcmSample)
  }

  return mulawBuffer
}

/**
 * Resamples 16-bit linear PCM audio between sample rates using linear interpolation.
 * 
 * @param {Object} params
 * @param {Buffer} params.inputBuffer - 16-bit signed LE PCM buffer
 * @param {number} params.fromSampleRate - e.g. 8000, 16000, 24000
 * @param {number} params.toSampleRate - e.g. 8000, 16000, 24000
 * @returns {Buffer} Resampled 16-bit signed LE PCM buffer
 */
function resamplePcm16({ inputBuffer, fromSampleRate, toSampleRate }) {
  if (!inputBuffer || inputBuffer.length === 0) {
    return Buffer.alloc(0)
  }

  if (fromSampleRate === toSampleRate) {
    return inputBuffer
  }

  const inSamples = Math.floor(inputBuffer.length / 2)
  if (inSamples === 0) {
    return Buffer.alloc(0)
  }

  const ratio = toSampleRate / fromSampleRate
  const outSamples = Math.round(inSamples * ratio)
  const outputBuffer = Buffer.allocUnsafe(outSamples * 2)

  for (let i = 0; i < outSamples; i++) {
    const srcIndexFloat = i / ratio
    const srcIndex1 = Math.floor(srcIndexFloat)
    const srcIndex2 = Math.min(srcIndex1 + 1, inSamples - 1)
    const fraction = srcIndexFloat - srcIndex1

    const s1 = inputBuffer.readInt16LE(srcIndex1 * 2)
    const s2 = inputBuffer.readInt16LE(srcIndex2 * 2)

    // Linear interpolation
    const interpolated = Math.round(s1 + (s2 - s1) * fraction)
    const clamped = Math.max(-32768, Math.min(32767, interpolated))

    outputBuffer.writeInt16LE(clamped, i * 2)
  }

  return outputBuffer
}

/**
 * Convenience helper: Normalizes raw provider audio to 16kHz 16-bit PCM (AI engine format).
 * @param {Object} params
 * @param {Buffer} params.payload - Inbound raw audio frame
 * @param {string} params.codec - 'pcmu' | 'pcm16'
 * @param {number} params.sampleRate - e.g. 8000
 * @param {number} [params.targetSampleRate=16000]
 * @returns {Buffer} Normalized 16-bit PCM at target sample rate
 */
function normalizeInboundAudio({ payload, codec = "pcmu", sampleRate = 8000, targetSampleRate = 16000 }) {
  let pcmBuffer = payload

  if (codec === "pcmu") {
    pcmBuffer = mulawToPcm16(payload)
  }

  if (sampleRate !== targetSampleRate) {
    pcmBuffer = resamplePcm16({
      inputBuffer: pcmBuffer,
      fromSampleRate: sampleRate,
      toSampleRate: targetSampleRate,
    })
  }

  return pcmBuffer
}

/**
 * Convenience helper: Encodes AI engine 16kHz PCM audio to provider format (e.g. 8kHz PCMU).
 * @param {Object} params
 * @param {Buffer} params.payload - AI engine 16-bit PCM audio buffer
 * @param {number} [params.sourceSampleRate=16000]
 * @param {string} [params.targetCodec="pcmu"] - 'pcmu' | 'pcm16'
 * @param {number} [params.targetSampleRate=8000]
 * @returns {Buffer} Provider-ready audio payload
 */
function encodeOutboundAudio({ payload, sourceSampleRate = 16000, targetCodec = "pcmu", targetSampleRate = 8000 }) {
  let pcmBuffer = payload

  if (sourceSampleRate !== targetSampleRate) {
    pcmBuffer = resamplePcm16({
      inputBuffer: pcmBuffer,
      fromSampleRate: sourceSampleRate,
      toSampleRate: targetSampleRate,
    })
  }

  if (targetCodec === "pcmu") {
    return pcm16ToMulaw(pcmBuffer)
  }

  return pcmBuffer
}

module.exports = {
  mulawToPcm16,
  pcm16ToMulaw,
  resamplePcm16,
  normalizeInboundAudio,
  encodeOutboundAudio,
}

