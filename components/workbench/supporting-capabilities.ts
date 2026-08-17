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
  // Both surfaces shipped with no entry anywhere, so they existed only for someone who already knew
  // the URL. They belong here rather than in primary navigation: the cockpit deliberately keeps four
  // primary destinations, and a surface the operator cannot find is a surface that is not there.
  { label: "Workroom", href: "/loom", lens: "work" },
  { label: "Lab", href: "/fabric", lens: "technical" },
  { label: "Raw Runtime", href: "/runtime?detail=technical", lens: "technical" },
] as const
