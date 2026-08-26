import { describe, it, expect } from "vitest"

import {
  bindW1Runtime,
  WORKSPACE_RUNTIME_RELATIONSHIP,
  type RuntimeBindingInput,
  type ServiceEndpointLike,
  type ServiceResourceLike,
} from "@/lib/loom/runtime-binding"

const RATIFIED = new Date("2026-08-01T00:00:00.000Z")

function service(over: Partial<ServiceResourceLike> = {}): ServiceResourceLike {
  return {
    id: 50,
    resourceKey: null,
    relationship: WORKSPACE_RUNTIME_RELATIONSHIP,
    type: "service",
    canonicalIdentity: "terrafusion-workspace",
    ratifiedAt: null,
    ...over,
  }
}

function endpoint(over: Partial<ServiceEndpointLike> = {}): ServiceEndpointLike {
  return {
    projectResourceId: 50,
    node: "hermes",
    endpoint: "https://192.168.88.9:5199",
    observedProjectId: 2,
    observedServiceIdentity: "terrafusion",
    observedRevision: "731b15f0",
    ratifiedAt: null,
    ...over,
  }
}

function bind(over: Partial<RuntimeBindingInput> = {}) {
  return bindW1Runtime({
    projectId: 2,
    services: [service()],
    endpoints: [endpoint()],
    node: "hermes",
    ...over,
  })
}

describe("bindW1Runtime proves belonging, not appearance", () => {
  it("binds the endpoint that reports the bound Project", () => {
    expect(bind()).toMatchObject({
      ok: true,
      endpoint: "https://192.168.88.9:5199",
      node: "hermes",
      projectId: 2,
      resourceId: 50,
    })
  })

  it("refuses NO_PROJECT rather than admitting anything", () => {
    expect(bind({ projectId: null })).toMatchObject({ ok: false, refusal: "NO_PROJECT" })
  })

  it("refuses NO_WORKSPACE_RUNTIME when the Project has none", () => {
    // Project 2's only `runtime` service in the live store is the PACS data runtime, which is not a
    // workspace-runtime, so today this is the honest answer: the owner has not declared one.
    expect(bind({ services: [service({ relationship: "runtime" })] })).toMatchObject({
      ok: false,
      refusal: "NO_WORKSPACE_RUNTIME",
    })
  })

  it("does not mistake the PACS runtime for the workspace runtime", () => {
    const pacs = service({ id: 40, relationship: "runtime", canonicalIdentity: "aegis:/home/bs/mssql/data" })
    expect(bind({ services: [pacs] })).toMatchObject({ ok: false, refusal: "NO_WORKSPACE_RUNTIME" })
  })

  it("refuses AMBIGUOUS_WORKSPACE_RUNTIME when the Project has two", () => {
    const r = bind({ services: [service(), service({ id: 51 })] })
    expect(r).toMatchObject({ ok: false, refusal: "AMBIGUOUS_WORKSPACE_RUNTIME" })
    if (!r.ok) expect(r.detail).toMatch(/ids 50, 51/)
  })

  it("refuses NOT_SERVED_ON_NODE for a node with no endpoint", () => {
    expect(bind({ node: "omen" })).toMatchObject({ ok: false, refusal: "NOT_SERVED_ON_NODE" })
  })

  it("refuses RUNTIME_NOT_OBSERVED when belonging was never reported", () => {
    // Appearance is not belonging. An endpoint that has never said which Project it serves cannot
    // be bound, even if a header would say terrafusion.
    expect(bind({ endpoints: [endpoint({ observedProjectId: null })] })).toMatchObject({
      ok: false,
      refusal: "RUNTIME_NOT_OBSERVED",
    })
  })

  it("refuses RUNTIME_PROJECT_MISMATCH when the endpoint serves another Project", () => {
    // The 2026-08-26 failure at the runtime level: a real TerraFusion build on an invented port
    // serving a different Project's world.
    const r = bind({ endpoints: [endpoint({ observedProjectId: 41 })] })
    expect(r).toMatchObject({ ok: false, refusal: "RUNTIME_PROJECT_MISMATCH" })
    if (!r.ok) expect(r.detail).toMatch(/reports project 41, not 2/)
  })

  it("selects by resourceKey when one is present", () => {
    const r = bind({
      services: [service({ resourceKey: "ws-runtime", relationship: "runtime" })],
      serviceSelector: "ws-runtime",
    })
    expect(r.ok).toBe(true)
  })

  it("binds while unratified — binding and certification are different questions", () => {
    const r = bind()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ratified).toBe(false)
  })

  it("reports ratified only when BOTH service and endpoint are confirmed", () => {
    expect(
      bind({ services: [service({ ratifiedAt: RATIFIED })], endpoints: [endpoint({ ratifiedAt: RATIFIED })] }),
    ).toMatchObject({ ok: true, ratified: true })
    expect(bind({ services: [service({ ratifiedAt: RATIFIED })] })).toMatchObject({ ok: true, ratified: false })
  })

  it("carries the observed revision so a deployed SHA can be proven equal to the landed one", () => {
    const r = bind()
    if (r.ok) expect(r.observedRevision).toBe("731b15f0")
  })
})
