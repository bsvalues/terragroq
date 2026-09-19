import { guardLineRequest } from "@/lib/environment/line-guard"

export function guardHelloApplicationMutation(request: Request): Response | null {
  const rejection = guardLineRequest(request)
  return rejection
    ? Response.json({ error: rejection.error }, { status: rejection.status, headers: { "cache-control": "no-store" } })
    : null
}
