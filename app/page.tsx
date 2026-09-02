import { notFound, redirect } from "next/navigation"

import { getUserId } from "@/lib/session"
import { Desk } from "@/components/desk/desk"
import { isSummonedSurface } from "@/lib/environment/summon"
import { ensureCanonicalOwnerProjects } from "@/lib/projects/owner-project-provisioning"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"

/**
 * `/` IS the working environment.
 *
 * Owner directive, 2026-08-22 (the Primary Experience Replacement): the repository kept embodying the
 * old product more strongly than any instruction embodied the new one, and code wins. An agent opening
 * this repo met `WorkbenchShell`, `WorkbenchViewMode`, `ProjectExplorer`, `Inspector`, and routes for
 * /projects, /activity, /system — and correctly concluded "this is a web application with sections and
 * an AI feature". Every new capability was then implemented through those seams, which is why a month
 * of saying "workspace, not dashboard" produced more dashboard.
 *
 * So the root abstraction changes, not the styling. When WilliamOS opens, you are already inside it:
 * there is no Home to land on, nothing to navigate to, and no Environment to go find. Projects,
 * activity, system state, threads and workers are DATA the environment surfaces when they matter —
 * they are not applications with pages.
 *
 * The legacy shell survives at its own routes as COMPATIBILITY ONLY, marked for deletion. It is no
 * longer the application frame, and `tests/primary-experience-contract.test.ts` fails the build if it
 * becomes one again.
 *
 * This is the ONLY environment root. `/env` (#919) and `/environment` (#922) were the two predecessor
 * compositions the collision map named -- "three compositions, not two", with the collapse assigned
 * to this lane -- and they now redirect here rather than standing beside it. Adding `/` while leaving
 * both alive would have been the third shell the map warned about, shipped by the change that was
 * supposed to prevent it.
 */
export default async function WilliamOSRoot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // A logged-out request lands at sign-in, never crashes: session resolution can throw as well as
  // return null, and both mean the same thing here.
  let userId: string | null = null
  try {
    userId = await getUserId()
  } catch {
    userId = null
  }
  if (!userId) redirect("/sign-in")
  const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
  if (!assertOwner(userId, ownerId).ok) notFound()
  // The first authenticated landing is also the retryable provisioning seam for the owner's
  // canonical Projects. Signup cannot safely own this: its post-create hooks run after the user
  // transaction commits, so a transient failure could otherwise strand a valid owner with no
  // usable Space. Awaiting here guarantees the workspace never hydrates ahead of its Project truth.
  await ensureCanonicalOwnerProjects(userId)
  // A superseded route redirected here carrying the surface it used to be. Anything unrecognized is
  // simply dropped: an unknown surface name opens the ordinary empty environment rather than an error
  // page, because a stale bookmark is not a fault the owner needs reported.
  const params = await searchParams
  const requested = params.summon
  const projectKey = params.project === "williamos" ? "williamos" : "terrafusion"
  return <Desk initialSummon={isSummonedSurface(requested) ? requested : null} projectKey={projectKey} />
}
