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

export const LOCAL_RUNTIME_STATUS_BOUNDARY_COPY = {
  summary:
    "WilliamOS status route is live when this panel receives the GET response. Approved host-loopback checks are shown separately; the Primary Operator still runs the wrappers manually.",
  blocked:
    "No start, stop, restart, repair, schedule, persistence, LAN exposure, Docker metadata, backup scanning, port scanning, or command execution is available from this UI.",
  containerizedProof:
    "Host-loopback checks may show unknown when viewed from inside the proof container. WilliamOS does not start, stop, repair, or manage containers.",
} as const
