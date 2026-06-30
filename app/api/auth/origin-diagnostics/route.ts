import { NextResponse } from "next/server"
import { getOriginDiagnostics } from "@/lib/auth-origins"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const diagnostics = getOriginDiagnostics(req)
  const isProd = process.env.NODE_ENV === "production"

  return NextResponse.json(
    {
      ok: true,
      diagnostics: isProd
        ? {
            currentOrigin: diagnostics.currentOrigin,
            isCurrentOriginTrusted: diagnostics.isCurrentOriginTrusted,
            warnings: diagnostics.warnings.map(() => "Auth origin diagnostic warning detected."),
            recoveryActions: diagnostics.recoveryActions.map(
              () => "Contact your platform administrator to verify trusted origin settings.",
            ),
          }
        : diagnostics,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
