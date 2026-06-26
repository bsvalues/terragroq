// Agent Permission Matrix (§14 of the WilliamOS DevOps Work Order Playbook).
// Pure data + a deterministic permission checker. Fixed by the playbook, so it
// lives in code as enforced doctrine rather than user-editable state.
//
// The matrix caps the maximum authority each agent may ever be granted, plus
// the explicit allowed / blocked action lists from the playbook.

import { authorityRank, type AuthorityId } from "./taxonomy"

export interface AgentSpec {
  id: string
  label: string
  description: string
  // Maximum authority this agent may be granted on a work order.
  maxAuthority: AuthorityId
  allowed: string[]
  blocked: string[]
}

export const AGENTS: AgentSpec[] = [
  {
    id: "codex",
    label: "Codex",
    description: "Implementation agent. Scoped code work inside an authorized WO.",
    // May perform scoped local mutation; never commits/pushes/releases unless a
    // human opens those gates separately.
    maxAuthority: "A3_WRITE_SHARED",
    allowed: [
      "inspect code",
      "propose patches",
      "perform scoped implementation",
      "run validators",
      "produce evidence",
    ],
    blocked: ["broad refactor", "commit", "push", "tag", "merge", "release", "canon promotion"],
  },
  {
    id: "claude",
    label: "Claude",
    description: "Architecture, synthesis, and drafting. No implementation momentum.",
    maxAuthority: "A1_DRAFT",
    allowed: [
      "architecture review",
      "handoff drafting",
      "risk analysis",
      "work order drafting",
      "synthesis",
    ],
    blocked: ["treating synthesis as approval", "creating implementation momentum without authority"],
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "Narrow in-scope implementation and tests inside a work order.",
    maxAuthority: "A2_WRITE_OWN",
    allowed: ["narrow implementation", "test generation", "local repair inside work order"],
    blocked: ["governance decisions", "release decisions", "scope expansion"],
  },
  {
    id: "local",
    label: "WilliamOS Local Agent",
    description: "Memory, doctrine, classification, current truth, approved local commands.",
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
  return AGENTS.find((a) => a.id === id)
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
  if (authorityRank(authorityLevel) > authorityRank(spec.maxAuthority)) {
    return {
      allowed: false,
      reason: `${spec.label} is capped at ${spec.maxAuthority}; cannot be granted ${authorityLevel}`,
    }
  }
  return { allowed: true, reason: `${spec.label} permitted at ${authorityLevel}` }
}
