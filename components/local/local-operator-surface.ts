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
    commandReference: [
      {
        label: "Status",
        command: "scripts/local/williamos-omen-status.ps1",
        description:
          "Reports Postgres proof, app container, ports, backup directory, and manual-only posture.",
      },
      {
        label: "Backup check",
        command: "scripts/local/williamos-omen-backup-check.ps1",
        description:
          "Shows backup directory posture and latest local backup reminder without creating backups.",
      },
      {
        label: "Start",
        command: "scripts/local/williamos-omen-start.ps1",
        description:
          "Operator-run PowerShell helper for starting the app proof container on localhost only.",
      },
      {
        label: "Stop",
        command: "scripts/local/williamos-omen-stop.ps1",
        description:
          "Operator-run PowerShell helper for stopping and removing only the app proof container.",
      },
      {
        label: "Help",
        command: "-Help",
        description: "Supported by all OMEN manual wrappers for usage and safety output.",
      },
    ],
    backupGuidance: [
      {
        label: "Manual backup expectation",
        value: "Before meaningful local work",
        description:
          "The operator should confirm or create a local PostgreSQL backup before data-changing work, restore drills, or future persistence decisions.",
      },
      {
        label: "Backup location convention",
        value: "C:\\Users\\bsval\\williamos-local-runtime\\backups",
        description: "Backups stay operator-local and outside the repository.",
      },
      {
        label: "Latest known backup example",
        value: "williamos-omen-manual-backup-20260703-060207.dump",
        description: "Documented proof backup from the OMEN local operations lane.",
      },
      {
        label: "Restore drill reminder",
        value: "Backup is trusted after restore proof",
        description:
          "WO-LOCAL-010 proved backup/restore once; future important changes should preserve that discipline.",
      },
    ],
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
