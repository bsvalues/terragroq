import { resolveLoomRoot } from "@/lib/loom/load-workspace-root"

/**
 * The workspace root for one loom request, or a Response refusing it.
 *
 * This is what the routes call in place of the old module-scope
 * `const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()`. That constant was
 * resolved once at import, so it could be neither per-node nor per-Project, and it could never
 * refuse — a misconfigured deployment served whatever directory it happened to land in. Resolution
 * is now per-request, and when a Project is declared a binding failure is a typed 409, never a
 * silent ambient root.
 *
 * A 409 is deliberate: the deployment ASSERTS (by declaring a Project id) that it serves that
 * Project's canonical repository on this node, and the assertion does not hold. That is a conflict
 * between declared and actual state, not a bad request from the caller.
 */
export async function loomRootForRequest(): Promise<{ root: string } | Response> {
  const resolved = await resolveLoomRoot()
  if ("refused" in resolved) {
    return Response.json(
      { error: "WORKSPACE_BINDING_REFUSED", refusal: resolved.refused, detail: resolved.detail },
      { status: 409, headers: { "cache-control": "no-store" } },
    )
  }
  return { root: resolved.root }
}
