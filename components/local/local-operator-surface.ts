export type LocalRuntimeStatusItem = {
  label: string
  value: string
  description: string
}

export type LocalOperatorSurface = {
  title: string
  eyebrow: string
  description: string
  phaseHost: string
  posture: {
    label: string
    value: string
    description: string
  }[]
  runtimeStatus: LocalRuntimeStatusItem[]
  commandReference: {
    label: string
    command: string
    description: string
  }[]
  backupGuidance: LocalRuntimeStatusItem[]
  safetyWarnings: string[]
  homeCard: {
    label: string
    value: string
    description: string
    href: string
  }
  safety: {
    readOnly: true
    queriesHostRuntime: false
    executesCommands: false
    addsShellEndpoint: false
    mutatesContainers: false
    registersService: false
    createsSchedule: false
    enablesLan: false
    changesDbSchema: false
    disclosesSecrets: false
    touchesTerraFusionPostgres: false
    enablesAutonomy: false
  }
}

export function getLocalOperatorSurface(): LocalOperatorSurface {
  return {
    title: "Local Operations",
    eyebrow: "OMEN Manual Runtime",
    description:
      "Read-only guidance for operating WilliamOS on the HP OMEN Phase 1 host. WilliamOS shows what to run and what posture to expect; it does not execute local commands.",
    phaseHost: "HP OMEN Gaming Laptop 16-ap0xxx",
    posture: [
      {
        label: "Operating mode",
        value: "Manual-only",
        description: "The Primary Operator starts and stops WilliamOS explicitly from PowerShell.",
      },
      {
        label: "Network posture",
        value: "Localhost-only",
        description: "The expected app proof binds to 127.0.0.1 on port 3100 or fallback 3101.",
      },
      {
        label: "Persistence",
        value: "Disabled",
        description: "No service, scheduled task, startup item, or automatic restart is enabled.",
      },
      {
        label: "Autonomy",
        value: "Disabled",
        description: "Hermes, MCP, background workers, and autonomous loops remain inactive.",
      },
    ],
    runtimeStatus: [
      {
        label: "Phase 1 host",
        value: "HP OMEN Gaming Laptop 16-ap0xxx",
        description: "Current local proof host for manual WilliamOS operation.",
      },
      {
        label: "Postgres proof",
        value: "williamos-postgres-proof · 127.0.0.1:15432",
        description: "Expected WilliamOS-only PostgreSQL proof container and localhost port.",
      },
      {
        label: "App proof container",
        value: "williamos-omen-app-proof",
        description: "Expected app proof container name when the operator starts WilliamOS manually.",
      },
      {
        label: "App ports",
        value: "3100 preferred · 3101 fallback",
        description: "Host port 3000 and 0.0.0.0 binding remain blocked.",
      },
    ],
    commandReference: [],
    backupGuidance: [],
    safetyWarnings: [],
    homeCard: {
      label: "Local Operations",
      value: "Manual-ready",
      description: "OMEN local operation is wrapper-supported, localhost-only, and operator-triggered.",
      href: "/runtime",
    },
    safety: {
      readOnly: true,
      queriesHostRuntime: false,
      executesCommands: false,
      addsShellEndpoint: false,
      mutatesContainers: false,
      registersService: false,
      createsSchedule: false,
      enablesLan: false,
      changesDbSchema: false,
      disclosesSecrets: false,
      touchesTerraFusionPostgres: false,
      enablesAutonomy: false,
    },
  }
}
