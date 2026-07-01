export type DogfoodTrainingMaterial = {
  label: string
  description: string
}

export type DogfoodReviewGate = {
  label: string
  description: string
}

export type ProductionOperatingMode = {
  title: string
  eyebrow: string
  summary: string
  agentMayDo: string[]
  agentMustNotDo: string[]
  trainingMaterial: DogfoodTrainingMaterial[]
  reviewGates: DogfoodReviewGate[]
  safety: {
    productionCommandSurface: true
    capturesTrainingCandidates: true
    automaticMemoryWrites: false
    automaticTrainingUpdates: false
    autonomousExecution: false
    hermesExecution: false
    accessGrantActivation: false
    backgroundWorkers: false
  }
}

export function getProductionOperatingMode(): ProductionOperatingMode {
  return {
    title: "Production operating mode",
    eyebrow: "Dogfood and training capture",
    summary:
      "WilliamOS production is now the command, evidence, and training-candidate surface for governed work. It captures what happened for review; it does not silently learn, execute, mutate memory, or activate workers.",
    agentMayDo: [
      "use production surfaces as operating evidence",
      "record completion evidence in PRs and reports",
      "propose memory, training, and eval candidates",
      "surface owner corrections and blocked gates",
      "continue governed Work Orders inside approved scope",
    ],
    agentMustNotDo: [
      "enable Hermes execution",
      "start autonomous loops",
      "write memory automatically",
      "promote training records automatically",
      "activate access grants",
      "change auth, env, DB, packages, or Vercel settings",
      "start background workers or schedulers",
    ],
    trainingMaterial: [
      {
        label: "Completed work",
        description: "Work Order completions, phase closures, validation, and production checks.",
      },
      {
        label: "Decisions",
        description: "Owner decisions, corrections, rejected assumptions, and blocked gates.",
      },
      {
        label: "Evidence",
        description: "Test results, builds, PR checks, route probes, and safety assertions.",
      },
      {
        label: "Lessons",
        description: "Repeated patterns, bad assumptions, stop reasons, and future eval candidates.",
      },
    ],
    reviewGates: [
      {
        label: "Primary review",
        description: "The Primary decides what becomes canonical memory or accepted training.",
      },
      {
        label: "Evidence check",
        description: "Claims need validation, route checks, or cited reports before trust.",
      },
      {
        label: "Safety boundary",
        description: "Execution, access, auth, DB, env, and worker changes remain blocked.",
      },
    ],
    safety: {
      productionCommandSurface: true,
      capturesTrainingCandidates: true,
      automaticMemoryWrites: false,
      automaticTrainingUpdates: false,
      autonomousExecution: false,
      hermesExecution: false,
      accessGrantActivation: false,
      backgroundWorkers: false,
    },
  }
}
