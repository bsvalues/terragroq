import { getAuthReadiness } from "@/lib/auth-readiness"
import { getProcessStartedAt } from "@/lib/runtime-instance"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import type { WorkspaceRepositoryMountView } from "@/lib/projects/core-seven-repositories"
import { resolveTerraFusionWorkspaceBinding } from "@/lib/projects/workspace-project-binding"
import { getUserId } from "@/lib/session"
import { AuthAside } from "@/components/auth-aside"
import { AuthSetupAssistant } from "@/components/setup/auth-setup-assistant"

export default async function SetupPage() {
  const readiness = await getAuthReadiness({ probeDatabase: true })
  const defaultAuthUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  let defaultTerraFusionRoot = ""
  let terraFusionRootConfigured = false
  let initialCoreSevenRepositories: readonly WorkspaceRepositoryMountView[] = []
  try {
    const userId = await getUserId()
    if (userId) {
      const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
      if (assertOwner(userId, ownerId).ok) {
        const binding = await resolveTerraFusionWorkspaceBinding(userId)
        if (binding.ok) {
          defaultTerraFusionRoot = binding.binding.configuredWorkspaceRoot
          terraFusionRootConfigured = true
          initialCoreSevenRepositories = binding.binding.project.repositories ?? []
        }
      }
    }
  } catch {
    // Setup remains available for bootstrap, but never claims an unverified target checkout.
  }
  const initialProcessStartedAt = getProcessStartedAt()

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-xl">
          <AuthSetupAssistant
            initialReadiness={readiness}
            defaultAuthUrl={defaultAuthUrl}
            defaultTerraFusionRoot={defaultTerraFusionRoot}
            initialTerraFusionRootConfigured={terraFusionRootConfigured}
            initialCoreSevenRepositories={initialCoreSevenRepositories}
            initialProcessStartedAt={initialProcessStartedAt}
          />
        </div>
      </div>
    </main>
  )
}
