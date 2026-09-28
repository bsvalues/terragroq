/**
 * The local-setup gate, the drift that made two surfaces unreachable, and the boundary that keeps
 * recovery from being armed by side effect.
 *
 * `/api/setup/local-config`, `/api/setup/local-status` and `/api/setup/primary-credential` each
 * carried their own copy of this predicate. Two copies omitted the explicit-enable branch, so in a
 * production build they could not be enabled at all -- and those two are exactly the surfaces an
 * operator needs when locked out: local status, and primary-credential recovery. `local-config`
 * alone honoured the setting, which is why the defect was invisible: the one route anyone would test
 * by hand was the one that worked.
 *
 * The fix for that must not open the password-reset route. `local-config` PERSISTS
 * `LOCAL_SETUP_ENABLED="true"` into `.env.local` during a normal full setup, and the live launcher
 * carries that file into the production process -- so any route gated on `localSetupEnabled()` is
 * enabled by the setup flow itself after the first bootstrap, with no further operator action. For
 * the read-only/setup surfaces that is acceptable; for an unauthenticated credential-reset route
 * that rewrites the Primary password and deletes every session, it is a security regression. Hence
 * the separate, process-only, never-persisted recovery flag, and the assertions below that pin the
 * separation.
 *
 * The coupling assertions are the point. A semantics test alone passes again the moment someone
 * re-inlines the predicate in one route.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  PRIMARY_RECOVERY_DEADLINE_ENV_VAR,
  PRIMARY_RECOVERY_ENV_VAR,
  claimPrimaryRecovery,
  isLoopbackHost,
  localSetupEnabled,
  primaryRecoveryEnabled,
  releasePrimaryRecovery,
} from "@/lib/setup/local-setup-enabled"

const ROOT = process.cwd()
const ROUTES = [
  "app/api/setup/local-config/route.ts",
  "app/api/setup/local-status/route.ts",
  "app/api/setup/primary-credential/route.ts",
]
const SETUP_SURFACES = [
  "app/api/setup/local-config/route.ts",
  "app/api/setup/local-status/route.ts",
]
const RECOVERY_SURFACE = "app/api/setup/primary-credential/route.ts"
const SHARED_MODULE = "@/lib/setup/local-setup-enabled"

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8")

describe("localSetupEnabled semantics", () => {
  it("an explicit opt-out wins in every environment", () => {
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "false", NODE_ENV: "production" })).toBe(false)
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "false", NODE_ENV: "development" })).toBe(false)
  })

  it("an explicit opt-in wins in every environment, production included", () => {
    // This is the branch two routes were missing. Without it, an operator could set
    // LOCAL_SETUP_ENABLED=true on a deployed runtime and the route would still refuse -- so the
    // documented way to recover access could never work where it was needed.
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "true", NODE_ENV: "production" })).toBe(true)
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "true", NODE_ENV: "development" })).toBe(true)
  })

  it("an unset value defaults to disabled in production and enabled elsewhere", () => {
    expect(localSetupEnabled({ NODE_ENV: "production" })).toBe(false)
    expect(localSetupEnabled({ NODE_ENV: "development" })).toBe(true)
    expect(localSetupEnabled({ NODE_ENV: "test" })).toBe(true)
  })

  it("only the literal strings count as an explicit decision", () => {
    // A truthy-looking value must not be read as an opt-in: "1"/"yes" fall through to the default.
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "1", NODE_ENV: "production" })).toBe(false)
    expect(localSetupEnabled({ LOCAL_SETUP_ENABLED: "yes", NODE_ENV: "production" })).toBe(false)
  })
})

describe("primaryRecoveryEnabled is a separate decision, bounded by a deadline", () => {
  const NOW = Date.parse("2026-09-29T00:00:00Z")
  const future = (ms: number) => new Date(NOW + ms).toISOString()
  const armed = (ms: number) => ({
    [PRIMARY_RECOVERY_ENV_VAR]: "true",
    [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: future(ms),
  })

  it("is armed only while a readable deadline is still in the future", () => {
    expect(primaryRecoveryEnabled(armed(60_000), NOW)).toBe(true)
    // The deadline is rechecked on EVERY call: a long-running server must stop honouring the
    // capability the moment the window closes, not at its next start.
    expect(primaryRecoveryEnabled(armed(60_000), NOW + 60_001)).toBe(false)
    expect(primaryRecoveryEnabled(armed(-1), NOW)).toBe(false)
  })

  it("refuses an armed flag with no readable deadline", () => {
    // The deadline IS the bound, so its absence cannot mean "unbounded".
    expect(primaryRecoveryEnabled({ [PRIMARY_RECOVERY_ENV_VAR]: "true" }, NOW)).toBe(false)
    expect(primaryRecoveryEnabled({ [PRIMARY_RECOVERY_ENV_VAR]: "true", [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: "soon" }, NOW)).toBe(false)
    expect(primaryRecoveryEnabled({}, NOW)).toBe(false)
  })

  it("is refused when nothing is set, in EVERY environment", () => {
    expect(primaryRecoveryEnabled({}, NOW)).toBe(false)
    expect(primaryRecoveryEnabled({ NODE_ENV: "production" }, NOW)).toBe(false)
    expect(primaryRecoveryEnabled({ NODE_ENV: "development" }, NOW)).toBe(false)
    expect(primaryRecoveryEnabled({ NODE_ENV: "test" }, NOW)).toBe(false)
  })

  it("the persisted setup flag must NOT arm recovery", () => {
    // The regression this whole separation exists for: local-config writes LOCAL_SETUP_ENABLED="true"
    // into .env.local during full setup and the launcher carries that file into the running process.
    for (const env of [
      { LOCAL_SETUP_ENABLED: "true" },
      { LOCAL_SETUP_ENABLED: "true", NODE_ENV: "production" },
      { LOCAL_SETUP_ENABLED: "true", NODE_ENV: "development" },
    ]) {
      expect(primaryRecoveryEnabled(env, NOW), `LOCAL_SETUP_ENABLED must not arm recovery: ${JSON.stringify(env)}`).toBe(false)
    }
    // ...and adding a deadline must not rescue it either: the flag itself has to be present.
    expect(primaryRecoveryEnabled({ LOCAL_SETUP_ENABLED: "true", [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: future(60_000) }, NOW)).toBe(false)
  })

  it("names its own variables, distinct from the persisted one", () => {
    expect(PRIMARY_RECOVERY_ENV_VAR).toBe("WILLIAMOS_PRIMARY_RECOVERY")
    expect(PRIMARY_RECOVERY_DEADLINE_ENV_VAR).toBe("WILLIAMOS_PRIMARY_RECOVERY_UNTIL")
    expect(PRIMARY_RECOVERY_ENV_VAR).not.toBe("LOCAL_SETUP_ENABLED")
  })
})

describe("claimPrimaryRecovery is synchronous and single-use", () => {
  const NOW = Date.parse("2026-09-29T00:00:00Z")
  it("gives the capability to exactly one caller", () => {
    const env: NodeJS.ProcessEnv = {
      [PRIMARY_RECOVERY_ENV_VAR]: "true",
      [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: new Date(NOW + 60_000).toISOString(),
    }
    // Two callers, no await between them -- the shape a concurrent pair would take.
    expect(claimPrimaryRecovery(env, NOW)).toBe(true)
    expect(claimPrimaryRecovery(env, NOW)).toBe(false)
  })

  it("refuses to claim outside the window", () => {
    const env: NodeJS.ProcessEnv = {
      [PRIMARY_RECOVERY_ENV_VAR]: "true",
      [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: new Date(NOW - 1).toISOString(),
    }
    expect(claimPrimaryRecovery(env, NOW)).toBe(false)
  })

  it("hands an unspent claim back, and the deadline still governs", () => {
    const env: NodeJS.ProcessEnv = {
      [PRIMARY_RECOVERY_ENV_VAR]: "true",
      [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: new Date(NOW + 60_000).toISOString(),
    }
    expect(claimPrimaryRecovery(env, NOW)).toBe(true)
    releasePrimaryRecovery(env)
    expect(claimPrimaryRecovery(env, NOW)).toBe(true)
    // A release after the window closed must not reopen it.
    const late: NodeJS.ProcessEnv = {
      [PRIMARY_RECOVERY_ENV_VAR]: "true",
      [PRIMARY_RECOVERY_DEADLINE_ENV_VAR]: new Date(NOW + 1_000).toISOString(),
    }
    expect(claimPrimaryRecovery(late, NOW)).toBe(true)
    releasePrimaryRecovery(late)
    expect(claimPrimaryRecovery(late, NOW + 2_000)).toBe(false)
  })
})

describe("isLoopbackHost is the one host predicate", () => {
  it("accepts exactly the loopback hosts the routes used to inline", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) expect(isLoopbackHost(host)).toBe(true)
    for (const host of ["192.168.88.9", "williamos.lan", "hermes.local", "127.0.0.2", "", "example.com"]) {
      expect(isLoopbackHost(host)).toBe(false)
    }
  })
})

describe("every setup route shares the one declaration", () => {
  for (const rel of SETUP_SURFACES) {
    it(`${rel} imports the shared predicate and defines no local copy`, () => {
      const src = read(rel)
      expect(src, `${rel} must import the shared predicate`).toMatch(
        /import\s*\{[^}]*localSetupEnabled[^}]*\}\s*from\s*"@\/lib\/setup\/local-setup-enabled"/,
      )
      // A re-inlined copy is how this drifted. Assert the local definition is gone.
      expect(src, `${rel} must not define its own localSetupEnabled`).not.toMatch(
        /function\s+localSetupEnabled\s*\(/,
      )
      // And the old shape specifically: returning the NODE_ENV test without the opt-in branch.
      expect(src, `${rel} must not re-inline the enable predicate`).not.toMatch(
        /LOCAL_SETUP_ENABLED\s*===\s*"false"\s*\)\s*return\s+false\s*\n\s*return\s+process\.env\.NODE_ENV/,
      )
    })
  }

  it(`${RECOVERY_SURFACE} gates on recovery, never on the persisted setup flag`, () => {
    const src = read(RECOVERY_SURFACE)
    expect(src, "recovery must import its own predicate").toMatch(
      /import\s*\{[^}]*primaryRecoveryEnabled[^}]*\}\s*from\s*"@\/lib\/setup\/local-setup-enabled"/,
    )
    expect(src, "the recovery route must call primaryRecoveryEnabled()").toMatch(/primaryRecoveryEnabled\(\)/)
    // The precise regression: this route must not be gated on the flag setup persists.
    expect(src, "the recovery route must NOT gate on localSetupEnabled").not.toMatch(
      /if\s*\(\s*!\s*localSetupEnabled\(\)\s*\)/,
    )
    expect(src, "the recovery route must not re-inline the enable predicate").not.toMatch(
      /function\s+localSetupEnabled\s*\(/,
    )
    // The gate must be decided from the classification AND before the expensive work: gating the
    // route up front on recovery 403s a fresh install's provisioning, and hashing first spends CPU
    // and a pooled connection on a request that is about to be refused.
    const classifiedAt = src.indexOf("declaredOperation = classifyPrimaryCredentialOperation(await getPrimaryRecordState(pool))")
    const gatedAt = src.indexOf("const refusal = setupGateRefusal(declaredOperation)")
    const hashedAt = src.indexOf("await hashPassword(input.password)")
    expect(classifiedAt, "the request path must classify the operation").toBeGreaterThan(-1)
    expect(gatedAt, "the request path must decide the gate from that classification").toBeGreaterThan(-1)
    expect(hashedAt, "the request path must hash the password").toBeGreaterThan(-1)
    expect(gatedAt, "the gate must follow the classification").toBeGreaterThan(classifiedAt)
    expect(hashedAt, "the password must be hashed only after the operation is allowed").toBeGreaterThan(gatedAt)
  })

  it("all three routes share the loopback host predicate", () => {
    for (const rel of ROUTES) {
      const src = read(rel)
      expect(src, `${rel} must import the shared isLoopbackHost`).toMatch(
        /import\s*\{[^}]*isLoopbackHost[^}]*\}\s*from\s*"@\/lib\/setup\/local-setup-enabled"/,
      )
      // The duplicated per-route host comparison is what the shared declaration replaces.
      expect(src, `${rel} must not re-inline the loopback host list`).not.toMatch(
        /hostname\s*===\s*"localhost"\s*\|\|\s*url\.hostname\s*===\s*"127\.0\.0\.1"/,
      )
    }
  })

  it("no setup route persists the recovery variable", () => {
    // Nothing a normal setup flow writes may arm recovery, so the recovery variable must not appear
    // as a written key anywhere in the setup surfaces.
    for (const rel of ROUTES) {
      const src = read(rel)
      expect(src, `${rel} must not write the recovery variable`).not.toMatch(
        /\["WILLIAMOS_PRIMARY_RECOVERY"/,
      )
      expect(src, `${rel} must not reference the recovery variable as a persisted key`).not.toMatch(
        /envLine\(\s*"WILLIAMOS_PRIMARY_RECOVERY"/,
      )
    }
    expect(read("lib/setup/local-setup-enabled.ts")).toMatch(/WILLIAMOS_PRIMARY_RECOVERY/)
  })
})