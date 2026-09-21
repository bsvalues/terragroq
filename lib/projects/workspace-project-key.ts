export const WORKSPACE_PROJECTS = Object.freeze([
  { key: "terrafusion", name: "TerraFusion OS" },
  { key: "williamos", name: "WilliamOS" },
  { key: "hello-application", name: "Hello Application" },
] as const)

export type WorkspaceProjectKey = string
export type VisibleWorkspaceProject = Readonly<{ key: WorkspaceProjectKey; name: string }>

export function isWorkspaceProjectKey(value: unknown): value is WorkspaceProjectKey {
  // Syntax only. Server authority always comes from canonical catalog binding.
  return typeof value === "string" && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
}

function helloEnabled(): boolean {
  return process.env.WILLIAMOS_HELLO_ENABLED?.trim() === "1"
}

export function resolveVisibleWorkspaceProjects(applications: readonly VisibleWorkspaceProject[] = []): readonly VisibleWorkspaceProject[] {
  const allowed = new Set<WorkspaceProjectKey>(helloEnabled()
    ? WORKSPACE_PROJECTS.map((project) => project.key)
    : ["terrafusion", "williamos"])
  const configured = process.env.WILLIAMOS_VISIBLE_PROJECTS
    ?.split(",")
    .map((value) => value.trim())
    .filter((value) => WORKSPACE_PROJECTS.some((project) => project.key === value))
  const requested: readonly WorkspaceProjectKey[] = configured?.length ? configured : ["terrafusion", "williamos"]
  const unique = [...new Set(requested)].filter((key): key is WorkspaceProjectKey => allowed.has(key))
  const core = unique.map((key) => {
    const project = WORKSPACE_PROJECTS.find((candidate) => candidate.key === key)
    if (!project) throw new Error("WORKSPACE_PROJECT_CATALOG_INVALID")
    return project
  })
  const coreKeys = new Set(WORKSPACE_PROJECTS.map((project) => project.key as string))
  const distinct = applications.filter((project, index) => isWorkspaceProjectKey(project.key)
    && !coreKeys.has(project.key) && applications.findIndex((item) => item.key === project.key) === index)
  return [...core, ...distinct]
}

export function resolveRequestedWorkspaceProjectKey(value: unknown, applications: readonly VisibleWorkspaceProject[] = []): WorkspaceProjectKey {
  const visible = resolveVisibleWorkspaceProjects(applications)
  const fallback = visible.find((project) => project.key === process.env.WILLIAMOS_DEFAULT_PROJECT)?.key
    ?? visible[0]?.key
    ?? "terrafusion"
  return visible.some((project) => project.key === value) ? value as WorkspaceProjectKey : fallback
}
