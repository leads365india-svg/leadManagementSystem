const mongoose = require("mongoose")
const tenantIsolationPlugin = require("../plugins/tenantIsolationPlugin")

/**
 * IdempotencyReservation Model - Phase 2: Reliable Idempotency
 *
 * Provides atomic, distributed reservation/claim mechanism across application instances.
 * - Keyed by compound _id: `${tenantId}:${sha256(idempotencyKey)}` (MongoDB native unique primary key)
 * - Hashes raw idempotency key; never stores credentials or secrets in plaintext
 * - Tracks payload SHA-256 hash to reject conflicting payloads with HTTP 409
 * - Caches completed response to prevent duplicate lead creation and repeated side effects
 * - Allows safe retries on genuine failures without duplicating committed leads
 */

const idempotencyReservationSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // `${tenantId}:${keyHash}`
      required: true,
    },
    tenantId: {
      type: String,
      required: [true, "Tenant ID is required for idempotency reservation"],
      index: true,
      trim: true,
    },
    integrationId: {
      type: String,
      default: null,
      index: true,
      trim: true,
    },
    keyHash: {
      type: String,
      required: true,
      index: true,
    },
    payloadHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },
    error: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: "idempotency_reservations",
  }
)

// Ambient multi-tenant isolation
idempotencyReservationSchema.plugin(tenantIsolationPlugin, { tenantField: "tenantId" })

const IdempotencyReservation =
  mongoose.models.IdempotencyReservation ||
  mongoose.model("IdempotencyReservation", idempotencyReservationSchema)

module.exports = {
  IdempotencyReservation,
}
