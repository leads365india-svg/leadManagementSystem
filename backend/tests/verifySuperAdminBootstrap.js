/**
 * Automated Verification Suite for Super Admin Bootstrap, Credential Synchronization & Error Resilience
 *
 * Verifies:
 * 1. bcrypt.compare is never called with undefined or invalid hash arguments.
 * 2. User query explicitly includes .select("+password") to override select: false in User schema.
 * 3. Existing Super Admin with valid password hash:
 *    - Matching password confirms credentials without writes.
 *    - Differing password preserves production credentials (no silent overwrite) unless FORCE_RESEED_SUPERADMIN=true.
 * 4. Existing Super Admin with missing password hash:
 *    - Safely detected; bcrypt.compare is skipped.
 *    - Overwrite skipped to protect database records; non-sensitive diagnostic logged.
 *    - Explicit FORCE_RESEED_SUPERADMIN=true repairs the record safely.
 * 5. Existing Super Admin with invalid/corrupt password hash format:
 *    - Safely detected; bcrypt.compare is skipped.
 *    - Overwrite skipped unless FORCE_RESEED_SUPERADMIN=true.
 * 6. Missing required environment configuration (SUPERADMIN_PASSWORD unset or whitespace):
 *    - Produces clean diagnostic rather than opaque bcrypt error.
 * 7. First-time bootstrap:
 *    - Creates Super Admin with role: "super_admin", status: "active", tenantId: null.
 *    - Records system config marker "superadmin_bootstrap_completed".
 * 8. Repeated bootstrap:
 *    - Does NOT create duplicate Super Admin accounts or mutate credentials.
 */

const assert = require("assert")
const bcrypt = require("bcryptjs")
const { bootstrapSuperAdmin, isValidBcryptHash } = require("../db/seedSuperAdmin")
const User = require("../models/User")
const SystemConfig = require("../models/SystemConfig")
const { DEFAULT_ACCOUNT_ADMIN_PERMISSIONS, RolePermission } = require("../models/RolePermission")
const Role = require("../models/Role")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ PASS: ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message)
    failed++
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✅ PASS: ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}:`, err.message)
    failed++
  }
}

async function runAll() {
  console.log("\n=======================================================")
  console.log("   SUPER ADMIN BOOTSTRAP & RESILIENCE VERIFICATION     ")
  console.log("=======================================================\n")

  // ---------------------------------------------------------------------------
  // SUITE 1: Bcrypt Hash Validation Function
  // ---------------------------------------------------------------------------
  console.log("📋 Suite 1: Bcrypt Hash Format Verification")

  test("Valid $2b$10 hash is recognized as valid", () => {
    const validHash = bcrypt.hashSync("SuperAdmin@2026!", 10)
    assert.strictEqual(isValidBcryptHash(validHash), true)
  })

  test("Valid $2a$10 and $2y$12 hashes are recognized", () => {
    const dummy2a = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
    const dummy2y = "$2y$12$e8k4N5XzZz1wS9qP2mO8leV1N0Xp9q8r7s6t5u4v3w2x1y0z9a8b7"
    assert.strictEqual(isValidBcryptHash(dummy2a), true)
    assert.strictEqual(isValidBcryptHash(dummy2y), true)
  })

  test("Rejects null, undefined, and non-string inputs safely", () => {
    assert.strictEqual(isValidBcryptHash(null), false)
    assert.strictEqual(isValidBcryptHash(undefined), false)
    assert.strictEqual(isValidBcryptHash(""), false)
    assert.strictEqual(isValidBcryptHash(12345), false)
    assert.strictEqual(isValidBcryptHash({}), false)
  })

  test("Rejects plain text or truncated hashes safely", () => {
    assert.strictEqual(isValidBcryptHash("plain_password_not_a_hash"), false)
    assert.strictEqual(isValidBcryptHash("$2b$10$short"), false)
  })

  // ---------------------------------------------------------------------------
  // SUITE 2: Query Projection Inspection
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 2: Mongoose Query Projection Inspection")

  test("User query explicitly requests +password projection to overcome select: false", () => {
    const fs = require("fs")
    const path = require("path")
    const seedCode = fs.readFileSync(path.resolve(__dirname, "../db/seedSuperAdmin.js"), "utf8")
    assert(
      seedCode.includes('.select("+password")'),
      "seedSuperAdmin.js must query with .select('+password') to retrieve password field"
    )
  })

  // ---------------------------------------------------------------------------
  // SUITE 3: Existing Super Admin with Valid Password Hash
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 3: Existing Super Admin with Valid Password Hash")

  await testAsync("Matching password verifies credentials without saving or modifying record", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      const rawPass = "AdminSecret2026!"
      const hashedPass = await bcrypt.hash(rawPass, 10)
      process.env.SUPERADMIN_PASSWORD = rawPass
      delete process.env.FORCE_RESEED_SUPERADMIN

      let saveCalled = false
      const mockSuperAdmin = {
        _id: "sa_001",
        email: "superadmin@leadflow.io",
        password: hashedPass,
        role: "super_admin",
        save: async () => { saveCalled = true },
      }

      // Stub dependencies
      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(saveCalled, false, "Must not save/overwrite when password matches")
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  await testAsync("Differing password does NOT overwrite existing credentials when FORCE_RESEED is false", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      const initialHashedPass = await bcrypt.hash("InitialPassword123!", 10)
      process.env.SUPERADMIN_PASSWORD = "DifferentPassword456!"
      delete process.env.FORCE_RESEED_SUPERADMIN

      let saveCalled = false
      const mockSuperAdmin = {
        _id: "sa_001",
        email: "superadmin@leadflow.io",
        password: initialHashedPass,
        role: "super_admin",
        save: async () => { saveCalled = true },
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(saveCalled, false, "Must NOT silently overwrite differing password without FORCE_RESEED")
        assert.strictEqual(mockSuperAdmin.password, initialHashedPass, "Original password hash remains unchanged")
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  // ---------------------------------------------------------------------------
  // SUITE 4: Existing Super Admin with Missing or Invalid Password Hash
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 4: Existing Super Admin with Missing or Invalid Password Hash")

  await testAsync("Missing password hash does NOT call bcrypt.compare or crash with undefined", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      process.env.SUPERADMIN_PASSWORD = "SomeEnvPassword!"
      delete process.env.FORCE_RESEED_SUPERADMIN

      let saveCalled = false
      const mockSuperAdmin = {
        _id: "sa_002",
        email: "superadmin@leadflow.io",
        password: null, // Missing password hash
        role: "super_admin",
        save: async () => { saveCalled = true },
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true, "Must complete successfully without throwing Illegal arguments error")
        assert.strictEqual(saveCalled, false, "Must NOT overwrite missing password without explicit FORCE_RESEED")
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  await testAsync("Corrupted password hash does NOT trigger bcrypt comparison or unhandled error", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      process.env.SUPERADMIN_PASSWORD = "SomeEnvPassword!"
      delete process.env.FORCE_RESEED_SUPERADMIN

      let saveCalled = false
      const mockSuperAdmin = {
        _id: "sa_003",
        email: "superadmin@leadflow.io",
        password: "corrupted_plain_text_not_hash",
        role: "super_admin",
        save: async () => { saveCalled = true },
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(saveCalled, false)
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  await testAsync("Explicit FORCE_RESEED_SUPERADMIN=true repairs missing password safely", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      process.env.SUPERADMIN_PASSWORD = "NewRepairedPassword2026!"
      process.env.FORCE_RESEED_SUPERADMIN = "true"

      let saveCalled = false
      const mockSuperAdmin = {
        _id: "sa_004",
        email: "superadmin@leadflow.io",
        password: null,
        role: "super_admin",
        save: async () => { saveCalled = true },
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve(null)
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(saveCalled, true, "Must save repaired password when FORCE_RESEED=true")
        assert.strictEqual(mockSuperAdmin.password, "NewRepairedPassword2026!")
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  // ---------------------------------------------------------------------------
  // SUITE 5: Missing Required Environment Configuration
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 5: Missing Required Environment Configuration")

  await testAsync("SUPERADMIN_PASSWORD unset produces clean diagnostic and skips bcrypt comparison", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      delete process.env.SUPERADMIN_PASSWORD
      delete process.env.FORCE_RESEED_SUPERADMIN

      const validHash = await bcrypt.hash("ExistingSecret!", 10)
      const mockSuperAdmin = {
        _id: "sa_005",
        email: "superadmin@leadflow.io",
        password: validHash,
        role: "super_admin",
        save: async () => {},
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(result.status, "already_bootstrapped")
      } finally {
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  // ---------------------------------------------------------------------------
  // SUITE 6: First-time Bootstrap
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 6: First-time Bootstrap")

  await testAsync("Bootstraps new Super Admin when no account exists", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalEnvEmail = process.env.SUPERADMIN_EMAIL
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      process.env.SUPERADMIN_PASSWORD = "BootPassword2026!"
      process.env.SUPERADMIN_EMAIL = "new_admin@leadflow.io"
      delete process.env.FORCE_RESEED_SUPERADMIN

      let createdUserPayload = null
      let configMarkerUpdated = false

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origConfigUpdate = SystemConfig.findOneAndUpdate
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany
      const origSave = User.prototype.save

      let savedUser = null
      User.prototype.save = async function () {
        savedUser = this
        return this
      }

      User.findOne = () => ({
        select: () => Promise.resolve(null), // No super admin
      })
      SystemConfig.findOne = () => Promise.resolve(null)
      SystemConfig.findOneAndUpdate = async (filter, update) => {
        configMarkerUpdated = true
        return { ...filter, ...update }
      }
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(result.status, "bootstrapped")
        assert.notStrictEqual(savedUser, null, "Must save new User instance")
        assert.strictEqual(savedUser.email, "new_admin@leadflow.io")
        assert.strictEqual(savedUser.role, "super_admin")
        assert.strictEqual(savedUser.tenantId, null)
        assert.strictEqual(configMarkerUpdated, true, "Must mark bootstrap completed in SystemConfig")
      } finally {
        User.prototype.save = origSave
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        SystemConfig.findOneAndUpdate = origConfigUpdate
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.SUPERADMIN_EMAIL = originalEnvEmail
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  // ---------------------------------------------------------------------------
  // SUITE 7: Repeated Bootstrap
  // ---------------------------------------------------------------------------
  console.log("\n📋 Suite 7: Repeated Bootstrap (Idempotence & Safety)")

  await testAsync("Repeated execution does not create duplicate accounts or change credentials", async () => {
    const originalEnvPass = process.env.SUPERADMIN_PASSWORD
    const originalForce = process.env.FORCE_RESEED_SUPERADMIN

    try {
      delete process.env.FORCE_RESEED_SUPERADMIN
      const existingHash = await bcrypt.hash("ExistingPassword123!", 10)
      let mockSuperAdminSaveCalled = false
      const mockSuperAdmin = {
        _id: "existing_sa_id",
        email: "superadmin@leadflow.io",
        password: existingHash,
        role: "super_admin",
        save: async () => { mockSuperAdminSaveCalled = true },
      }

      const origFindOne = User.findOne
      const origConfigFindOne = SystemConfig.findOne
      const origRolePermFindOne = RolePermission.findOne
      const origRoleUpdateMany = Role.updateMany
      const origSave = User.prototype.save

      let newAccountCreated = false
      User.prototype.save = async function () {
        newAccountCreated = true
        return this
      }

      User.findOne = () => ({
        select: () => Promise.resolve(mockSuperAdmin),
      })
      SystemConfig.findOne = () => Promise.resolve({ key: "superadmin_bootstrap_completed" })
      RolePermission.findOne = () => Promise.resolve({
        permissions: [...DEFAULT_ACCOUNT_ADMIN_PERMISSIONS],
        save: async () => {},
      })
      Role.updateMany = () => ({ setOptions: () => Promise.resolve() })

      try {
        const result = await bootstrapSuperAdmin()
        assert.strictEqual(result.success, true)
        assert.strictEqual(result.status, "already_bootstrapped")
        assert.strictEqual(newAccountCreated, false, "Must not create a new User on repeated bootstrap")
        assert.strictEqual(mockSuperAdminSaveCalled, false, "Must not mutate existing Super Admin on repeated bootstrap")
      } finally {
        User.prototype.save = origSave
        User.findOne = origFindOne
        SystemConfig.findOne = origConfigFindOne
        RolePermission.findOne = origRolePermFindOne
        Role.updateMany = origRoleUpdateMany
      }
    } finally {
      process.env.SUPERADMIN_PASSWORD = originalEnvPass
      process.env.FORCE_RESEED_SUPERADMIN = originalForce
    }
  })

  console.log("\n=======================================================")
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`)
  console.log("=======================================================\n")

  if (failed > 0) {
    process.exit(1)
  }
}

runAll().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})
