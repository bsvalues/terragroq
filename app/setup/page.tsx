import { getAuthReadiness } from "@/lib/auth-readiness"
import { getProcessStartedAt } from "@/lib/runtime-instance"
import { AuthAside } from "@/components/auth-aside"
import { AuthSetupAssistant } from "@/components/setup/auth-setup-assistant"

export default async function SetupPage() {
  const readiness = await getAuthReadiness({ probeDatabase: true })
  const defaultAuthUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  const initialProcessStartedAt = getProcessStartedAt()

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-xl">
          <AuthSetupAssistant
            initialReadiness={readiness}
            defaultAuthUrl={defaultAuthUrl}
            initialProcessStartedAt={initialProcessStartedAt}
          />
        </div>
      </div>
    </main>
  )
}
