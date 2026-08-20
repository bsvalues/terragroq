import { redirect } from "next/navigation"

import { getUserId } from "@/lib/session"
import { Environment } from "@/components/environment/environment"

/**
 * The Environment (#762) — greenfield. Deliberately outside the (shell) layout group: none of the
 * frozen Workbench chrome loads here. The screen starts almost empty and assembles around the work.
 */
export default async function EnvironmentPage() {
  const userId = await getUserId()
  if (!userId) redirect("/sign-in")
  return <Environment />
}
