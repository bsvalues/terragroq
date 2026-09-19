export const WORKSPACE_PROJECTS = Object.freeze([
  { key: "terrafusion", name: "TerraFusion OS" },
  { key: "williamos", name: "WilliamOS" },
  { key: "hello-application", name: "Hello Application" },
] as const)

export type WorkspaceProjectKey = typeof WORKSPACE_PROJECTS[number]["key"]
export type VisibleWorkspaceProject = Readonly<{ key: WorkspaceProjectKey; name: string }>

export function isWorkspaceProjectKey(value: unknown): value is WorkspaceProjectKey {
  return WORKSPACE_PROJECTS.some((project) => project.key === value)
}

function helloEnabled(): boolean {
  return process.env.WILLIAMOS_HELLO_ENABLED?.trim() === "1"
}

export function resolveVisibleWorkspaceProjects(): readonly VisibleWorkspaceProject[] {
  const allowed = new Set<WorkspaceProjectKey>(helloEnabled()
    ? WORKSPACE_PROJECTS.map((project) => project.key)
    : ["terrafusion", "williamos"])
  const configured = process.env.WILLIAMOS_VISIBLE_PROJECTS
    ?.split(",")
    .map((value) => value.trim())
    .filter(isWorkspaceProjectKey)
  const requested: readonly WorkspaceProjectKey[] = configured?.length ? configured : ["terrafusion", "williamos"]
  const unique = [...new Set(requested)].filter((key): key is WorkspaceProjectKey => allowed.has(key))
  return unique.map((key) => {
    const project = WORKSPACE_PROJECTS.find((candidate) => candidate.key === key)
    if (!project) throw new Error("WORKSPACE_PROJECT_CATALOG_INVALID")
    return project
  })
}

export function resolveRequestedWorkspaceProjectKey(value: unknown): WorkspaceProjectKey {
  const visible = resolveVisibleWorkspaceProjects()
  const fallback = visible.find((project) => project.key === process.env.WILLIAMOS_DEFAULT_PROJECT)?.key
    ?? visible[0]?.key
    ?? "terrafusion"
  return visible.some((project) => project.key === value) ? value as WorkspaceProjectKey : fallback
}
