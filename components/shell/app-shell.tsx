import { AppShellFrame } from "./app-shell-frame"
import { HealthStatusStrip } from "./health-status-strip"
import { RUNTIME } from "@/lib/ai/config"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getAuthReadiness } from "@/lib/auth-readiness"

export async function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string }
  children: React.ReactNode
}) {
  const [readiness, runtime] = await Promise.all([
    getAuthReadiness({ probeDatabase: true }),
    Promise.resolve(buildRuntimeStatus()),
  ])

  return (
    <AppShellFrame
      user={user}
      modelName={RUNTIME.chatModel}
      healthStrip={<HealthStatusStrip readiness={readiness} runtime={runtime} />}
    >
      {children}
    </AppShellFrame>
  )
}
