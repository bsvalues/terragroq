import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react"
import { AuthAside } from "@/components/auth-aside"
import { Button } from "@/components/ui/button"
import { getOperatorLoginSurface } from "@/lib/operator-login-surface"
import { getSession } from "@/lib/session"

const noticeIcons = {
  neutral: ShieldCheck,
  locked: LockKeyhole,
  disabled: KeyRound,
}

const noticeClasses = {
  neutral: "border-border bg-muted/30",
  locked: "border-warning/30 bg-warning/10",
  disabled: "border-border bg-card",
}

const actionButtonVariants = {
  primary: "default",
  secondary: "outline",
  muted: "ghost",
} as const

export default async function OperatorPage() {
  const session = await getSession()
  if (session?.user) redirect("/")

  const surface = getOperatorLoginSurface()

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <AuthAside />
      <section className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-xl flex-col gap-8">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-primary">
              {surface.eyebrow}
            </p>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-balance">
                {surface.title}
              </h1>
              <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                {surface.description}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={surface.primaryAction.href}>
                {surface.primaryAction.label}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            {surface.secondaryActions.map((action) => (
              <Button
                key={action.href}
                asChild
                size="lg"
                variant={actionButtonVariants[action.variant]}
              >
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ))}
          </div>

          <div id="scoped-access" className="grid gap-3">
            {surface.notices.map((notice) => {
              const Icon = noticeIcons[notice.tone]
              return (
                <article
                  key={notice.title}
                  className={`rounded-xl border p-4 ${noticeClasses[notice.tone]}`}
                >
                  <div className="flex gap-3">
                    <Icon className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
                    <div className="space-y-1">
                      <h2 className="text-sm font-medium">{notice.title}</h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {notice.body}
                      </p>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </main>
  )
}
