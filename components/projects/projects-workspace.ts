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

export type ProjectsWorkspace = {
  title: string
  eyebrow: string
  description: string
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
      "Projects are real operational systems inside WilliamOS. They carry context, Work Orders, Evidence, deployment posture, blockers, and next work without becoming separate command environments.",
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
