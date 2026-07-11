export type ProjectPosture = "active" | "planned" | "blocked"
export type ProjectEvidenceState = "declared" | "observed" | "stale" | "unknown" | "blocked"

export type ProjectSource = {
  label: string
  reference: string
  state: ProjectEvidenceState
  observedAt: string | null
  explanation: string
}

export type TerraFusionCommandRecord = {
  id: string
  label: string
  summary: string
  source: ProjectSource
}

export type TerraFusionCommandLayer = {
  projectCard: TerraFusionCommandRecord
  workOrders: TerraFusionCommandRecord[]
  evidence: TerraFusionCommandRecord[]
  blockers: TerraFusionCommandRecord[]
  deployment: TerraFusionCommandRecord
  nextMove: TerraFusionCommandRecord
}

export type WilliamOsProject = {
  name: string
  posture: ProjectPosture
  currentFocus: string
  latestWorkOrder: string
  latestEvidence: string
  deploymentPosture: string
  blockedDecision: string
  nextRecommendedWork: string
  commandLayer?: TerraFusionCommandLayer
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
        blockedDecision:
          "Live external state is blocked pending separate authority; the static repository-local command view is unblocked.",
        nextRecommendedWork:
          "Complete WO-TF-COMMAND-001 through WO-TF-COMMAND-006 as a static, sourced command layer.",
        commandLayer: {
          projectCard: {
            id: "TF-PROJECT-001",
            label: "TerraFusion OS",
            summary:
              "Governed project under WilliamOS command; this card is declared repository state, not a live TerraFusion observation.",
            source: {
              label: "WilliamOS architecture",
              reference: "docs/governance/williamos-unified-system-architecture.md",
              state: "declared",
              observedAt: null,
              explanation: "Canonical repository-local product doctrine.",
            },
          },
          workOrders: [
            {
              id: "TF-WO-FEED-001",
              label: "TerraFusion command Work Orders",
              summary: "WO-TF-COMMAND-001 through WO-TF-COMMAND-006 are the active static implementation sequence.",
              source: {
                label: "Active program queue",
                reference: "docs/governance/active-program-queue.md",
                state: "observed",
                observedAt: "2026-07-10",
                explanation: "Verified on merged WilliamOS main after PR #338.",
              },
            },
          ],
          evidence: [
            {
              id: "TF-EVIDENCE-001",
              label: "Command-layer preflight",
              summary: "The R0 preflight completed and approved only an R1 static/read-only implementation.",
              source: {
                label: "WO-TF-COMMAND-000F rollup",
                reference: "docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md",
                state: "observed",
                observedAt: "2026-07-10",
                explanation: "Repository-local merge evidence from PR #338.",
              },
            },
            {
              id: "TF-EVIDENCE-002",
              label: "Historical Azure precedent",
              summary: "Prior TerraFusion deployment material exists but does not establish current WilliamOS or TerraFusion status.",
              source: {
                label: "WO-DEPLOY-011B audit",
                reference: "docs/reports/WO-DEPLOY-011B-azure-inputs-discovery-audit.md",
                state: "stale",
                observedAt: null,
                explanation: "Historical precedent only; current applicability is unverified.",
              },
            },
          ],
          blockers: [
            {
              id: "TF-BLOCKER-001",
              label: "Live TerraFusion state",
              summary: "External repository, deployment, runtime, county, and PACS inspection require separate authority.",
              source: {
                label: "TerraFusion command preflight",
                reference: "docs/governance/terrafusion-command-preflight.md",
                state: "blocked",
                observedAt: null,
                explanation: "Outside the R1 static/read-only authority ceiling.",
              },
            },
          ],
          deployment: {
            id: "TF-DEPLOYMENT-001",
            label: "Deployment status",
            summary: "No current TerraFusion deployment status is asserted by this read model.",
            source: {
              label: "No current deployment proof",
              reference: "docs/reports/WO-TF-COMMAND-000F-preflight-rollup.md",
              state: "unknown",
              observedAt: null,
              explanation: "A current deployment claim requires dated observed evidence.",
            },
          },
          nextMove: {
            id: "TF-NEXT-001",
            label: "Next governed move",
            summary: "Validate and merge the repository-local static command layer; stop before live integration.",
            source: {
              label: "WilliamOS loop registry",
              reference: "docs/governance/loop-registry.md",
              state: "declared",
              observedAt: null,
              explanation: "Governed recommendation, not execution authority.",
            },
          },
        },
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
