/**
 * The local-setup gate, and the drift that made two surfaces unreachable.
 *
 * `/api/setup/local-config`, `/api/setup/local-status` and `/api/setup/primary-credential` each
 * carried their own copy of this predicate. Two copies omitted the explicit-enable branch, so in a
 * production build they could not be enabled at all -- and those two are exactly the surfaces an
 * operator needs when locked out: local status, and primary-credential recovery. `local-config`
 * alone honoured the setting, which is why the defect was invisible: the one route anyone would test
 * by hand was the one that worked.
 *
 * The coupling assertions below are the point. A semantics test alone passes again the moment
 * someone re-inlines the predicate in one route.
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { localSetupEnabled } from "@/lib/setup/local-setup-enabled"

const ROOT = process.cwd()
const ROUTES = [
  "app/api/setup/local-config/route.ts",
  "app/api/setup/local-status/route.ts",
  "app/api/setup/primary-credential/route.ts",
]

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

describe("every setup route shares the one declaration", () => {
  for (const rel of ROUTES) {
    it(`${rel} imports the shared predicate and defines no local copy`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
      expect(src, `${rel} must import the shared predicate`).toMatch(
        /import\s*\{\s*localSetupEnabled\s*\}\s*from\s*"@\/lib\/setup\/local-setup-enabled"/,
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
})