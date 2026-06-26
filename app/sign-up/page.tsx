import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { AuthForm } from "@/components/auth-form"
import { AuthAside } from "@/components/auth-aside"

export default async function SignUpPage() {
  const session = await getSession()
  if (session?.user) redirect("/")

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <AuthForm mode="sign-up" />
      </div>
      <AuthAside />
    </main>
  )
}
