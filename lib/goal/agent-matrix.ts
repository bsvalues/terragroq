// Agent Permission Matrix (§14 of the WilliamOS DevOps Work Order Playbook).
// Pure data + a deterministic permission checker. Fixed by the playbook, so it
// lives in code as enforced doctrine rather than user-editable state.
//
// The matrix caps the maximum authority each agent may ever be granted, plus
// the explicit allowed / blocked action lists from the playbook.

import { authority, authorityRank, type AuthorityId } from "./taxonomy"

export type AgentCatalogStatus = "registered" | "retired"
export type AgentExecutionStatus =
  | "hosted_transport_unproven"
  | "provider_lane_unproven"
  | "catalog_only"
  | "local_capacity"

export interface AgentSpec {
  id: string
  label: string
  description: string
  // Catalog membership describes known capability; it is not runtime proof.
  catalogStatus: AgentCatalogStatus
  executionStatus: AgentExecutionStatus
  // External builders receive authority only from the WO grant minted after
  // this cap check succeeds. No catalog entry provides ambient authority.
  requiresWorkOrderGrant: boolean
  // Maximum authority this agent may be granted on a work order.
  maxAuthority: AuthorityId
  allowed: string[]
  blocked: string[]
}

export const AGENTS: AgentSpec[] = [
  {
    id: "codex",
    label: "Codex",
    description: "Hosted implementation and assurance capacity for a bounded work-order lane.",
    catalogStatus: "registered",
    executionStatus: "hosted_transport_unproven",
    requiresWorkOrderGrant: true,
    maxAuthority: "A8_PUSH",
    allowed: [
      "inspect code",
      "propose patches",
      "perform scoped implementation",
      "run validators",
      "commit granted work",
      "push granted branches",
      "open pull requests",
      "merge granted pull requests",
      "address review findings",
      "produce evidence",
    ],
    blocked: [
      "ungranted action or path",
      "broad refactor outside reservation",
      "auth or secret change",
      "destructive change",
      "tag",
      "release",
      "canon promotion",
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Provider-isolated implementation, review, and assurance capacity for a bounded work-order lane.",
    catalogStatus: "registered",
    executionStatus: "provider_lane_unproven",
    requiresWorkOrderGrant: true,
    maxAuthority: "A8_PUSH",
    allowed: [
      "architecture review",
      "handoff drafting",
      "risk analysis",
      "work order drafting",
      "synthesis",
      "scoped implementation",
      "run validators",
      "commit granted work",
      "push granted branches",
      "open pull requests",
      "merge granted pull requests",
      "address review findings",
    ],
    blocked: [
      "ungranted action or path",
      "treating synthesis as approval",
      "auth or secret change",
      "destructive change",
      "tag",
      "release",
      "canon promotion",
    ],
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "Narrow in-scope implementation and tests inside a work order.",
    catalogStatus: "registered",
    executionStatus: "catalog_only",
    requiresWorkOrderGrant: true,
    maxAuthority: "A2_WRITE_OWN",
    allowed: ["narrow implementation", "test generation", "local repair inside work order"],
    blocked: ["governance decisions", "release decisions", "scope expansion"],
  },
  {
    id: "local",
    label: "WilliamOS Local Agent",
    description: "Memory, doctrine, classification, current truth, approved local commands.",
    catalogStatus: "registered",
    executionStatus: "local_capacity",
    requiresWorkOrderGrant: true,
    maxAuthority: "A2_WRITE_OWN",
    allowed: [
      "retrieve memory",
      "check doctrine",
      "classify requests",
      "check current truth",
      "run approved local commands",
    ],
    blocked: [
      "silent fallback to cloud",
      "silent command execution",
      "silent persistence of sensitive state",
      "authority escalation",
    ],
  },
]

export function agent(id: string): AgentSpec | undefined {
  const normalized = id === "claude" ? "claude-code" : id
  return AGENTS.find((a) => a.id === normalized)
}

// Deterministic permission check: is `authorityLevel` within the agent's cap?
export function checkAgentPermission(
  agentId: string,
  authorityLevel: string,
): { allowed: boolean; reason: string } {
  const spec = agent(agentId)
  if (!spec) {
    return { allowed: false, reason: `Unknown agent "${agentId}" — no permission profile` }
  }
  if (!authority(authorityLevel)) {
    return { allowed: false, reason: `Unknown authority "${authorityLevel}" — permission denied` }
  }
  if (spec.catalogStatus !== "registered") {
    return { allowed: false, reason: `${spec.label} is not active in the agent catalog` }
  }
  if (authorityRank(authorityLevel) > authorityRank(spec.maxAuthority)) {
    return {
      allowed: false,
      reason: `${spec.label} is capped at ${spec.maxAuthority}; cannot be granted ${authorityLevel}`,
    }
  }
  return {
    allowed: true,
    reason: `${spec.label} may receive a work-order grant at ${authorityLevel}; dispatch still requires executable capacity`,
  }
}
