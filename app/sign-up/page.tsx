import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { AuthForm } from "@/components/auth-form"
import { AuthAside } from "@/components/auth-aside"

export default async function SignUpPage() {
  const session = await getSession()
  if (session?.user) redirect("/")

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">Provision operator</h1>
            <p className="text-muted-foreground text-sm">
              Create your account to start capturing memory, decisions, and doctrine.
            </p>
          </div>
          <AuthForm mode="sign-up" />
        </div>
      </div>
    </main>
  )
}
