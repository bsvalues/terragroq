export type WorkspaceProjectKey = string

export type ApplicationUiContract = "generic-v4" | "legacy-v1-v3"

export type ApplicationProjectApi = Readonly<{
  contract: ApplicationUiContract
  manifestUrl: string | null
  runtimeUrl: string
  previewUrl: string
  executionRoutesUrl: string
  proposalsUrl: string
  rejectMethod: "PATCH" | "DELETE"
  writablePaths: readonly string[] | null
  validationCommand: string
}>

export type CoreVisibleWorkspaceProject = Readonly<{
  key: WorkspaceProjectKey
  name: string
  kind: "core"
  preview: "terrafusion" | "neutral"
}>

export type ApplicationVisibleWorkspaceProject = Readonly<{
  key: WorkspaceProjectKey
  name: string
  kind: "application"
  preview: "contained"
  application: ApplicationProjectApi
}>

export type VisibleWorkspaceProject = CoreVisibleWorkspaceProject | ApplicationVisibleWorkspaceProject
export type WorkspaceProjectSummary = Readonly<{ key: WorkspaceProjectKey; name: string }>

const legacyHelloProject: ApplicationVisibleWorkspaceProject = Object.freeze({
  key: "hello-application",
  name: "Hello Application",
  kind: "application",
  preview: "contained",
  application: Object.freeze({
    contract: "legacy-v1-v3",
    manifestUrl: null,
    runtimeUrl: "/api/projects/hello-application/runtime",
    previewUrl: "/api/projects/hello-application/preview",
    executionRoutesUrl: "/api/projects/hello-application/execution-routes",
    proposalsUrl: "/api/projects/hello-application/proposals",
    rejectMethod: "DELETE",
    writablePaths: Object.freeze([
      "examples/hello-application/src/app.js",
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ]),
    validationCommand: "node --test examples/hello-application/test/hello.test.mjs",
  }),
})

export const HELLO_APPLICATION_WORKSPACE_PROJECT = legacyHelloProject

export const WORKSPACE_PROJECTS = Object.freeze([
  Object.freeze({ key: "terrafusion", name: "TerraFusion OS", kind: "core", preview: "terrafusion" }),
  Object.freeze({ key: "williamos", name: "WilliamOS", kind: "core", preview: "neutral" }),
  legacyHelloProject,
] as const satisfies readonly VisibleWorkspaceProject[])

export const DEFAULT_VISIBLE_WORKSPACE_PROJECTS: readonly VisibleWorkspaceProject[] = Object.freeze([
  WORKSPACE_PROJECTS[0],
  WORKSPACE_PROJECTS[1],
])

export function applicationWorkspaceProject(key: string, name: string): ApplicationVisibleWorkspaceProject {
  if (!isWorkspaceProjectKey(key)) throw new Error("WORKSPACE_PROJECT_KEY_INVALID")
  const encoded = encodeURIComponent(key)
  return Object.freeze({
    key,
    name,
    kind: "application",
    preview: "contained",
    application: Object.freeze({
      contract: "generic-v4",
      manifestUrl: `/api/projects/${encoded}/application-manifest`,
      runtimeUrl: `/api/projects/${encoded}/application-runtime`,
      previewUrl: `/api/projects/${encoded}/application-preview`,
      executionRoutesUrl: `/api/projects/${encoded}/application-execution-routes`,
      proposalsUrl: `/api/projects/${encoded}/application-proposals`,
      rejectMethod: "PATCH",
      writablePaths: null,
      validationCommand: "node --test test/application.test.mjs",
    }),
  })
}

export function isWorkspaceProjectKey(value: unknown): value is WorkspaceProjectKey {
  // Syntax only. Server authority always comes from canonical catalog binding.
  return typeof value === "string" && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
}

function helloEnabled(): boolean {
  return process.env.WILLIAMOS_HELLO_ENABLED?.trim() === "1"
}

export function resolveVisibleWorkspaceProjects(applications: readonly WorkspaceProjectSummary[] = []): readonly VisibleWorkspaceProject[] {
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
    .map((project) => applicationWorkspaceProject(project.key, project.name))
  return [...core, ...distinct]
}

export function resolveRequestedWorkspaceProjectKey(value: unknown, applications: readonly WorkspaceProjectSummary[] = []): WorkspaceProjectKey {
  const visible = resolveVisibleWorkspaceProjects(applications)
  const fallback = visible.find((project) => project.key === process.env.WILLIAMOS_DEFAULT_PROJECT)?.key
    ?? visible[0]?.key
    ?? "terrafusion"
  return visible.some((project) => project.key === value) ? value as WorkspaceProjectKey : fallback
}
