import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ACADEMY_LESSONS, WIKI_PAGES } from "@/components/academy/academy-wiki-registry"
import { evaluateOperatorContinuation } from "@/components/operator/codex-operator-resolver"

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8")

describe("Codex operator adoption", () => {
  it("aligns the canonical goal, loop, Work Order, and resumable stop documents", () => {
    const playbook = read("docs/governance/codex-operator-playbook.md")
    const goalRegistry = read("docs/governance/goal-registry.md")
    const loopRegistry = read("docs/governance/loop-registry.md")
    const workOrder = read("docs/governance/work-order-template.md")
    const decision = read("docs/governance/owner-decision-packet-template.md")

    for (const text of [playbook, goalRegistry, loopRegistry]) {
      expect(text).toContain("GOAL-WOS-CODEX-OPERATOR-001")
      expect(text).toContain("LOOP-WOS-CODEX-OPERATOR-001")
    }
    expect(workOrder).toContain("RISK_CLASS:")
    expect(workOrder).toContain("EVIDENCE_PATH:")
    expect(decision).toContain("WALL_TYPE:")
    expect(decision).toContain("RESUME_ACTION:")
  })

  it("registers the canonical Academy lesson and Wiki concept", () => {
    const lesson = ACADEMY_LESSONS.find(
      (candidate) => candidate.lessonId === "lesson-codex-operator-goal-loop",
    )
    const page = WIKI_PAGES.find((candidate) => candidate.pageId === "wiki-codex-operator")

    expect(lesson?.relatedGoal).toBe("GOAL-WOS-CODEX-OPERATOR-001")
    expect(lesson?.whatThisDoesNotEnable).toContain("command runner")
    expect(page?.relatedSurfaces).toContain("/goal-console")
    expect(page?.whatItIsNot).toContain("command runner")
  })

  it.each([
    ["passed docs Work Order", undefined, "CONTINUE", "NEXT_WO_ELIGIBLE"],
    ["ordinary merge conflict", undefined, "CONTINUE", "NEXT_WO_ELIGIBLE"],
    ["in-scope review remediation", undefined, "CONTINUE", "NEXT_WO_ELIGIBLE"],
    ["auth change", "auth behavior", "AUTHORITY_WALL", "AUTH_ACCESS_WALL"],
    ["schema migration", "database schema migration", "AUTHORITY_WALL", "DB_SCHEMA_WALL"],
    ["secret", "private key", "AUTHORITY_WALL", "SECRET_WALL"],
    ["PACS mutation", "PACS mutation", "AUTHORITY_WALL", "TERRAFUSION_PACS_WALL"],
    ["runtime activation", "Hermes activation", "AUTHORITY_WALL", "RUNTIME_ACTIVATION_WALL"],
    ["production deploy", "production deploy", "AUTHORITY_WALL", "PRODUCTION_RELEASE_WALL"],
    ["production write", "production-write behavior", "AUTHORITY_WALL", "PRODUCTION_RELEASE_WALL"],
    ["package update", "package update", "AUTHORITY_WALL", "ENV_PACKAGE_VERCEL_WALL"],
    ["memory write", "memory write", "AUTHORITY_WALL", "MEMORY_RUNTIME_WALL"],
    ["runtime retrieval", "runtime retrieval", "AUTHORITY_WALL", "MEMORY_RUNTIME_WALL"],
    ["dynamic retrieval", "dynamic retrieval", "AUTHORITY_WALL", "MEMORY_RUNTIME_WALL"],
    ["autonomous loop", "autonomous loop", "AUTHORITY_WALL", "RUNTIME_ACTIVATION_WALL"],
    ["scope expansion", "scope expansion", "AUTHORITY_WALL", "SCOPE_EXPANSION_WALL"],
    ["connection string", "connection string", "AUTHORITY_WALL", "SECRET_WALL"],
    ["destructive cleanup", "destructive worktree cleanup", "AUTHORITY_WALL", "DESTRUCTIVE_OPERATION_WALL"],
  ])("classifies %s", (_scenario, requestedCapability, decision, reasonCode) => {
    expect(
      evaluateOperatorContinuation({
        previousWorkOrderResult: "PASS",
        nextRiskClass: "R1",
        riskCeiling: "R1",
        requestedCapability,
      }),
    ).toMatchObject({ decision, reasonCode })
  })

  it("preserves completed goals while adopting the new schema prospectively", () => {
    const goalRegistry = read("docs/governance/goal-registry.md")
    const evidence = read("docs/reports/WO-CODEX-OPERATOR-001-021-adoption-evidence.md")

    expect(goalRegistry).toContain("GOAL-WOS-004")
    expect(evidence).toContain("Completed goals remain closed")
    expect(evidence).toContain("WO-CODEX-OPERATOR-022")
  })

  it("keeps the curriculum and evidence free of product execution claims", () => {
    const files = [
      "docs/academy/operator-training/codex-operator-goal-loop.md",
      "docs/wiki/concepts/codex-operator.md",
      "docs/reports/WO-CODEX-OPERATOR-001-021-adoption-evidence.md",
    ].map(read)

    expect(files.join(" ")).not.toMatch(/AUTH_EMAIL_OTP_ENABLED|BETTER_AUTH_SECRET|DATABASE_URL|ghp_|sk-/)
    expect(files.every((text) => /does not|no command runner|adds no command runner/i.test(text))).toBe(true)
  })
})
