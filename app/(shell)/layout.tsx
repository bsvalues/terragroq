import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { AppShell } from "@/components/shell/app-shell"
import { LegacyRouteBanner } from "@/components/shell/legacy-route-banner"

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <LegacyRouteBanner />
      {children}
    </AppShell>
  )
}
