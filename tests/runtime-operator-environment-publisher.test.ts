import { describe, expect, it } from "vitest"

import {
  buildEndpointRuntimeRequest,
  buildObservationRuntimeRequest,
  buildValidationReceipt,
  environmentPort,
  environmentPublicUrl,
  environmentRuntimeResponseIsRetryable,
  environmentRuntimePayloadDigest,
  environmentWorldId,
  requireEnvironmentValidationReceipt,
} from "../scripts/runtime-operator/environment-publisher.mjs"

describe("resident Environment publisher contract", () => {
  it("recognizes only an exact durable world marker", () => {
    expect(environmentWorldId("work [environment-world:world-42] now")).toBe("world-42")
    expect(environmentWorldId("environment world 42")).toBeNull()
  })

  it("derives a bounded stable port and a client-safe public URL", () => {
    expect(environmentPort("world-42", "4200-4299")).toBe(environmentPort("world-42", "4200-4299"))
    expect(environmentPublicUrl("https://worlds.example.test/{worldId}?port={port}", {
      worldId: "world-42", port: 4242,
    })).toBe("https://worlds.example.test/world-42?port=4242")
    expect(() => environmentPublicUrl("http://worlds.example.test/{worldId}", {
      worldId: "world-42", port: 4242,
    })).toThrow("ENVIRONMENT_RUNTIME_PUBLIC_URL_WALL")
  })

  it("waits only for retryable runtime admission failures", () => {
    expect(environmentRuntimeResponseIsRetryable(409, "WORLD_CONCURRENTLY_CHANGED")).toBe(true)
    expect(environmentRuntimeResponseIsRetryable(422, "ENDPOINT_PUBLIC_NOT_READY")).toBe(true)
    expect(environmentRuntimeResponseIsRetryable(503, "UNKNOWN")).toBe(true)
    expect(environmentRuntimeResponseIsRetryable(409, "ENDPOINT_PUBLIC_IDENTITY_MISMATCH")).toBe(false)
    expect(environmentRuntimeResponseIsRetryable(403, "RUNTIME_AUTHORITY_GRANT_INVALID")).toBe(false)
  })

  it("binds endpoint and validation packets to the same world, branch, head, and durable evidence", () => {
    const endpoint = buildEndpointRuntimeRequest({
      worldId: "world-42",
      workOrderRef: "WO-0042",
      grantRef: "GRANT-0042",
      resourceIdentity: "repo:application",
      workspace: "/worktrees/wo-0042",
      branch: "runtime/wo-0042",
      head: "0123456789abcdef0123456789abcdef01234567",
      port: 4242,
      publicUrl: "https://worlds.example.test/world-42",
      evidenceRef: "EV-0042-ENDPOINT",
      capturedAt: "2026-08-20T20:00:00.000Z",
    })
    const observation = buildObservationRuntimeRequest({
      endpointRequest: endpoint,
      evidenceRef: "EV-0042-EXECUTION",
      validators: ["test", "build"],
      changedPaths: ["app/sign-in/page.tsx"],
    })
    expect(endpoint.endpoint).toMatchObject({
      worldId: "world-42", branch: "runtime/wo-0042", head: "0123456789abcdef0123456789abcdef01234567",
      probeUrl: "http://127.0.0.1:4242", appUrl: "https://worlds.example.test/world-42",
    })
    expect(observation.observation.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tests", evidenceRef: "EV-0042-EXECUTION" }),
    ]))
    expect(environmentRuntimePayloadDigest(endpoint)).toMatch(/^[0-9a-f]{64}$/)
    expect(environmentRuntimePayloadDigest(observation)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("accepts only a strict test-and-build receipt for the exact committed tree", () => {
    const receipt = buildValidationReceipt({
      tree: "tree-one",
      gates: ["build", "test", "diff-check"],
      buildId: "build-one",
      strict: true,
      recordedAt: "2026-08-20T20:00:00.000Z",
    })
    expect(() => requireEnvironmentValidationReceipt({
      receipt, tree: "tree-one", buildId: "build-one", validators: ["test", "build"],
    })).not.toThrow()
    expect(() => requireEnvironmentValidationReceipt({
      receipt, tree: "tree-two", buildId: "build-one", validators: ["test", "build"],
    })).toThrow("ENVIRONMENT_RUNTIME_VALIDATION_BINDING_WALL")
    expect(() => requireEnvironmentValidationReceipt({
      receipt, tree: "tree-one", buildId: "build-one", validators: ["build"],
    })).toThrow("ENVIRONMENT_RUNTIME_VALIDATION_BINDING_WALL")
  })
})
