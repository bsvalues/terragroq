import { NextResponse } from "next/server"
import { getAuthReadiness } from "@/lib/auth-readiness"

export async function GET() {
  const readiness = await getAuthReadiness({ probeDatabase: true })
  const isProd = process.env.NODE_ENV === "production"
  const payload = isProd
    ? {
        ...readiness,
        issues: readiness.issues.map((issue) => ({
          ...issue,
          message:
            issue.severity === "error"
              ? "Authentication prerequisites are not satisfied. Contact your platform administrator."
              : "Authentication warning detected. Contact your platform administrator if sign-in fails.",
        })),
        signup: readiness.signup.open
          ? readiness.signup
          : {
              ...readiness.signup,
              reason:
                "Operator sign-up is not available. Contact your platform administrator.",
            },
      }
    : readiness

  return NextResponse.json(payload, {
    status: readiness.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
