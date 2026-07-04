export type LocalRuntimeCheckState = "ready" | "stopped" | "unknown" | "degraded" | "stale"
export type LocalRuntimeCheckHealth = "pass" | "fail" | "unknown"
export type LocalRuntimeLoopbackContext = "host-loopback"

export type LocalRuntimeHttpTarget = {
  label: "root" | "runtime" | "goalConsole" | "health" | "readiness"
  primaryUrl: string
  fallbackUrl: string
}

export type LocalRuntimeHttpCheck = {
  label: LocalRuntimeHttpTarget["label"]
  url: string
  health: LocalRuntimeCheckHealth
  status?: number
  latencyMs?: number
}

export type LocalRuntimeStatus = {
  ok: true
  mode: "manual-only"
  host: "HP OMEN Gaming Laptop 16-ap0xxx"
  scope: "localhost-only"
  executionEnabled: false
  persistenceEnabled: false
  lanExposureEnabled: false
  checkedAt: string
  checks: {
    statusRoute: {
      state: "ready"
      source: "this request"
      note: string
    }
    appHttp: {
      state: LocalRuntimeCheckState
      context: LocalRuntimeLoopbackContext
      url: "http://127.0.0.1:3100" | "http://127.0.0.1:3101"
      health: LocalRuntimeCheckHealth
      readiness: LocalRuntimeCheckHealth
      note: string
      routes: LocalRuntimeHttpCheck[]
    }
    app: {
      state: LocalRuntimeCheckState
      url: "http://127.0.0.1:3100" | "http://127.0.0.1:3101"
      health: LocalRuntimeCheckHealth
      readiness: LocalRuntimeCheckHealth
      routes: LocalRuntimeHttpCheck[]
    }
    postgresProof: {
      state: "documented" | "unknown"
      expectedPort: "127.0.0.1:15432"
      note: string
    }
  }
  semantics: {
    sourceModel: "static posture + localhost HTTP GET checks"
    stateModel: {
      state: LocalRuntimeCheckState
      meaning: string
    }[]
    containerizedProofNote: string
    controlBoundary: string
  }
  warnings: string[]
}

export const LOCAL_RUNTIME_POSTURE = {
  mode: "manual-only",
  host: "HP OMEN Gaming Laptop 16-ap0xxx",
  scope: "localhost-only",
  executionEnabled: false,
  persistenceEnabled: false,
  lanExposureEnabled: false,
  selectedFirstSlice: "static posture + GET-only localhost HTTP checks",
  implementationScope: "read-only status display",
  blockedCapabilities: [
    "command execution",
    "command runner",
    "Docker metadata",
    "backup metadata",
    "port checks",
    "persistence",
    "service registration",
    "scheduling",
    "LAN exposure",
    "autonomy",
  ],
} as const

export const LOCAL_RUNTIME_HTTP_TARGETS: LocalRuntimeHttpTarget[] = [
  {
    label: "root",
    primaryUrl: "http://127.0.0.1:3100/",
    fallbackUrl: "http://127.0.0.1:3101/",
  },
  {
    label: "runtime",
    primaryUrl: "http://127.0.0.1:3100/runtime",
    fallbackUrl: "http://127.0.0.1:3101/runtime",
  },
  {
    label: "goalConsole",
    primaryUrl: "http://127.0.0.1:3100/goal-console",
    fallbackUrl: "http://127.0.0.1:3101/goal-console",
  },
  {
    label: "health",
    primaryUrl: "http://127.0.0.1:3100/api/health",
    fallbackUrl: "http://127.0.0.1:3101/api/health",
  },
  {
    label: "readiness",
    primaryUrl: "http://127.0.0.1:3100/api/auth/readiness",
    fallbackUrl: "http://127.0.0.1:3101/api/auth/readiness",
  },
]

export const LOCAL_RUNTIME_STATE_MODEL: LocalRuntimeStatus["semantics"]["stateModel"] = [
  {
    state: "ready",
    meaning: "All approved localhost HTTP checks returned successful responses.",
  },
  {
    state: "stopped",
    meaning: "No approved localhost HTTP checks responded from the checked process namespace.",
  },
  {
    state: "degraded",
    meaning: "At least one approved localhost HTTP check responded, but not every check passed.",
  },
  {
    state: "stale",
    meaning: "The displayed status is older than the current request cycle or could not be refreshed.",
  },
  {
    state: "unknown",
    meaning: "The status route could not classify the app from approved localhost HTTP checks.",
  },
]

export const LOCAL_RUNTIME_STATUS_SEMANTICS: LocalRuntimeStatus["semantics"] = {
  sourceModel: "static posture + localhost HTTP GET checks",
  stateModel: LOCAL_RUNTIME_STATE_MODEL,
  containerizedProofNote:
    "WilliamOS status route is live when this handler responds. Host-loopback checks may show unknown, stopped, or degraded when viewed from inside the proof container because 127.0.0.1 is evaluated from that process namespace.",
  controlBoundary:
    "Read-only status only. No command execution, Docker metadata, backup scanning, port scanning, persistence, LAN exposure, repair, or automation is enabled.",
}

const STATUS_ROUTE_READY_NOTE =
  "This status route is serving this request. Host-loopback app HTTP checks are reported separately."

const APP_HTTP_CONTEXT_NOTE =
  "Approved localhost app HTTP checks target the host-loopback bases. They may be unavailable from inside the app proof container and do not determine whether this status route is live."

const ACTION_QUERY_PARAMS = new Set(["action", "target", "command", "refresh", "start", "stop", "restart"])

function hasUnsafeActionParam(url: URL) {
  for (const key of url.searchParams.keys()) {
    if (ACTION_QUERY_PARAMS.has(key.toLowerCase())) return true
  }
  return false
}

export function validateLocalRuntimeStatusRequest(req: Request) {
  const url = new URL(req.url)
  if (hasUnsafeActionParam(url)) {
    return {
      ok: false as const,
      status: 400,
      body: {
        ok: false,
        error: "Action parameters are not accepted by this read-only status route.",
      },
    }
  }
  return { ok: true as const }
}

async function checkUrl(
  target: LocalRuntimeHttpTarget,
  url: string,
  timeoutMs: number,
): Promise<LocalRuntimeHttpCheck> {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json, text/html;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    return {
      label: target.label,
      url,
      health: res.ok ? "pass" : "fail",
      status: res.status,
      latencyMs: Date.now() - start,
    }
  } catch {
    return {
      label: target.label,
      url,
      health: "unknown",
      latencyMs: Date.now() - start,
    }
  }
}

async function runChecksForBase(
  useFallback: boolean,
  timeoutMs: number,
): Promise<LocalRuntimeHttpCheck[]> {
  return Promise.all(
    LOCAL_RUNTIME_HTTP_TARGETS.map((target) =>
      checkUrl(target, useFallback ? target.fallbackUrl : target.primaryUrl, timeoutMs),
    ),
  )
}

function summarizeChecks(
  routes: LocalRuntimeHttpCheck[],
): Pick<LocalRuntimeStatus["checks"]["app"], "state" | "health" | "readiness"> {
  const health = routes.find((route) => route.label === "health")?.health ?? "unknown"
  const readiness = routes.find((route) => route.label === "readiness")?.health ?? "unknown"
  const anyPass = routes.some((route) => route.health === "pass")
  const anyFail = routes.some((route) => route.health === "fail")
  const allPass = routes.every((route) => route.health === "pass")

  if (allPass) return { state: "ready", health, readiness }
  if (anyPass || anyFail) return { state: "degraded", health, readiness }
  return { state: "stopped", health, readiness }
}

export async function getLocalRuntimeStatus(options: { timeoutMs?: number } = {}): Promise<LocalRuntimeStatus> {
  const timeoutMs = options.timeoutMs ?? 900
  const primaryRoutes = await runChecksForBase(false, timeoutMs)
  const primarySummary = summarizeChecks(primaryRoutes)
  const useFallback = primarySummary.state === "stopped"
  const routes = useFallback ? await runChecksForBase(true, timeoutMs) : primaryRoutes
  const summary = summarizeChecks(routes)
  const appHttp = {
    state: summary.state,
    context: "host-loopback" as const,
    url: useFallback ? "http://127.0.0.1:3101" as const : "http://127.0.0.1:3100" as const,
    health: summary.health,
    readiness: summary.readiness,
    note: APP_HTTP_CONTEXT_NOTE,
    routes,
  }

  return {
    ok: true,
    mode: LOCAL_RUNTIME_POSTURE.mode,
    host: LOCAL_RUNTIME_POSTURE.host,
    scope: LOCAL_RUNTIME_POSTURE.scope,
    executionEnabled: LOCAL_RUNTIME_POSTURE.executionEnabled,
    persistenceEnabled: LOCAL_RUNTIME_POSTURE.persistenceEnabled,
    lanExposureEnabled: LOCAL_RUNTIME_POSTURE.lanExposureEnabled,
    checkedAt: new Date().toISOString(),
    checks: {
      statusRoute: {
        state: "ready",
        source: "this request",
        note: STATUS_ROUTE_READY_NOTE,
      },
      appHttp,
      app: appHttp,
      postgresProof: {
        state: "documented",
        expectedPort: "127.0.0.1:15432",
        note:
          "Documented only in this first slice. The status API does not inspect Docker, ports, backups, or database contents.",
      },
    },
    semantics: LOCAL_RUNTIME_STATUS_SEMANTICS,
    warnings:
      summary.state === "ready"
        ? []
        : [
            "WilliamOS status route is live. Host-loopback checks may be unavailable from inside the proof container.",
            "Local status is read-only. Use the manual OMEN wrappers for operator-run start, stop, and status proof.",
          ],
  }
}

