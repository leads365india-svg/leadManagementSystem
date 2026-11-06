const MockTelephonyAdapter = require("./mockTelephonyAdapter.service")
const TwilioAdapter = require("./twilioAdapter.service")
const ExotelAdapter = require("./exotelAdapter.service")

/**
 * Telephony Provider Adapter Factory
 * 
 * Provides unified access to provider implementations:
 * - MockTelephonyAdapter ('mock')
 * - TwilioAdapter ('twilio')
 * - ExotelAdapter ('exotel')
 */

const adapterRegistry = new Map()

// Register default singleton instances
const mockAdapter = new MockTelephonyAdapter()
const twilioAdapter = new TwilioAdapter()
const exotelAdapter = new ExotelAdapter()

adapterRegistry.set("mock", mockAdapter)
adapterRegistry.set("twilio", twilioAdapter)
adapterRegistry.set("exotel", exotelAdapter)

/**
 * Retrieves the adapter implementation for a telephony provider.
 * @param {string} provider - Provider identifier ('mock' | 'twilio' | 'exotel' | etc.)
 * @returns {TelephonyAdapterInterface}
 */
function getTelephonyAdapter(provider = "mock") {
  const normalized = (provider || "mock").toLowerCase().trim()
  const adapter = adapterRegistry.get(normalized)
  if (!adapter) {
    throw new Error(`Unsupported telephony provider: '${provider}'`)
  }
  return adapter
}

/**
 * Overrides or registers an adapter instance (used for testing or custom PBX adapters).
 * @param {string} provider
 * @param {TelephonyAdapterInterface} adapter
 */
function registerTelephonyAdapter(provider, adapter) {
  if (!provider || !adapter) return
  adapterRegistry.set(provider.toLowerCase().trim(), adapter)
}

module.exports = {
  getTelephonyAdapter,
  registerTelephonyAdapter,
  MockTelephonyAdapter,
  TwilioAdapter,
  ExotelAdapter,
}

