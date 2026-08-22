import { redirect } from "next/navigation"

import { getUserId } from "@/lib/session"
import { Desk } from "@/components/desk/desk"

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
 */
export default async function WilliamOSRoot() {
  // A logged-out request lands at sign-in, never crashes: session resolution can throw as well as
  // return null, and both mean the same thing here.
  let userId: string | null = null
  try {
    userId = await getUserId()
  } catch {
    userId = null
  }
  if (!userId) redirect("/sign-in")
  return <Desk />
}
