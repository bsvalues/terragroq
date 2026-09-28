import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import type { WorkspaceRepositoryMountView } from "@/lib/projects/core-seven-repositories"
import { resolveTerraFusionWorkspaceBinding } from "@/lib/projects/workspace-project-binding"
import { getProcessStartedAt, getRuntimeInstanceId } from "@/lib/runtime-instance"
import { getSession } from "@/lib/session"

export const runtime = "nodejs"

function localSetupEnabled() {
  if (process.env.LOCAL_SETUP_ENABLED === "false") return false
  return process.env.NODE_ENV !== "production"
}

function isLoopbackHost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
}

export async function GET(req: Request) {
  if (!localSetupEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup status is disabled in this environment. Contact your platform administrator.",
      },
      { status: 403 },
    )
  }

  const url = new URL(req.url)
  if (!isLoopbackHost(url)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup status only accepts loopback requests. Use localhost when running setup.",
      },
      { status: 403 },
    )
  }

  const readiness = await getAuthReadiness({ probeDatabase: true })
  let terraFusionRootConfigured = false
  let terraFusionRootStatus = "UNAUTHENTICATED"
  let coreSevenRepositories: readonly WorkspaceRepositoryMountView[] = []
  const session = await getSession()
  if (session?.user) {
    const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
    const owner = assertOwner(session.user.id, ownerId)
    if (owner.ok) {
      const binding = await resolveTerraFusionWorkspaceBinding(session.user.id)
      terraFusionRootConfigured = binding.ok
      terraFusionRootStatus = binding.ok ? "VERIFIED" : binding.error
      coreSevenRepositories = binding.ok ? binding.binding.project.repositories ?? [] : []
    } else {
      terraFusionRootStatus = owner.failure ?? "OWNER_UNRESOLVED"
    }
  }
  return NextResponse.json(
    {
      ok: true,
      readiness,
      terraFusionRootConfigured,
      terraFusionRootStatus,
      coreSevenRepositories,
      processStartedAt: getProcessStartedAt(),
      runtimeInstanceId: getRuntimeInstanceId(),
      checkedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
