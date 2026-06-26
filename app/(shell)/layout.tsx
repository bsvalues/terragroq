import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { AppShell } from "@/components/shell/app-shell"

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      {children}
    </AppShell>
  )
}
