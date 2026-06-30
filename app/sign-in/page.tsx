import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { AuthForm } from "@/components/auth-form"
import { AuthAside } from "@/components/auth-aside"

export default async function SignInPage() {
  const session = await getSession()
  if (session?.user) redirect("/")
  const readiness = await getAuthReadiness({ probeDatabase: true })

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">Primary Operator access</h1>
            <p className="text-muted-foreground text-sm">
              Enter WilliamOS with the operator account created during bootstrap.
            </p>
          </div>
          <AuthForm mode="sign-in" readiness={readiness} />
        </div>
      </div>
    </main>
  )
}
