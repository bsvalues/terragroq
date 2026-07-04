export const LOCAL_OMEN_PHASE_ROLLUP = {
  label: "Local OMEN Phase 1",
  value: "Stable",
  description:
    "Local status API, runtime surface, proof route, manual wrapper proof, and UX refinement are complete.",
  href: "/runtime",
  originMain: "585a5dfd0ceccff76df2842e1fee8538275fe840",
  completedBatches: [
    "LOCAL-OMEN-RUNTIME-STATUS-POST-PROOF-BATCH-001",
    "LOCAL-OMEN-LIVE-STATUS-REFINEMENT-BATCH-001",
  ],
  validation: "git diff, focused tests, full suite, production build, Vercel, and CodeRabbit passed",
  safety:
    "Read-only governed subsystem. No command execution, metadata expansion, persistence, LAN exposure, or autonomy.",
} as const

export const SHELL_WOE_NEXT_BATCH = {
  label: "WILLIAMOS-SHELL-WOE-RESUME-BATCH-001",
  value: "In progress",
  description:
    "Resume Home, Work Orders, Evidence, Authority, and Work Order Engine read models after local status stabilization.",
  href: "/work-orders",
  recommendedAfterThisBatch: "WILLIAMOS-WOE-DETAIL-SURFACES-BATCH-001",
} as const

export const SHELL_WOE_AUTHORITY_BLOCKERS = [
  {
    label: "Local runtime control",
    status: "blocked",
    description: "No start, stop, restart, repair, service, scheduler, persistence, or LAN exposure.",
  },
  {
    label: "Metadata expansion",
    status: "blocked",
    description: "Docker metadata, backup metadata, and port status remain separate future gates.",
  },
  {
    label: "Execution authority",
    status: "blocked",
    description: "No command runner, UI command execution, autonomous loop, Hermes, or MCP activation.",
  },
  {
    label: "External mutation",
    status: "blocked",
    description: "No cloud, DNS, Vercel, Azure, production deploy, TerraFusion/PACS, or unrelated container touch.",
  },
] as const

export const SHELL_WOE_ATTENTION_MODEL = [
  "Stable systems",
  "Ready next work",
  "Blocked decisions",
  "Recent completed phase",
  "Local runtime status",
  "Evidence links",
] as const

export const SHELL_WOE_FORBIDDEN_LANGUAGE = [
  "AI-powered",
  "boost productivity",
  "team workspace",
  "admin dashboard",
  "collaboration portal",
  "self-healing automation",
] as const

export const SHELL_WOE_SAFETY = {
  readOnly: true,
  commandExecutionAdded: false,
  commandRunnerAdded: false,
  dockerMetadataAdded: false,
  backupScanAdded: false,
  portChecksAdded: false,
  persistenceImplemented: false,
  serviceRegistered: false,
  scheduleCreated: false,
  lanExposureEnabled: false,
  secretsDisclosed: false,
  terraFusionPacsTouched: false,
  unrelatedContainersTouched: false,
} as const
