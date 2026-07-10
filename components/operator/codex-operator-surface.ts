import { getCodexOperatorProgram } from "@/components/operator/codex-operator-registry"
import { resolveNextOperatorWorkOrder } from "@/components/operator/codex-operator-resolver"

export type CodexOperatorSurface = ReturnType<typeof getCodexOperatorSurface>

export function getCodexOperatorSurface() {
  const program = getCodexOperatorProgram()
  const completed = program.workOrders.filter((workOrder) => workOrder.status === "COMPLETE").length
  const nextAction = resolveNextOperatorWorkOrder(program)

  return {
    eyebrow: "GOAL-WOS-CODEX-OPERATOR-001",
    title: "Codex Operator Loop",
    description:
      "The Primary sets consequential authority. Codex carries each eligible Work Order through implementation, proof, review, merge, and verification.",
    status: program.status,
    provenance: {
      kind: program.provenance,
      label: "Declared program state",
      caution: "Confirm live Git, PR, checks, and routes before acting.",
    },
    owner: {
      role: program.ownerRole,
      responsibility: "Sets outcomes, resolves true authority walls, and retains final governance authority.",
    },
    operator: {
      role: program.operatorRole,
      responsibility:
        "Owns truth gathering, branch and worktree setup, implementation, validation, pull requests, review remediation, eligible merge, evidence, and continuation.",
    },
    progress: {
      completed,
      total: program.workOrders.length,
      label: `${completed} of ${program.workOrders.length} Work Orders evidenced`,
    },
    nextAction,
    workOrders: program.workOrders,
    stopWalls: program.goal.blocked,
    crossLinks: [
      { label: "Work Orders", href: "/work-orders", description: "Inspect bounded scope and completion state." },
      { label: "Evidence", href: "/audit", description: "Verify proof before accepting completion." },
      { label: "Trace", href: "/trace", description: "Review reasoning and failure history." },
      { label: "Memory", href: "/memory", description: "Review governed continuity context." },
      { label: "Authority", href: "/governance", description: "Inspect limits and owner-only gates." },
      { label: "Decisions", href: "/decisions", description: "Review typed authority-wall packets." },
    ],
    controls: [] as [],
    safety: program.safety,
  }
}
