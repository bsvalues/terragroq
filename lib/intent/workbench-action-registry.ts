import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"

export type WorkbenchActionDescriptor = Readonly<{
  id: string
  kind: "mode" | "capability"
  label: string
  href: string
  keywords: readonly string[]
  navigationAliases?: readonly string[]
}>

const modes: readonly WorkbenchActionDescriptor[] = [
  { id: "mode.home", kind: "mode", label: "Home", href: "/", keywords: ["home", "overview"] },
  { id: "mode.projects", kind: "mode", label: "Projects", href: "/projects", keywords: ["project", "projects", "context"] },
  { id: "mode.activity", kind: "mode", label: "Activity", href: "/activity", keywords: ["activity", "recent", "events"] },
  { id: "mode.system", kind: "mode", label: "System", href: "/system", keywords: ["system", "status", "health"] },
]

const capabilityIds: Readonly<Record<string, string>> = {
  "Work Orders": "work-orders",
  Council: "council",
  Knowledge: "knowledge",
  Evidence: "evidence",
  Authority: "authority",
  Trace: "trace",
  Hermes: "hermes",
  Forge: "forge",
  "Goal Console": "goal-console",
  Workroom: "workroom",
  Lab: "lab",
  "Raw Runtime": "raw-runtime",
}

// Words the operator would actually type for a surface, where they differ from its label. The lab
// page in particular gets asked for as "the servers" or "the machines" far more often than by name.
const navigationAliasesByLabel: Readonly<Record<string, readonly string[]>> = {
  Council: ["brain council"],
  Forge: ["agent forge"],
  "Raw Runtime": ["runtime"],
  Workroom: ["loom", "work room", "workspace", "editor", "terminal"],
  Lab: ["fabric", "nodes", "machines", "servers", "the lab"],
}

const capabilities: readonly WorkbenchActionDescriptor[] = supportingCapabilities.map((capability) => ({
  id: `capability.${capabilityIds[capability.label]}`,
  kind: "capability",
  label: capability.label,
  href: capability.href,
  keywords: [capability.label.toLowerCase(), capability.lens],
  navigationAliases: navigationAliasesByLabel[capability.label],
}))

export const workbenchActionRegistry: readonly WorkbenchActionDescriptor[] = [
  ...modes,
  ...capabilities,
]

export function findWorkbenchActions(rawQuery: string): readonly WorkbenchActionDescriptor[] {
  const query = rawQuery.trim().toLowerCase()
  if (query.length === 0) return workbenchActionRegistry
  if (query.length > 200) return []
  const tokens = query.split(/\s+/).filter(Boolean)
  return workbenchActionRegistry.filter((action) => {
    const haystack = `${action.label} ${action.keywords.join(" ")}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

export function matchWorkbenchNavigationTarget(rawInput: string): Readonly<{
  action: WorkbenchActionDescriptor
  phrase: string
}> | null {
  const input = rawInput.toLowerCase()
  const matches = workbenchActionRegistry.flatMap((action) => {
    const phrases = [action.label.toLowerCase(), ...(action.navigationAliases ?? [])]
      .sort((left, right) => right.length - left.length)
    const phrase = phrases.find((candidate) => new RegExp(`\\b${candidate.replaceAll(" ", "\\s+")}\\b`, "i").test(input))
    return phrase ? [{ action, phrase }] : []
  })
  return matches.length === 1 ? matches[0] : null
}
