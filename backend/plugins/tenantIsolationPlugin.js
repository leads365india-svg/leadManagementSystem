const { getTenantContext } = require("../middleware/tenantContext")

/**
 * Mongoose Tenant & Workspace Isolation Plugin
 *
 * Automatically enforces tenant boundary partitioning and workspace scoping on all
 * read and write queries based on ambient AsyncLocalStorage context.
 *
 * Supports four explicit scope modes:
 * 1. standalone: Scopes by tenantId only (Mode A)
 * 2. single_workspace: Scopes by tenantId AND workspaceId (Mode B targeted)
 * 3. authorized_all_workspaces: Scopes by tenantId across all workspaces (Org Admin oversight)
 * 4. unassigned_review: Scopes by tenantId and unassigned records (workspaceId is null or missing)
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
  const hasWorkspaceField = Boolean(schema.paths && schema.paths.workspaceId)

  // 1. Query Hook: Automatically inject tenantId and workspaceId into filter
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
      // If the query explicitly provided a tenantId or document _id, allow it (e.g. background job, test harness, direct ID lookup)
      if (
        (currentQuery[tenantField] !== undefined && currentQuery[tenantField] !== null) ||
        (currentQuery._id !== undefined && currentQuery._id !== null)
      ) {
        return
      }
      throw new Error(
        `Tenant context missing: Query on tenant-scoped model executed without ambient tenant context or explicit tenantId. Use runWithTenantContext() or set { skipTenantFilter: true }.`
      )
    }

    // Super Admin root view without target tenant can query cross-tenant
    if (context.isSuperAdmin && !context.tenantId) {
      return
    }

    // Anonymous pre-auth context (e.g. unauthenticated /auth/login or /auth/tenant-info)
    if (context.mode === "anonymous") {
      if (
        (currentQuery[tenantField] !== undefined && currentQuery[tenantField] !== null) ||
        (currentQuery._id !== undefined && currentQuery._id !== null)
      ) {
        return
      }
      throw new Error(
        `Tenant context missing in anonymous mode: Query on tenant-scoped model executed without explicit ${tenantField} or _id.`
      )
    }

    const effectiveTenantId = context.tenantId
    if (!effectiveTenantId) {
      throw new Error(`Tenant context invalid: Non-superadmin context has no tenantId.`)
    }

    // A. Apply tenant filter
    if (currentQuery[tenantField] !== undefined && currentQuery[tenantField] !== null) {
      if (String(currentQuery[tenantField]) !== String(effectiveTenantId) && !context.isSuperAdmin) {
        throw new Error(
          `Cross-tenant query violation: Query attempted with tenantId '${currentQuery[tenantField]}' in context of '${effectiveTenantId}'`
        )
      }
    } else {
      currentQuery[tenantField] = effectiveTenantId
    }

    // B. Apply workspace filter for models that support workspace partitioning
    if (hasWorkspaceField) {
      const mode = context.mode || (context.workspaceId ? "single_workspace" : "standalone")

      if (mode === "single_workspace" && context.workspaceId) {
        const expectedWorkspaceId = String(context.workspaceId._id || context.workspaceId)

        if (currentQuery.workspaceId !== undefined && currentQuery.workspaceId !== null) {
          if (String(currentQuery.workspaceId) !== expectedWorkspaceId && !context.isSuperAdmin) {
            throw new Error(
              `Cross-workspace query violation: Query attempted with workspaceId '${currentQuery.workspaceId}' in context of '${expectedWorkspaceId}'`
            )
          }
        } else {
          currentQuery.workspaceId = context.workspaceId
        }
      } else if (mode === "unassigned_review") {
        if (!currentQuery.$or && currentQuery.workspaceId === undefined) {
          currentQuery.$or = [{ workspaceId: null }, { workspaceId: { $exists: false } }]
        }
      }
      // standalone and authorized_all_workspaces modes query across the whole tenant
    }

    this.setQuery(currentQuery)
  })

  // 2. Aggregate Hook: Inject tenantId and workspaceId match into aggregation pipeline
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

    if (context.mode === "anonymous") {
      const pipeline = this.pipeline()
      if (pipeline && pipeline.length > 0 && pipeline[0].$match && pipeline[0].$match[tenantField]) {
        return
      }
      throw new Error(
        `Tenant context missing in anonymous mode: Aggregation on tenant-scoped collection executed without explicit tenant filter.`
      )
    }

    const effectiveTenantId = context.tenantId
    if (!effectiveTenantId) {
      throw new Error(`Tenant context invalid: Non-superadmin context has no tenantId.`)
    }

    const matchStage = { [tenantField]: effectiveTenantId }

    if (hasWorkspaceField) {
      const mode = context.mode || (context.workspaceId ? "single_workspace" : "standalone")
      if (mode === "single_workspace" && context.workspaceId) {
        matchStage.workspaceId = context.workspaceId
      } else if (mode === "unassigned_review") {
        matchStage.$or = [{ workspaceId: null }, { workspaceId: { $exists: false } }]
      }
    }

    this.pipeline().unshift({ $match: matchStage })
  })

  // 3. Document Validate Hook: Automatically stamp tenantId and workspaceId before validation
  schema.pre("validate", function (next) {
    const context = getTenantContext()
    if (context && context.tenantId && !this[tenantField]) {
      this[tenantField] = context.tenantId
    }

    if (hasWorkspaceField && context && context.workspaceId && !this.workspaceId) {
      const mode = context.mode || "single_workspace"
      if (mode === "single_workspace") {
        this.workspaceId = context.workspaceId
      }
    }

    next()
  })

  // 4. Document Save Hook: Automatically stamp and guard tenantId and workspaceId
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

    if (context.mode === "anonymous") {
      if (this[tenantField]) {
        return next()
      }
      return next(
        new Error(
          `Tenant context missing in anonymous mode: Cannot save tenant-scoped document without explicit ${tenantField}.`
        )
      )
    }

    // A. Tenant Guard
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

    // B. Workspace Guard
    if (hasWorkspaceField) {
      const mode = context.mode || (context.workspaceId ? "single_workspace" : "standalone")
      if (mode === "single_workspace" && context.workspaceId) {
        const expectedWorkspaceId = String(context.workspaceId._id || context.workspaceId)
        if (!this.workspaceId) {
          this.workspaceId = context.workspaceId
        } else if (String(this.workspaceId) !== expectedWorkspaceId && !context.isSuperAdmin) {
          return next(
            new Error(
              `Cross-workspace mutation denied: Cannot save document with workspaceId '${this.workspaceId}' in context of '${expectedWorkspaceId}'`
            )
          )
        }
      }
    }

    next()
  })

  // 5. InsertMany Hook: Automatically stamp tenantId and workspaceId on bulk inserts
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

        if (hasWorkspaceField) {
          const mode = context.mode || (context.workspaceId ? "single_workspace" : "standalone")
          if (mode === "single_workspace" && context.workspaceId) {
            const expectedWorkspaceId = String(context.workspaceId._id || context.workspaceId)
            if (!doc.workspaceId) {
              doc.workspaceId = context.workspaceId
            } else if (String(doc.workspaceId) !== expectedWorkspaceId && !context.isSuperAdmin) {
              return next(
                new Error(
                  `Cross-workspace bulk insert denied: Document has workspaceId '${doc.workspaceId}' while context is '${expectedWorkspaceId}'`
                )
              )
            }
          }
        }
      }
    }

    next()
  })
}

module.exports = tenantIsolationPlugin
