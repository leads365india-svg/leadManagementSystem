const fs = require("fs")
const path = require("path")

const storagePath = path.resolve(__dirname, "../services/recordingStorage.js")
let content = fs.readFileSync(storagePath, "utf8").replace(/\r\n/g, "\n")

const targetStr = `  if (call.recording.status !== "stored" || !call.recording.fileId) {
    return res.status(404).json({
      success: false,
      error: "No audio recording available for this call",
      status: call.recording?.status || "none",
    })
  }`

const replacementStr = `  if (!call.recording || call.recording.status !== "stored" || !call.recording.fileId) {
    // Check if recording is stored on filesystem via mobile sync
    const rawPath = call.metadata?.recordingUrl || call.recordingUrl
    if (rawPath) {
      const path = require("path")
      const fs = require("fs")
      const safeTenantId = (tenantId || "default").replace(/[^a-zA-Z0-9_-]/g, "")
      const fileName = path.basename(rawPath)
      const filePath = path.join(__dirname, "../uploads/recordings", safeTenantId, fileName)
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath)
        if (stats.size > 0) {
          const mobileController = require("../controllers/mobileController")
          if (typeof mobileController.streamAudioFile === "function") {
            return mobileController.streamAudioFile(
              { headers: { range: rangeHeader } },
              res,
              filePath,
              call.metadata?.recordingMimeType
            )
          }
        }
      }
    }

    return res.status(404).json({
      success: false,
      error: "No audio recording available for this call",
      status: call.recording?.status || "none",
    })
  }`

if (!content.includes(targetStr)) {
  console.error("targetStr not found in recordingStorage.js")
  process.exit(1)
}

content = content.replace(targetStr, replacementStr)

// Also ensure empty files (0 bytes) return a descriptive 404 rather than an empty 200 stream
const targetLenStr = `  const totalLength = file.length
  const mimeType = file.contentType || file.metadata?.mimeType || "audio/mp4"`

const replacementLenStr = `  const totalLength = file.length
  if (!totalLength || totalLength <= 0) {
    return res.status(404).json({
      success: false,
      error: "Audio recording file is empty (0 bytes)",
      status: "empty",
    })
  }
  const mimeType = file.contentType || file.metadata?.mimeType || "audio/mp4"`

if (content.includes(targetLenStr)) {
  content = content.replace(targetLenStr, replacementLenStr)
}

fs.writeFileSync(storagePath, content, "utf8")
console.log("Successfully patched recordingStorage.js!")
