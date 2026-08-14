export type SupportingCapability = Readonly<{
  label: string
  href: string
  lens: "work" | "decision" | "knowledge" | "proof" | "technical"
}>

export const supportingCapabilities: readonly SupportingCapability[] = [
  { label: "Work Orders", href: "/work-orders", lens: "work" },
  { label: "Council", href: "/brain-council", lens: "decision" },
  { label: "Knowledge", href: "/memory", lens: "knowledge" },
  { label: "Evidence", href: "/audit", lens: "proof" },
  { label: "Authority", href: "/decisions", lens: "decision" },
  { label: "Trace", href: "/trace", lens: "technical" },
  { label: "Hermes", href: "/hermes", lens: "technical" },
  { label: "Forge", href: "/agent-forge", lens: "technical" },
  { label: "Goal Console", href: "/goal-console", lens: "work" },
  { label: "Raw Runtime", href: "/runtime?detail=technical", lens: "technical" },
] as const
