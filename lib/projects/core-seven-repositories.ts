export const CORE_SEVEN_REPOSITORY_KEYS = [
  "os-1",
  "sovereign-os",
  "forge",
  "atlas",
  "dais",
  "dossier",
  "gpt",
] as const

export type CoreSevenRepositoryKey = typeof CORE_SEVEN_REPOSITORY_KEYS[number]
export type WorkspaceRepositoryKey = CoreSevenRepositoryKey | "williamos"
export type WorkspaceRepositoryRole =
  | "integrated-runtime"
  | "sovereign-planning-and-promotion"
  | "suite-source"
  | "attached-source"

export type WorkspaceRepositoryDefinition = Readonly<{
  projectKey: "terrafusion" | "williamos"
  key: WorkspaceRepositoryKey
  identity: string
  label: string
  role: WorkspaceRepositoryRole
  suite: "forge" | "atlas" | "dais" | "dossier" | "gpt" | null
  previewSource: boolean
  defaultRepository: boolean
  relationship: "primary-repo" | "sovereign-planning-and-promotion" | "suite-source"
  configuredRootEnvironment: string
  /** Stable server-owned mount slot. The verified physical checkout can move without changing it. */
  mountKey: string
}>

export type WorkspaceRepositoryMountView = Readonly<{
  repositoryResourceId?: number
  key: string
  identity: string
  label: string
  role: WorkspaceRepositoryRole
  suite: WorkspaceRepositoryDefinition["suite"]
  previewSource: boolean
  defaultRepository: boolean
  mount: Readonly<{
    key: string
    configured: boolean
    verified: boolean
    branch: string | null
    revision: string | null
    refusal: string | null
  }>
}>

export const CORE_SEVEN_REPOSITORIES: readonly WorkspaceRepositoryDefinition[] = Object.freeze([
  {
    projectKey: "terrafusion",
    key: "os-1",
    identity: "bsvalues/terrafusion_os_1.0",
    label: "OS 1.0",
    role: "integrated-runtime",
    suite: null,
    previewSource: true,
    defaultRepository: true,
    relationship: "primary-repo",
    configuredRootEnvironment: "WILLIAMOS_TERRAFUSION_ROOT",
    mountKey: "terrafusion:os-1:configured",
  },
  {
    projectKey: "terrafusion",
    key: "sovereign-os",
    identity: "bsvalues/terrafusion-os",
    label: "Sovereign OS",
    role: "sovereign-planning-and-promotion",
    suite: null,
    previewSource: false,
    defaultRepository: false,
    relationship: "sovereign-planning-and-promotion",
    configuredRootEnvironment: "WILLIAMOS_TERRAFUSION_SOVEREIGN_OS_ROOT",
    mountKey: "terrafusion:sovereign-os:configured",
  },
  ...(["forge", "atlas", "dais", "dossier", "gpt"] as const).map((suite) => ({
    projectKey: "terrafusion" as const,
    key: suite,
    identity: `bsvalues/terrafusion-${suite}`,
    label: suite === "gpt" ? "GPT" : `${suite[0].toUpperCase()}${suite.slice(1)}`,
    role: "suite-source" as const,
    suite,
    previewSource: false,
    defaultRepository: false,
    relationship: "suite-source" as const,
    configuredRootEnvironment: `WILLIAMOS_TERRAFUSION_${suite.toUpperCase()}_ROOT`,
    mountKey: `terrafusion:${suite}:configured`,
  })),
])

const WILLIAMOS_REPOSITORY: WorkspaceRepositoryDefinition = Object.freeze({
  projectKey: "williamos",
  key: "williamos",
  identity: "bsvalues/terragroq",
  label: "WilliamOS",
  role: "integrated-runtime",
  suite: null,
  previewSource: true,
  defaultRepository: true,
  relationship: "primary-repo",
  configuredRootEnvironment: "WILLIAMOS_PROJECT_ROOT",
  mountKey: "williamos:williamos:configured",
})

export type WorkspaceRepositorySelectionResult =
  | Readonly<{ ok: true; repository: WorkspaceRepositoryDefinition }>
  | Readonly<{ ok: false; error: "SPACE_PROJECT_INVALID" | "WORKSPACE_REPOSITORY_UNKNOWN" }>

/**
 * Resolve a browser-supplied stable key only against the server-owned repository catalog. Paths,
 * remotes, roles, and Preview status never come from the request.
 */
export function resolveWorkspaceRepositorySelection(
  projectKey: unknown,
  repositoryKey: unknown,
): WorkspaceRepositorySelectionResult {
  if (projectKey === "williamos") {
    if (repositoryKey === undefined || repositoryKey === null || repositoryKey === "" || repositoryKey === "williamos") {
      return { ok: true, repository: WILLIAMOS_REPOSITORY }
    }
    return { ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" }
  }
  if (projectKey !== "terrafusion") return { ok: false, error: "SPACE_PROJECT_INVALID" }

  const selectedKey = repositoryKey === undefined || repositoryKey === null || repositoryKey === ""
    ? "os-1"
    : repositoryKey
  if (typeof selectedKey !== "string") return { ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" }
  const repository = CORE_SEVEN_REPOSITORIES.find((candidate) => candidate.key === selectedKey)
  return repository
    ? { ok: true, repository }
    : { ok: false, error: "WORKSPACE_REPOSITORY_UNKNOWN" }
}
