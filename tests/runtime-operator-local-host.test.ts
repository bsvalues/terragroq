import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { evaluateOperatorHost } from "@/components/operator/portfolio-operator-resolver"

const root = process.cwd()

describe("local-first runtime operator", () => {
  it("prohibits GitHub Actions hosting without an explicit future owner decision", () => {
    expect(evaluateOperatorHost("LOCAL_OMEN_WINDOWS")).toEqual({
      selectable: true,
      reasonCode: "LOCAL_WINDOWS_IDENTITY_HOST_AUTHORIZED",
    })
    expect(evaluateOperatorHost("LOCAL_OMEN_DOCKER_VALIDATION")).toEqual({
      selectable: true,
      reasonCode: "DOCKER_VALIDATION_ONLY",
    })
    expect(evaluateOperatorHost("GITHUB_ACTIONS")).toEqual({ selectable: false, reasonCode: "GITHUB_ACTIONS_HOST_PROHIBITED" })
    expect(evaluateOperatorHost("DEDICATED_UBUNTU")).toEqual({ selectable: false, reasonCode: "PHASE_2_NOT_AUTHORIZED" })
  })

  it("has no autonomous GitHub Actions workflow or GitHub issue intake", () => {
    expect(fs.existsSync(path.join(root, ".github/workflows/runtime-operator.yml"))).toBe(false)
    expect(fs.existsSync(path.join(root, ".github/ISSUE_TEMPLATE/runtime-work-order.yml"))).toBe(false)
  })

  it("keeps the superseded Docker runtime inert until raw mounts are retired", () => {
    const compose = fs.readFileSync(path.join(root, "runtime-operator/compose.yaml"), "utf8")
    expect(compose).not.toContain("secrets/openai_api_key")
    expect(compose).not.toContain("secrets/github_token")
    expect(compose).toContain("${WILLIAMOS_OPERATOR_HOME}/control/activation")
    expect(compose).not.toMatch(/OPENAI_API_KEY:\s*[^\n$]/)
    const supervisor = fs.readFileSync(path.join(root, "runtime-operator/supervisor.sh"), "utf8")
    expect(supervisor).toContain("superseded_identity_host")
    expect(supervisor).toContain("activation input ignored")
    expect(supervisor).toContain("sleep infinity")
    expect(supervisor).not.toContain("local-cycle.sh")
    const dockerfile = fs.readFileSync(path.join(root, "runtime-operator/Dockerfile"), "utf8")
    expect(dockerfile).toContain("sed -i 's/\\r$//' supervisor.sh")
    expect(supervisor).toContain("audit.mjs")
    const audit = fs.readFileSync(path.join(root, "runtime-operator/audit.mjs"), "utf8")
    expect(audit).toContain("previousHash")
    expect(audit).toContain('createHash("sha256")')
    const provision = fs.readFileSync(path.join(root, "scripts/local/williamos-operator-provision.ps1"), "utf8")
    expect(provision).toContain("MIGRATION_WALL_NONEMPTY_LEGACY_CREDENTIAL")
    expect(provision).toContain('Initialize-OperatorFile "$OperatorHome\\control\\activation" "disabled"')
    expect(provision).not.toContain("Initialize-OperatorFile \"$OperatorHome\\secrets")
    expect(fs.existsSync(path.join(root, "runtime-operator/local-cycle.sh"))).toBe(false)
    expect(dockerfile).not.toContain("@openai/codex")
    expect(dockerfile).not.toContain("cli.github.com")
  })
})
