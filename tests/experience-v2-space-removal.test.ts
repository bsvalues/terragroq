import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  removeOwnedProjectSpace,
  workspaceProjectFromRoot,
  type RemoveOwnedProjectSpaceResult,
  type SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"

const remove = vi.fn<(
  userId: string,
  projectIdentity: string,
  worldId: string,
) => Promise<RemoveOwnedProjectSpaceResult>>()

const store: SpaceWorkingWorldStore = {
  findOwned: vi.fn(),
  findLatestOwned: vi.fn(),
  findLatestOwnedForProject: vi.fn(),
  insertOwned: vi.fn(),
  updateOwned: vi.fn(),
  removeOwnedProjectSpace: remove,
}

beforeEach(() => remove.mockReset().mockResolvedValue("removed"))

describe("owned project Space removal", () => {
  const project = workspaceProjectFromRoot("C:\\repos\\TerraFusion")

  it("binds the mutation to the exact owner, configured project identity, and Space", async () => {
    await expect(removeOwnedProjectSpace({
      userId: "owner-a", project, worldId: "world-b",
    }, store)).resolves.toEqual({ removedWorldId: "world-b" })
    expect(remove).toHaveBeenCalledWith("owner-a", "c:/repos/terrafusion", "world-b")
  })

  it.each([
    ["not-found", "WORLD_NOT_FOUND"],
    ["project-mismatch", "SPACE_PROJECT_MISMATCH"],
    ["last-space", "SPACE_LAST_PROJECT_SPACE"],
  ] as const)("maps %s to a typed product error", async (result, error) => {
    remove.mockResolvedValueOnce(result)
    await expect(removeOwnedProjectSpace({
      userId: "owner-a", project, worldId: "world-b",
    }, store)).rejects.toThrow(error)
  })

  it("fails closed when a store has no atomic removal operation", async () => {
    await expect(removeOwnedProjectSpace({
      userId: "owner-a", project, worldId: "world-b",
    }, { ...store, removeOwnedProjectSpace: undefined })).rejects.toThrow("SPACE_REMOVAL_UNAVAILABLE")
  })
})
