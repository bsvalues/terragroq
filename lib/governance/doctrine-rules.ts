// WO-015 — Machine-checkable doctrine. The DB doctrine register (keyword-based
// validateAction) handles operator-authored rules; this module encodes the
// playbook's FIXED constitutional rules as deterministic predicates so /goal,
// /loop, WO transitions, and evidence acceptance can all enforce them uniformly.

import { authorityRank } from "@/lib/goal/taxonomy"

export type DoctrineVerdictKind = "forbidden" | "requires_approval"

export interface DoctrineContext {
  intent: string
  // Authority requested or granted for the action, if any.
  authority?: string
  // The assigned agent's maximum authority cap, if an agent is involved.
  agentMaxAuthority?: string
  // Whether an explicit release artifact exists (for release gating).
  hasReleaseArtifact?: boolean
  // Active locks/postures (STOP/HOLD/FREEZE) and their scope.
  activeLocks?: { kind: string; scope?: string | null }[]
  // Whether the operator has explicitly authorized Phase 6 / expansion work.
  phase6Authorized?: boolean
}

export interface DoctrineViolation {
  ruleId: string
  name: string
  verdict: DoctrineVerdictKind
  severity: "low" | "medium" | "high" | "critical"
  message: string
  safeAlternative: string
}

interface RuleDef {
  id: string
  name: string
  check: (ctx: DoctrineContext, text: string) => DoctrineViolation | null
}

function violation(
  rule: { id: string; name: string },
  verdict: DoctrineVerdictKind,
  severity: DoctrineViolation["severity"],
  message: string,
  safeAlternative: string,
): DoctrineViolation {
  return { ruleId: rule.id, name: rule.name, verdict, severity, message, safeAlternative }
}

export const DOCTRINE_RULES: RuleDef[] = [
  {
    id: "DR-001",
    name: "A handoff is a map, not authority",
    check: (_ctx, text) => {
      const isHandoff = /\bhandoff\b/.test(text)
      const claimsExecution = /(implement|execute|authoriz|next step is implementation|start building|begin work)/.test(text)
      if (isHandoff && claimsExecution) {
        return violation(
          { id: "DR-001", name: "A handoff is a map, not authority" },
          "requires_approval",
          "medium",
          "A handoff describes work; it does not authorize it. Treat it as a map only.",
          "Convert the handoff into a draft work order and obtain an explicit authority grant.",
        )
      }
      return null
    },
  },
  {
    id: "DR-002",
    name: "No Phase 6 expansion without explicit authorization",
    check: (ctx, text) => {
      const isPhase6 = /(phase\s*6|autonomous (improv|expansion|loop)|self-?improv|expand autonomously)/.test(text)
      if (isPhase6 && !ctx.phase6Authorized) {
        return violation(
          { id: "DR-002", name: "No Phase 6 expansion without explicit authorization" },
          "forbidden",
          "high",
          "Phase 6 / autonomous expansion is blocked without explicit operator authorization.",
          "Stay in planning-only. Draft the expansion as a work order and request authorization.",
        )
      }
      return null
    },
  },
  {
    id: "DR-003",
    name: "No TerraFusion mutation under STOP",
    check: (ctx, text) => {
      const touchesTF = /terrafusion/.test(text)
      const mutates = /(clean|cleanup|mutate|delete|refactor|fix|modify|migrate|rewrite)/.test(text)
      const stop = (ctx.activeLocks ?? []).some((l) => l.kind.toUpperCase() === "STOP")
      if (touchesTF && mutates && stop) {
        return violation(
          { id: "DR-003", name: "No TerraFusion mutation under STOP" },
          "forbidden",
          "critical",
          "A STOP lock is active on TerraFusion — mutation is forbidden.",
          "Run an evidence-only loop to document state; do not mutate until STOP is released.",
        )
      }
      return null
    },
  },
  {
    id: "DR-004",
    name: "No production/data touch without A7/A8 authority",
    check: (ctx, text) => {
      const touchesProd = /(production|prod deploy|prod data|live data|touch prod|prod database)/.test(text)
      if (touchesProd && authorityRank(ctx.authority ?? "A0_READ_ONLY") < authorityRank("A7_COMMIT")) {
        return violation(
          { id: "DR-004", name: "No production/data touch without A7/A8 authority" },
          "forbidden",
          "critical",
          "Production / data touch requires at least A7 authority; current authority is insufficient.",
          "Raise a work order requesting A7/A8 and obtain an explicit grant before any production action.",
        )
      }
      return null
    },
  },
  {
    id: "DR-005",
    name: "No canon promotion without A9 authority",
    check: (ctx, text) => {
      const promotesCanon = /(promote.*canon|canon promot|make.*canon|canonize|to canon)/.test(text)
      if (promotesCanon && authorityRank(ctx.authority ?? "A0_READ_ONLY") < authorityRank("A9_RELEASE")) {
        return violation(
          { id: "DR-005", name: "No canon promotion without A9 authority" },
          "forbidden",
          "high",
          "Canon promotion requires A9 authority.",
          "Record the candidate as reviewed; promote to canon only under an explicit A9 grant.",
        )
      }
      return null
    },
  },
  {
    id: "DR-006",
    name: "No release without an explicit release artifact",
    check: (ctx, text) => {
      const releases = /(release|deploy|publish|cut a tag|ship to prod)/.test(text)
      if (releases && ctx.hasReleaseArtifact === false) {
        return violation(
          { id: "DR-006", name: "No release without an explicit release artifact" },
          "requires_approval",
          "high",
          "A release was requested but no explicit release artifact exists.",
          "Produce the release artifact (notes, evidence, rollback plan) before releasing.",
        )
      }
      return null
    },
  },
  {
    id: "DR-007",
    name: "No agent authority escalation",
    check: (ctx) => {
      if (
        ctx.agentMaxAuthority &&
        ctx.authority &&
        authorityRank(ctx.authority) > authorityRank(ctx.agentMaxAuthority)
      ) {
        return violation(
          { id: "DR-007", name: "No agent authority escalation" },
          "forbidden",
          "high",
          `Requested ${ctx.authority} exceeds the agent's cap of ${ctx.agentMaxAuthority}.`,
          "Lower the requested authority to the agent's cap, or assign an agent permitted at this level.",
        )
      }
      return null
    },
  },
]

export interface DoctrineCheckResult {
  verdict: "allowed" | "requires_approval" | "forbidden"
  violations: DoctrineViolation[]
}

// Run all machine-checkable doctrine rules. Forbidden wins over requires_approval.
export function checkDoctrineRules(ctx: DoctrineContext): DoctrineCheckResult {
  const text = (ctx.intent ?? "").toLowerCase()
  const violations: DoctrineViolation[] = []
  for (const rule of DOCTRINE_RULES) {
    const v = rule.check(ctx, text)
    if (v) violations.push(v)
  }
  const verdict = violations.some((v) => v.verdict === "forbidden")
    ? "forbidden"
    : violations.some((v) => v.verdict === "requires_approval")
      ? "requires_approval"
      : "allowed"
  return { verdict, violations }
}
