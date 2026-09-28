import type { WilliamOSDeploymentStatus } from "@/lib/deployment/profile"

export function DeploymentProfileBanner({
  status,
}: {
  status: WilliamOSDeploymentStatus
}) {
  if (status.profile !== "county-development") return null

  const healthy = status.valid
  const detail = healthy
    ? `${status.deploymentId} · local AI · ${status.dataBoundary}`
    : `Boundary invalid · ${status.violations.join(" · ")}`

  return (
    <aside
      aria-label="WilliamOS deployment compartment"
      data-testid="county-development-profile-banner"
      data-boundary-valid={healthy ? "true" : "false"}
      title={detail}
      style={{
        position: "fixed",
        top: 8,
        right: 10,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: "min(720px, calc(100vw - 20px))",
        padding: "6px 10px",
        border: `1px solid ${healthy ? "rgba(34, 211, 238, 0.48)" : "rgba(248, 113, 113, 0.72)"}`,
        borderRadius: 999,
        background: healthy ? "rgba(7, 21, 31, 0.94)" : "rgba(55, 12, 18, 0.96)",
        color: healthy ? "rgb(165, 243, 252)" : "rgb(254, 202, 202)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        fontSize: 11,
        lineHeight: 1.2,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        backdropFilter: "blur(12px)",
      }}
    >
      <strong>{status.label}</strong>
      <span aria-hidden>·</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {healthy ? `${status.chatModel} · LOCAL ONLY` : "BOUNDARY INVALID"}
      </span>
    </aside>
  )
}
