const { getTenantContext } = require("../middleware/tenantContext")

/**
 * Mongoose Tenant Isolation Plugin
 * Complies with Roadmap Phase 3: Tenant isolation layer.
 * 
 * Automatically enforces tenant boundary partitioning on all read and write queries
 * based on ambient AsyncLocalStorage context. Eliminates the risk of developer error
 * or missed manual filters exposing cross-tenant records.
 */

const QUERY_OPS = [
  "find",
  "findOne",
  "countDocuments",
  "findOneAndUpdate",
  "updateMany",
  "updateOne",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
]

function tenantIsolationPlugin(schema, options = {}) {
  const tenantField = options.tenantField || "tenantId"

  // 1. Query Hook: Automatically inject tenantId into filter or reject invalid queries
  schema.pre(QUERY_OPS, function () {
    const context = getTenantContext()
    const queryOptions = this.getOptions() || {}

    // Check if query explicitly requested a bypass (e.g. system migrations or super admin root view)
    if (queryOptions.skipTenantFilter === true) {
      return
    }

    const currentQuery = this.getQuery() || {}

    // If no ambient context:
    if (!context) {
      // If the query explicitly provided a tenantId or document _id, allow it (e.g. background job, test harness, or direct ID lookup)
      if (
        (currentQuery[tenantField] !== undefined && currentQuery[tenantField] !== null) ||
        (currentQuery._id !== undefined && currentQuery._id !== null)
      ) {
        return
      }
      // Fail-safe: throw error if query on tenant-scoped model is executed without tenant context or explicit filter
      throw new Error(
        `Tenant context missing: Query on tenant-scoped model executed without ambient tenant context or explicit tenantId. Use runWithTenantContext() or set { skipTenantFilter: true }.`
      )
    }

    // Super Admin without a specific target tenantId can query cross-tenant
    if (context.isSuperAdmin && !context.tenantId) {
      return
    }

    const effectiveTenantId = context.tenantId
    if (!effectiveTenantId) {
      throw new Error(`Tenant context invalid: Non-superadmin context has no tenantId.`)
    }

    // Apply tenant filter safely
    if (currentQuery[tenantField] !== undefined && currentQuery[tenantField] !== null) {
      // If a specific tenantId was already passed in query, enforce that it matches ambient tenant
      if (String(currentQuery[tenantField]) !== String(effectiveTenantId) && !context.isSuperAdmin) {
        throw new Error(
          `Cross-tenant query violation: Query attempted with tenantId '${currentQuery[tenantField]}' in context of '${effectiveTenantId}'`
        )
      }
    } else {
      currentQuery[tenantField] = effectiveTenantId
    }

    this.setQuery(currentQuery)
  })

  // 2. Aggregate Hook: Inject tenantId match into aggregation pipeline
  schema.pre("aggregate", function () {
    const context = getTenantContext()
    const aggOptions = this.options || {}

    if (aggOptions.skipTenantFilter === true) {
      return
    }

    if (!context) {
      const pipeline = this.pipeline()
      if (pipeline && pipeline.length > 0 && pipeline[0].$match && pipeline[0].$match[tenantField]) {
        return
      }
      throw new Error(
        `Tenant context missing: Aggregation on tenant-scoped collection executed without ambient tenant context or explicit tenant filter.`
      )
    }

    if (context.isSuperAdmin && !context.tenantId) {
      return
    }

    const effectiveTenantId = context.tenantId
    if (!effectiveTenantId) {
      throw new Error(`Tenant context invalid: Non-superadmin context has no tenantId.`)
    }

    this.pipeline().unshift({ $match: { [tenantField]: effectiveTenantId } })
  })

  // 3. Document Validate Hook: Automatically stamp tenantId from ambient context before schema validation
  schema.pre("validate", function (next) {
    const context = getTenantContext()
    if (!this[tenantField] && context && context.tenantId) {
      this[tenantField] = context.tenantId
    }
    next()
  })

  // 4. Document Save Hook: Automatically stamp tenantId on insert/save and prevent cross-tenant overwrite
  schema.pre("save", function (next) {
    const context = getTenantContext()
    const saveOptions = (this.$__ && this.$__.saveOptions) || {}

    if (saveOptions.skipTenantFilter === true) {
      return next()
    }

    if (!context) {
      if (this[tenantField]) {
        return next()
      }
      return next(
        new Error(
          `Tenant context missing: Cannot save tenant-scoped document without tenant context or explicit tenantId.`
        )
      )
    }

    // If tenantId is not set, automatically stamp from ambient context
    if (!this[tenantField] && context.tenantId) {
      this[tenantField] = context.tenantId
    } else if (
      this[tenantField] &&
      context.tenantId &&
      String(this[tenantField]) !== String(context.tenantId) &&
      !context.isSuperAdmin
    ) {
      return next(
        new Error(
          `Cross-tenant mutation denied: Cannot save document for tenant '${this[tenantField]}' in context of '${context.tenantId}'`
        )
      )
    }

    next()
  })

  // 4. InsertMany Hook: Automatically stamp tenantId on bulk inserts
  schema.pre("insertMany", function (next, docs) {
    const context = getTenantContext()
    if (!Array.isArray(docs)) return next()

    for (const doc of docs) {
      if (!context) {
        if (!doc[tenantField]) {
          return next(
            new Error(
              `Tenant context missing: Cannot insert document without tenant context or explicit tenantId.`
            )
          )
        }
      } else {
        if (!doc[tenantField] && context.tenantId) {
          doc[tenantField] = context.tenantId
        } else if (
          doc[tenantField] &&
          context.tenantId &&
          String(doc[tenantField]) !== String(context.tenantId) &&
          !context.isSuperAdmin
        ) {
          return next(
            new Error(
              `Cross-tenant bulk insert denied: Document has tenant '${doc[tenantField]}' while context is '${context.tenantId}'`
            )
          )
        }
      }
    }

    next()
  })
}

module.exports = tenantIsolationPlugin
