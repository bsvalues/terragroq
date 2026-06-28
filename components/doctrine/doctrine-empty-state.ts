export type DoctrineEmptyStateStep = {
  id: string
  title: string
  description: string
}

export const DOCTRINE_EMPTY_STATE_STEPS: DoctrineEmptyStateStep[] = [
  {
    id: "baseline",
    title: "Seed the baseline",
    description: "Start with guardrails that define what agents and operators may not do.",
  },
  {
    id: "approval",
    title: "Declare approval rules",
    description: "Make risky lanes require explicit authority instead of relying on intent.",
  },
  {
    id: "lineage",
    title: "Supersede, do not overwrite",
    description: "Retire old rules with lineage so governance changes remain auditable.",
  },
]

export function getDoctrineEmptyStateSteps(): DoctrineEmptyStateStep[] {
  return DOCTRINE_EMPTY_STATE_STEPS.map((step) => ({ ...step }))
}
