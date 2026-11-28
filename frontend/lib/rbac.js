export const LEGACY_PERMISSION_MAP = {
  "leads.view": "leads.view",
  "leads.edit": "leads.edit",
  "leads.delete": "leads.delete",
  "followups.view": "followups.view",
  "followups.manage": "followups.manage",
  "calls.view": "calls.view",
  "calls.manage": "calls.log",
  "users.view": "staff.view",
  "users.manage": "staff.manage",
}

/**
 * Mirrors backend rbacScope.isPermissionCoveredByCeiling hierarchy:
 * - `.all` or un-scoped `resource.action` in ceiling covers `.all`, `.team`, and `.own`
 * - `.team` in ceiling covers `.team` and `.own`
 * - `resource.*` covers any action/scope under `resource`
 * - Handles legacy key aliases (`calls.manage` <-> `calls.log`, `users.*` <-> `staff.*`)
 */
export function isPermissionCoveredByCeiling(permKey, ceilingList) {
  if (!permKey || typeof permKey !== "string") return false
  if (!Array.isArray(ceilingList)) return true

  const ceilingSet = new Set(ceilingList)
  if (ceilingSet.has(permKey)) return true

  const parts = permKey.split(".")
  if (parts.length === 3) {
    const [resource, action, scope] = parts
    if (
      ceilingSet.has(`${resource}.${action}.all`) ||
      ceilingSet.has(`${resource}.${action}`) ||
      ceilingSet.has(`${resource}.*`)
    ) {
      return true
    }
    if (scope === "own" && ceilingSet.has(`${resource}.${action}.team`)) {
      return true
    }
  }

  if (parts.length === 2) {
    const [resource, action] = parts
    if (
      ceilingSet.has(`${resource}.${action}.all`) ||
      ceilingSet.has(`${resource}.${action}.team`) ||
      ceilingSet.has(`${resource}.${action}.own`) ||
      ceilingSet.has(`${resource}.${action}`) ||
      ceilingSet.has(`${resource}.*`)
    ) {
      return true
    }
  }

  if (LEGACY_PERMISSION_MAP[permKey] && ceilingSet.has(LEGACY_PERMISSION_MAP[permKey])) {
    return true
  }

  for (const [legacyKey, modernKey] of Object.entries(LEGACY_PERMISSION_MAP)) {
    if (modernKey === permKey && ceilingSet.has(legacyKey)) {
      return true
    }
  }

  return false
}

/**
 * Expands un-scoped legacy keys (e.g. `leads.view`, `leads.edit`, `followups.view`,
 * `followups.manage`, `calls.view`) into their concrete module checkbox keys so
 * UI checkboxes accurately reflect granted permissions and unchecking one removes
 * the broad un-scoped key instead of leaving it behind silently.
 */
export function expandPermissionsForModules(rawPermissions = [], modules = [], ceilingList = null) {
  if (!Array.isArray(rawPermissions)) return []
  const cleaned = Array.from(
    new Set(rawPermissions.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim())),
  )

  if (!Array.isArray(modules) || modules.length === 0) {
    return cleaned
  }

  const moduleKeySet = new Set()
  const scopedGroups = {}

  for (const mod of modules) {
    for (const perm of mod?.permissions || []) {
      const key = perm?.key
      if (!key) continue
      moduleKeySet.add(key)
      const parts = key.split(".")
      if (parts.length === 3) {
        const prefix = `${parts[0]}.${parts[1]}`
        if (!scopedGroups[prefix]) scopedGroups[prefix] = []
        scopedGroups[prefix].push(key)
      }
    }
  }

  const expanded = new Set()

  for (const key of cleaned) {
    if (moduleKeySet.has(key)) {
      expanded.add(key)
      continue
    }

    const mapped = LEGACY_PERMISSION_MAP[key]
    if (mapped && moduleKeySet.has(mapped)) {
      expanded.add(mapped)
      continue
    }

    if (Array.isArray(scopedGroups[key]) && scopedGroups[key].length > 0) {
      for (const scopedKey of scopedGroups[key]) {
        if (!Array.isArray(ceilingList) || isPermissionCoveredByCeiling(scopedKey, ceilingList)) {
          expanded.add(scopedKey)
        }
      }
      continue
    }
  }

  return Array.from(expanded)
}
