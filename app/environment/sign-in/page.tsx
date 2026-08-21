import { redirect } from "next/navigation"

import { EnvironmentSignIn } from "@/components/environment-root/environment-sign-in"
import { passkeyResolution } from "@/lib/auth"
import { passkeyUnavailableCopy } from "@/lib/auth-passkey"
import { getSession } from "@/lib/session"

export default async function EnvironmentSignInPage() {
  const session = await getSession().catch(() => null)
  if (session?.user) redirect("/environment")
  return (
    <EnvironmentSignIn
      passkeyAvailable={passkeyResolution.available}
      passkeyUnavailableReason={passkeyUnavailableCopy(passkeyResolution)}
    />
  )
}
