import { describe, it, expect } from "vitest"

import { bindW1Runtime } from "@/lib/loom/runtime-binding"
import type { ServiceResourceLike, ServiceEndpointLike } from "@/lib/loom/runtime-binding"

/**
 * Verbatim from ATLAS after the owner's two decisions on 2026-08-26: Project 2's primary repo
 * ratified, and a canonical workspace-runtime service declared+ratified. These rows drive the
 * refusal PROGRESSION the model is meant to produce, checked against real state rather than
 * invented fixtures.
 */

// Project 2 services after the owner declaration: the PACS data runtime (pre-existing) and the new
// workspace-runtime service id=42. No endpoints exist on any node yet.
const SERVICES: ServiceResourceLike[] = [
  { id: 40, resourceKey: "pacs", relationship: "runtime", type: "service",
    canonicalIdentity: "aegis:/home/bs/mssql/data", ratifiedAt: new Date("2026-08-19T00:27:07Z") },
  { id: 42, resourceKey: "workspace-runtime", relationship: "workspace-runtime", type: "service",
    canonicalIdentity: "terrafusion/os-shell", ratifiedAt: new Date("2026-08-26T18:52:38Z") },
]
const NO_ENDPOINTS: ServiceEndpointLike[] = []

describe("live ATLAS runtime progression, project 2", () => {
  it("no longer refuses NO_WORKSPACE_RUNTIME — the service is declared", () => {
    // Before the owner decision this was NO_WORKSPACE_RUNTIME. The declaration moved it forward.
    const r = bindW1Runtime({ projectId: 2, services: SERVICES, endpoints: NO_ENDPOINTS, node: "hermes" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refusal).not.toBe("NO_WORKSPACE_RUNTIME")
  })

  it("refuses NOT_SERVED_ON_NODE — the service exists but has no endpoint yet", () => {
    // The precise current truth. PROVISION_AND_OBSERVE creates the endpoint; until then there is
    // nothing to serve. (RUNTIME_NOT_OBSERVED would require an endpoint row with no observed Project.)
    const r = bindW1Runtime({ projectId: 2, services: SERVICES, endpoints: NO_ENDPOINTS, node: "hermes" })
    expect(r).toMatchObject({ ok: false, refusal: "NOT_SERVED_ON_NODE" })
  })

  it("does not mistake the PACS runtime for the workspace runtime", () => {
    // Both are `service` rows; only id=42 is the workspace runtime. Selecting the default
    // relationship must never bind the SQL Server data runtime.
    const r = bindW1Runtime({ projectId: 2, services: SERVICES, endpoints: NO_ENDPOINTS, node: "hermes" })
    if (!r.ok) expect(r.refusal).not.toBe("AMBIGUOUS_WORKSPACE_RUNTIME")
  })

  it("would bind once a real endpoint reports Project 2 at a revision", () => {
    // The shape PROVISION must write. A belonging-proven endpoint binds; nothing else does.
    const provisioned: ServiceEndpointLike[] = [
      { projectResourceId: 42, node: "hermes", endpoint: "https://hermes.local:PORT",
        observedProjectId: 2, observedServiceIdentity: "terrafusion/os-shell",
        observedRevision: "fd294dc3", ratifiedAt: null },
    ]
    const r = bindW1Runtime({ projectId: 2, services: SERVICES, endpoints: provisioned, node: "hermes" })
    expect(r).toMatchObject({ ok: true, resourceId: 42, projectId: 2 })
  })

  it("still refuses an endpoint that serves another Project", () => {
    const wrong: ServiceEndpointLike[] = [
      { projectResourceId: 42, node: "hermes", endpoint: "https://hermes.local:PORT",
        observedProjectId: 41, observedServiceIdentity: "localops", observedRevision: "abc",
        ratifiedAt: null },
    ]
    expect(bindW1Runtime({ projectId: 2, services: SERVICES, endpoints: wrong, node: "hermes" })).toMatchObject({
      ok: false,
      refusal: "RUNTIME_PROJECT_MISMATCH",
    })
  })
})
