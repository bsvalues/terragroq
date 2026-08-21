import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { EnvironmentRoot } from "@/components/environment-root/environment-root"
import { loadCurrentEnvironmentWorld } from "@/lib/environment/server"
import { getSession } from "@/lib/session"

export const metadata: Metadata = {
  title: "Environment",
  description: "The current working world.",
}

export const dynamic = "force-dynamic"

export default async function EnvironmentPage() {
  const session = await getSession().catch(() => null)
  if (!session?.user) redirect("/environment/sign-in")

  const initialWorld = await loadCurrentEnvironmentWorld(null, session.user.id)
  return <EnvironmentRoot initialWorld={initialWorld} />
}
