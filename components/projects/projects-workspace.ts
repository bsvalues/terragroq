export type ProjectPosture = "active" | "planned" | "blocked"

export type WilliamOsProject = {
  name: string
  posture: ProjectPosture
  currentFocus: string
  latestWorkOrder: string
  latestEvidence: string
  deploymentPosture: string
  blockedDecision: string
  nextRecommendedWork: string
}

export type ProjectsPostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type ProjectsCommandState = {
  label: string
  state: string
  description: string
}

export type ProjectsAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type ProjectsWorkspace = {
  title: string
  eyebrow: string
  description: string
  postureSummary: ProjectsPostureSummaryItem[]
  commandStates: ProjectsCommandState[]
  authorityBoundaries: ProjectsAuthorityBoundary[]
  projects: WilliamOsProject[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    readOnly: true
    movesRepos: false
    deploys: false
    writesProduction: false
    mutatesData: false
    grantsAuthority: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
  }
}

export function getProjectsWorkspace(): ProjectsWorkspace {
  return {
    title: "Projects",
    eyebrow: "Systems Under Command",
    description:
      "Projects are governed systems under WilliamOS command. They preserve work context, evidence, readiness, blockers, and next moves without becoming task boards or separate command environments.",
    postureSummary: [
      {
        label: "Systems",
        value: "under command",
        description:
          "Each project is treated as an operational system with context, boundaries, and evidence.",
      },
      {
        label: "Primary review",
        value: "required",
        description:
          "Project direction moves through Work Orders and owner decisions before anything changes.",
      },
      {
        label: "Execution",
        value: "not available",
        description:
          "This area organizes command context; it does not run automations or mutate systems.",
      },
    ],
    commandStates: [
      {
        label: "Context",
        state: "Organized",
        description: "Project facts, focus, blockers, and readiness stay visible in one place.",
      },
      {
        label: "Evidence",
        state: "Required",
        description: "Claims about a project need validation, production checks, or source proof.",
      },
      {
        label: "Next Move",
        state: "Governed",
        description: "Recommended work must become a scoped Work Order before mutation.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Project execution",
        state: "Disabled",
        description: "Projects cannot start automation, move repos, deploy, or perform task execution.",
      },
      {
        label: "Data",
        state: "No mutation",
        description: "Project context is read-only here; no database, schema, or production data changes occur.",
      },
      {
        label: "Authority",
        state: "Primary gated",
        description: "Any consequential project change requires explicit owner authority.",
      },
    ],
    projects: [
      {
        name: "TerraFusion OS",
        posture: "active",
        currentFocus: "Unified WilliamOS shell and governed operator workflow.",
        latestWorkOrder: "WO-SHELL-010 - Projects Workspace / TerraFusion OS Native Area",
        latestEvidence: "Production health, readiness, PR checks, and shell tests remain the proof chain.",
        deploymentPosture: "Production is observed through Systems and Evidence; no deploy action is available here.",
        blockedDecision: "No blocker in this read-only slice.",
        nextRecommendedWork: "Connect project status to future Work Orders and Evidence feeds.",
      },
      {
        name: "BS County Values",
        posture: "planned",
        currentFocus: "Placeholder for county-value project context.",
        latestWorkOrder: "Not started",
        latestEvidence: "No project evidence registered yet.",
        deploymentPosture: "Not configured",
        blockedDecision: "Needs project definition before implementation.",
        nextRecommendedWork: "Create a scoped project intake Work Order.",
      },
      {
        name: "CIAPS / Permit Import",
        posture: "planned",
        currentFocus: "Placeholder for permit-import project context.",
        latestWorkOrder: "Not started",
        latestEvidence: "No project evidence registered yet.",
        deploymentPosture: "Not configured",
        blockedDecision: "Needs source-system and data-boundary review.",
        nextRecommendedWork: "Draft data-safety discovery Work Order.",
      },
      {
        name: "RAG Drive",
        posture: "planned",
        currentFocus: "Placeholder for retrieval and knowledge-drive project context.",
        latestWorkOrder: "Not started",
        latestEvidence: "No project evidence registered yet.",
        deploymentPosture: "Not configured",
        blockedDecision: "Needs corpus and privacy posture definition.",
        nextRecommendedWork: "Draft retrieval-boundary discovery Work Order.",
      },
      {
        name: "DataSourceBridge",
        posture: "planned",
        currentFocus: "Placeholder for source integration project context.",
        latestWorkOrder: "Not started",
        latestEvidence: "No project evidence registered yet.",
        deploymentPosture: "Not configured",
        blockedDecision: "Needs integration ownership review.",
        nextRecommendedWork: "Draft connector inventory Work Order.",
      },
      {
        name: "CountyAppraisalHub",
        posture: "planned",
        currentFocus: "Placeholder for appraisal hub project context.",
        latestWorkOrder: "Not started",
        latestEvidence: "No project evidence registered yet.",
        deploymentPosture: "Not configured",
        blockedDecision: "Needs product boundary and data policy review.",
        nextRecommendedWork: "Draft project charter Work Order.",
      },
    ],
    links: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Convert project needs into governed work before mutation.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Attach proof and validation to project claims.",
      },
      {
        label: "Systems",
        href: "/runtime",
        description: "Check production, runtime, auth, and deployment posture.",
      },
      {
        label: "Brain Council",
        href: "/brain-council",
        description: "Review project strategy and risks before work is scoped.",
      },
    ],
    safety: {
      readOnly: true,
      movesRepos: false,
      deploys: false,
      writesProduction: false,
      mutatesData: false,
      grantsAuthority: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    },
  }
}
