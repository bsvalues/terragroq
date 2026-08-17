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
    //
    // This must be the header the PROXY asserts, not the one a client sets. It briefly read
    // "x-williamos-device" -- the device-mutation header from lib/device-auth/contract.ts, which any
    // client can send -- so certificate devices stopped being recognised and landed on the sign-in
    // page instead, while an ordinary client could have triggered the redirect by asking for it.
    const device = (await headers()).get("x-williamos-device-cert")
    redirect(device ? "/api/device-cert/session?next=/" : "/sign-in")
  }

  return (
    <AppShell user={{ id: session.user.id, name: session.user.name, email: session.user.email }}>
      <LegacyRouteBanner />
      {children}
    </AppShell>
  )
}
