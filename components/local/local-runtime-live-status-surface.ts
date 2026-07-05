export const LOCAL_RUNTIME_EVIDENCE_REFERENCES = [
  {
    label: "First-slice API",
    path: "docs/reports/WO-LOCAL-079-get-only-local-runtime-status-api.md",
    summary: "GET-only local runtime status route added without command execution.",
  },
  {
    label: "Runtime surface",
    path: "docs/reports/WO-LOCAL-081-runtime-surface-live-status-integration.md",
    summary: "Read-only status display wired into /runtime.",
  },
  {
    label: "Refreshed image proof",
    path: "docs/reports/WO-LOCAL-107-resume-williamos-proof-image-refresh.md",
    summary: "Refreshed app image served /api/local/runtime/status from the OMEN proof container.",
  },
] as const

export const LOCAL_RUNTIME_STATE_EXPLAINERS = [
  {
    state: "ready",
    title: "Ready",
    meaning: "The status route is live and approved checks passed from the checked context.",
    operatorGuidance: "Continue using manual wrappers for any start or stop action.",
  },
  {
    state: "degraded",
    title: "Degraded",
    meaning: "The status route is live, but one or more approved checks did not pass.",
    operatorGuidance: "Use the manual status wrapper for evidence before changing anything.",
  },
  {
    state: "stopped",
    title: "Stopped",
    meaning: "No approved host-loopback app checks responded from the checked context.",
    operatorGuidance: "This can be expected after cleanup or from inside a proof container namespace.",
  },
  {
    state: "unknown",
    title: "Unknown",
    meaning: "The status route cannot classify the app from the approved GET-only checks.",
    operatorGuidance: "Treat as evidence to inspect manually, not as permission to repair automatically.",
  },
  {
    state: "stale",
    title: "Stale",
    meaning: "The displayed status may no longer reflect the current request cycle.",
    operatorGuidance: "Use the read-only refresh affordance or run the manual status wrapper.",
  },
] as const

export const LOCAL_RUNTIME_BOUNDARY_ITEMS = [
  "Status display only",
  "Manual wrappers remain operator-run",
  "No UI command execution",
  "No Docker metadata",
  "No backup metadata",
  "No port status",
  "No persistence or LAN exposure",
] as const

export const LOCAL_RUNTIME_SEMANTIC_ITEMS = [
  {
    label: "Status route",
    description: "Route/status API truth: this read-only handler is reachable and rendering its own status.",
  },
  {
    label: "Host-loopback checks",
    description: "Approved localhost app HTTP checks are separate from route status and may be unknown from a proof container namespace.",
  },
  {
    label: "Compatibility alias",
    description: "checks.app remains a compatibility alias for checks.appHttp; it is not the primary operator-facing concept.",
  },
] as const

export const LOCAL_RUNTIME_STATUS_BOUNDARY_COPY = {
  summary:
    "WilliamOS reports local runtime posture without taking control. The status route, host-loopback checks, and evidence references are separated so proof stays readable.",
  blocked:
    "No start, stop, restart, repair, schedule, persistence, LAN exposure, Docker metadata, backup scanning, port scanning, or command execution is available from this UI.",
  containerizedProof:
    "Host-loopback checks may show unknown when viewed from inside the proof container. WilliamOS does not start, stop, repair, or manage containers.",
  proofSummary:
    "Latest proof: the refreshed OMEN app image served /api/local/runtime/status successfully, then the proof container was removed and ports 3100/3101 were cleared.",
} as const
