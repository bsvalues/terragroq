import path from "node:path"

import { describe, expect, it } from "vitest"

import { unmountedPolicyVolumes } from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * `D:` was physically unplugged. The lane reported that its provider stack was not deployed and that its
 * pinned model was absent -- neither true -- and that false verdict was recorded against the lane.
 *
 * A verdict about whether a local model can implement must not be reachable from a loose cable. The
 * policy's pinned paths are checked first, and a volume that is not mounted says so by name.
 */
const B = String.fromCharCode(92)
const winPath = (...parts: string[]) => parts.join(B)

const POLICY = {
  placement: {
    dockerConfig: winPath("D:", "HermesServices", "williamos-hermes-agent", "docker-config"),
    workspaceRoot: winPath("D:", "HermesWorkspaces", "williamos-free-dev-agent"),
    baselineWorkspace: winPath("D:", "HermesWorkspaces", "williamos-free-dev-agent", "baseline"),
    baselineBundle: winPath("D:", "HermesServices", "williamos-hermes-agent", "williamos-baseline.bundle"),
    allowedWorkspaceRoots: [winPath("C:", "Users", "bs", ".williamos", "hermes-bridge", "worktrees")],
  },
}

describe("a pinned path on an unmounted volume", () => {
  it("names the volume rather than implying the deployment is missing", () => {
    const missing = unmountedPolicyVolumes(POLICY, (candidate: string) => !String(candidate).startsWith("D:"))
    expect(missing).toHaveLength(1)
    expect(missing[0].volume).toBe(`D:${B}`)
    expect(missing[0].example).toContain("HermesServices")
  })

  it("reports each volume once however many pinned paths live on it", () => {
    // Four of the five pinned paths are on D:; one reconnect fixes all four.
    const missing = unmountedPolicyVolumes(POLICY, (candidate: string) => !String(candidate).startsWith("D:"))
    expect(missing.map((entry) => entry.volume)).toEqual([`D:${B}`])
  })

  it("names every unmounted volume at once, not one reconnect at a time", () => {
    const missing = unmountedPolicyVolumes(POLICY, () => false)
    expect(missing.map((entry) => entry.volume).sort()).toEqual([`C:${B}`, `D:${B}`])
  })

  it("says nothing when every pinned volume is mounted", () => {
    expect(unmountedPolicyVolumes(POLICY, () => true)).toEqual([])
  })

  it("ignores a policy that pins nothing, rather than inventing a volume", () => {
    expect(unmountedPolicyVolumes({ placement: {} }, () => false)).toEqual([])
    expect(unmountedPolicyVolumes({}, () => false)).toEqual([])
    expect(unmountedPolicyVolumes(undefined, () => false)).toEqual([])
  })

  it("ignores relative pins, which name no volume to be missing", () => {
    const relative = { placement: { dockerConfig: path.join("config", "docker") } }
    expect(unmountedPolicyVolumes(relative, () => false)).toEqual([])
  })
})
