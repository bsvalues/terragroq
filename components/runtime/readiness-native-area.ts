export type ReadinessSignal = {
  label: string
  state: string
  description: string
}

export type ReadinessBoundary = {
  label: string
  blocked: string
  description: string
}

export type ReadinessNativeArea = {
  title: string
  eyebrow: string
  description: string
  signals: ReadinessSignal[]
  boundaries: ReadinessBoundary[]
  safety: {
    readOnly: true
    changesReadinessEndpoint: false
    changesAuthBehavior: false
    changesProductionChecks: false
    mutatesDatabase: false
    changesSchema: false
    changesEnv: false
    changesPackages: false
    changesVercelSettings: false
    deploys: false
    releases: false
    tags: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getReadinessNativeArea(): ReadinessNativeArea {
  return {
    title: "Readiness",
    eyebrow: "WilliamOS Pre-Action Safety",
    description:
      "Readiness is the native WilliamOS pre-action safety layer. It shows whether the system is configured, verified, blocked, disabled by design, or safe to proceed before work moves toward authority.",
    signals: [
      {
        label: "Production health",
        state: "verified",
        description: "Health checks confirm database, auth, and runtime posture before claims advance.",
      },
      {
        label: "Auth readiness",
        state: "configured",
        description: "Auth checks confirm required configuration and bootstrap-locked owner provisioning posture.",
      },
      {
        label: "Security headers",
        state: "verified",
        description: "Header evidence confirms the browser-facing safety baseline remains present.",
      },
      {
        label: "Access Grants",
        state: "disabled",
        description: "Access Grants remain disabled and not configured until owner activation is approved.",
      },
      {
        label: "Authority",
        state: "requires authority",
        description: "Readiness can inform a decision, but it cannot approve, execute, or grant authority.",
      },
      {
        label: "Action",
        state: "no action taken",
        description: "This surface reports status only; it does not remediate, deploy, or mutate.",
      },
    ],
    boundaries: [
      {
        label: "Endpoint behavior",
        blocked: "unchanged",
        description: "No readiness, health, auth, or runtime endpoint behavior is changed by this surface.",
      },
      {
        label: "Remediation",
        blocked: "blocked",
        description: "No automated repair, instant fix control, background repair, or production write is available.",
      },
      {
        label: "Runtime authority",
        blocked: "blocked",
        description: "Hermes, MCP, autonomy, deploy, release, tag, and access-grant activation remain blocked.",
      },
    ],
    safety: {
      readOnly: true,
      changesReadinessEndpoint: false,
      changesAuthBehavior: false,
      changesProductionChecks: false,
      mutatesDatabase: false,
      changesSchema: false,
      changesEnv: false,
      changesPackages: false,
      changesVercelSettings: false,
      deploys: false,
      releases: false,
      tags: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
