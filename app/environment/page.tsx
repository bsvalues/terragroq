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
  const userId = await getUserId()
  if (!userId) redirect("/sign-in")
  return <Desk />
}
