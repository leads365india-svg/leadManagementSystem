const { AsyncLocalStorage } = require("async_hooks")

/**
 * Tenant Context Manager using Node.js AsyncLocalStorage
 * Complies with Roadmap Phase 3: Tenant isolation layer.
 * 
 * Provides an ambient, execution-scoped tenant context across all async operations,
 * allowing Mongoose plugins and services to enforce tenant isolation automatically
 * without requiring every query to manually pass tenantId.
 */

const tenantStorage = new AsyncLocalStorage()

/**
 * Run an async function within a specific tenant context
 */
const runWithTenantContext = (context, fn) => {
  const store = typeof context === "string" ? { tenantId: context, isSuperAdmin: false } : context
  return tenantStorage.run(store, fn)
}

/**
 * Retrieve the current ambient tenant context
 * @returns {{ tenantId: string | null, isSuperAdmin: boolean, user: object | null } | null}
 */
const getTenantContext = () => {
  return tenantStorage.getStore() || null
}

/**
 * Determine effective tenant partition from an Express request
 * Single shared source of truth replacing duplicated controller helpers.
 */
const getEffectiveTenant = (req) => {
  if (!req || !req.user) {
    return { tenantId: null, isSuperAdmin: false }
  }

  const isSuperAdmin = req.user.role === "super_admin"

  if (isSuperAdmin) {
    // Super admin can explicitly scope to a tenant via query param, header, or body
    const requestedTenant =
      (typeof req.query?.tenantId === "string" ? req.query.tenantId.trim() : null) ||
      (typeof req.headers?.["x-tenant-id"] === "string" ? req.headers["x-tenant-id"].trim() : null) ||
      (typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : null) ||
      null

    return { tenantId: requestedTenant, isSuperAdmin: true }
  }

  // Normal tenant user: strictly bound to authenticated tenantId
  return {
    tenantId: req.user.tenantId || null,
    isSuperAdmin: false,
  }
}

/**
 * Express middleware that initializes ambient AsyncLocalStorage tenant context
 * Run right after authentication middleware.
 */
const tenantContextMiddleware = (req, res, next) => {
  const { tenantId, isSuperAdmin } = getEffectiveTenant(req)

  const context = {
    tenantId: tenantId || null,
    isSuperAdmin,
    userId: req.user?.id || req.user?._id || null,
    userRole: req.user?.role || null,
    userEmail: req.user?.email || null,
  }

  // Attach to request object for convenience
  req.tenantContext = context

  tenantStorage.run(context, () => {
    next()
  })
}

module.exports = {
  tenantStorage,
  runWithTenantContext,
  getTenantContext,
  getEffectiveTenant,
  tenantContextMiddleware,
}
