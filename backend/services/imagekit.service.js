const ImageKit = require("imagekit")

/**
 * ImageKit Configuration and Client Service
 * 
 * Provides:
 * 1. Safe access to ImageKit Node.js SDK with environment variable validation.
 * 2. Graceful fallback when credentials are not yet configured.
 * 3. Mock injection capability for automated unit and integration tests.
 * 4. Helper for generating short-lived signed URLs for private media access.
 */

let mockClient = null

/**
 * Checks whether ImageKit environment variables are fully configured.
 * @returns {boolean}
 */
function isImageKitConfigured() {
  if (mockClient) return true

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY
  const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT

  return Boolean(
    publicKey &&
    privateKey &&
    urlEndpoint &&
    publicKey.trim().length > 0 &&
    privateKey.trim().length > 0 &&
    urlEndpoint.trim().length > 0 &&
    !publicKey.includes("your-imagekit") &&
    !privateKey.includes("your-imagekit")
  )
}

/**
 * Returns an initialized ImageKit client instance.
 * Throws a clean descriptive error if ImageKit is not configured.
 * @returns {ImageKit}
 */
function getImageKitClient() {
  if (mockClient) {
    return mockClient
  }

  if (!isImageKitConfigured()) {
    const error = new Error(
      "ImageKit credentials are not configured. Please set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT in your environment variables."
    )
    error.code = "IMAGEKIT_NOT_CONFIGURED"
    error.statusCode = 503
    throw error
  }

  return new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY.trim(),
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY.trim(),
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT.trim(),
  })
}

/**
 * Injects a mock ImageKit client for automated testing.
 * @param {Object} mock
 */
function setMockClient(mock) {
  mockClient = mock
}

/**
 * Clears any injected mock client.
 */
function clearMockClient() {
  mockClient = null
}

/**
 * Generates an authenticated short-lived signed URL for a private file.
 * 
 * @param {Object} options
 * @param {string} [options.path] - File path (e.g. /lead-management/tenant_1/recordings/call_123.mp3)
 * @param {string} [options.url] - Full ImageKit file URL
 * @param {number} [options.expireSeconds=300] - Expiry time in seconds (default 5 minutes)
 * @returns {string} Signed URL
 */
function getSignedUrl({ path, url, expireSeconds = 300 }) {
  const client = getImageKitClient()
  const options = {
    signed: true,
    expireSeconds,
  }

  if (url) {
    options.src = url
  } else if (path) {
    options.path = path.startsWith("/") ? path : `/${path}`
  } else {
    throw new Error("Either path or url must be provided to generate a signed URL")
  }

  return client.url(options)
}

/**
 * Generates client-side authentication parameters if direct client upload is used.
 * @param {string} [token]
 * @param {number} [expire]
 * @returns {Object} { token, expire, signature }
 */
function getAuthenticationParameters(token, expire) {
  const client = getImageKitClient()
  return client.getAuthenticationParameters(token, expire)
}

module.exports = {
  isImageKitConfigured,
  getImageKitClient,
  setMockClient,
  clearMockClient,
  getSignedUrl,
  getAuthenticationParameters,
}

