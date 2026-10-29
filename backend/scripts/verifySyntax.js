const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

function scan(dir) {
  let files = []
  if (!fs.existsSync(dir)) return files
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) {
      if (f !== "node_modules" && f !== ".git" && f !== ".next") {
        files = files.concat(scan(p))
      }
    } else if (f.endsWith(".js") || f.endsWith(".mjs")) {
      files.push(p)
    }
  })
  return files
}

const jsFiles = scan(path.resolve(__dirname, ".."))
console.log(`Checking syntax of ${jsFiles.length} backend JS/MJS files...`)
let errCount = 0

jsFiles.forEach((f) => {
  try {
    execSync(`node -c "${f}"`, { stdio: "pipe" })
  } catch (err) {
    console.error("Syntax error in:", f, err.message)
    errCount++
  }
})

if (errCount === 0) {
  console.log(`[PASS] All ${jsFiles.length} backend files have valid JavaScript syntax!`)
  process.exit(0)
} else {
  console.error(`[FAIL] ${errCount} files failed syntax check!`)
  process.exit(1)
}
