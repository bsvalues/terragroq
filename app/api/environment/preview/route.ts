import { inspectWorkspaceApp, williamOsOrigin } from "@/lib/environment/workspace-app"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
})

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return reply({ error: "UNAUTHENTICATED" }, 401)
  const evidence = await inspectWorkspaceApp(
    process.env.WILLIAMOS_WORKSPACE_APP_URL?.trim() || null,
    williamOsOrigin(process.env.BETTER_AUTH_URL?.trim() || null, request.url),
  )
  return reply({ evidence })
}
