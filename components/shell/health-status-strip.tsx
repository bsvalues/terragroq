import Link from "next/link"
import type { AuthReadiness } from "@/lib/auth-readiness"
import type { RuntimeStatus } from "@/lib/ai/runtime"
import { cn } from "@/lib/utils"
import { getSignupStatus, type HealthTone } from "./health-status"

function chipClass(tone: HealthTone) {
  return cn(
    "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px]",
    tone === "ready" && "border-success/30 bg-success/15 text-success",
    tone === "warn" && "border-warning/30 bg-warning/15 text-warning",
    tone === "blocked" && "border-destructive/30 bg-destructive/15 text-destructive",
  )
}

export function HealthStatusStrip({
  readiness,
  runtime,
}: {
  readiness: AuthReadiness
  runtime: RuntimeStatus
}) {
  const env =
    process.env.NODE_ENV === "production"
      ? "prod"
      : process.env.VERCEL_ENV === "preview"
        ? "preview"
        : "local"
  const setupAvailable =
    process.env.NODE_ENV !== "production" &&
    process.env.LOCAL_SETUP_ENABLED !== "false" &&
    process.env.AUTH_SIGNUP_MODE !== "closed"
  const signupStatus = getSignupStatus(readiness)

  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          System status
        </span>
        <span className={chipClass(readiness.databaseReady ? "ready" : "blocked")}>
          DB: {readiness.databaseReady ? "ready" : "blocked"}
        </span>
        <span className={chipClass(readiness.authReady ? "ready" : "blocked")}>
          Auth: {readiness.authReady ? "ready" : "setup needed"}
        </span>
        <span className={chipClass(signupStatus.tone)} title={signupStatus.title}>
          {signupStatus.label}
        </span>
        <span className={chipClass(runtime.fallback ? "warn" : "ready")}>
          Runtime: {runtime.fallback ? "fallback" : "explicit"}
        </span>
        <span className={chipClass(env === "local" ? "warn" : "ready")}>
          Env: {env}
        </span>
        {!readiness.ready && setupAvailable ? (
          <Link
            href="/setup"
            className="ml-auto rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open setup
          </Link>
        ) : null}
      </div>
    </div>
  )
}
