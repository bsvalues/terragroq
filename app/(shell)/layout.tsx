import { headers } from "next/headers"
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
  if (!session?.user) {
    // A device whose certificate TLS already verified does not get asked to log in.
    const device = (await headers()).get("x-williamos-device")
    redirect(device ? "/api/device-cert/session?next=/" : "/sign-in")
  }

  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <LegacyRouteBanner />
      {children}
    </AppShell>
  )
}
