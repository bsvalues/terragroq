import { NextResponse } from "next/server"
import { getOriginDiagnostics } from "@/lib/auth-origins"

export const runtime = "nodejs"

export async function GET(req: Request) {
  return NextResponse.json(
    {
      ok: true,
      diagnostics: getOriginDiagnostics(req),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
