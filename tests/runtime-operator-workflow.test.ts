import fs from "node:fs"
import { describe, expect, it } from "vitest"

const workflow = fs.readFileSync(".github/workflows/runtime-operator.yml", "utf8")
const policy = fs.readFileSync("scripts/runtime-operator/policy.mjs", "utf8")

describe("runtime operator workflow boundary", () => {
  it("is scheduled, serialized, and disabled by the repository kill switch", () => {
    expect(workflow).toContain('cron: "*/15 * * * *"')
    expect(workflow).toContain("group: williamos-runtime-operator")
    expect(workflow).toContain("vars.WILLIAMOS_RUNTIME_OPERATOR_ENABLED == 'true'")
    expect(workflow).toContain("cancel-in-progress: false")
  })

  it("keeps Codex read-only and separates repository writes into publish", () => {
    expect(workflow).toContain("uses: openai/codex-action@b11346a6fa031e2e164ab4b7c7ea201afffd7d59 # v1")
    expect(workflow).toContain("sandbox: read-only")
    expect(workflow).toMatch(/codex:[\s\S]*permissions:\s*\n\s*contents: read/)
    expect(workflow).toMatch(/publish:[\s\S]*permissions:[\s\S]*contents: write/)
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).not.toContain("pull_request_target")
    expect(workflow.match(/secrets\.OPENAI_API_KEY/g)).toHaveLength(1)
  })

  it("uses fixed validation, exact path enforcement, attestation, and bounded remediation", () => {
    expect(workflow).toContain("node scripts/runtime-operator/verify-diff.mjs")
    expect(workflow).toContain("npm test -- --run")
    expect(workflow).toContain("actions/attest-build-provenance@43d14bc2b83dec42d39ecae14e916627a18bb661 # v3")
    expect(workflow).toContain("node scripts/runtime-operator/monitor.mjs")
    expect(workflow).toContain("node scripts/runtime-operator/resolve-threads.mjs")
    expect(workflow).toContain("node scripts/runtime-operator/recover.mjs")
    expect(workflow).toContain("node scripts/runtime-operator/scan-secrets.mjs")
    expect(policy).toContain("ALLOWED_REPOSITORY")
    expect(policy).toContain("FORBIDDEN_CAPABILITY")
    expect(policy).toContain("FORBIDDEN_PATH")
  })
})
