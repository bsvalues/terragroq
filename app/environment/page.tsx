import { redirect } from "next/navigation"

import { getUserId } from "@/lib/session"
import { Desk } from "@/components/desk/desk"

/**
 * The replacement environment's entry (#762). Deliberately outside the (shell) layout group: nothing
 * of the legacy Workbench loads here, by construction and by acceptance test. When this root can do a
 * real development day, it replaces the old entry point; until then the legacy app remains reachable
 * separately, as compatibility only.
 */
export default async function EnvironmentRoot() {
  // A logged-out request must land at sign-in, never crash: session resolution can throw as well as
  // return null, and both mean the same thing here (review P1). Destination preservation through
  // sign-in would require changing the legacy auth flow, which the refusal list forbids -- it arrives
  // when the environment grows its own entry, and until then the cost is one extra navigation.
  let userId: string | null = null
  try {
    userId = await getUserId()
  } catch {
    userId = null
  }
  if (!userId) redirect("/sign-in")
  return <Desk />
}
